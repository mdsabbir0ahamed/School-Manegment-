import { Router } from "express";
import { db } from "@workspace/db";
import {
  classAnnouncementsTable, classesTable, usersTable,
  studentsTable, parentStudentsTable,
} from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireRole } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";

const router = Router();

const requireStaff      = requireRole("SUPER_ADMIN", "TEACHER");
const requireStaffView  = requireRole("SUPER_ADMIN", "TEACHER", "ACCOUNTANT");

// ── Admin / Teacher: list announcements for a class ─────────────────────────
router.get("/class-announcements", requireAuth, requireStaffView, async (req: AuthRequest, res): Promise<void> => {
  const classId = parseInt(String(req.query["classId"]), 10);
  if (isNaN(classId)) { res.status(400).json({ error: "BAD_REQUEST", message: "classId required" }); return; }

  // Teachers may only see their own classes
  if (req.userRole === "TEACHER") {
    const [cls] = await db.select({ teacherId: classesTable.teacherId })
      .from(classesTable).where(eq(classesTable.id, classId)).limit(1);
    if (!cls || cls.teacherId !== req.userId) {
      res.status(403).json({ error: "FORBIDDEN", message: "You can only view announcements for your own classes" }); return;
    }
  }

  const announcements = await db
    .select()
    .from(classAnnouncementsTable)
    .where(eq(classAnnouncementsTable.classId, classId))
    .orderBy(desc(classAnnouncementsTable.createdAt));

  res.json({ announcements });
});

// ── Admin / Teacher: post announcement ──────────────────────────────────────
router.post("/class-announcements", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const { classId, title, body } = req.body ?? {};
  if (!classId || !title?.trim() || !body?.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "classId, title and body are required" }); return;
  }

  const cid = parseInt(String(classId), 10);

  // Teachers may only post to their own classes
  if (req.userRole === "TEACHER") {
    const [cls] = await db.select({ teacherId: classesTable.teacherId })
      .from(classesTable).where(eq(classesTable.id, cid)).limit(1);
    if (!cls || cls.teacherId !== req.userId) {
      res.status(403).json({ error: "FORBIDDEN", message: "You can only post to your own classes" }); return;
    }
  }

  const [author] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  const [created] = await db.insert(classAnnouncementsTable).values({
    classId: cid,
    authorUserId: req.userId!,
    authorName: author ? `${author.firstName} ${author.lastName}` : "Unknown",
    title: title.trim(),
    body: body.trim(),
  }).returning();

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "CREATE", entity: "class_announcement", entityId: created!.id,
    description: `Posted announcement to class #${cid}: ${title}`,
    metadata: { classId: cid },
  });

  res.status(201).json({ announcement: created });
});

// ── Admin / Teacher: delete announcement ────────────────────────────────────
router.delete("/class-announcements/:id", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select()
    .from(classAnnouncementsTable).where(eq(classAnnouncementsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  const isAdmin = req.userRole === "SUPER_ADMIN";
  const isOwner = existing.authorUserId === req.userId;
  if (!isAdmin && !isOwner) {
    res.status(403).json({ error: "FORBIDDEN", message: "You can only delete your own announcements" }); return;
  }

  await db.delete(classAnnouncementsTable).where(eq(classAnnouncementsTable.id, id));
  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "DELETE", entity: "class_announcement", entityId: id,
    description: `Deleted announcement #${id} from class #${existing.classId}`,
    metadata: { classId: existing.classId },
  });

  res.status(204).send();
});

// ── Student: announcements for their linked class ────────────────────────────
router.get("/student/announcements", requireAuth, requireRole("STUDENT"), async (req: AuthRequest, res): Promise<void> => {
  const [userRow] = await db.select({ linkedStudentId: usersTable.linkedStudentId })
    .from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  if (!userRow?.linkedStudentId) { res.json({ announcements: [], classId: null }); return; }

  const [student] = await db.select({ classId: studentsTable.classId })
    .from(studentsTable).where(eq(studentsTable.id, userRow.linkedStudentId)).limit(1);

  if (!student?.classId) { res.json({ announcements: [], classId: null }); return; }

  const announcements = await db
    .select()
    .from(classAnnouncementsTable)
    .where(eq(classAnnouncementsTable.classId, student.classId))
    .orderBy(desc(classAnnouncementsTable.createdAt));

  res.json({ announcements, classId: student.classId });
});

// ── Parent: announcements for all linked students' classes ───────────────────
router.get("/parent/announcements", requireAuth, requireRole("PARENT"), async (req: AuthRequest, res): Promise<void> => {
  const links = await db
    .select({ studentId: parentStudentsTable.studentId })
    .from(parentStudentsTable)
    .where(eq(parentStudentsTable.parentUserId, req.userId!));

  if (!links.length) { res.json({ announcements: [] }); return; }

  const studentIds = links.map(l => l.studentId);
  const students = await db
    .select({ id: studentsTable.id, classId: studentsTable.classId, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable)
    .where(inArray(studentsTable.id, studentIds));

  const classIds = [...new Set(students.map(s => s.classId).filter((c): c is number => c !== null))];
  if (!classIds.length) { res.json({ announcements: [] }); return; }

  const announcements = await db
    .select()
    .from(classAnnouncementsTable)
    .where(inArray(classAnnouncementsTable.classId, classIds))
    .orderBy(desc(classAnnouncementsTable.createdAt));

  // Build classId → student name map for display
  const classStudentMap: Record<number, string> = {};
  for (const s of students) {
    if (s.classId) classStudentMap[s.classId] = `${s.firstName} ${s.lastName}`;
  }

  res.json({
    announcements: announcements.map(a => ({
      ...a,
      studentName: classStudentMap[a.classId] ?? null,
    })),
  });
});

export default router;
