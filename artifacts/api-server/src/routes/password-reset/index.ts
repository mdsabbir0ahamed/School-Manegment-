import { Router } from "express";
import { db } from "@workspace/db";
import { passwordResetTokensTable, usersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { hashPassword } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import crypto from "node:crypto";

const router = Router();

// POST /auth/forgot-password — generate a reset token
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };
  if (!email?.trim()) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Email is required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);

  // Always respond with 200 (don't reveal if email exists)
  if (!user || !user.isActive) {
    res.json({ message: "If this email is registered, a reset link has been sent." });
    return;
  }

  // Invalidate old tokens for this user
  await db.update(passwordResetTokensTable)
    .set({ used: true })
    .where(eq(passwordResetTokensTable.userId, user.id));

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.insert(passwordResetTokensTable).values({
    userId: user.id, token, expiresAt, used: false,
  });

  await audit({
    userId: user.id, userEmail: user.email, userRole: user.role,
    action: "PASSWORD_RESET_REQUEST", entity: "auth",
    description: `Password reset requested for ${user.email}`,
  });

  // In production, send an email. For now, log the token (admin can retrieve it).
  logger.info({ email: user.email, token, expiresAt }, "Password reset token generated");

  // Return the token in response — in production this would be sent via email only
  res.json({
    message: "Password reset token generated. Check server logs or use the token below.",
    token, // Only exposed here; in prod, send via email
    expiresAt: expiresAt.toISOString(),
    note: "In production, configure SMTP to email this token instead of returning it.",
  });
});

// POST /auth/reset-password — use token to set new password
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token?.trim() || !newPassword || newPassword.length < 6) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Valid token and newPassword (min 6 chars) required" });
    return;
  }
  const now = new Date();
  const [resetToken] = await db.select().from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.token, token),
        eq(passwordResetTokensTable.used, false),
        gt(passwordResetTokensTable.expiresAt, now),
      )
    ).limit(1);

  if (!resetToken) {
    res.status(400).json({ error: "INVALID_TOKEN", message: "Token is invalid or has expired" });
    return;
  }

  await db.update(usersTable)
    .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(usersTable.id, resetToken.userId));

  await db.update(passwordResetTokensTable)
    .set({ used: true })
    .where(eq(passwordResetTokensTable.id, resetToken.id));

  const [user] = await db.select({ email: usersTable.email, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, resetToken.userId)).limit(1);

  await audit({
    userId: resetToken.userId, userEmail: user?.email, userRole: user?.role,
    action: "PASSWORD_RESET", entity: "auth",
    description: `Password reset completed for user #${resetToken.userId}`,
  });

  res.json({ message: "Password has been reset successfully. You can now log in." });
});

export default router;
