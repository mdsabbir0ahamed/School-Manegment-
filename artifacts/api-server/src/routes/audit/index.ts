import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { eq, and, desc, count, gte, lte } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireAdmin } from "../../middlewares/requireRole.js";

const router = Router();

router.get("/audit-logs", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const isExport = req.query["export"] === "true";
  const limit = isExport ? 10000 : Math.min(parseInt(String(req.query["limit"] ?? "30"), 10) || 30, 100);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10) || 0;
  const action = req.query["action"] ? String(req.query["action"]) : undefined;
  const entity = req.query["entity"] ? String(req.query["entity"]) : undefined;
  const userId = req.query["userId"] ? parseInt(String(req.query["userId"]), 10) : undefined;
  const dateFrom = req.query["dateFrom"] ? String(req.query["dateFrom"]) : undefined;
  const dateTo = req.query["dateTo"] ? String(req.query["dateTo"]) : undefined;

  const conditions = [];
  if (action) conditions.push(eq(auditLogsTable.action, action));
  if (entity) conditions.push(eq(auditLogsTable.entity, entity));
  if (userId && !isNaN(userId)) conditions.push(eq(auditLogsTable.userId, userId));
  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setDate(end.getDate() + 1);
    conditions.push(lte(auditLogsTable.createdAt, end));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const [logs, totalResult] = await Promise.all([
    db.select().from(auditLogsTable).where(where).orderBy(desc(auditLogsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(auditLogsTable).where(where),
  ]);

  res.json({
    logs: logs.map(l => ({
      id: l.id, userId: l.userId, userEmail: l.userEmail, userRole: l.userRole,
      action: l.action, entity: l.entity, entityId: l.entityId,
      description: l.description, metadata: l.metadata ? JSON.parse(l.metadata) : null,
      ipAddress: l.ipAddress, createdAt: l.createdAt.toISOString(),
    })),
    total: totalResult[0]?.count ?? 0,
  });
});

export default router;
