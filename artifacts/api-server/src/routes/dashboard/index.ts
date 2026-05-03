import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable, studentsTable, classesTable,
  attendanceTable, invoicesTable, transactionsTable,
} from "@workspace/db";
import { eq, count, sum, and, gte, lte, sql, ne } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";

const router = Router();

router.get("/dashboard/stats", requireAuth, async (_req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];
  const monthStart = `${today.slice(0, 7)}-01`;
  const [
    totalStudentsResult, activeStudentsResult, totalTeachersResult, totalClassesResult,
    todayAttendanceResult, todayTotalResult, monthlyRevenueResult, pendingInvoicesResult,
    overdueInvoicesResult, newAdmissionsResult, totalRevenueResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(studentsTable),
    db.select({ count: count() }).from(studentsTable).where(eq(studentsTable.status, "ACTIVE")),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "TEACHER")),
    db.select({ count: count() }).from(classesTable),
    db.select({ count: count() }).from(attendanceTable).where(and(eq(attendanceTable.date, today), eq(attendanceTable.status, "PRESENT"))),
    db.select({ count: count() }).from(attendanceTable).where(eq(attendanceTable.date, today)),
    db.select({ total: sum(transactionsTable.amountPaid) }).from(transactionsTable).where(gte(transactionsTable.paidAt, new Date(monthStart))),
    db.select({ count: count() }).from(invoicesTable).where(eq(invoicesTable.status, "PENDING")),
    db.select({ count: count() }).from(invoicesTable).where(eq(invoicesTable.status, "OVERDUE")),
    db.select({ count: count() }).from(studentsTable).where(gte(studentsTable.admissionDate, monthStart)),
    db.select({ total: sum(transactionsTable.amountPaid) }).from(transactionsTable),
  ]);
  const todayPresent = todayAttendanceResult[0]?.count ?? 0;
  const todayTotal = todayTotalResult[0]?.count ?? 0;
  res.json({
    totalStudents: totalStudentsResult[0]?.count ?? 0,
    activeStudents: activeStudentsResult[0]?.count ?? 0,
    totalTeachers: totalTeachersResult[0]?.count ?? 0,
    totalClasses: totalClassesResult[0]?.count ?? 0,
    todayAttendanceRate: todayTotal > 0 ? Math.round((todayPresent / todayTotal) * 1000) / 10 : 0,
    monthlyRevenue: parseFloat(monthlyRevenueResult[0]?.total ?? "0"),
    pendingInvoices: pendingInvoicesResult[0]?.count ?? 0,
    overdueInvoices: overdueInvoicesResult[0]?.count ?? 0,
    newAdmissionsThisMonth: newAdmissionsResult[0]?.count ?? 0,
    totalRevenue: parseFloat(totalRevenueResult[0]?.total ?? "0"),
  });
});

router.get("/dashboard/attendance-summary", requireAuth, async (_req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];
  const classes = await db.select().from(classesTable);
  const summary = await Promise.all(classes.map(async cls => {
    const [presentResult, absentResult, lateResult, totalResult] = await Promise.all([
      db.select({ count: count() }).from(attendanceTable).where(and(eq(attendanceTable.classId, cls.id), eq(attendanceTable.date, today), eq(attendanceTable.status, "PRESENT"))),
      db.select({ count: count() }).from(attendanceTable).where(and(eq(attendanceTable.classId, cls.id), eq(attendanceTable.date, today), eq(attendanceTable.status, "ABSENT"))),
      db.select({ count: count() }).from(attendanceTable).where(and(eq(attendanceTable.classId, cls.id), eq(attendanceTable.date, today), eq(attendanceTable.status, "LATE"))),
      db.select({ count: count() }).from(studentsTable).where(eq(studentsTable.classId, cls.id)),
    ]);
    const present = presentResult[0]?.count ?? 0;
    const total = totalResult[0]?.count ?? 0;
    return {
      classId: cls.id, className: cls.section ? `${cls.name} - ${cls.section}` : cls.name,
      total, present, absent: absentResult[0]?.count ?? 0, late: lateResult[0]?.count ?? 0,
      rate: total > 0 ? Math.round((present / total) * 1000) / 10 : 0,
    };
  }));
  const overallPresent = summary.reduce((s, c) => s + c.present, 0);
  const overallTotal = summary.reduce((s, c) => s + c.total, 0);
  res.json({
    date: today, summary,
    overall: { total: overallTotal, present: overallPresent, rate: overallTotal > 0 ? Math.round((overallPresent / overallTotal) * 1000) / 10 : 0 },
  });
});

