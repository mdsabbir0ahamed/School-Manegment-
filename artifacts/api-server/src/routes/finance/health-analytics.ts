import { Router } from "express";
import { db } from "@workspace/db";
import {
  invoicesTable, studentsTable, feeTypesTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";

const router = Router();

function round2(n: number) { return Math.round(n * 100) / 100; }

// GET /finance/health-analytics
// School-wide financial health dashboard data.
router.get("/finance/health-analytics", requireAuth, requireFinance, async (_req, res): Promise<void> => {
  const today = new Date();

  // 1. Monthly trend — last 12 calendar months
  const trendRows = await db.execute<{
    yr: number; mo: number;
    billed: string; collected: string; outstanding: string; invoice_count: number;
  }>(sql`
    SELECT
      EXTRACT(YEAR  FROM due_date::date)::int  AS yr,
      EXTRACT(MONTH FROM due_date::date)::int  AS mo,
      SUM(total_amount::numeric)::numeric       AS billed,
      SUM(paid_amount::numeric)::numeric        AS collected,
      SUM(total_amount::numeric - paid_amount::numeric)::numeric AS outstanding,
      COUNT(*)::int                             AS invoice_count
    FROM invoices
    WHERE status != 'CANCELLED'
      AND due_date::date >= (CURRENT_DATE - INTERVAL '11 months')::date
      AND due_date::date <  (CURRENT_DATE + INTERVAL '1 month')::date
    GROUP BY yr, mo
    ORDER BY yr, mo
  `);

  const monthlyTrend: {
    label: string; year: number; month: number;
    billed: number; collected: number; outstanding: number; collectionRate: number; invoiceCount: number;
  }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const yr = d.getFullYear();
    const mo = d.getMonth() + 1;
    const trendRowArr = (trendRows as any).rows ?? trendRows;
    const found = (trendRowArr as Array<{ yr: number; mo: number; billed: string; collected: string; outstanding: string; invoice_count: number }>)
      .find(r => Number(r.yr) === yr && Number(r.mo) === mo);
    const billed      = found ? parseFloat(String(found.billed))      : 0;
    const collected   = found ? parseFloat(String(found.collected))   : 0;
    const outstanding = found ? parseFloat(String(found.outstanding)) : 0;
    const rate        = billed > 0 ? round2((collected / billed) * 100) : 0;
    const label       = d.toLocaleString("en-US", { month: "short", year: "2-digit" });
    monthlyTrend.push({
      label, year: yr, month: mo,
      billed: round2(billed), collected: round2(collected),
      outstanding: round2(outstanding), collectionRate: rate,
      invoiceCount: found ? Number(found.invoice_count) : 0,
    });
  }

  // 2. Top debtors — students with most outstanding balance
  const debtorRows = await db.execute<{
    student_id: number; first_name: string; last_name: string;
    outstanding: string; overdue_count: number; pending_count: number;
  }>(sql`
    SELECT
      s.id           AS student_id,
      s.first_name,
      s.last_name,
      SUM(i.total_amount::numeric - i.paid_amount::numeric)::numeric AS outstanding,
      COUNT(*) FILTER (WHERE i.status = 'OVERDUE')::int              AS overdue_count,
      COUNT(*) FILTER (WHERE i.status = 'PENDING')::int              AS pending_count
    FROM invoices i
    JOIN students s ON s.id = i.student_id
    WHERE i.status IN ('PENDING', 'OVERDUE')
    GROUP BY s.id, s.first_name, s.last_name
    HAVING SUM(i.total_amount::numeric - i.paid_amount::numeric) > 0
    ORDER BY outstanding DESC
    LIMIT 15
  `);

  const debtorRowArr = (debtorRows as any).rows ?? debtorRows;
  const topDebtors = (debtorRowArr as Array<{
    student_id: number; first_name: string; last_name: string;
    outstanding: string; overdue_count: number; pending_count: number;
  }>).map(r => ({
    studentId:    Number(r.student_id),
    name:         `${r.first_name} ${r.last_name}`,
    outstanding:  round2(parseFloat(String(r.outstanding))),
    overdueCount: Number(r.overdue_count),
    pendingCount: Number(r.pending_count),
  }));

  // 3. Fee-type breakdown
  const feeTypeRows = await db.execute<{
    fee_type_id: number; fee_type_name: string;
    billed: string; collected: string; outstanding: string; invoice_count: number;
  }>(sql`
    SELECT
      ft.id              AS fee_type_id,
      ft.name            AS fee_type_name,
      SUM(i.total_amount::numeric)::numeric              AS billed,
      SUM(i.paid_amount::numeric)::numeric               AS collected,
      SUM(i.total_amount::numeric - i.paid_amount::numeric)::numeric AS outstanding,
      COUNT(*)::int      AS invoice_count
    FROM invoices i
    JOIN fee_types ft ON ft.id = i.fee_type_id
    WHERE i.status != 'CANCELLED'
    GROUP BY ft.id, ft.name
    ORDER BY billed DESC
  `);

  const feeTypeRowArr = (feeTypeRows as any).rows ?? feeTypeRows;
  const feeTypeBreakdown = (feeTypeRowArr as Array<{
    fee_type_id: number; fee_type_name: string;
    billed: string; collected: string; outstanding: string; invoice_count: number;
  }>).map(r => {
    const billed    = round2(parseFloat(String(r.billed)));
    const collected = round2(parseFloat(String(r.collected)));
    return {
      feeTypeId:    Number(r.fee_type_id),
      name:         String(r.fee_type_name),
      billed, collected,
      outstanding:  round2(parseFloat(String(r.outstanding))),
      collectionRate: billed > 0 ? round2((collected / billed) * 100) : 0,
      invoiceCount: Number(r.invoice_count),
    };
  });

  // 4. Aging buckets — wrap in subquery so alias is available in GROUP BY
  const agingRows = await db.execute<{
    bucket: string; count: number; outstanding: string;
  }>(sql`
    SELECT bucket,
           COUNT(*)::int AS count,
           SUM(total_amount::numeric - paid_amount::numeric)::numeric AS outstanding
    FROM (
      SELECT total_amount, paid_amount,
        CASE
          WHEN due_date::date > CURRENT_DATE                          THEN 'Not yet due'
          WHEN (CURRENT_DATE - due_date::date) BETWEEN 1  AND 30     THEN '1-30 days'
          WHEN (CURRENT_DATE - due_date::date) BETWEEN 31 AND 60     THEN '31-60 days'
          WHEN (CURRENT_DATE - due_date::date) BETWEEN 61 AND 90     THEN '61-90 days'
          ELSE '90+ days'
        END AS bucket
      FROM invoices
      WHERE status IN ('PENDING', 'OVERDUE')
    ) sub
    GROUP BY bucket
    ORDER BY
      CASE bucket
        WHEN 'Not yet due' THEN 0
        WHEN '1-30 days'   THEN 1
        WHEN '31-60 days'  THEN 2
        WHEN '61-90 days'  THEN 3
        ELSE 4
      END
  `);

  const BUCKET_ORDER = ["Not yet due", "1-30 days", "31-60 days", "61-90 days", "90+ days"];
  const agingRowArr = (agingRows as any).rows ?? agingRows;
  const agingBuckets = BUCKET_ORDER.map(bucket => {
    const found = (agingRowArr as Array<{ bucket: string; count: number; outstanding: string }>)
      .find(r => r.bucket === bucket);
    return {
      bucket,
      count:       found ? Number(found.count)                            : 0,
      outstanding: found ? round2(parseFloat(String(found.outstanding))) : 0,
    };
  });

  // 5. Snapshot KPIs
  const snapRows = await db.execute<{
    total_billed: string; total_collected: string; total_outstanding: string;
    overdue_count: number; pending_count: number; paid_count: number; cancelled_count: number;
  }>(sql`
    SELECT
      SUM(total_amount::numeric)::numeric              AS total_billed,
      SUM(paid_amount::numeric)::numeric               AS total_collected,
      SUM(total_amount::numeric - paid_amount::numeric)
        FILTER (WHERE status IN ('PENDING','OVERDUE'))::numeric AS total_outstanding,
      COUNT(*) FILTER (WHERE status = 'OVERDUE')::int  AS overdue_count,
      COUNT(*) FILTER (WHERE status = 'PENDING')::int  AS pending_count,
      COUNT(*) FILTER (WHERE status = 'PAID')::int     AS paid_count,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_count
    FROM invoices
  `);

  const snapRowArr = (snapRows as any).rows ?? snapRows;
  const snap = (snapRowArr as Array<Record<string, unknown>>)[0] ?? {};
  const totalBilled      = round2(parseFloat(String(snap["total_billed"]      ?? 0)));
  const totalCollected   = round2(parseFloat(String(snap["total_collected"]   ?? 0)));
  const totalOutstanding = round2(parseFloat(String(snap["total_outstanding"] ?? 0)));
  const overallRate      = totalBilled > 0 ? round2((totalCollected / totalBilled) * 100) : 0;

  const snapshot = {
    totalBilled, totalCollected, totalOutstanding,
    overallCollectionRate: overallRate,
    overdueCount:   Number(snap["overdue_count"]   ?? 0),
    pendingCount:   Number(snap["pending_count"]   ?? 0),
    paidCount:      Number(snap["paid_count"]      ?? 0),
    cancelledCount: Number(snap["cancelled_count"] ?? 0),
  };

  res.json({ monthlyTrend, topDebtors, feeTypeBreakdown, agingBuckets, snapshot, generatedAt: today.toISOString() });
});

export default router;
