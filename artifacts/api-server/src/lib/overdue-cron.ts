import { db } from "@workspace/db";
import { invoicesTable, notificationsTable, studentsTable, usersTable, parentStudentsTable } from "@workspace/db";
import { eq, and, lt, sql, inArray } from "drizzle-orm";
import { logger } from "./logger.js";

export async function sendInvoiceReminder(invoiceId: number): Promise<{
  parentNotified: boolean;
  staffNotified: number;
  message: string;
}> {
  const [inv] = await db.select({
    id: invoicesTable.id,
    invoiceNumber: invoicesTable.invoiceNumber,
    studentId: invoicesTable.studentId,
    totalAmount: invoicesTable.totalAmount,
    paidAmount: invoicesTable.paidAmount,
    dueDate: invoicesTable.dueDate,
    status: invoicesTable.status,
  }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);

  if (!inv) throw new Error("Invoice not found");

  const [student] = await db.select({
    firstName: studentsTable.firstName,
    lastName: studentsTable.lastName,
    parentEmail: studentsTable.parentEmail,
    parentName: studentsTable.parentName,
  }).from(studentsTable).where(eq(studentsTable.id, inv.studentId)).limit(1);

  const studentName = student ? `${student.firstName} ${student.lastName}` : `Student #${inv.studentId}`;
  const due = parseFloat(inv.totalAmount) - parseFloat(inv.paidAmount);
  const title = "Fee Payment Reminder";
  const message = `Invoice ${inv.invoiceNumber} for ${studentName} — ৳${due.toLocaleString()} outstanding (due ${inv.dueDate})`;

  let parentNotified = false;

  // Collect all parent user IDs to notify (explicit links + email fallback, deduplicated)
  const parentUserIds = new Set<number>();

  // 1. Explicit parent_students links
  const explicitLinks = await db.select({ parentUserId: parentStudentsTable.parentUserId })
    .from(parentStudentsTable)
    .where(eq(parentStudentsTable.studentId, inv.studentId));
  for (const link of explicitLinks) parentUserIds.add(link.parentUserId);

  // 2. Email-based fallback
  if (student?.parentEmail) {
    const [emailParent] = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.email, student.parentEmail), eq(usersTable.isActive, true)))
      .limit(1);
    if (emailParent) parentUserIds.add(emailParent.id);
  }

  // Send notification to each parent
  for (const parentUserId of parentUserIds) {
    await db.insert(notificationsTable).values({
      userId: parentUserId,
      title,
      message: `Your child's invoice ${inv.invoiceNumber} has an outstanding balance of ৳${due.toLocaleString()} (due ${inv.dueDate}). Please clear it at your earliest convenience.`,
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
      message: `Reminder triggered for ${inv.invoiceNumber} — ${studentName} — ৳${due.toLocaleString()} due`,
      type: "INFO",
      link: "/finance",
    });
  }

  return {
    parentNotified,
    staffNotified: staffUsers.length,
    message: parentNotified
      ? `Reminder sent to parent and ${staffUsers.length} staff member(s)`
      : `Reminder sent to ${staffUsers.length} staff member(s) (no parent account found)`,
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

export function startOverdueCron(): void {
  markOverdueInvoices().catch(err => logger.error({ err }, "Overdue cron failed"));

  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    markOverdueInvoices().catch(err => logger.error({ err }, "Overdue cron failed"));
  }, SIX_HOURS);

  logger.info("Overdue invoice cron started (runs every 6 hours)");
}
