import { Router } from "express";
import { db } from "@workspace/db";
import { expenseBudgetsTable, expensesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";

const router = Router();

const CATEGORIES = [
  "SALARY","RENT","UTILITIES","MAINTENANCE","SUPPLIES",
  "TRANSPORT","FOOD","EVENTS","TECHNOLOGY","OTHER",
] as const;

// ── GET /finance/budgets?year=YYYY ─────────────────────────────────────────
// Returns all budgets for the year, each enriched with actual spend + variance.

router.get("/finance/budgets", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const y = parseInt(String(req.query["year"] ?? new Date().getFullYear()), 10);

  const budgets = await db
    .select()
    .from(expenseBudgetsTable)
    .where(eq(expenseBudgetsTable.year, y));

  // Actual paid spend per category this year
  const actuals = await db
    .select({
      category: expensesTable.category,
      actual: sql<number>`sum(amount)::numeric`,
    })
    .from(expensesTable)
    .where(
      and(
        sql`extract(year from expense_date::date) = ${y}`,
        eq(expensesTable.status, "PAID"),
      ),
    )
    .groupBy(expensesTable.category);

  const budgetMap = new Map(budgets.map(b => [b.category, parseFloat(b.budgetAmount)]));
  const actualMap = new Map(actuals.map(a => [a.category, parseFloat(String(a.actual))]));

  // Build one row per category that has either a budget OR actual spend
  const allCategories = new Set([...budgetMap.keys(), ...actualMap.keys()]);
  const rows = Array.from(allCategories).map(cat => {
    const budget = budgetMap.get(cat) ?? null;
    const actual = actualMap.get(cat) ?? 0;
    const variance    = budget !== null ? actual - budget : null;
    const variancePct = budget !== null && budget > 0 ? (variance! / budget) * 100 : null;
    const budgetRow   = budgets.find(b => b.category === cat);
    return {
      id: budgetRow?.id ?? null,
      category: cat,
      year: y,
      budget,
      actual,
      variance,
      variancePct: variancePct !== null ? Math.round(variancePct * 10) / 10 : null,
      notes: budgetRow?.notes ?? null,
      updatedAt: budgetRow?.updatedAt?.toISOString() ?? null,
    };
  });

  // Also add CATEGORIES with no data at all so the UI can render all rows
  for (const cat of CATEGORIES) {
    if (!allCategories.has(cat)) {
      rows.push({ id: null, category: cat, year: y, budget: null, actual: 0, variance: null, variancePct: null, notes: null, updatedAt: null });
    }
  }

  // Sort by budget amount desc, then alphabetically
  rows.sort((a, b) => (b.budget ?? -1) - (a.budget ?? -1));

  // Annual totals
  const totalBudget = rows.reduce((s, r) => s + (r.budget ?? 0), 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);

  res.json({
    year: y,
    rows,
    totals: {
      budget: Math.round(totalBudget * 100) / 100,
      actual: Math.round(totalActual * 100) / 100,
      variance: Math.round((totalActual - totalBudget) * 100) / 100,
    },
  });
});

// ── PUT /finance/budgets ────────────────────────────────────────────────────
// Upsert: set or update the annual budget for one category+year.

router.put("/finance/budgets", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const { category, year, budgetAmount, notes } = req.body as {
    category?: string; year?: number; budgetAmount?: number; notes?: string;
  };

  if (!category || !year || budgetAmount === undefined) {
    res.status(400).json({ error: "category, year, and budgetAmount are required" }); return;
  }
  if (!CATEGORIES.includes(category as any)) {
    res.status(400).json({ error: "Invalid category" }); return;
  }
  if (budgetAmount < 0) {
    res.status(400).json({ error: "budgetAmount must be >= 0" }); return;
  }

  const [upserted] = await db
    .insert(expenseBudgetsTable)
    .values({
      category: category as any,
      year,
      budgetAmount: String(budgetAmount),
      notes: notes ?? null,
      createdByUserId: req.userId!,
    })
    .onConflictDoUpdate({
      target: [expenseBudgetsTable.category, expenseBudgetsTable.year],
      set: {
        budgetAmount: String(budgetAmount),
        notes: notes ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPSERT", entity: "expense_budget", entityId: upserted.id,
    description: `Set ${year} budget for ${category}: ৳${budgetAmount.toLocaleString()}`,
    metadata: { category, year, budgetAmount, notes },
  });

  logger.info({ category, year, budgetAmount }, "Budget upserted");
  res.json({ id: upserted.id, category, year, budgetAmount, notes });
});

// ── DELETE /finance/budgets/:id ────────────────────────────────────────────

router.delete("/finance/budgets/:id", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select().from(expenseBudgetsTable).where(eq(expenseBudgetsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  await db.delete(expenseBudgetsTable).where(eq(expenseBudgetsTable.id, id));

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "expense_budget", entityId: id,
    description: `Removed ${existing.year} budget for ${existing.category}`,
    metadata: { category: existing.category, year: existing.year, budgetAmount: existing.budgetAmount },
  });

  res.status(204).end();
});

export default router;
