import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, studentsTable, classesTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { hashPassword } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAdmin } from "../../middlewares/requireRole.js";
import { CreateUserBody, UpdateUserBody, ListUsersQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/users", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const parsed = ListUsersQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : { limit: 20, offset: 0 };
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  const conditions = [];
  if (params.role) conditions.push(eq(usersTable.role, params.role as any));

  const [users, totalResult] = await Promise.all([
    db.select({
      id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName,
      lastName: usersTable.lastName, phoneNumber: usersTable.phoneNumber,
      role: usersTable.role, isActive: usersTable.isActive, createdAt: usersTable.createdAt,
    }).from(usersTable).where(conditions.length ? and(...conditions) : undefined).limit(limit).offset(offset).orderBy(usersTable.createdAt),
    db.select({ count: count() }).from(usersTable).where(conditions.length ? and(...conditions) : undefined),
  ]);

  res.json({
    users: users.map(u => ({ ...u, createdAt: u.createdAt.toISOString() })),
    total: totalResult[0]?.count ?? 0,
  });
});

router.post("/users", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid input" }); return; }
  const { password, ...rest } = parsed.data;
  const passwordHash = hashPassword(password);
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, rest.email)).limit(1);
  if (existing) { res.status(409).json({ error: "CONFLICT", message: "Email already in use" }); return; }
  const [user] = await db.insert(usersTable).values({ ...rest, passwordHash }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "user", entityId: user.id,
    description: `Created user ${user.email} with role ${user.role}`,
    metadata: { role: user.role, email: user.email },
  });
  res.status(201).json({
    id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    phoneNumber: user.phoneNumber, role: user.role, isActive: user.isActive, createdAt: user.createdAt.toISOString(),
  });
});

router.get("/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    phoneNumber: user.phoneNumber, role: user.role, isActive: user.isActive, createdAt: user.createdAt.toISOString() });
});

router.put("/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
  const [user] = await db.update(usersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(usersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "user", entityId: id,
    description: `Updated user ${user.email}`, metadata: parsed.data as Record<string, unknown>,
  });
  res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    phoneNumber: user.phoneNumber, role: user.role, isActive: user.isActive, createdAt: user.createdAt.toISOString() });
});

// ── Linked Student Record (STUDENT role) ────────────────────────────────────

router.get("/users/:id/linked-student", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [user] = await db.select({ linkedStudentId: usersTable.linkedStudentId })
    .from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  if (!user.linkedStudentId) { res.json({ student: null }); return; }

  const [student] = await db.select({
    id: studentsTable.id, studentId: studentsTable.studentId,
    firstName: studentsTable.firstName, lastName: studentsTable.lastName,
    status: studentsTable.status, classId: studentsTable.classId,
  }).from(studentsTable).where(eq(studentsTable.id, user.linkedStudentId)).limit(1);

  if (!student) { res.json({ student: null }); return; }

  let className: string | null = null;
  if (student.classId) {
    const [cls] = await db.select({ name: classesTable.name })
      .from(classesTable).where(eq(classesTable.id, student.classId)).limit(1);
    className = cls?.name ?? null;
  }

  res.json({ student: { ...student, className } });
});

router.put("/users/:id/linked-student", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const studentId: number | null = req.body.studentId ?? null;

  const [user] = await db.select({ role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  if (user.role !== "STUDENT") { res.status(400).json({ error: "BAD_REQUEST", message: "User is not a STUDENT" }); return; }

  if (studentId !== null) {
    const [conflict] = await db.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.linkedStudentId, studentId)).limit(1);
    if (conflict && conflict.id !== id) {
      res.status(409).json({ error: "CONFLICT", message: "This student record is already linked to another user account" });
      return;
    }
  }

  await db.update(usersTable)
    .set({ linkedStudentId: studentId, updatedAt: new Date() })
    .where(eq(usersTable.id, id));

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "UPDATE", entity: "user", entityId: id,
    description: studentId
      ? `Linked student record #${studentId} to user account #${id}`
      : `Unlinked student record from user account #${id}`,
    metadata: { linkedStudentId: studentId },
  });

  res.json({ success: true, linkedStudentId: studentId });
});

router.delete("/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  await db.delete(usersTable).where(eq(usersTable.id, id));
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "user", entityId: id,
    description: `Deleted user ${user?.email ?? id}`,
  });
  res.status(204).send();
});

export default router;
