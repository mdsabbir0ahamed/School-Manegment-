import { Router } from "express";
import { db } from "@workspace/db";
import { classFeeSchedulesTable, classesTable, feeTypesTable, usersTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
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

// ── GET /finance/fee-schedules/export ─────────────────────────────────────

router.get("/finance/fee-schedules/export", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const { academicYear, classId } = req.query as Record<string, string>;

  const conditions = [];
  if (academicYear) conditions.push(eq(classFeeSchedulesTable.academicYear, academicYear));
  if (classId)      conditions.push(eq(classFeeSchedulesTable.classId, parseInt(classId, 10)));

  const rows = await db
    .select()
    .from(classFeeSchedulesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(classFeeSchedulesTable.academicYear, classFeeSchedulesTable.classId, classFeeSchedulesTable.feeTypeId);

  // Build lookup maps with a single query each
  const classIds   = [...new Set(rows.map(r => r.classId))];
  const feeTypeIds = [...new Set(rows.map(r => r.feeTypeId))];

  const classes = classIds.length
    ? await db.select({ id: classesTable.id, name: classesTable.name, gradeLevel: classesTable.gradeLevel })
        .from(classesTable).where(inArray(classesTable.id, classIds))
    : [];
  const feeTypes = feeTypeIds.length
    ? await db.select({ id: feeTypesTable.id, name: feeTypesTable.name, defaultAmount: feeTypesTable.amount })
        .from(feeTypesTable).where(inArray(feeTypesTable.id, feeTypeIds))
    : [];

  const classMap   = new Map(classes.map(c => [c.id, c]));
  const feeTypeMap = new Map(feeTypes.map(f => [f.id, f]));

  const header = "className,feeTypeName,academicYear,amount,defaultAmount,isActive,notes,gradeLevel";
  const csvLines = rows.map(r => {
    const cls = classMap.get(r.classId);
    const ft  = feeTypeMap.get(r.feeTypeId);
    const escape = (s: string) => s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    return [
      escape(cls?.name ?? `Class #${r.classId}`),
      escape(ft?.name ?? `Fee #${r.feeTypeId}`),
      r.academicYear,
      r.amount,
      ft?.defaultAmount ?? "",
      r.isActive ? "true" : "false",
      escape(r.notes ?? ""),
      cls?.gradeLevel ?? "",
    ].join(",");
  });

  const ay = academicYear ?? "all";
  const filename = `fee-schedules-${ay}.csv`;
  const csv = [header, ...csvLines].join("\r\n");

  logger.info({ rows: rows.length, academicYear, classId }, "Fee schedules exported");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

// ── POST /finance/fee-schedules/import ────────────────────────────────────

router.post("/finance/fee-schedules/import", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const { rows, academicYear: defaultYear } = req.body as {
    rows?: Array<{ className: string; feeTypeName: string; academicYear?: string; amount: number; notes?: string }>;
    academicYear?: string;
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "rows array is required and must not be empty" }); return;
  }
  if (rows.length > 500) {
    res.status(400).json({ error: "Maximum 500 rows per import" }); return;
  }

  // Pre-load lookup maps
  const allClasses  = await db.select({ id: classesTable.id, name: classesTable.name }).from(classesTable);
  const allFeeTypes = await db.select({ id: feeTypesTable.id, name: feeTypesTable.name }).from(feeTypesTable);

  const classMap   = new Map(allClasses.map(c => [c.name.trim().toLowerCase(), c.id]));
  const feeTypeMap = new Map(allFeeTypes.map(f => [f.name.trim().toLowerCase(), f.id]));

  const imported: number[] = [];
  const errors: Array<{ row: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const rowNum = i + 1;

    const classId   = classMap.get(r.className?.trim().toLowerCase() ?? "");
    const feeTypeId = feeTypeMap.get(r.feeTypeName?.trim().toLowerCase() ?? "");
    const ay        = (r.academicYear?.trim() || defaultYear)?.trim() ?? "";
    const amount    = Number(r.amount);

    if (!classId)            { errors.push({ row: rowNum, reason: `Class "${r.className}" not found` }); continue; }
    if (!feeTypeId)          { errors.push({ row: rowNum, reason: `Fee type "${r.feeTypeName}" not found` }); continue; }
    if (!ay || !/^\d{4}-\d{2}$/.test(ay)) { errors.push({ row: rowNum, reason: `Academic year "${ay}" invalid (use e.g. 2025-26)` }); continue; }
    if (isNaN(amount) || amount < 0) { errors.push({ row: rowNum, reason: `Amount "${r.amount}" invalid` }); continue; }

    try {
      const [schedule] = await db
        .insert(classFeeSchedulesTable)
        .values({ classId, feeTypeId, academicYear: ay, amount: String(amount), notes: r.notes?.trim() || null, createdByUserId: req.userId! })
        .onConflictDoUpdate({
          target: [classFeeSchedulesTable.classId, classFeeSchedulesTable.feeTypeId, classFeeSchedulesTable.academicYear],
          set: { amount: String(amount), notes: r.notes?.trim() || null, isActive: true, updatedAt: new Date() },
        })
        .returning({ id: classFeeSchedulesTable.id });
      imported.push(schedule.id);
    } catch (err) {
      errors.push({ row: rowNum, reason: "Database error — duplicate or constraint violation" });
    }
  }

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "IMPORT", entity: "class_fee_schedule", entityId: 0,
    description: `Bulk imported ${imported.length} fee schedules (${errors.length} errors)`,
    metadata: { imported: imported.length, errors: errors.length },
  });

  logger.info({ imported: imported.length, errors: errors.length }, "Fee schedules bulk import complete");
  res.json({ imported: imported.length, errors, total: rows.length });
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
