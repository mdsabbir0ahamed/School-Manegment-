import { Router } from "express";
import { db } from "@workspace/db";
import { studentNotesTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireRole } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";

const router = Router();

const requireStaff = requireRole("SUPER_ADMIN", "TEACHER", "ACCOUNTANT");
const requireCanWrite = requireRole("SUPER_ADMIN", "TEACHER");

router.get("/student-notes", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const studentId = parseInt(String(req.query["studentId"]), 10);
  if (isNaN(studentId)) { res.status(400).json({ error: "BAD_REQUEST", message: "studentId required" }); return; }

  const notes = await db
    .select()
    .from(studentNotesTable)
    .where(eq(studentNotesTable.studentId, studentId))
    .orderBy(desc(studentNotesTable.createdAt));

  res.json({ notes });
});

router.post("/student-notes", requireAuth, requireCanWrite, async (req: AuthRequest, res): Promise<void> => {
  const { studentId, note } = req.body ?? {};
  if (!studentId || !note?.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "studentId and note are required" }); return;
  }

  const [author] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  const authorName = author ? `${author.firstName} ${author.lastName}` : "Unknown";

  const [created] = await db
    .insert(studentNotesTable)
    .values({
      studentId: parseInt(String(studentId), 10),
      authorUserId: req.userId!,
      authorName,
      note: note.trim(),
    })
    .returning();

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "CREATE", entity: "student_note", entityId: created!.id,
    description: `Added note for student #${studentId}`,
    metadata: { studentId },
  });

  res.status(201).json({ note: created });
});

router.delete("/student-notes/:id", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db
    .select({ authorUserId: studentNotesTable.authorUserId, studentId: studentNotesTable.studentId })
    .from(studentNotesTable)
    .where(eq(studentNotesTable.id, id))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  const isAdmin = req.userRole === "SUPER_ADMIN";
  const isOwner = existing.authorUserId === req.userId;
  if (!isAdmin && !isOwner) {
    res.status(403).json({ error: "FORBIDDEN", message: "You can only delete your own notes" }); return;
  }

  await db.delete(studentNotesTable).where(eq(studentNotesTable.id, id));

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "DELETE", entity: "student_note", entityId: id,
    description: `Deleted note for student #${existing.studentId}`,
    metadata: { studentId: existing.studentId },
  });

  res.status(204).send();
});

export default router;
