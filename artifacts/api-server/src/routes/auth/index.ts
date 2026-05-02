import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createToken, hashPassword, verifyPassword } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { LoginBody } from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";

const router = Router();

// ── Login ──────────────────────────────────────────────────────────────────

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid input" });
    return;
  }
  const { email, password } = parsed.data;
  const ip = req.headers["x-forwarded-for"]?.toString() ?? req.socket.remoteAddress ?? null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user) {
    await audit({ action: "LOGIN_FAILED", entity: "auth", description: `Failed login for ${email}`, ipAddress: ip });
    res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    return;
  }
  if (!verifyPassword(password, user.passwordHash)) {
    await audit({ action: "LOGIN_FAILED", entity: "auth", userEmail: email, description: `Wrong password for ${email}`, ipAddress: ip });
    res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "ACCOUNT_DISABLED", message: "Account is disabled" });
    return;
  }
  await audit({
    userId: user.id, userEmail: user.email, userRole: user.role,
    action: "LOGIN", entity: "auth",
    description: `${user.firstName} ${user.lastName} logged in`,
    ipAddress: ip,
  });
  const accessToken = createToken(user.id, user.role, user.email);
  res.json({
    accessToken,
    user: {
      id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
      phoneNumber: user.phoneNumber, role: user.role, isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

// ── Me ─────────────────────────────────────────────────────────────────────

router.get("/auth/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user) {
    res.status(404).json({ error: "NOT_FOUND", message: "User not found" });
    return;
  }
  res.json({
    id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    phoneNumber: user.phoneNumber, role: user.role, isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  });
});

// ── Change Password ────────────────────────────────────────────────────────

router.put("/auth/password", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || typeof currentPassword !== "string") {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Current password is required" });
    return;
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "New password must be at least 6 characters" });
    return;
  }
  const ip = req.headers["x-forwarded-for"]?.toString() ?? req.socket.remoteAddress ?? null;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user) {
    res.status(404).json({ error: "NOT_FOUND", message: "User not found" });
    return;
  }

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    await audit({
      userId: user.id, userEmail: user.email, userRole: user.role,
      action: "PASSWORD_CHANGE_FAILED", entity: "auth",
      description: `Failed password change attempt for ${user.email}`,
      ipAddress: ip,
    });
    res.status(400).json({ error: "WRONG_PASSWORD", message: "Current password is incorrect" });
    return;
  }

  if (currentPassword === newPassword) {
    res.status(400).json({ error: "SAME_PASSWORD", message: "New password must be different from current password" });
    return;
  }

  await db.update(usersTable)
    .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  await audit({
    userId: user.id, userEmail: user.email, userRole: user.role,
    action: "PASSWORD_CHANGE", entity: "auth",
    description: `${user.firstName} ${user.lastName} changed their password`,
    ipAddress: ip,
  });

  res.json({ message: "Password updated successfully" });
});

export default router;
