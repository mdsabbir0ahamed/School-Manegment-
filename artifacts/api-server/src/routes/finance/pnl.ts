import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable, expensesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";

const router = Router();

// ── GET /finance/pnl ───────────────────────────────────────────────────────
// Returns monthly income vs paid expenses for the given year,
// plus annual KPIs and a month-by-month breakdown table.

router.get("/finance/pnl", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const y = parseInt(String(req.query["year"] ?? new Date().getFullYear()), 10);

  // Monthly income — sum of actual payments collected (transactions.amountPaid)
  const incomeRows = await db
    .select({
      month: sql<string>`to_char("paid_at", 'YYYY-MM')`,
      income: sql<number>`sum(amount_paid)::numeric`,
    })
    .from(transactionsTable)
    .where(sql`extract(year from "paid_at") = ${y}`)
    .groupBy(sql`to_char("paid_at", 'YYYY-MM')`)
    .orderBy(sql`to_char("paid_at", 'YYYY-MM')`);

  // Monthly expenses — sum of PAID expenses
  const expenseRows = await db
    .select({
      month: sql<string>`to_char(expense_date::date, 'YYYY-MM')`,
      expenses: sql<number>`sum(amount)::numeric`,
    })
    .from(expensesTable)
    .where(
      and(
        sql`extract(year from expense_date::date) = ${y}`,
        eq(expensesTable.status, "PAID"),
      ),
    )
    .groupBy(sql`to_char(expense_date::date, 'YYYY-MM')`)
    .orderBy(sql`to_char(expense_date::date, 'YYYY-MM')`);

  // Build a full 12-month map
  const incomeMap = new Map(incomeRows.map(r => [r.month, parseFloat(String(r.income))]));
  const expenseMap = new Map(expenseRows.map(r => [r.month, parseFloat(String(r.expenses))]));

  const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthly = MONTH_LABELS.map((label, i) => {
    const key = `${y}-${String(i + 1).padStart(2, "0")}`;
    const income   = incomeMap.get(key)  ?? 0;
    const expenses = expenseMap.get(key) ?? 0;
    const net      = income - expenses;
    return { month: key, label, income, expenses, net };
  });

  // Annual KPIs
  const totalIncome   = monthly.reduce((s, m) => s + m.income,   0);
  const totalExpenses = monthly.reduce((s, m) => s + m.expenses, 0);
  const netSurplus    = totalIncome - totalExpenses;
  const margin        = totalIncome > 0 ? (netSurplus / totalIncome) * 100 : 0;

  // Best and worst months (excluding months with no activity)
  const active = monthly.filter(m => m.income > 0 || m.expenses > 0);
  const best  = active.length ? active.reduce((a, b) => b.net > a.net ? b : a) : null;
  const worst = active.length ? active.reduce((a, b) => b.net < a.net ? b : a) : null;

  // Trailing 3-month average net (most recent 3 active months)
  const recent3 = active.slice(-3);
  const trailing3Avg = recent3.length
    ? recent3.reduce((s, m) => s + m.net, 0) / recent3.length
    : 0;

  res.json({
    year: y,
    kpis: {
      totalIncome:   Math.round(totalIncome   * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netSurplus:    Math.round(netSurplus    * 100) / 100,
      marginPct:     Math.round(margin        * 10)  / 10,
      trailing3Avg:  Math.round(trailing3Avg  * 100) / 100,
      bestMonth:  best  ? { label: best.label,  net: best.net  } : null,
      worstMonth: worst ? { label: worst.label, net: worst.net } : null,
    },
    monthly,
  });
});

export default router;
