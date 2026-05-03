import { db } from "@workspace/db";
import { invoicesTable, notificationsTable, studentsTable, usersTable, parentStudentsTable, reminderSettingsTable, tenantsTable } from "@workspace/db";
import { eq, and, lt, ne, sql, inArray } from "drizzle-orm";
import { sendSms, sendWhatsapp, type SmsConfig } from "./sms.js";
import { logger } from "./logger.js";
import { getEscalationThresholds } from "./escalation-thresholds.js";

function daysOverdueFrom(dueDateStr: string): number {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - due.getTime()) / 86_400_000);
}

async function runEscalationCheck(): Promise<void> {
  const overdueInvoices = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      studentId: invoicesTable.studentId,
      totalAmount: invoicesTable.totalAmount,
      paidAmount: invoicesTable.paidAmount,
      dueDate: invoicesTable.dueDate,
      escalationLevel: invoicesTable.escalationLevel,
    })
    .from(invoicesTable)
    .where(eq(invoicesTable.status, "OVERDUE"));

  if (!overdueInvoices.length) return;

  const { warningDays, criticalDays } = await getEscalationThresholds();

  const studentIds = [...new Set(overdueInvoices.map(i => i.studentId))];
  const students = await db
    .select({ id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable)
    .where(inArray(studentsTable.id, studentIds));
  const studentMap = new Map(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));

  const staffUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.isActive, true), sql`${usersTable.role} IN ('SUPER_ADMIN', 'ACCOUNTANT')`));

  let escalated = 0;
  for (const inv of overdueInvoices) {
    const days = daysOverdueFrom(inv.dueDate);
    const studentName = studentMap.get(inv.studentId) ?? `Student #${inv.studentId}`;
    let newLevel: "WARNING" | "CRITICAL" | null = null;

    if (days >= criticalDays && inv.escalationLevel !== "CRITICAL") {
      newLevel = "CRITICAL";
    } else if (days >= warningDays && inv.escalationLevel === "NORMAL") {
      newLevel = "WARNING";
    }

    if (newLevel) {
      await db.update(invoicesTable).set({
        escalationLevel: newLevel,
        escalatedAt: new Date(),
        escalationNote: `Auto-escalated to ${newLevel}: ${days} days overdue`,
        updatedAt: new Date(),
      }).where(eq(invoicesTable.id, inv.id));

      const outstanding = parseFloat(inv.totalAmount) - parseFloat(inv.paidAmount);
      for (const user of staffUsers) {
        await db.insert(notificationsTable).values({
          userId: user.id,
          title: `Invoice Escalated to ${newLevel}`,
          message: `${inv.invoiceNumber} — ${studentName} — ৳${outstanding.toLocaleString()} | ${days} days overdue`,
          type: newLevel === "CRITICAL" ? "DANGER" : "WARNING",
          link: "/finance",
        });
      }
      escalated++;
    }
  }

  if (escalated > 0) {
    logger.info({ escalated }, "Cron: escalation check completed");
  }
}