router.get("/dashboard/revenue-trend", requireAuth, async (_req, res): Promise<void> => {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const monthStart = `${year}-${month}-01`;
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const monthEnd = nextMonth.toISOString().split("T")[0];
    const [collected, pending] = await Promise.all([
      db.select({ total: sum(transactionsTable.amountPaid) }).from(transactionsTable)
        .where(and(gte(transactionsTable.paidAt, new Date(monthStart)), lte(transactionsTable.paidAt, new Date(monthEnd)))),
      db.select({ total: sum(invoicesTable.totalAmount) }).from(invoicesTable)
        .where(and(eq(invoicesTable.month, `${year}-${month}`), eq(invoicesTable.status, "PENDING"))),
    ]);
    months.push({
      month: d.toLocaleString("default", { month: "short", year: "numeric" }),
      collected: parseFloat(collected[0]?.total ?? "0"),
      pending: parseFloat(pending[0]?.total ?? "0"),
    });
  }
  res.json({ months });
});

router.get("/dashboard/recent-activity", requireAuth, async (_req, res): Promise<void> => {
  const [recentStudents, recentTransactions, recentAttendance] = await Promise.all([
    db.select().from(studentsTable).orderBy(sql`${studentsTable.createdAt} DESC`).limit(3),
    db.select().from(transactionsTable).orderBy(sql`${transactionsTable.paidAt} DESC`).limit(3),
    db.select().from(attendanceTable).orderBy(sql`${attendanceTable.createdAt} DESC`).limit(3),
  ]);
  const activities = [
    ...recentStudents.map(s => ({
      id: `admission-${s.id}`, type: "ADMISSION" as const,
      description: "New student admitted", entityName: `${s.firstName} ${s.lastName}`,
      amount: null, timestamp: s.createdAt.toISOString(),
    })),
    ...recentTransactions.map(t => ({
      id: `payment-${t.id}`, type: "PAYMENT" as const,
      description: "Payment received", entityName: `Invoice #${t.invoiceId}`,
      amount: parseFloat(t.amountPaid), timestamp: t.paidAt.toISOString(),
    })),
    ...recentAttendance.map(a => ({
      id: `attendance-${a.id}`, type: "ATTENDANCE" as const,
      description: `Attendance marked: ${a.status}`, entityName: `Student #${a.studentId}`,
      amount: null, timestamp: a.createdAt.toISOString(),
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10);
  res.json({ activities });
});

// ── GET /dashboard/escalation-summary ─────────────────────────────────────
// Returns escalation counts + at-risk amounts for finance-role users.
router.get("/dashboard/escalation-summary", requireAuth, requireFinance, async (_req, res): Promise<void> => {
  const [criticalResult, warningResult] = await Promise.all([
    db.select({ cnt: count(), atRisk: sum(sql<string>`${invoicesTable.totalAmount}::numeric - ${invoicesTable.paidAmount}::numeric`) })
      .from(invoicesTable)
      .where(eq(invoicesTable.escalationLevel, "CRITICAL")),
    db.select({ cnt: count(), atRisk: sum(sql<string>`${invoicesTable.totalAmount}::numeric - ${invoicesTable.paidAmount}::numeric`) })
      .from(invoicesTable)
      .where(eq(invoicesTable.escalationLevel, "WARNING")),
  ]);
  const criticalCount = criticalResult[0]?.cnt ?? 0;
  const warningCount = warningResult[0]?.cnt ?? 0;
  const criticalAtRisk = parseFloat(criticalResult[0]?.atRisk ?? "0");
  const warningAtRisk = parseFloat(warningResult[0]?.atRisk ?? "0");
  res.json({
    criticalCount,
    warningCount,
    totalEscalated: criticalCount + warningCount,
    totalAtRisk: criticalAtRisk + warningAtRisk,
    criticalAtRisk,
    warningAtRisk,
  });
});

export default router;
