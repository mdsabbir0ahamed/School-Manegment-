import { Router } from "express";
import { db } from "@workspace/db";
import { studentIncidentsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireRole } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";

const router = Router();

const requireStaff    = requireRole("SUPER_ADMIN", "TEACHER", "ACCOUNTANT");
const requireCanWrite = requireRole("SUPER_ADMIN", "TEACHER");
const requireAdmin    = requireRole("SUPER_ADMIN");

router.get("/student-incidents", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const studentId = parseInt(String(req.query["studentId"]), 10);
  if (isNaN(studentId)) { res.status(400).json({ error: "BAD_REQUEST", message: "studentId required" }); return; }

  const incidents = await db
    .select()
    .from(studentIncidentsTable)
    .where(eq(studentIncidentsTable.studentId, studentId))
    .orderBy(desc(studentIncidentsTable.createdAt));

  res.json({ incidents });
});

router.post("/student-incidents", requireAuth, requireCanWrite, async (req: AuthRequest, res): Promise<void> => {
  const { studentId, title, description, severity, actionTaken } = req.body ?? {};
  if (!studentId || !title?.trim() || !description?.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "studentId, title and description are required" }); return;
  }

  const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const sev = SEVERITIES.includes(severity) ? severity : "LOW";

  const [author] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  const [created] = await db
    .insert(studentIncidentsTable)
    .values({
      studentId: parseInt(String(studentId), 10),
      reportedByUserId: req.userId!,
      reportedByName: author ? `${author.firstName} ${author.lastName}` : "Unknown",
      title: title.trim(),
      description: description.trim(),
      severity: sev,
      actionTaken: actionTaken?.trim() || null,
      status: "OPEN",
    })
    .returning();

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "CREATE", entity: "student_incident", entityId: created!.id,
    description: `Logged ${sev} incident for student #${studentId}: ${title}`,
    metadata: { studentId, severity: sev },
  });

  res.status(201).json({ incident: created });
});

router.patch("/student-incidents/:id", requireAuth, requireCanWrite, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db
    .select()
    .from(studentIncidentsTable)
    .where(eq(studentIncidentsTable.id, id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  const isAdmin = req.userRole === "SUPER_ADMIN";
  const isOwner = existing.reportedByUserId === req.userId;
  if (!isAdmin && !isOwner) {
    res.status(403).json({ error: "FORBIDDEN", message: "You can only update your own incidents" }); return;
  }

  const STATUSES = ["OPEN", "RESOLVED", "DISMISSED"];
  const { status, actionTaken } = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status && STATUSES.includes(status)) {
    updates["status"] = status;
    if (status === "RESOLVED" || status === "DISMISSED") updates["resolvedAt"] = new Date();
    else updates["resolvedAt"] = null;
  }
  if (actionTaken !== undefined) updates["actionTaken"] = actionTaken?.trim() || null;

  const [updated] = await db
    .update(studentIncidentsTable)
    .set(updates as any)
    .where(eq(studentIncidentsTable.id, id))
    .returning();

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "UPDATE", entity: "student_incident", entityId: id,
    description: `Updated incident #${id} for student #${existing.studentId} → ${status ?? "no status change"}`,
    metadata: updates as Record<string, unknown>,
  });

  res.json({ incident: updated });
});

router.delete("/student-incidents/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db
    .select({ studentId: studentIncidentsTable.studentId, title: studentIncidentsTable.title })
    .from(studentIncidentsTable)
    .where(eq(studentIncidentsTable.id, id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  await db.delete(studentIncidentsTable).where(eq(studentIncidentsTable.id, id));

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "DELETE", entity: "student_incident", entityId: id,
    description: `Deleted incident for student #${existing.studentId}: ${existing.title}`,
    metadata: { studentId: existing.studentId },
  });

  res.status(204).send();
});

export default router;
