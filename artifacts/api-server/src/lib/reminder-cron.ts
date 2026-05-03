import { db } from "@workspace/db";
import {
  invoicesTable,
  reminderSettingsTable,
  studentsTable,
  usersTable,
  parentStudentsTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendSms, sendWhatsapp, type SmsConfig } from "./sms.js";
import { sendInvoiceReminder } from "./overdue-cron.js";

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

async function getOrCreateSettings(): Promise<{
  isEnabled: boolean;
  reminderDays: number[];
  lastRunAt: Date | null;
}> {
  const [existing] = await db
    .select()
    .from(reminderSettingsTable)
    .where(eq(reminderSettingsTable.tenantId, 1))
    .limit(1);

  if (existing) {
    let days: number[] = [-3, -1, 0, 1, 3, 7];
    try {
      days = JSON.parse(existing.reminderDays);
    } catch {
      // use defaults
    }
    return { isEnabled: existing.isEnabled, reminderDays: days, lastRunAt: existing.lastRunAt };
  }

  // Create defaults
  const [created] = await db
    .insert(reminderSettingsTable)
    .values({ tenantId: 1 })
    .returning();

  return { isEnabled: true, reminderDays: [-3, -1, 0, 1, 3, 7], lastRunAt: created?.lastRunAt ?? null };
}

export async function runReminderCron(force = false): Promise<{ sent: number; skipped: boolean }> {
  const settings = await getOrCreateSettings();

  if (!settings.isEnabled && !force) {
    logger.info("Reminder cron skipped — disabled in settings");
    return { sent: 0, skipped: true };
  }

  // Skip if already ran today (unless forced)
  if (!force && settings.lastRunAt) {
    const lastRunDay = toDateStr(settings.lastRunAt);
    const today = toDateStr(new Date());
    if (lastRunDay === today) {
      logger.info({ lastRunDay }, "Reminder cron skipped — already ran today");
      return { sent: 0, skipped: true };
    }
  }

  const today = new Date();
  const sentInvoiceIds = new Set<number>();
  let totalSent = 0;

  for (const offset of settings.reminderDays) {
    const targetDate = toDateStr(addDays(today, -offset)); // offset is "days before due"

    // Find PENDING invoices matching this target due date
    const pendingInvoices = await db
      .select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(
        and(
          inArray(invoicesTable.status, ["PENDING", "OVERDUE"]),
          eq(invoicesTable.dueDate, targetDate),
        ),
      );

    for (const inv of pendingInvoices) {
      if (sentInvoiceIds.has(inv.id)) continue; // de-dupe if multiple offsets hit same invoice
      try {
        await sendInvoiceReminder(inv.id);
        sentInvoiceIds.add(inv.id);
        totalSent++;
        logger.info(
          { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, offset },
          "Auto-reminder sent",
        );
      } catch (err) {
        logger.error({ err, invoiceId: inv.id }, "Failed to send auto-reminder");
      }
    }
  }

  // Update lastRunAt and count
  await db
    .update(reminderSettingsTable)
    .set({ lastRunAt: new Date(), lastRunCount: totalSent, updatedAt: new Date() })
    .where(eq(reminderSettingsTable.tenantId, 1));

  logger.info({ totalSent }, "Reminder cron completed");
  return { sent: totalSent, skipped: false };
}

