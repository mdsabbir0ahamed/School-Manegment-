import { Router } from "express";
import { db } from "@workspace/db";
import {
  studentDiscountsTable, studentsTable, feeTypesTable, usersTable,
} from "@workspace/db";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";

const router = Router();

// ── Helper: format a discount row ─────────────────────────────────────────

async function formatDiscount(d: typeof studentDiscountsTable.$inferSelect) {
  const [student] = await db
    .select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName, studentId: studentsTable.studentId })
    .from(studentsTable).where(eq(studentsTable.id, d.studentId)).limit(1);

  const [feeType] = d.feeTypeId
    ? await db.select({ name: feeTypesTable.name }).from(feeTypesTable).where(eq(feeTypesTable.id, d.feeTypeId)).limit(1)
    : [null];

  const [creator] = d.createdByUserId
    ? await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(eq(usersTable.id, d.createdByUserId)).limit(1)
    : [null];

  return {
    id: d.id,
    studentId: d.studentId,
    studentName: student ? `${student.firstName} ${student.lastName}` : `Student #${d.studentId}`,
    studentKey: student?.studentId ?? "",
    feeTypeId: d.feeTypeId,
    feeTypeName: feeType?.name ?? null,
    discountType: d.discountType,
    discountValue: parseFloat(d.discountValue),
    reason: d.reason,
    isActive: d.isActive,
    createdBy: creator ? `${creator.firstName} ${creator.lastName}` : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

// ── GET /finance/discounts ────────────────────────────────────────────────

router.get(
  "/finance/discounts",
  requireAuth,
  requireFinance,
  async (req, res): Promise<void> => {
    const studentId = req.query["studentId"] ? parseInt(String(req.query["studentId"]), 10) : undefined;
    const activeOnly = req.query["active"] === "true";

    const conditions = [];
    if (studentId) conditions.push(eq(studentDiscountsTable.studentId, studentId));
    if (activeOnly) conditions.push(eq(studentDiscountsTable.isActive, true));

    const rows = await db
      .select()
      .from(studentDiscountsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(studentDiscountsTable.createdAt))
      .limit(200);

    const formatted = await Promise.all(rows.map(formatDiscount));
    res.json({ discounts: formatted, total: formatted.length });
  },
);

// ── POST /finance/discounts ───────────────────────────────────────────────

router.post(
  "/finance/discounts",
  requireAuth,
  requireFinance,
  async (req: AuthRequest, res): Promise<void> => {
    const { studentId, feeTypeId, discountType, discountValue, reason } = req.body as {
      studentId?: number;
      feeTypeId?: number | null;
      discountType?: string;
      discountValue?: number;
      reason?: string;
    };

    if (!studentId || !discountType || discountValue === undefined) {
      res.status(400).json({ error: "studentId, discountType, and discountValue are required" }); return;
    }
    if (!["PERCENTAGE", "FIXED"].includes(discountType)) {
      res.status(400).json({ error: "discountType must be PERCENTAGE or FIXED" }); return;
    }
    if (discountValue <= 0) {
      res.status(400).json({ error: "discountValue must be positive" }); return;
    }
    if (discountType === "PERCENTAGE" && discountValue > 100) {
      res.status(400).json({ error: "Percentage discount cannot exceed 100%" }); return;
    }

    const [student] = await db.select({ id: studentsTable.id }).from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
    if (!student) { res.status(404).json({ error: "STUDENT_NOT_FOUND" }); return; }

    if (feeTypeId) {
      const [ft] = await db.select({ id: feeTypesTable.id }).from(feeTypesTable).where(eq(feeTypesTable.id, feeTypeId)).limit(1);
      if (!ft) { res.status(404).json({ error: "FEE_TYPE_NOT_FOUND" }); return; }
    }

    const [discount] = await db.insert(studentDiscountsTable).values({
      studentId,
      feeTypeId: feeTypeId ?? null,
      discountType: discountType as "PERCENTAGE" | "FIXED",
      discountValue: String(discountValue),
      reason: reason ?? null,
      isActive: true,
      createdByUserId: req.userId!,
    }).returning();

    await audit({
      userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
      action: "CREATE", entity: "student_discount", entityId: discount.id,
      description: `Created ${discountType} discount of ${discountValue}${discountType === "PERCENTAGE" ? "%" : "৳"} for student #${studentId}${feeTypeId ? ` on fee type #${feeTypeId}` : " (all fees)"}`,
      metadata: { studentId, feeTypeId, discountType, discountValue, reason },
    });

    logger.info({ discountId: discount.id, studentId, discountType, discountValue }, "Student discount created");
    res.status(201).json(await formatDiscount(discount));
  },
);

// ── PATCH /finance/discounts/:id ─────────────────────────────────────────

router.patch(
  "/finance/discounts/:id",
  requireAuth,
  requireFinance,
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

    const { isActive, reason, discountValue } = req.body as {
      isActive?: boolean; reason?: string; discountValue?: number;
    };

    const [existing] = await db.select().from(studentDiscountsTable).where(eq(studentDiscountsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const updates: Partial<typeof studentDiscountsTable.$inferInsert> = { updatedAt: new Date() };
    if (isActive !== undefined) updates.isActive = isActive;
    if (reason !== undefined) updates.reason = reason;
    if (discountValue !== undefined) updates.discountValue = String(discountValue);

    const [updated] = await db.update(studentDiscountsTable).set(updates).where(eq(studentDiscountsTable.id, id)).returning();

    await audit({
      userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
      action: "UPDATE", entity: "student_discount", entityId: id,
      description: `Updated discount #${id} — ${isActive !== undefined ? `active: ${isActive}` : ""}${discountValue !== undefined ? ` value: ${discountValue}` : ""}`,
      metadata: { isActive, discountValue, reason },
    });

    res.json(await formatDiscount(updated));
  },
);

// ── DELETE /finance/discounts/:id ────────────────────────────────────────

router.delete(
  "/finance/discounts/:id",
  requireAuth,
  requireFinance,
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

    const [existing] = await db.select().from(studentDiscountsTable).where(eq(studentDiscountsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    await db.delete(studentDiscountsTable).where(eq(studentDiscountsTable.id, id));

    await audit({
      userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
      action: "DELETE", entity: "student_discount", entityId: id,
      description: `Deleted discount #${id} for student #${existing.studentId}`,
      metadata: { studentId: existing.studentId, discountType: existing.discountType, discountValue: existing.discountValue },
    });

    res.status(204).end();
  },
);

export default router;

// ── Exported helper: compute discounted amount for a student+feeType ──────

export async function applyDiscount(
  studentId: number,
  feeTypeId: number,
  baseAmount: number,
): Promise<{ finalAmount: number; discountApplied: number; discountId: number | null }> {
  // Prefer a fee-type-specific discount over a catch-all discount
  const discounts = await db
    .select()
    .from(studentDiscountsTable)
    .where(
      and(
        eq(studentDiscountsTable.studentId, studentId),
        eq(studentDiscountsTable.isActive, true),
        or(
          eq(studentDiscountsTable.feeTypeId, feeTypeId),
          isNull(studentDiscountsTable.feeTypeId),
        ),
      ),
    )
    .orderBy(studentDiscountsTable.feeTypeId); // specific (non-null) first

  if (discounts.length === 0) return { finalAmount: baseAmount, discountApplied: 0, discountId: null };

  // Pick most specific: fee-type-specific wins over catch-all
  const best = discounts.find(d => d.feeTypeId === feeTypeId) ?? discounts[0]!;
  const value = parseFloat(best.discountValue);

  let discountApplied: number;
  if (best.discountType === "PERCENTAGE") {
    discountApplied = Math.round(baseAmount * value) / 100;
  } else {
    discountApplied = Math.min(value, baseAmount);
  }

  return {
    finalAmount: Math.max(0, baseAmount - discountApplied),
    discountApplied,
    discountId: best.id,
  };
}