export async function sendInvoiceReminder(invoiceId: number): Promise<{
  parentNotified: boolean;
  staffNotified: number;
  smsSent: boolean;
  message: string;
}> {
  const [[inv], [reminderSettings]] = await Promise.all([
    db.select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      studentId: invoicesTable.studentId,
      totalAmount: invoicesTable.totalAmount,
      paidAmount: invoicesTable.paidAmount,
      dueDate: invoicesTable.dueDate,
      status: invoicesTable.status,
    }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1),
    db.select({
      smsEnabled: reminderSettingsTable.smsEnabled,
      whatsappEnabled: reminderSettingsTable.whatsappEnabled,
    }).from(reminderSettingsTable).where(eq(reminderSettingsTable.tenantId, 1)).limit(1),
  ]);

  if (!inv) throw new Error("Invoice not found");
  const smsReminderEnabled = reminderSettings?.smsEnabled ?? false;
  const waReminderEnabled = reminderSettings?.whatsappEnabled ?? false;

  const [student] = await db.select({
    firstName: studentsTable.firstName,
    lastName: studentsTable.lastName,
    parentEmail: studentsTable.parentEmail,
    parentName: studentsTable.parentName,
    parentPhone: studentsTable.parentPhone,
  }).from(studentsTable).where(eq(studentsTable.id, inv.studentId)).limit(1);

  const studentName = student ? `${student.firstName} ${student.lastName}` : `Student #${inv.studentId}`;
  const due = parseFloat(inv.totalAmount) - parseFloat(inv.paidAmount);
  const title = "Fee Payment Reminder";

  let parentNotified = false;

  // Collect all parent user IDs + their phones
  const parentUserIds = new Set<number>();
  let parentPhone: string | null = null;

  // 1. Explicit parent_students links
  const explicitLinks = await db
    .select({ parentUserId: parentStudentsTable.parentUserId, phoneNumber: usersTable.phoneNumber })
    .from(parentStudentsTable)
    .innerJoin(usersTable, eq(usersTable.id, parentStudentsTable.parentUserId))
    .where(eq(parentStudentsTable.studentId, inv.studentId));

  for (const link of explicitLinks) {
    parentUserIds.add(link.parentUserId);
    if (!parentPhone && link.phoneNumber) parentPhone = link.phoneNumber;
  }

  // 2. Email-based fallback
  if (student?.parentEmail) {
    const [emailParent] = await db.select({ id: usersTable.id, phoneNumber: usersTable.phoneNumber })
      .from(usersTable)
      .where(and(eq(usersTable.email, student.parentEmail), eq(usersTable.isActive, true)))
      .limit(1);
    if (emailParent) {
      parentUserIds.add(emailParent.id);
      if (!parentPhone && emailParent.phoneNumber) parentPhone = emailParent.phoneNumber;
    }
  }

  // 3. student.parentPhone fallback
  if (!parentPhone && student?.parentPhone) parentPhone = student.parentPhone;

  // Send in-app notifications to each parent
  for (const parentUserId of parentUserIds) {
    await db.insert(notificationsTable).values({
      userId: parentUserId,
      title,
      message: `Your child's invoice ${inv.invoiceNumber} has an outstanding balance of BDT ${due.toLocaleString("en-US", { minimumFractionDigits: 2 })} (due ${inv.dueDate}). Please clear it at your earliest convenience.`,
      type: "WARNING",
      link: "/parent",
    });
    parentNotified = true;
  }

  // Notify all staff (SUPER_ADMIN + ACCOUNTANT)
  const staffUsers = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.isActive, true),
      sql`${usersTable.role} IN ('SUPER_ADMIN', 'ACCOUNTANT')`,
    ));

  for (const user of staffUsers) {
    await db.insert(notificationsTable).values({
      userId: user.id,
      title: "Payment Reminder Sent",
      message: `Reminder triggered for ${inv.invoiceNumber} — ${studentName} — BDT ${due.toLocaleString("en-US", { minimumFractionDigits: 2 })} due`,
      type: "INFO",
      link: "/finance",
    });
  }

  // ── SMS / WhatsApp reminder ────────────────────────────────────────────────
  let smsSent = false;
  if (parentPhone && (smsReminderEnabled || waReminderEnabled)) {
    const [tenant] = await db.select({
      name: tenantsTable.name,
      twilioAccountSid: tenantsTable.twilioAccountSid,
      twilioAuthToken: tenantsTable.twilioAuthToken,
      twilioFromPhone: tenantsTable.twilioFromPhone,
      twilioWhatsappFrom: tenantsTable.twilioWhatsappFrom,
    }).from(tenantsTable).limit(1);

    if (tenant?.twilioAccountSid && tenant.twilioAuthToken) {
      const cfg: SmsConfig = {
        accountSid: tenant.twilioAccountSid,
        authToken: tenant.twilioAuthToken,
        fromPhone: tenant.twilioFromPhone ?? "",
        whatsappFrom: tenant.twilioWhatsappFrom ?? "",
      };
      const schoolName = tenant.name ?? "School ERP";
      const smsBody = `Fee Reminder: Invoice ${inv.invoiceNumber} for ${studentName} — BDT ${due.toLocaleString("en-US", { minimumFractionDigits: 2 })} due on ${inv.dueDate}. Please pay at your earliest convenience. — ${schoolName}`;

      if (smsReminderEnabled && cfg.fromPhone) {
        const r = await sendSms(parentPhone, smsBody, cfg);
        if (r.delivered) { smsSent = true; logger.info({ invoiceId, parentPhone }, "Fee reminder SMS sent"); }
        else logger.warn({ invoiceId, error: r.error }, "Fee reminder SMS failed");
      }
      if (waReminderEnabled && cfg.whatsappFrom) {
        const r = await sendWhatsapp(parentPhone, smsBody, cfg);
        if (r.delivered) { smsSent = true; logger.info({ invoiceId, parentPhone }, "Fee reminder WhatsApp sent"); }
        else logger.warn({ invoiceId, error: r.error }, "Fee reminder WhatsApp failed");
      }
    }
  }

  const channelDesc = [
    parentNotified ? "in-app" : null,
    smsSent ? "SMS/WhatsApp" : null,
  ].filter(Boolean).join(" + ");

  return {
    parentNotified,
    staffNotified: staffUsers.length,
    smsSent,
    message: parentNotified || smsSent
      ? `Reminder sent via ${channelDesc} to parent and ${staffUsers.length} staff member(s)`
      : `Reminder sent to ${staffUsers.length} staff member(s) (no parent account or phone found)`,
  };
}

