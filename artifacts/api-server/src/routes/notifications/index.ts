import { Router } from "express";
import { db } from "@workspace/db";
import {
  notificationsTable,
  parentStudentsTable,
  studentsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, count, desc, inArray } from "drizzle-orm";
import {
  requireAuth,
  type AuthRequest,
} from "../../middlewares/requireAuth.js";
import { requireAcademic } from "../../middlewares/requireRole.js";

const router = Router();

// ── List own notifications ─────────────────────────────────────────────────

router.get(
  "/notifications",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const unreadOnly = req.query["unread"] === "true";
    const limit = Math.min(
      parseInt(String(req.query["limit"] ?? "30"), 10),
      100,
    );
    const conditions = [eq(notificationsTable.userId, req.userId!)];
    if (unreadOnly) conditions.push(eq(notificationsTable.isRead, false));
    const [notifications, totalResult, unreadResult] = await Promise.all([
      db
        .select()
        .from(notificationsTable)
        .where(and(...conditions))
        .limit(limit)
        .orderBy(desc(notificationsTable.createdAt)),
      db
        .select({ count: count() })
        .from(notificationsTable)
        .where(eq(notificationsTable.userId, req.userId!)),
      db
        .select({ count: count() })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.userId, req.userId!),
            eq(notificationsTable.isRead, false),
          ),
        ),
    ]);
    res.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        isRead: n.isRead,
        link: n.link,
        createdAt: n.createdAt.toISOString(),
      })),
      total: totalResult[0]?.count ?? 0,
      unreadCount: unreadResult[0]?.count ?? 0,
    });
  },
);

// ── Send bulk notification to parents of a class (or all parents) ──────────

router.post(
  "/notifications/bulk",
  requireAuth,
  requireAcademic,
  async (req: AuthRequest, res): Promise<void> => {
    const { title, message, type, classId } = req.body as {
      title?: string;
      message?: string;
      type?: string;
      classId?: number | "all";
    };

    if (!title || !message) {
      res
        .status(400)
        .json({ error: "BAD_REQUEST", message: "title and message required" });
      return;
    }

    const validTypes = ["INFO", "SUCCESS", "WARNING", "DANGER"];
    const notifType = validTypes.includes(type ?? "")
      ? (type as "INFO" | "SUCCESS" | "WARNING" | "DANGER")
      : "INFO";

    const tenantId = req.tenantId ?? 1;

    let parentUserIds: number[] = [];

    if (classId && classId !== "all") {
      const numClassId = Number(classId);
      const studentsInClass = await db
        .select({ id: studentsTable.id })
        .from(studentsTable)
        .where(
          and(
            eq(studentsTable.classId, numClassId),
            eq(studentsTable.tenantId, tenantId),
          ),
        );

      const studentIds = studentsInClass.map((s) => s.id);

      if (studentIds.length > 0) {
        const links = await db
          .select({ parentUserId: parentStudentsTable.parentUserId })
          .from(parentStudentsTable)
          .where(
            and(
              inArray(parentStudentsTable.studentId, studentIds),
              eq(parentStudentsTable.tenantId, tenantId),
            ),
          );
        parentUserIds = [...new Set(links.map((l) => l.parentUserId))];
      }
    } else {
      const allParents = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.role, "PARENT"),
            eq(usersTable.tenantId, tenantId),
            eq(usersTable.isActive, true),
          ),
        );
      parentUserIds = allParents.map((p) => p.id);
    }

    if (parentUserIds.length === 0) {
      res.json({ sent: 0, message: "No parents found for the selected scope" });
      return;
    }

    const records = parentUserIds.map((userId) => ({
      tenantId,
      userId,
      title,
      message,
      type: notifType,
      isRead: false,
    }));

    await db.insert(notificationsTable).values(records);

    res.json({
      sent: records.length,
      message: `Notification sent to ${records.length} parent(s)`,
    });
  },
);

// ── Mark ALL as read — MUST come before /:id routes ───────────────────────

router.put(
  "/notifications/read-all",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(eq(notificationsTable.userId, req.userId!));
    res.json({ message: "All marked as read" });
  },
);

// ── Mark ONE as read ───────────────────────────────────────────────────────

router.put(
  "/notifications/:id/read",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "BAD_REQUEST" });
      return;
    }
    const [updated] = await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(
        and(
          eq(notificationsTable.id, id),
          eq(notificationsTable.userId, req.userId!),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    res.json({ message: "Marked as read" });
  },
);

// ── Delete one ─────────────────────────────────────────────────────────────

router.delete(
  "/notifications/:id",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "BAD_REQUEST" });
      return;
    }
    await db
      .delete(notificationsTable)
      .where(
        and(
          eq(notificationsTable.id, id),
          eq(notificationsTable.userId, req.userId!),
        ),
      );
    res.json({ message: "Deleted" });
  },
);

export default router;
