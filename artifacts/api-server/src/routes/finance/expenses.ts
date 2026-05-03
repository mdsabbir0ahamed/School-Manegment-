import { Router } from "express";
import { db } from "@workspace/db";
import { expensesTable, usersTable } from "@workspace/db";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";

const router = Router();

const CATEGORIES = ["SALARY","RENT","UTILITIES","MAINTENANCE","SUPPLIES","TRANSPORT","FOOD","EVENTS","TECHNOLOGY","OTHER"] as const;
const STATUSES   = ["PENDING","APPROVED","REJECTED","PAID"] as const;

// ── Helper: format ─────────────────────────────────────────────────────────

async function formatExpense(e: typeof expensesTable.$inferSelect) {
  const [creator] = e.createdByUserId
    ? await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, e.createdByUserId)).limit(1)
    : [null];
  const [approver] = e.approvedByUserId
    ? await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, e.approvedByUserId)).limit(1)
    : [null];

  return {
    id: e.id,
    category: e.category,
    description: e.description,
    amount: parseFloat(e.amount),
    expenseDate: e.expenseDate,
    payee: e.payee,
    referenceNumber: e.referenceNumber,
    notes: e.notes,
    status: e.status,
    createdBy: creator ? `${creator.firstName} ${creator.lastName}` : null,
    approvedBy: approver ? `${approver.firstName} ${approver.lastName}` : null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

// ── GET /finance/expenses ──────────────────────────────────────────────────

router.get("/finance/expenses", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const { category, status, dateFrom, dateTo, limit: limitStr, offset: offsetStr } = req.query as Record<string, string>;

  const limit  = Math.min(parseInt(limitStr ?? "50", 10), 200);
  const offset = parseInt(offsetStr ?? "0", 10);

  const conditions: ReturnType<typeof eq>[] = [];
  if (category && CATEGORIES.includes(category as any)) {
    conditions.push(eq(expensesTable.category, category as any));
  }
  if (status && STATUSES.includes(status as any)) {
    conditions.push(eq(expensesTable.status, status as any));
  }
  if (dateFrom) conditions.push(gte(expensesTable.expenseDate, dateFrom));
  if (dateTo)   conditions.push(lte(expensesTable.expenseDate, dateTo));

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(expensesTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(expensesTable.expenseDate))
      .limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(expensesTable)
      .where(conditions.length ? and(...conditions) : undefined),
  ]);

  const formatted = await Promise.all(rows.map(formatExpense));
  res.json({ expenses: formatted, total });
});

// ── GET /finance/expenses/summary ─────────────────────────────────────────

