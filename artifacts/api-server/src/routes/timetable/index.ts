import { Router } from "express";
import { db } from "@workspace/db";
import { timetableTable, classesTable, subjectsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAdmin, requireAcademic } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";

const router = Router();

async function formatSlot(t: typeof timetableTable.$inferSelect) {
  const [cls] = await db.select({ name: classesTable.name })
    .from(classesTable).where(eq(classesTable.id, t.classId)).limit(1);
  const [sub] = await db.select({ name: subjectsTable.name, code: subjectsTable.code })
    .from(subjectsTable).where(eq(subjectsTable.id, t.subjectId)).limit(1);
  const teacher = t.teacherId
    ? await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, t.teacherId)).limit(1)
    : [];
  return {
    id: t.id,
    classId: t.classId,
    className: cls?.name ?? "Unknown",
    subjectId: t.subjectId,
    subjectName: sub?.name ?? "Unknown",
    subjectCode: sub?.code ?? "",
    teacherId: t.teacherId,
    teacherName: teacher[0] ? `${teacher[0].firstName} ${teacher[0].lastName}` : null,
    dayOfWeek: t.dayOfWeek,
    startTime: t.startTime,
    endTime: t.endTime,
    room: t.room,
    createdAt: t.createdAt.toISOString(),
  };
}

// ── List ───────────────────────────────────────────────────────────────────

router.get("/timetable", requireAuth, requireAcademic, async (req, res): Promise<void> => {
  const classId = req.query["classId"] ? parseInt(String(req.query["classId"]), 10) : undefined;
  const day = req.query["day"] as string | undefined;
  const conditions = [];
  if (classId) conditions.push(eq(timetableTable.classId, classId));
  if (day) conditions.push(eq(timetableTable.dayOfWeek, day as any));
  const where = conditions.length ? and(...conditions) : undefined;
  const slots = await db.select().from(timetableTable).where(where).orderBy(timetableTable.startTime);
  res.json({ slots: await Promise.all(slots.map(formatSlot)), total: slots.length });
});

// ── Create ─────────────────────────────────────────────────────────────────

router.post("/timetable", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { classId, subjectId, teacherId, dayOfWeek, startTime, endTime, room } = req.body as {
    classId?: number; subjectId?: number; teacherId?: number;
    dayOfWeek?: string; startTime?: string; endTime?: string; room?: string;
  };
  if (!classId || !subjectId || !dayOfWeek || !startTime || !endTime) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "classId, subjectId, dayOfWeek, startTime, endTime required" });
    return;
  }
  const [slot] = await db.insert(timetableTable).values({
    classId, subjectId, teacherId: teacherId ?? null,
    dayOfWeek: dayOfWeek as any, startTime, endTime, room: room ?? null,
  }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "timetable", entityId: slot.id,
    description: `Added timetable slot: ${dayOfWeek} ${startTime}-${endTime}`,
  });
  res.status(201).json(await formatSlot(slot));
});

// ── Update ─────────────────────────────────────────────────────────────────

router.put("/timetable/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const { startTime, endTime, room, teacherId, subjectId } = req.body as {
    startTime?: string; endTime?: string; room?: string; teacherId?: number | null; subjectId?: number;
  };
  const [updated] = await db.update(timetableTable).set({
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(room !== undefined ? { room: room ?? null } : {}),
    ...(teacherId !== undefined ? { teacherId: teacherId ?? null } : {}),
    ...(subjectId ? { subjectId } : {}),
    updatedAt: new Date(),
  }).where(eq(timetableTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "timetable", entityId: id,
    description: `Updated timetable slot #${id}`,
  });
  res.json(await formatSlot(updated));
});

// ── Delete ─────────────────────────────────────────────────────────────────

router.delete("/timetable/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [deleted] = await db.delete(timetableTable).where(eq(timetableTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "timetable", entityId: id,
    description: `Deleted timetable slot #${id}`,
  });
  res.json({ message: "Deleted" });
});

export default router;