async function markOverdueInvoices(): Promise<void> {
  const today = new Date().toISOString().split("T")[0]!;
  const overdueInvoices = await db.select({
    id: invoicesTable.id,
    invoiceNumber: invoicesTable.invoiceNumber,
    studentId: invoicesTable.studentId,
    totalAmount: invoicesTable.totalAmount,
    dueDate: invoicesTable.dueDate,
  })
    .from(invoicesTable)
    .where(and(
      eq(invoicesTable.status, "PENDING"),
      lt(invoicesTable.dueDate, today),
    ));

  if (!overdueInvoices.length) return;

  // Mark them all overdue
  await db.update(invoicesTable)
    .set({ status: "OVERDUE", updatedAt: new Date() })
    .where(and(
      eq(invoicesTable.status, "PENDING"),
      lt(invoicesTable.dueDate, today),
    ));

  logger.info({ count: overdueInvoices.length }, "Marked invoices as overdue");

  // Notify all SUPER_ADMIN and ACCOUNTANT users
  const staffUsers = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.isActive, true),
      sql`${usersTable.role} IN ('SUPER_ADMIN', 'ACCOUNTANT')`,
    ));

  // Fetch students for all overdue invoices in one query
  const studentIds = [...new Set(overdueInvoices.map(i => i.studentId))];
  const students = studentIds.length
    ? await db.select({
        id: studentsTable.id,
        firstName: studentsTable.firstName,
        lastName: studentsTable.lastName,
        parentEmail: studentsTable.parentEmail,
      }).from(studentsTable).where(inArray(studentsTable.id, studentIds))
    : [];
  const studentMap = new Map(students.map(s => [s.id, s]));

  // Collect parent emails
  const parentEmails = students.map(s => s.parentEmail).filter((e): e is string => !!e);
  const parentUsers = parentEmails.length
    ? await db.select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable)
        .where(and(
          eq(usersTable.isActive, true),
          sql`${usersTable.email} = ANY(ARRAY[${sql.raw(parentEmails.map(e => `'${e.replace(/'/g, "''")}'`).join(","))}]::text[])`,
        ))
    : [];
  const parentByEmail = new Map(parentUsers.map(u => [u.email, u.id]));

  for (const inv of overdueInvoices) {
    const student = studentMap.get(inv.studentId);
    const studentName = student ? `${student.firstName} ${student.lastName}` : `Student #${inv.studentId}`;

    // Notify staff
    for (const user of staffUsers) {
      await db.insert(notificationsTable).values({
        userId: user.id,
        title: "Invoice Overdue",
        message: `Invoice ${inv.invoiceNumber} (৳${parseFloat(inv.totalAmount).toLocaleString()}) for ${studentName} is overdue since ${inv.dueDate}`,
        type: "DANGER",
        link: "/finance",
      });
    }

    // Notify parent if they have an account
    if (student?.parentEmail) {
      const parentUserId = parentByEmail.get(student.parentEmail);
      if (parentUserId) {
        await db.insert(notificationsTable).values({
          userId: parentUserId,
          title: "Fee Payment Overdue",
          message: `Invoice ${inv.invoiceNumber} — ৳${parseFloat(inv.totalAmount).toLocaleString()} was due on ${inv.dueDate} and is now overdue. Please pay immediately.`,
          type: "DANGER",
          link: "/parent",
        });
      }
    }
  }
}

async function markAndEscalate(): Promise<void> {
  await markOverdueInvoices();
  await runEscalationCheck();
}

export function startOverdueCron(): void {
  markAndEscalate().catch(err => logger.error({ err }, "Overdue cron failed"));

  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    markAndEscalate().catch(err => logger.error({ err }, "Overdue cron failed"));
  }, SIX_HOURS);

  logger.info("Overdue invoice cron started (runs every 6 hours, with escalation check)");
}
