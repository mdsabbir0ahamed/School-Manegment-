import { Router } from "express";
import { db } from "@workspace/db";
import {
  invoicesTable, studentsTable, classesTable,
  feeTypesTable, notificationsTable, usersTable,
  parentStudentsTable,
} from "@workspace/db";
import { eq, and, inArray, sql, ne } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";
import { logger } from "../../lib/logger.js";
import { getEscalationThresholds } from "../../lib/escalation-thresholds.js";

const router = Router();

// ── helpers ─────────────────────────────────────────────────────────────────
function daysOverdue(dueDateStr: string): number {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - due.getTime()) / 86_400_000);
}

async function notifyEscalation(
  inv: { id: number; invoiceNumber: string; totalAmount: string; paidAmount: string; dueDate: string; studentId: number },
  studentName: string,
  level: "WARNING" | "CRITICAL",
  days: number,
): Promise<void> {
  const outstanding = parseFloat(inv.totalAmount) - parseFloat(inv.paidAmount);
  const levelLabel = level === "CRITICAL" ? "CRITICAL — Immediate Action Required" : "WARNING — Payment Overdue";
  const urgency = level === "CRITICAL" ? "immediately" : "promptly";

  // Collect parent user IDs
  const parentIds = new Set<number>();
  const links = await db
    .select({ parentUserId: parentStudentsTable.parentUserId })
    .from(parentStudentsTable)
    .where(eq(parentStudentsTable.studentId, inv.studentId));
  for (const l of links) parentIds.add(l.parentUserId);

  const [student] = await db
    .select({ parentEmail: studentsTable.parentEmail })
    .from(studentsTable)
    .where(eq(studentsTable.id, inv.studentId))
    .limit(1);
  if (student?.parentEmail) {
    const [pu] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.email, student.parentEmail), eq(usersTable.isActive, true)))
      .limit(1);
    if (pu) parentIds.add(pu.id);
  }

  for (const parentUserId of parentIds) {
    await db.insert(notificationsTable).values({
      userId: parentUserId,
      title: `Fee ${levelLabel}`,
      message: `Invoice ${inv.invoiceNumber} for ${studentName} — ৳${outstanding.toLocaleString()} outstanding (${days} days overdue since ${inv.dueDate}). Please pay ${urgency}.`,
      type: level === "CRITICAL" ? "DANGER" : "WARNING",
      link: "/parent",
    });
  }

  // Notify all finance staff
  const staff = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.isActive, true),
        sql`${usersTable.role} IN ('SUPER_ADMIN', 'ACCOUNTANT')`,
      ),
    );

  for (const user of staff) {
    await db.insert(notificationsTable).values({
      userId: user.id,
      title: `Invoice Escalated to ${level}`,
      message: `${inv.invoiceNumber} — ${studentName} — ৳${outstanding.toLocaleString()} | ${days} days overdue`,
      type: level === "CRITICAL" ? "DANGER" : "WARNING",
      link: "/finance",
    });
  }
}