router.get("/finance/expenses/summary", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const { year } = req.query as { year?: string };
  const y = parseInt(year ?? String(new Date().getFullYear()), 10);

  // Monthly totals for the selected year
  const monthly = await db
    .select({
      month: sql<string>`to_char(expense_date::date, 'YYYY-MM')`,
      total: sql<number>`sum(amount)::numeric`,
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

  // Category breakdown for the selected year
  const byCategory = await db
    .select({
      category: expensesTable.category,
      total: sql<number>`sum(amount)::numeric`,
      count: sql<number>`count(*)::int`,
    })
    .from(expensesTable)
    .where(
      and(
        sql`extract(year from expense_date::date) = ${y}`,
        eq(expensesTable.status, "PAID"),
      ),
    )
    .groupBy(expensesTable.category)
    .orderBy(sql`sum(amount) desc`);

  // Overall totals (all statuses)
  const [totals] = await db
    .select({
      totalAll:     sql<number>`coalesce(sum(amount), 0)::numeric`,
      totalPaid:    sql<number>`coalesce(sum(case when status = 'PAID'    then amount else 0 end), 0)::numeric`,
      totalPending: sql<number>`coalesce(sum(case when status = 'PENDING' then amount else 0 end), 0)::numeric`,
      countAll:     sql<number>`count(*)::int`,
    })
    .from(expensesTable)
    .where(sql`extract(year from expense_date::date) = ${y}`);

  res.json({
    year: y,
    totals: {
      all:     parseFloat(String(totals?.totalAll ?? 0)),
      paid:    parseFloat(String(totals?.totalPaid ?? 0)),
      pending: parseFloat(String(totals?.totalPending ?? 0)),
      count:   totals?.countAll ?? 0,
    },
    monthly: monthly.map(m => ({ month: m.month, total: parseFloat(String(m.total)) })),
    byCategory: byCategory.map(c => ({
      category: c.category,
      total: parseFloat(String(c.total)),
      count: c.count,
    })),
  });
});

// ── POST /finance/expenses ─────────────────────────────────────────────────

router.post("/finance/expenses", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const { category, description, amount, expenseDate, payee, referenceNumber, notes } = req.body as {
    category?: string; description?: string; amount?: number;
    expenseDate?: string; payee?: string; referenceNumber?: string; notes?: string;
  };

  if (!category || !description || amount === undefined || !expenseDate) {
    res.status(400).json({ error: "category, description, amount, and expenseDate are required" }); return;
  }
  if (!CATEGORIES.includes(category as any)) {
    res.status(400).json({ error: "Invalid category" }); return;
  }
  if (amount <= 0) {
    res.status(400).json({ error: "amount must be positive" }); return;
  }

  const [expense] = await db.insert(expensesTable).values({
    category: category as any,
    description,
    amount: String(amount),
    expenseDate,
    payee: payee ?? null,
    referenceNumber: referenceNumber ?? null,
    notes: notes ?? null,
    status: "PENDING",
    createdByUserId: req.userId!,
  }).returning();

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "expense", entityId: expense.id,
    description: `Created expense "${description}" — ${category} ৳${amount} on ${expenseDate}`,
    metadata: { category, description, amount, expenseDate, payee },
  });

  logger.info({ expenseId: expense.id, category, amount }, "Expense created");
  res.status(201).json(await formatExpense(expense));
});

// ── PATCH /finance/expenses/:id ────────────────────────────────────────────

router.patch("/finance/expenses/:id", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select().from(expensesTable).where(eq(expensesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  const { status, amount, description, payee, referenceNumber, notes, category } = req.body as Record<string, any>;

  const updates: Partial<typeof expensesTable.$inferInsert> = { updatedAt: new Date() };
  if (status && STATUSES.includes(status)) {
    updates.status = status;
    if (status === "APPROVED" || status === "PAID") {
      updates.approvedByUserId = req.userId!;
    }
  }
  if (amount !== undefined && amount > 0)  updates.amount = String(amount);
  if (description !== undefined)           updates.description = description;
  if (payee !== undefined)                 updates.payee = payee;
  if (referenceNumber !== undefined)       updates.referenceNumber = referenceNumber;
  if (notes !== undefined)                 updates.notes = notes;
  if (category && CATEGORIES.includes(category)) updates.category = category;

  const [updated] = await db.update(expensesTable).set(updates).where(eq(expensesTable.id, id)).returning();

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "expense", entityId: id,
    description: `Updated expense #${id}${status ? ` → status: ${status}` : ""}`,
    metadata: { status, amount, description },
  });

  res.json(await formatExpense(updated));
});

// ── DELETE /finance/expenses/:id ───────────────────────────────────────────

router.delete("/finance/expenses/:id", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select().from(expensesTable).where(eq(expensesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  if (existing.status === "PAID") {
    res.status(409).json({ error: "Cannot delete a paid expense. Change status first." }); return;
  }

  await db.delete(expensesTable).where(eq(expensesTable.id, id));

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "expense", entityId: id,
    description: `Deleted expense #${id} — ${existing.category} ৳${existing.amount}`,
    metadata: { category: existing.category, amount: existing.amount, description: existing.description },
  });

  res.status(204).end();
});

export default router;
