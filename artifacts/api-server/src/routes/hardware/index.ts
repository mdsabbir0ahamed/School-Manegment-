import { Router } from "express";
import { db } from "@workspace/db";
import { hardwareAssetsTable, maintenanceLogsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAdmin } from "../../middlewares/requireRole.js";
import { resolveTenant, type TenantRequest } from "../../middlewares/requireTenant.js";
import { audit } from "../../lib/audit.js";

const router = Router();

router.get("/assets", requireAuth, resolveTenant, async (req: AuthRequest & TenantRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "PARENT" || role === "STUDENT") { res.status(403).json({ error: "FORBIDDEN" }); return; }
  const tenantId = req.tenant?.id ?? 1;
  const assets = await db.select().from(hardwareAssetsTable)
    .where(eq(hardwareAssetsTable.tenantId, tenantId))
    .orderBy(hardwareAssetsTable.createdAt);
  res.json({ assets });
});

router.post("/assets", requireAuth, requireAdmin, resolveTenant, async (req: AuthRequest & TenantRequest, res): Promise<void> => {
  const tenantId = req.tenant?.id ?? 1;
  const {
    name, type, ipAddress, macAddress, serialNumber, location, status,
    manufacturer, model, purchaseDate, warrantyExpiry, purchaseCost, notes,
  } = req.body as Record<string, string | undefined>;
  if (!name || !type) { res.status(400).json({ error: "VALIDATION_ERROR", message: "name and type required" }); return; }
  const [asset] = await db.insert(hardwareAssetsTable).values({
    tenantId,
    name,
    type: type as any,
    ipAddress: ipAddress ?? null,
    macAddress: macAddress ?? null,
    serialNumber: serialNumber ?? null,
    location: location ?? null,
    status: (status as any) ?? "ONLINE",
    manufacturer: manufacturer ?? null,
    model: model ?? null,
    purchaseDate: purchaseDate ?? null,
    warrantyExpiry: warrantyExpiry ?? null,
    purchaseCost: purchaseCost ?? null,
    notes: notes ?? null,
  }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "hardware_asset", entityId: asset.id,
    description: `Added hardware asset "${asset.name}" (${asset.type})`,
  });
  res.status(201).json(asset);
});

router.get("/assets/:id", requireAuth, resolveTenant, async (req: AuthRequest & TenantRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "PARENT" || role === "STUDENT") { res.status(403).json({ error: "FORBIDDEN" }); return; }
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const tenantId = req.tenant?.id ?? 1;
  const [asset] = await db.select().from(hardwareAssetsTable)
    .where(and(eq(hardwareAssetsTable.id, id), eq(hardwareAssetsTable.tenantId, tenantId))).limit(1);
  if (!asset) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  const logs = await db.select().from(maintenanceLogsTable)
    .where(eq(maintenanceLogsTable.assetId, id))
    .orderBy(desc(maintenanceLogsTable.performedAt));
  res.json({ ...asset, maintenanceLogs: logs });
});

router.put("/assets/:id", requireAuth, requireAdmin, resolveTenant, async (req: AuthRequest & TenantRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const tenantId = req.tenant?.id ?? 1;
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const allowed = ["name","type","ipAddress","macAddress","serialNumber","location","status","manufacturer","model","purchaseDate","warrantyExpiry","purchaseCost","notes"];
  for (const k of allowed) {
    if (body[k] !== undefined) updates[k] = body[k];
  }
  const [asset] = await db.update(hardwareAssetsTable).set(updates as any)
    .where(and(eq(hardwareAssetsTable.id, id), eq(hardwareAssetsTable.tenantId, tenantId))).returning();
  if (!asset) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "hardware_asset", entityId: id,
    description: `Updated hardware asset "${asset.name}"`,
  });
  res.json(asset);
});

router.delete("/assets/:id", requireAuth, requireAdmin, resolveTenant, async (req: AuthRequest & TenantRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const tenantId = req.tenant?.id ?? 1;
  const [asset] = await db.select({ name: hardwareAssetsTable.name }).from(hardwareAssetsTable)
    .where(and(eq(hardwareAssetsTable.id, id), eq(hardwareAssetsTable.tenantId, tenantId))).limit(1);
  if (!asset) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await db.delete(hardwareAssetsTable).where(eq(hardwareAssetsTable.id, id));
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "hardware_asset", entityId: id,
    description: `Deleted hardware asset "${asset.name}"`,
  });
  res.status(204).send();
});

router.post("/assets/:id/maintenance", requireAuth, requireAdmin, resolveTenant, async (req: AuthRequest & TenantRequest, res): Promise<void> => {
  const assetId = parseInt(String(req.params["id"]), 10);
  if (isNaN(assetId)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const tenantId = req.tenant?.id ?? 1;
  const { description, performedBy, cost, nextMaintenanceDate, notes } = req.body as Record<string, string | undefined>;
  if (!description || !performedBy) { res.status(400).json({ error: "VALIDATION_ERROR", message: "description and performedBy required" }); return; }
  const [log] = await db.insert(maintenanceLogsTable).values({
    tenantId,
    assetId,
    description,
    performedBy,
    cost: cost ?? null,
    nextMaintenanceDate: nextMaintenanceDate ?? null,
    notes: notes ?? null,
  }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "maintenance_log", entityId: log.id,
    description: `Logged maintenance for asset ${assetId}: ${description}`,
  });
  res.status(201).json(log);
});

export default router;
