import { Router } from "express";
import { db } from "@workspace/db";
import {
  classFeeSchedulesTable, classesTable, feeTypesTable,
  invoicesTable, studentsTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";

const router = Router();

// ── GET /finance/collection-report ─────────────────────────────────────────
// Returns per-class fee collection gap analysis for an academic year.
// Expected = schedule amount × active student count
// Billed   = totalAmount of non-cancelled invoices in that AY
// Collected= paidAmount of PAID invoices in that AY

router.get("/finance/collection-report", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const rawAy = String(req.query["academicYear"] ?? "");
  if (!rawAy || !/^\d{4}-\d{2}$/.test(rawAy)) {
    res.status(400).json({ error: "academicYear is required (format: YYYY-YY, e.g. 2025-26)" });
    return;
  }

  // Parse academic year → calendar year boundaries
  const ayStart = parseInt(rawAy.slice(0, 4), 10);  // e.g. 2025
  const ayEnd   = ayStart + 1;                       // e.g. 2026

  // ── 1. Active fee schedules for this AY ───────────────────────────────────
  const schedules = await db
    .select()
    .from(classFeeSchedulesTable)
    .where(
      and(
        eq(classFeeSchedulesTable.academicYear, rawAy),
        eq(classFeeSchedulesTable.isActive, true),
      ),
    );

  if (!schedules.length) {
    res.json({ academicYear: rawAy, kpis: zeroKpis(rawAy), byClass: [] });
    return;
  }

  // ── 2. Active student counts per class ────────────────────────────────────
  const classIds = [...new Set(schedules.map(s => s.classId))];
  const feeTypeIds = [...new Set(schedules.map(s => s.feeTypeId))];

  const studentCountRows = await db
    .select({
      classId: studentsTable.classId,
      count: sql<number>`count(*)::int`,
    })
    .from(studentsTable)
    .where(
      and(
        inArray(studentsTable.classId, classIds),
        eq(studentsTable.status, "ACTIVE"),
      ),
    )
    .groupBy(studentsTable.classId);

  const studentCountMap = new Map(
    studentCountRows.map(r => [r.classId ?? -1, r.count]),
  );

  // ── 3. Billed amounts (non-cancelled invoices in this AY) ─────────────────
  // AY boundary: month >= 7 of ayStart OR month < 7 of ayEnd
  const billedRows = await db
    .select({
      classId: studentsTable.classId,
      feeTypeId: invoicesTable.feeTypeId,
      billed: sql<number>`sum(${invoicesTable.totalAmount})::numeric`,
      invoiceCount: sql<number>`count(${invoicesTable.id})::int`,
    })
    .from(invoicesTable)
    .innerJoin(studentsTable, eq(invoicesTable.studentId, studentsTable.id))
    .where(
      and(
        sql`${invoicesTable.status} != 'CANCELLED'`,
        inArray(studentsTable.classId, classIds),
        inArray(invoicesTable.feeTypeId, feeTypeIds),
        sql`(
          (EXTRACT(MONTH FROM ${invoicesTable.dueDate}::date) >= 7 AND EXTRACT(YEAR FROM ${invoicesTable.dueDate}::date) = ${ayStart})
          OR
          (EXTRACT(MONTH FROM ${invoicesTable.dueDate}::date) < 7 AND EXTRACT(YEAR FROM ${invoicesTable.dueDate}::date) = ${ayEnd})
        )`,
      ),
    )
    .groupBy(studentsTable.classId, invoicesTable.feeTypeId);

  // ── 4. Collected amounts (PAID invoices only) ─────────────────────────────
  const collectedRows = await db
    .select({
      classId: studentsTable.classId,
      feeTypeId: invoicesTable.feeTypeId,
      collected: sql<number>`sum(${invoicesTable.paidAmount})::numeric`,
    })
    .from(invoicesTable)
    .innerJoin(studentsTable, eq(invoicesTable.studentId, studentsTable.id))
    .where(
      and(
        eq(invoicesTable.status, "PAID"),
        inArray(studentsTable.classId, classIds),
        inArray(invoicesTable.feeTypeId, feeTypeIds),
        sql`(
          (EXTRACT(MONTH FROM ${invoicesTable.dueDate}::date) >= 7 AND EXTRACT(YEAR FROM ${invoicesTable.dueDate}::date) = ${ayStart})
          OR
          (EXTRACT(MONTH FROM ${invoicesTable.dueDate}::date) < 7 AND EXTRACT(YEAR FROM ${invoicesTable.dueDate}::date) = ${ayEnd})
        )`,
      ),
    )
    .groupBy(studentsTable.classId, invoicesTable.feeTypeId);

  // ── 5. Lookup maps ────────────────────────────────────────────────────────
  const classes  = await db.select().from(classesTable).where(inArray(classesTable.id, classIds));
  const feeTypes = await db.select().from(feeTypesTable).where(inArray(feeTypesTable.id, feeTypeIds));
  const classMap   = new Map(classes.map(c => [c.id, c]));
  const feeTypeMap = new Map(feeTypes.map(f => [f.id, f]));

  // Keyed lookup helpers
  const key = (classId: number | null, feeTypeId: number) => `${classId}:${feeTypeId}`;
  const billedMap    = new Map(billedRows.map(r => [key(r.classId, r.feeTypeId), { billed: parseFloat(String(r.billed ?? 0)), count: r.invoiceCount }]));
  const collectedMap = new Map(collectedRows.map(r => [key(r.classId, r.feeTypeId), parseFloat(String(r.collected ?? 0))]));

  // ── 6. Build per-class result ─────────────────────────────────────────────
  // Group schedules by classId
  const byClassMap = new Map<number, typeof schedules>();
  for (const s of schedules) {
    const arr = byClassMap.get(s.classId) ?? [];
    arr.push(s);
    byClassMap.set(s.classId, arr);
  }

  const byClass = [...byClassMap.entries()]
    .map(([classId, rows]) => {
      const cls           = classMap.get(classId);
      const studentCount  = studentCountMap.get(classId) ?? 0;

      const byFeeType = rows.map(s => {
        const k          = key(classId, s.feeTypeId);
        const ft         = feeTypeMap.get(s.feeTypeId);
        const scheduleAmt = parseFloat(s.amount);
        const expected   = scheduleAmt * studentCount;
        const billedEntry = billedMap.get(k);
        const billed     = billedEntry?.billed ?? 0;
        const invoiceCount = billedEntry?.count ?? 0;
        const collected  = collectedMap.get(k) ?? 0;
        const gap        = expected - collected;
        const rate       = expected > 0 ? (collected / expected) * 100 : 0;

        return {
          feeTypeId:    s.feeTypeId,
          feeTypeName:  ft?.name ?? `Fee #${s.feeTypeId}`,
          scheduleAmount: scheduleAmt,
          studentCount,
          expected:     round(expected),
          billed:       round(billed),
          invoiceCount,
          collected:    round(collected),
          gap:          round(gap),
          collectionRate: round(rate),
        };
      });

      const classExpected  = byFeeType.reduce((s, r) => s + r.expected,  0);
      const classBilled    = byFeeType.reduce((s, r) => s + r.billed,    0);
      const classCollected = byFeeType.reduce((s, r) => s + r.collected, 0);
      const classGap       = round(classExpected - classCollected);
      const classRate      = classExpected > 0 ? round((classCollected / classExpected) * 100) : 0;

      return {
        classId,
        className:   cls?.name ?? `Class #${classId}`,
        gradeLevel:  cls?.gradeLevel ?? 0,
        studentCount,
        expected:    round(classExpected),
        billed:      round(classBilled),
        collected:   round(classCollected),
        gap:         classGap,
        collectionRate: classRate,
        byFeeType,
      };
    })
    .sort((a, b) => a.gradeLevel - b.gradeLevel);

  // ── 7. Overall KPIs ───────────────────────────────────────────────────────
  const totalExpected  = round(byClass.reduce((s, c) => s + c.expected,  0));
  const totalBilled    = round(byClass.reduce((s, c) => s + c.billed,    0));
  const totalCollected = round(byClass.reduce((s, c) => s + c.collected, 0));
  const totalGap       = round(totalExpected - totalCollected);
  const overallRate    = totalExpected > 0 ? round((totalCollected / totalExpected) * 100) : 0;

  res.json({
    academicYear: rawAy,
    kpis: {
      totalExpected,
      totalBilled,
      totalCollected,
      totalGap,
      collectionRate: overallRate,
      classCount:    byClass.length,
      scheduleCount: schedules.length,
    },
    byClass,
  });
});

function round(n: number) { return Math.round(n * 100) / 100; }
function zeroKpis(ay: string) {
  return { totalExpected: 0, totalBilled: 0, totalCollected: 0, totalGap: 0, collectionRate: 0, classCount: 0, scheduleCount: 0, academicYear: ay };
}

export default router;
