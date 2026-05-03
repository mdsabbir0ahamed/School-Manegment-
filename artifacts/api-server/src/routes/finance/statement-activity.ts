import { Router } from "express";
import { db } from "@workspace/db";
import { feeStatementLogsTable, studentsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, desc, count, sql } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";
import type { AuthRequest } from "../../middlewares/requireAuth.js";

const router = Router();

// GET /finance/statement-activity
// School-wide statement dispatch history with filters.
router.get(
  "/finance/statement-activity",
  requireAuth,
  requireFinance,
  async (req: AuthRequest, res): Promise<void> => {
    const { dateFrom, dateTo, action, triggeredByUserId, page = "0", limit = "50" } = req.query as Record<string, string>;

    const pageNum  = Math.max(0, parseInt(page, 10) || 0);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const conditions = [];
    if (dateFrom) {
      conditions.push(gte(feeStatementLogsTable.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      conditions.push(lte(feeStatementLogsTable.createdAt, to));
    }
    if (action === "PDF_DOWNLOAD" || action === "EMAIL_SENT") {
      conditions.push(eq(feeStatementLogsTable.action, action));
    }
    if (triggeredByUserId) {
      const uid = parseInt(triggeredByUserId, 10);
      if (!isNaN(uid)) conditions.push(eq(feeStatementLogsTable.triggeredByUserId, uid));
    }

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }], kpiRows] = await Promise.all([
      db
        .select({
          id: feeStatementLogsTable.id,
          action: feeStatementLogsTable.action,
          sentTo: feeStatementLogsTable.sentTo,
          deliveryMode: feeStatementLogsTable.deliveryMode,
          createdAt: feeStatementLogsTable.createdAt,
          studentDbId: studentsTable.id,
          studentCode: studentsTable.studentId,
          studentFirstName: studentsTable.firstName,
          studentLastName: studentsTable.lastName,
          staffFirstName: usersTable.firstName,
          staffLastName: usersTable.lastName,
          staffRole: usersTable.role,
        })
        .from(feeStatementLogsTable)
        .leftJoin(studentsTable, eq(feeStatementLogsTable.studentId, studentsTable.id))
        .leftJoin(usersTable, eq(feeStatementLogsTable.triggeredByUserId, usersTable.id))
        .where(where)
        .orderBy(desc(feeStatementLogsTable.createdAt))
        .limit(pageSize)
        .offset(pageNum * pageSize),

      db
        .select({ total: count() })
        .from(feeStatementLogsTable)
        .where(where),

      // KPIs — always unfiltered for the summary cards
      db.execute<{ action: string; cnt: string }>(sql`
        SELECT action, COUNT(*) AS cnt
        FROM fee_statement_logs
        GROUP BY action
      `),
    ]);

    const kpiMap = Object.fromEntries(kpiRows.rows.map((r) => [r.action, parseInt(String(r.cnt), 10)]));

    // Unique students touched (unfiltered)
    const [{ uniqueStudents }] = await db
      .select({ uniqueStudents: sql<number>`COUNT(DISTINCT student_id)` })
      .from(feeStatementLogsTable);

    // Staff list for filter dropdown (unfiltered)
    const staffList = await db
      .selectDistinct({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        role: usersTable.role,
      })
      .from(feeStatementLogsTable)
      .innerJoin(usersTable, eq(feeStatementLogsTable.triggeredByUserId, usersTable.id))
      .orderBy(usersTable.firstName);

    res.json({
      logs: rows.map(r => ({
        id: r.id,
        action: r.action,
        sentTo: r.sentTo,
        deliveryMode: r.deliveryMode,
        createdAt: r.createdAt.toISOString(),
        student: r.studentCode
          ? { id: r.studentDbId, code: r.studentCode, name: `${r.studentFirstName} ${r.studentLastName}` }
          : null,
        triggeredBy: r.staffFirstName
          ? { name: `${r.staffFirstName} ${r.staffLastName}`.trim(), role: r.staffRole ?? "" }
          : null,
      })),
      total: Number(total),
      page: pageNum,
      pageSize,
      kpis: {
        totalDownloads:  kpiMap["PDF_DOWNLOAD"] ?? 0,
        totalEmails:     kpiMap["EMAIL_SENT"]   ?? 0,
        uniqueStudents:  Number(uniqueStudents),
        totalDispatches: (kpiMap["PDF_DOWNLOAD"] ?? 0) + (kpiMap["EMAIL_SENT"] ?? 0),
      },
      staffList: staffList.map(s => ({
        id: s.id,
        name: `${s.firstName} ${s.lastName}`.trim(),
        role: s.role,
      })),
    });
  },
);

export default router;