export async function sendParentDigest(force = false): Promise<{ sent: number; skipped: boolean }> {
  // Load digest settings
  const [row] = await db
    .select({
      digestSmsEnabled: reminderSettingsTable.digestSmsEnabled,
      digestWhatsappEnabled: reminderSettingsTable.digestWhatsappEnabled,
      digestLastRunAt: reminderSettingsTable.digestLastRunAt,
    })
    .from(reminderSettingsTable)
    .where(eq(reminderSettingsTable.tenantId, 1))
    .limit(1);

  const digestSmsEnabled = row?.digestSmsEnabled ?? false;
  const digestWhatsappEnabled = row?.digestWhatsappEnabled ?? false;

  if (!digestSmsEnabled && !digestWhatsappEnabled) {
    return { sent: 0, skipped: true };
  }

  // Skip if already ran today (unless forced)
  if (!force && row?.digestLastRunAt) {
    const lastDay = row.digestLastRunAt.toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];
    if (lastDay === today) {
      logger.info("Digest cron skipped — already ran today");
      return { sent: 0, skipped: true };
    }
  }

  // Fetch tenant Twilio config
  const [tenant] = await db
    .select({
      name: tenantsTable.name,
      twilioAccountSid: tenantsTable.twilioAccountSid,
      twilioAuthToken: tenantsTable.twilioAuthToken,
      twilioFromPhone: tenantsTable.twilioFromPhone,
      twilioWhatsappFrom: tenantsTable.twilioWhatsappFrom,
    })
    .from(tenantsTable)
    .limit(1);

  if (!tenant?.twilioAccountSid || !tenant.twilioAuthToken) {
    logger.warn("Digest cron: Twilio not configured, skipping");
    return { sent: 0, skipped: true };
  }

  const cfg: SmsConfig = {
    accountSid: tenant.twilioAccountSid,
    authToken: tenant.twilioAuthToken,
    fromPhone: tenant.twilioFromPhone ?? "",
    whatsappFrom: tenant.twilioWhatsappFrom ?? "",
  };
  const schoolName = tenant.name ?? "School ERP";

  // Fetch all PENDING and OVERDUE invoices
  const invoices = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      studentId: invoicesTable.studentId,
      totalAmount: invoicesTable.totalAmount,
      paidAmount: invoicesTable.paidAmount,
      dueDate: invoicesTable.dueDate,
      status: invoicesTable.status,
    })
    .from(invoicesTable)
    .where(inArray(invoicesTable.status, ["PENDING", "OVERDUE"]));

  if (!invoices.length) {
    await db
      .update(reminderSettingsTable)
      .set({ digestLastRunAt: new Date(), digestLastRunCount: 0, updatedAt: new Date() })
      .where(eq(reminderSettingsTable.tenantId, 1));
    return { sent: 0, skipped: false };
  }

  // Fetch all students for these invoices
  const studentIds = [...new Set(invoices.map(i => i.studentId))];
  const students = await db
    .select({
      id: studentsTable.id,
      firstName: studentsTable.firstName,
      lastName: studentsTable.lastName,
      parentPhone: studentsTable.parentPhone,
    })
    .from(studentsTable)
    .where(inArray(studentsTable.id, studentIds));
  const studentMap = new Map(students.map(s => [s.id, s]));

  // Fetch all explicit parent links with phone numbers
  const parentLinks = await db
    .select({
      studentId: parentStudentsTable.studentId,
      parentUserId: parentStudentsTable.parentUserId,
      phoneNumber: usersTable.phoneNumber,
    })
    .from(parentStudentsTable)
    .innerJoin(usersTable, eq(usersTable.id, parentStudentsTable.parentUserId))
    .where(inArray(parentStudentsTable.studentId, studentIds));

  // Build map: parentPhone → list of (studentName, invoices[])
  type InvoiceLine = { invoiceNumber: string; outstanding: number; dueDate: string; status: string };
  const phoneToLines = new Map<string, { studentName: string; lines: InvoiceLine[] }[]>();

  function ensurePhone(phone: string, studentName: string): { studentName: string; lines: InvoiceLine[] } {
    let entries = phoneToLines.get(phone);
    if (!entries) { entries = []; phoneToLines.set(phone, entries); }
    let entry = entries.find(e => e.studentName === studentName);
    if (!entry) { entry = { studentName, lines: [] }; entries.push(entry); }
    return entry;
  }

  for (const inv of invoices) {
    const student = studentMap.get(inv.studentId);
    if (!student) continue;
    const studentName = `${student.firstName} ${student.lastName}`;
    const outstanding = parseFloat(inv.totalAmount) - parseFloat(inv.paidAmount);
    if (outstanding <= 0) continue;

    const line: InvoiceLine = {
      invoiceNumber: inv.invoiceNumber,
      outstanding,
      dueDate: inv.dueDate,
      status: inv.status,
    };

    // Add to all linked parents
    const links = parentLinks.filter(l => l.studentId === inv.studentId);
    for (const link of links) {
      if (link.phoneNumber) ensurePhone(link.phoneNumber, studentName).lines.push(line);
    }
    // Fallback: student.parentPhone
    if (!links.some(l => !!l.phoneNumber) && student.parentPhone) {
      ensurePhone(student.parentPhone, studentName).lines.push(line);
    }
  }

  let sent = 0;
  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

  for (const [phone, studentEntries] of phoneToLines) {
    const totalOutstanding = studentEntries.flatMap(e => e.lines).reduce((s, l) => s + l.outstanding, 0);

    const lines: string[] = [`Fee Digest from ${schoolName}:`, ""];
    for (const entry of studentEntries) {
      lines.push(`Student: ${entry.studentName}`);
      for (const l of entry.lines) {
        const overdue = l.status === "OVERDUE" ? " [OVERDUE]" : "";
        lines.push(`  - ${l.invoiceNumber}: BDT ${fmt(l.outstanding)} due ${l.dueDate}${overdue}`);
      }
    }
    lines.push("");
    lines.push(`Total outstanding: BDT ${fmt(totalOutstanding)}`);
    lines.push("Please pay at your earliest convenience.");

    const body = lines.join("\n");

    if (digestSmsEnabled && cfg.fromPhone) {
      const r = await sendSms(phone, body, cfg);
      if (r.delivered) { sent++; logger.info({ phone }, "Digest SMS sent"); }
      else logger.warn({ phone, error: r.error }, "Digest SMS failed");
    }
    if (digestWhatsappEnabled && cfg.whatsappFrom) {
      const r = await sendWhatsapp(phone, body, cfg);
      if (r.delivered) { sent++; logger.info({ phone }, "Digest WhatsApp sent"); }
      else logger.warn({ phone, error: r.error }, "Digest WhatsApp failed");
    }
  }

  await db
    .update(reminderSettingsTable)
    .set({ digestLastRunAt: new Date(), digestLastRunCount: sent, updatedAt: new Date() })
    .where(eq(reminderSettingsTable.tenantId, 1));

  logger.info({ sent }, "Parent digest completed");
  return { sent, skipped: false };
}

export function startReminderCron(): void {
  // Run once on startup, then every hour (cron skips if already ran today)
  runReminderCron().catch(err => logger.error({ err }, "Reminder cron startup run failed"));
  sendParentDigest().catch(err => logger.error({ err }, "Digest cron startup run failed"));

  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    runReminderCron().catch(err => logger.error({ err }, "Reminder cron hourly run failed"));
    sendParentDigest().catch(err => logger.error({ err }, "Digest cron hourly run failed"));
  }, ONE_HOUR);

  logger.info("Fee reminder cron started (checks hourly, runs once per day)");
}
