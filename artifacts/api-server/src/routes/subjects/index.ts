import { Router } from "express";
import { db } from "@workspace/db";
import { subjectsTable, classesTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAdmin, requireAcademic } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";

const router = Router();

// ── List ───────────────────────────────────────────────────────────────────

router.get("/subjects", requireAuth, requireAcademic, async (req, res): Promise<void> => {
  const classId = req.query["classId"] ? parseInt(String(req.query["classId"]), 10) : undefined;
  const subjects = await db.select().from(subjectsTable)
    .where(classId ? eq(subjectsTable.classId, classId) : undefined)
    .orderBy(subjectsTable.name);
  res.json({
    subjects: subjects.map(s => ({
      id: s.id, name: s.name, code: s.code, description: s.description,
      classId: s.classId, createdAt: s.createdAt.toISOString(),
    })),
    total: subjects.length,
  });
});

// ── Create ─────────────────────────────────────────────────────────────────

router.post("/subjects", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { name, code, description, classId } = req.body as {
    name?: string; code?: string; description?: string; classId?: number;
  };
  if (!name?.trim() || !code?.trim()) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Name and code are required" });
    return;
  }
  const [existing] = await db.select({ id: subjectsTable.id })
    .from(subjectsTable).where(eq(subjectsTable.code, code.toUpperCase())).limit(1);
  if (existing) {
    res.status(409).json({ error: "DUPLICATE", message: "Subject code already exists" });
    return;
  }
  const [subject] = await db.insert(subjectsTable).values({
    name: name.trim(), code: code.toUpperCase().trim(),
    description: description?.trim() ?? null,
    classId: classId ?? null,
  }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "subject", entityId: subject.id,
    description: `Created subject "${subject.name}" (${subject.code})`,
  });
  res.status(201).json({
    id: subject.id, name: subject.name, code: subject.code,
    description: subject.description, classId: subject.classId,
    createdAt: subject.createdAt.toISOString(),
  });
});

// ── Update ─────────────────────────────────────────────────────────────────

router.put("/subjects/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const { name, code, description, classId } = req.body as {
    name?: string; code?: string; description?: string; classId?: number | null;
  };
  const [updated] = await db.update(subjectsTable).set({
    ...(name ? { name: name.trim() } : {}),
    ...(code ? { code: code.toUpperCase().trim() } : {}),
    ...(description !== undefined ? { description: description?.trim() ?? null } : {}),
    ...(classId !== undefined ? { classId: classId ?? null } : {}),
    updatedAt: new Date(),
  }).where(eq(subjectsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "subject", entityId: id,
    description: `Updated subject "${updated.name}"`,
  });
  res.json({
    id: updated.id, name: updated.name, code: updated.code,
    description: updated.description, classId: updated.classId,
    createdAt: updated.createdAt.toISOString(),
  });
});

// ── Delete ─────────────────────────────────────────────────────────────────

router.delete("/subjects/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [deleted] = await db.delete(subjectsTable).where(eq(subjectsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "subject", entityId: id,
    description: `Deleted subject "${deleted.name}"`,
  });
  res.json({ message: "Deleted" });
});

export default router;
