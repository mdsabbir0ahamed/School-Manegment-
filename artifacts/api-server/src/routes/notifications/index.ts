import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";

const router = Router();

// ── List own notifications ─────────────────────────────────────────────────

router.get("/notifications", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const unreadOnly = req.query["unread"] === "true";
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "30"), 10), 100);
  const conditions = [eq(notificationsTable.userId, req.userId!)];
  if (unreadOnly) conditions.push(eq(notificationsTable.isRead, false));
  const [notifications, totalResult, unreadResult] = await Promise.all([
    db.select().from(notificationsTable)
      .where(and(...conditions)).limit(limit).orderBy(desc(notificationsTable.createdAt)),
    db.select({ count: count() }).from(notificationsTable)
      .where(eq(notificationsTable.userId, req.userId!)),
    db.select({ count: count() }).from(notificationsTable)
      .where(and(eq(notificationsTable.userId, req.userId!), eq(notificationsTable.isRead, false))),
  ]);
  res.json({
    notifications: notifications.map(n => ({
      id: n.id, title: n.title, message: n.message, type: n.type,
      isRead: n.isRead, link: n.link, createdAt: n.createdAt.toISOString(),
    })),
    total: totalResult[0]?.count ?? 0,
    unreadCount: unreadResult[0]?.count ?? 0,
  });
});

// ── Mark ALL as read — MUST come before /:id routes ───────────────────────

router.put("/notifications/read-all", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, req.userId!));
  res.json({ message: "All marked as read" });
});

// ── Mark ONE as read ───────────────────────────────────────────────────────

router.put("/notifications/:id/read", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [updated] = await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.userId!)))
    .returning();
  if (!updated) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  res.json({ message: "Marked as read" });
});

// ── Delete one ─────────────────────────────────────────────────────────────

router.delete("/notifications/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  await db.delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.userId!)));
  res.json({ message: "Deleted" });
});

export default router;