// ── POST /finance/escalations/run ───────────────────────────────────────────
// Scans all OVERDUE invoices, escalates by days-overdue thresholds, notifies.
router.post(
  "/finance/escalations/run",
  requireAuth,
  requireFinance,
  async (req, res) => {
    try {
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

      if (!overdueInvoices.length) {
        res.json({ scanned: 0, escalatedToWarning: 0, escalatedToCritical: 0, alreadyEscalated: 0 });
        return;
      }

      const { warningDays, criticalDays } = await getEscalationThresholds();

      // Fetch student names in one query
      const studentIds = [...new Set(overdueInvoices.map(i => i.studentId))];
      const students = await db
        .select({ id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
        .from(studentsTable)
        .where(inArray(studentsTable.id, studentIds));
      const studentMap = new Map(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));

      let escalatedToWarning = 0;
      let escalatedToCritical = 0;
      let alreadyEscalated = 0;

      for (const inv of overdueInvoices) {
        const days = daysOverdue(inv.dueDate);
        const studentName = studentMap.get(inv.studentId) ?? `Student #${inv.studentId}`;

        let newLevel: "WARNING" | "CRITICAL" | null = null;
        if (days >= criticalDays && inv.escalationLevel !== "CRITICAL") {
          newLevel = "CRITICAL";
          escalatedToCritical++;
        } else if (days >= warningDays && inv.escalationLevel === "NORMAL") {
          newLevel = "WARNING";
          escalatedToWarning++;
        } else if (inv.escalationLevel !== "NORMAL") {
          alreadyEscalated++;
        }

        if (newLevel) {
          await db
            .update(invoicesTable)
            .set({
              escalationLevel: newLevel,
              escalatedAt: new Date(),
              escalationNote: `Auto-escalated to ${newLevel}: ${days} days overdue`,
              updatedAt: new Date(),
            })
            .where(eq(invoicesTable.id, inv.id));

          await notifyEscalation(inv, studentName, newLevel, days).catch(err =>
            logger.error({ err, invoiceId: inv.id }, "Escalation notification failed"),
          );
        }
      }

      logger.info(
        { scanned: overdueInvoices.length, escalatedToWarning, escalatedToCritical },
        "Escalation run complete",
      );

      res.json({
        scanned: overdueInvoices.length,
        escalatedToWarning,
        escalatedToCritical,
        alreadyEscalated,
      });
    } catch (err) {
      req.log.error({ err }, "Escalation run failed");
      res.status(500).json({ error: "Escalation run failed" });
    }
  },
);

// ── GET /finance/escalations ─────────────────────────────────────────────────
// Returns all WARNING and CRITICAL invoices with student + class context.
router.get(
  "/finance/escalations",
  requireAuth,
  requireFinance,
  async (req, res) => {
    try {
      const levelFilter = typeof req.query.level === "string" ? req.query.level : undefined;

      const rows = await db
        .select({
          id: invoicesTable.id,
          invoiceNumber: invoicesTable.invoiceNumber,
          dueDate: invoicesTable.dueDate,
          totalAmount: invoicesTable.totalAmount,
          paidAmount: invoicesTable.paidAmount,
          escalationLevel: invoicesTable.escalationLevel,
          escalatedAt: invoicesTable.escalatedAt,
          escalationNote: invoicesTable.escalationNote,
          studentId: invoicesTable.studentId,
          studentFirstName: studentsTable.firstName,
          studentLastName: studentsTable.lastName,
          studentCode: studentsTable.studentId,
          classId: classesTable.id,
          className: classesTable.name,
          feeTypeName: feeTypesTable.name,
        })
        .from(invoicesTable)
        .innerJoin(studentsTable, eq(invoicesTable.studentId, studentsTable.id))
        .innerJoin(classesTable, eq(studentsTable.classId, classesTable.id))
        .innerJoin(feeTypesTable, eq(invoicesTable.feeTypeId, feeTypesTable.id))
        .where(
          and(
            ne(invoicesTable.escalationLevel, "NORMAL"),
            levelFilter && (levelFilter === "WARNING" || levelFilter === "CRITICAL")
              ? eq(invoicesTable.escalationLevel, levelFilter)
              : undefined,
          ),
        )
        .orderBy(sql`CASE ${invoicesTable.escalationLevel} WHEN 'CRITICAL' THEN 0 ELSE 1 END`, invoicesTable.dueDate);

      const items = rows.map(r => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        dueDate: r.dueDate,
        totalAmount: parseFloat(r.totalAmount),
        paidAmount: parseFloat(r.paidAmount),
        outstanding: parseFloat(r.totalAmount) - parseFloat(r.paidAmount),
        daysOverdue: daysOverdue(r.dueDate),
        escalationLevel: r.escalationLevel,
        escalatedAt: r.escalatedAt,
        escalationNote: r.escalationNote,
        studentId: r.studentId,
        studentName: `${r.studentFirstName} ${r.studentLastName}`,
        studentCode: r.studentCode,
        classId: r.classId,
        className: r.className,
        feeTypeName: r.feeTypeName,
      }));

      const criticalCount = items.filter(i => i.escalationLevel === "CRITICAL").length;
      const warningCount = items.filter(i => i.escalationLevel === "WARNING").length;
      const totalAtRisk = items.reduce((s, i) => s + i.outstanding, 0);

      res.json({ summary: { criticalCount, warningCount, totalAtRisk }, items });
    } catch (err) {
      req.log.error({ err }, "Escalations list failed");
      res.status(500).json({ error: "Failed to load escalations" });
    }
  },
);

// ── PATCH /finance/escalations/:id/acknowledge ──────────────────────────────
// Accountant resets an invoice's escalation level back to NORMAL.
router.patch(
  "/finance/escalations/:id/acknowledge",
  requireAuth,
  requireFinance,
  async (req, res) => {
    const invoiceId = parseInt(String(req.params.id), 10);
    if (isNaN(invoiceId)) {
      res.status(400).json({ error: "Invalid invoice id" });
      return;
    }
    try {
      const [updated] = await db
        .update(invoicesTable)
        .set({
          escalationLevel: "NORMAL",
          escalationNote: `Acknowledged by user ${(req as any).user?.userId} on ${new Date().toISOString().split("T")[0]}`,
          updatedAt: new Date(),
        })
        .where(eq(invoicesTable.id, invoiceId))
        .returning({ id: invoicesTable.id });

      if (!updated) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }
      res.json({ id: updated.id, escalationLevel: "NORMAL" });
    } catch (err) {
      req.log.error({ err }, "Acknowledge escalation failed");
      res.status(500).json({ error: "Acknowledge failed" });
    }
  },
);

export default router;
