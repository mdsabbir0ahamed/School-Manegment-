/**
 * Shared helper: resolve a parent's phone number for a given student and send
 * SMS / WhatsApp notifications if the tenant has Twilio configured and the
 * relevant channel toggle is enabled.
 *
 * Resolution order: linked parent user account → student.parentPhone field.
 */

import { db } from "@workspace/db";
import {
  tenantsTable, studentsTable, parentStudentsTable, usersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { sendSms, sendWhatsapp, type SmsConfig } from "./sms.js";
import { logger } from "./logger.js";

export interface NotifyParentResult {
  phoneUsed: string | null;
  channelsSent: string[];
}

type Trigger = "payment" | "attendance";

async function getTenantSmsConfig() {
  const [tenant] = await db.select({
    twilioAccountSid: tenantsTable.twilioAccountSid,
    twilioAuthToken: tenantsTable.twilioAuthToken,
    twilioFromPhone: tenantsTable.twilioFromPhone,
    twilioWhatsappFrom: tenantsTable.twilioWhatsappFrom,
    smsEnabled: tenantsTable.smsEnabled,
    whatsappEnabled: tenantsTable.whatsappEnabled,
    attendanceSmsEnabled: tenantsTable.attendanceSmsEnabled,
    attendanceWhatsappEnabled: tenantsTable.attendanceWhatsappEnabled,
  }).from(tenantsTable).limit(1);
  return tenant ?? null;
}

function channelFlags(tenant: NonNullable<Awaited<ReturnType<typeof getTenantSmsConfig>>>, trigger: Trigger) {
  return {
    smsOk: trigger === "payment" ? (tenant.smsEnabled ?? false) : (tenant.attendanceSmsEnabled ?? false),
    waOk: trigger === "payment" ? (tenant.whatsappEnabled ?? false) : (tenant.attendanceWhatsappEnabled ?? false),
  };
}

async function resolvePhone(studentId: number): Promise<string | null> {
  const [linked] = await db
    .select({ phoneNumber: usersTable.phoneNumber })
    .from(parentStudentsTable)
    .innerJoin(usersTable, eq(usersTable.id, parentStudentsTable.parentUserId))
    .where(eq(parentStudentsTable.studentId, studentId))
    .limit(1);
  if (linked?.phoneNumber) return linked.phoneNumber;

  const [student] = await db
    .select({ parentPhone: studentsTable.parentPhone })
    .from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
  return student?.parentPhone ?? null;
}

async function dispatch(phone: string, body: string, cfg: SmsConfig, smsOk: boolean, waOk: boolean): Promise<string[]> {
  const sent: string[] = [];
  if (smsOk && cfg.fromPhone) {
    const r = await sendSms(phone, body, cfg);
    if (r.delivered) sent.push("SMS");
    else logger.warn({ phone, error: r.error }, "SMS not delivered");
  }
  if (waOk && cfg.whatsappFrom) {
    const r = await sendWhatsapp(phone, body, cfg);
    if (r.delivered) sent.push("WhatsApp");
    else logger.warn({ phone, error: r.error }, "WhatsApp not delivered");
  }
  return sent;
}

/**
 * Notify a single student's parent via SMS / WhatsApp.
 */
export async function notifyParentBySms(opts: {
  studentId: number;
  message: string;
  trigger: Trigger;
}): Promise<NotifyParentResult> {
  const tenant = await getTenantSmsConfig();
  if (!tenant?.twilioAccountSid || !tenant.twilioAuthToken) return { phoneUsed: null, channelsSent: [] };

  const cfg: SmsConfig = {
    accountSid: tenant.twilioAccountSid,
    authToken: tenant.twilioAuthToken,
    fromPhone: tenant.twilioFromPhone ?? "",
    whatsappFrom: tenant.twilioWhatsappFrom ?? "",
  };

  const { smsOk, waOk } = channelFlags(tenant, opts.trigger);
  if (!smsOk && !waOk) return { phoneUsed: null, channelsSent: [] };

  const phone = await resolvePhone(opts.studentId);
  if (!phone) return { phoneUsed: null, channelsSent: [] };

  const channelsSent = await dispatch(phone, opts.message, cfg, smsOk, waOk);
  return { phoneUsed: phone, channelsSent };
}

/**
 * Bulk version: notify parents for multiple absent students in parallel.
 * One tenant DB fetch; all student phone lookups resolved in two queries.
 */
export async function notifyParentsBulk(
  absentStudentIds: number[],
  makeMessage: (studentName: string) => string,
  trigger: Trigger,
): Promise<void> {
  if (absentStudentIds.length === 0) return;

  const tenant = await getTenantSmsConfig();
  if (!tenant?.twilioAccountSid || !tenant.twilioAuthToken) return;

  const cfg: SmsConfig = {
    accountSid: tenant.twilioAccountSid,
    authToken: tenant.twilioAuthToken,
    fromPhone: tenant.twilioFromPhone ?? "",
    whatsappFrom: tenant.twilioWhatsappFrom ?? "",
  };

  const { smsOk, waOk } = channelFlags(tenant, trigger);
  if (!smsOk && !waOk) return;

  // Batch-fetch student names + phones in two parallel queries
  const condition = absentStudentIds.length === 1
    ? eq(studentsTable.id, absentStudentIds[0]!)
    : inArray(studentsTable.id, absentStudentIds);

  const parentCondition = absentStudentIds.length === 1
    ? eq(parentStudentsTable.studentId, absentStudentIds[0]!)
    : inArray(parentStudentsTable.studentId, absentStudentIds);

  const [students, linkedParents] = await Promise.all([
    db.select({
      id: studentsTable.id,
      firstName: studentsTable.firstName,
      lastName: studentsTable.lastName,
      parentPhone: studentsTable.parentPhone,
    }).from(studentsTable).where(condition),
    db.select({
      studentId: parentStudentsTable.studentId,
      phoneNumber: usersTable.phoneNumber,
    }).from(parentStudentsTable)
      .innerJoin(usersTable, eq(usersTable.id, parentStudentsTable.parentUserId))
      .where(parentCondition),
  ]);

  // Build phone lookup: linked parent takes priority over student.parentPhone
  const phoneMap = new Map<number, string>();
  for (const s of students) {
    if (s.parentPhone) phoneMap.set(s.id, s.parentPhone);
  }
  for (const lp of linkedParents) {
    if (lp.phoneNumber) phoneMap.set(lp.studentId, lp.phoneNumber);
  }

  const nameMap = new Map(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));

  await Promise.allSettled(
    absentStudentIds.map(async (sid) => {
      const phone = phoneMap.get(sid);
      if (!phone) return;
      const name = nameMap.get(sid) ?? `Student #${sid}`;
      await dispatch(phone, makeMessage(name), cfg, smsOk, waOk);
    }),
  );
}
