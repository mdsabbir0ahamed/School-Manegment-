import { Router } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAdmin } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";

const router = Router();

router.get("/calendar", requireAuth, async (req, res): Promise<void> => {
  const month = req.query["month"] as string | undefined;
  const year = req.query["year"] as string | undefined;
  const conditions = [];
  if (year && month) {
    const start = `${year}-${month.padStart(2, "0")}-01`;
    const endDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const end = `${year}-${month.padStart(2, "0")}-${endDay}`;
    conditions.push(gte(calendarEventsTable.startDate, start));
    conditions.push(lte(calendarEventsTable.startDate, end));
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const events = await db.select().from(calendarEventsTable)
    .where(where).orderBy(calendarEventsTable.startDate);
  res.json({
    events: events.map(e => ({
      id: e.id, title: e.title, description: e.description,
      startDate: e.startDate, endDate: e.endDate, type: e.type,
      isAllDay: e.isAllDay, createdAt: e.createdAt.toISOString(),
    })),
    total: events.length,
  });
});

router.post("/calendar", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { title, description, startDate, endDate, type, isAllDay } = req.body as {
    title?: string; description?: string; startDate?: string; endDate?: string;
    type?: string; isAllDay?: boolean;
  };
  if (!title?.trim() || !startDate || !endDate) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "title, startDate, endDate required" });
    return;
  }
  const [event] = await db.insert(calendarEventsTable).values({
    title: title.trim(), description: description?.trim() ?? null,
    startDate, endDate: endDate || startDate,
    type: (type as any) ?? "EVENT", isAllDay: isAllDay ?? true,
  }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "calendar_event", entityId: event.id,
    description: `Added "${event.title}" on ${event.startDate}`,
  });
  res.status(201).json({
    id: event.id, title: event.title, description: event.description,
    startDate: event.startDate, endDate: event.endDate, type: event.type,
    isAllDay: event.isAllDay, createdAt: event.createdAt.toISOString(),
  });
});

router.put("/calendar/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const { title, description, startDate, endDate, type } = req.body as {
    title?: string; description?: string; startDate?: string; endDate?: string; type?: string;
  };
  const [updated] = await db.update(calendarEventsTable).set({
    ...(title ? { title: title.trim() } : {}),
    ...(description !== undefined ? { description: description?.trim() ?? null } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(type ? { type: type as any } : {}),
    updatedAt: new Date(),
  }).where(eq(calendarEventsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  res.json({
    id: updated.id, title: updated.title, description: updated.description,
    startDate: updated.startDate, endDate: updated.endDate, type: updated.type,
    isAllDay: updated.isAllDay, createdAt: updated.createdAt.toISOString(),
  });
});

router.delete("/calendar/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [deleted] = await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "calendar_event", entityId: id,
    description: `Deleted event "${deleted.title}"`,
  });
  res.json({ message: "Deleted" });
});

export default router;
