import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
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
