import { Router } from "express";
import { db } from "@workspace/db";
import { classFeeSchedulesTable, classesTable, feeTypesTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";

const router = Router();

// ── Helper: format a schedule row ──────────────────────────────────────────

async function fmt(s: typeof classFeeSchedulesTable.$inferSelect) {
  const [cls] = await db
    .select({ name: classesTable.name, gradeLevel: classesTable.gradeLevel })
    .from(classesTable).where(eq(classesTable.id, s.classId)).limit(1);
  const [ft] = await db
    .select({ name: feeTypesTable.name, defaultAmount: feeTypesTable.amount })
    .from(feeTypesTable).where(eq(feeTypesTable.id, s.feeTypeId)).limit(1);
  const [creator] = s.createdByUserId
    ? await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, s.createdByUserId)).limit(1)
    : [null];
  return {
    id: s.id,
    classId: s.classId,
    className: cls?.name ?? `Class #${s.classId}`,
    gradeLevel: cls?.gradeLevel ?? 0,
    feeTypeId: s.feeTypeId,
    feeTypeName: ft?.name ?? `Fee #${s.feeTypeId}`,
    defaultAmount: ft ? parseFloat(ft.defaultAmount) : null,
    academicYear: s.academicYear,
    amount: parseFloat(s.amount),
    isActive: s.isActive,
    notes: s.notes,
    createdBy: creator ? `${creator.firstName} ${creator.lastName}` : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ── GET /finance/fee-schedules ─────────────────────────────────────────────

router.get("/finance/fee-schedules", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const { academicYear, classId, feeTypeId } = req.query as Record<string, string>;

  const conditions = [];
  if (academicYear) conditions.push(eq(classFeeSchedulesTable.academicYear, academicYear));
  if (classId)      conditions.push(eq(classFeeSchedulesTable.classId, parseInt(classId, 10)));
  if (feeTypeId)    conditions.push(eq(classFeeSchedulesTable.feeTypeId, parseInt(feeTypeId, 10)));

  const rows = await db
    .select()
    .from(classFeeSchedulesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(classFeeSchedulesTable.academicYear), classFeeSchedulesTable.classId);

  const formatted = await Promise.all(rows.map(fmt));
  res.json({ schedules: formatted, total: formatted.length });
});

// ── POST /finance/fee-schedules ────────────────────────────────────────────

router.post("/finance/fee-schedules", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const { classId, feeTypeId, academicYear, amount, notes } = req.body as {
    classId?: number; feeTypeId?: number; academicYear?: string; amount?: number; notes?: string;
  };

  if (!classId || !feeTypeId || !academicYear || amount === undefined) {
    res.status(400).json({ error: "classId, feeTypeId, academicYear, and amount are required" }); return;
  }
  if (amount < 0) { res.status(400).json({ error: "amount must be >= 0" }); return; }

  const [cls] = await db.select({ id: classesTable.id }).from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  if (!cls) { res.status(404).json({ error: "CLASS_NOT_FOUND" }); return; }

  const [ft] = await db.select({ id: feeTypesTable.id }).from(feeTypesTable).where(eq(feeTypesTable.id, feeTypeId)).limit(1);
  if (!ft) { res.status(404).json({ error: "FEE_TYPE_NOT_FOUND" }); return; }

  const [schedule] = await db
    .insert(classFeeSchedulesTable)
    .values({ classId, feeTypeId, academicYear, amount: String(amount), notes: notes ?? null, createdByUserId: req.userId! })
    .onConflictDoUpdate({
      target: [classFeeSchedulesTable.classId, classFeeSchedulesTable.feeTypeId, classFeeSchedulesTable.academicYear],
      set: { amount: String(amount), notes: notes ?? null, isActive: true, updatedAt: new Date() },
    })
    .returning();

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPSERT", entity: "class_fee_schedule", entityId: schedule.id,
    description: `Set ${academicYear} fee schedule for class #${classId} / fee type #${feeTypeId}: ৳${amount}`,
    metadata: { classId, feeTypeId, academicYear, amount },
  });

  logger.info({ scheduleId: schedule.id, classId, feeTypeId, academicYear, amount }, "Fee schedule upserted");
  res.status(201).json(await fmt(schedule));
});

// ── PATCH /finance/fee-schedules/:id ──────────────────────────────────────

router.patch("/finance/fee-schedules/:id", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select().from(classFeeSchedulesTable).where(eq(classFeeSchedulesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  const { amount, isActive, notes } = req.body as { amount?: number; isActive?: boolean; notes?: string };
  const updates: Partial<typeof classFeeSchedulesTable.$inferInsert> = { updatedAt: new Date() };
  if (amount !== undefined)   updates.amount   = String(amount);
  if (isActive !== undefined) updates.isActive = isActive;
  if (notes !== undefined)    updates.notes    = notes;

  const [updated] = await db.update(classFeeSchedulesTable).set(updates).where(eq(classFeeSchedulesTable.id, id)).returning();

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "class_fee_schedule", entityId: id,
    description: `Updated fee schedule #${id}${amount !== undefined ? ` → ৳${amount}` : ""}${isActive !== undefined ? ` active:${isActive}` : ""}`,
    metadata: { amount, isActive, notes },
  });

  res.json(await fmt(updated));
});

// ── DELETE /finance/fee-schedules/:id ─────────────────────────────────────

router.delete("/finance/fee-schedules/:id", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select().from(classFeeSchedulesTable).where(eq(classFeeSchedulesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  await db.delete(classFeeSchedulesTable).where(eq(classFeeSchedulesTable.id, id));

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "class_fee_schedule", entityId: id,
    description: `Deleted fee schedule #${id} (class #${existing.classId}, fee type #${existing.feeTypeId}, ${existing.academicYear})`,
    metadata: { classId: existing.classId, feeTypeId: existing.feeTypeId, academicYear: existing.academicYear },
  });

  res.status(204).end();
});

// ── Exported helper: look up class-specific fee amount ─────────────────────

export async function getScheduledAmount(
  classId: number,
  feeTypeId: number,
  academicYear: string,
  defaultAmount: number,
): Promise<{ amount: number; fromSchedule: boolean; scheduleId: number | null }> {
  const [schedule] = await db
    .select()
    .from(classFeeSchedulesTable)
    .where(
      and(
        eq(classFeeSchedulesTable.classId, classId),
        eq(classFeeSchedulesTable.feeTypeId, feeTypeId),
        eq(classFeeSchedulesTable.academicYear, academicYear),
        eq(classFeeSchedulesTable.isActive, true),
      ),
    )
    .limit(1);

  if (schedule) {
    return { amount: parseFloat(schedule.amount), fromSchedule: true, scheduleId: schedule.id };
  }
  return { amount: defaultAmount, fromSchedule: false, scheduleId: null };
}

export default router;
