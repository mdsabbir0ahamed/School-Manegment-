import { Router } from "express";
import { db } from "@workspace/db";
import { classesTable, usersTable, studentsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAdmin } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { CreateClassBody } from "@workspace/api-zod";

const router = Router();

async function formatClass(cls: typeof classesTable.$inferSelect) {
  const [teacherResult, studentCount] = await Promise.all([
    cls.teacherId
      ? db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable).where(eq(usersTable.id, cls.teacherId)).limit(1)
      : Promise.resolve([]),
    db.select({ count: count() }).from(studentsTable).where(eq(studentsTable.classId, cls.id)),
  ]);
  const teacher = teacherResult[0];
  return {
    id: cls.id, name: cls.name, section: cls.section, gradeLevel: cls.gradeLevel,
    teacherId: cls.teacherId,
    teacherName: teacher ? `${teacher.firstName} ${teacher.lastName}` : null,
    studentCount: studentCount[0]?.count ?? 0,
    createdAt: cls.createdAt.toISOString(),
  };
}

router.get("/classes", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "ACCOUNTANT" || role === "PARENT" || role === "STUDENT") {
    res.status(403).json({ error: "FORBIDDEN" }); return;
  }
  const classes = await db.select().from(classesTable).orderBy(classesTable.gradeLevel);
  const formatted = await Promise.all(classes.map(formatClass));
  res.json({ classes: formatted });
});

router.post("/classes", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateClassBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
  const d = parsed.data;
  const [cls] = await db.insert(classesTable).values({
    name: d.name, section: d.section ?? null, gradeLevel: d.gradeLevel, teacherId: d.teacherId ?? null,
  }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "class", entityId: cls.id,
    description: `Created class "${cls.name}"`, metadata: { name: cls.name, gradeLevel: cls.gradeLevel },
  });
  res.status(201).json(await formatClass(cls));
});

router.get("/classes/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "ACCOUNTANT" || role === "PARENT" || role === "STUDENT") {
    res.status(403).json({ error: "FORBIDDEN" }); return;
  }
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [cls] = await db.select().from(classesTable).where(eq(classesTable.id, id)).limit(1);
  if (!cls) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  res.json(await formatClass(cls));
});

router.put("/classes/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const parsed = CreateClassBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
  const [cls] = await db.update(classesTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(classesTable.id, id)).returning();
  if (!cls) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "class", entityId: id,
    description: `Updated class "${cls.name}"`, metadata: parsed.data as Record<string, unknown>,
  });
  res.json(await formatClass(cls));
});

export default router;
