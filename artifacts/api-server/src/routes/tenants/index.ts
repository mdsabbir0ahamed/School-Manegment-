import { Router } from "express";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireSuperAdmin } from "../../middlewares/requireRole.js";
import { invalidateTenantCache } from "../../middlewares/requireTenant.js";
import { audit } from "../../lib/audit.js";

const router = Router();

router.get("/tenants/config", async (req, res): Promise<void> => {
  const subdomain = String(req.query["subdomain"] ?? "default");
  const [tenant] = await db.select({
    id: tenantsTable.id,
    name: tenantsTable.name,
    subdomain: tenantsTable.subdomain,
    primaryColor: tenantsTable.primaryColor,
    primaryColorDark: tenantsTable.primaryColorDark,
    logoUrl: tenantsTable.logoUrl,
    contactEmail: tenantsTable.contactEmail,
    plan: tenantsTable.plan,
  }).from(tenantsTable)
    .where(eq(tenantsTable.subdomain, subdomain))
    .limit(1);
  if (!tenant) {
    const [def] = await db.select().from(tenantsTable).where(eq(tenantsTable.subdomain, "default")).limit(1);
    if (!def) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    res.json(def);
    return;
  }
  res.json(tenant);
});

router.get("/tenants", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const tenants = await db.select().from(tenantsTable).orderBy(tenantsTable.createdAt);
  res.json({ tenants });
});

router.post("/tenants", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { name, subdomain, primaryColor, primaryColorDark, logoUrl, contactEmail, contactPhone, address, plan } = req.body as Record<string, string | undefined>;
  if (!name || !subdomain) { res.status(400).json({ error: "VALIDATION_ERROR", message: "name and subdomain required" }); return; }
  const slugified = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const [tenant] = await db.insert(tenantsTable).values({
    name,
    subdomain: slugified,
    primaryColor: primaryColor ?? "#4F46E5",
    primaryColorDark: primaryColorDark ?? "#3730A3",
    logoUrl: logoUrl ?? null,
    contactEmail: contactEmail ?? null,
    contactPhone: contactPhone ?? null,
    address: address ?? null,
    plan: (plan as any) ?? "FREE",
  }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "tenant", entityId: tenant.id,
    description: `Created tenant "${tenant.name}" (${tenant.subdomain})`,
  });
  res.status(201).json(tenant);
});

router.put("/tenants/:id", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const { name, primaryColor, primaryColorDark, logoUrl, contactEmail, contactPhone, address, plan, isActive } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates["name"] = name;
  if (primaryColor !== undefined) updates["primaryColor"] = primaryColor;
  if (primaryColorDark !== undefined) updates["primaryColorDark"] = primaryColorDark;
  if (logoUrl !== undefined) updates["logoUrl"] = logoUrl;
  if (contactEmail !== undefined) updates["contactEmail"] = contactEmail;
  if (contactPhone !== undefined) updates["contactPhone"] = contactPhone;
  if (address !== undefined) updates["address"] = address;
  if (plan !== undefined) updates["plan"] = plan;
  if (isActive !== undefined) updates["isActive"] = isActive;
  const [tenant] = await db.update(tenantsTable).set(updates as any).where(eq(tenantsTable.id, id)).returning();
  if (!tenant) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  invalidateTenantCache(String(id));
  invalidateTenantCache(tenant.subdomain);
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "tenant", entityId: id,
    description: `Updated tenant "${tenant.name}"`,
  });
  res.json(tenant);
});

router.delete("/tenants/:id", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  if (id === 1) { res.status(400).json({ error: "FORBIDDEN", message: "Cannot delete default tenant" }); return; }
  const [tenant] = await db.select({ name: tenantsTable.name, subdomain: tenantsTable.subdomain }).from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1);
  await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  invalidateTenantCache(String(id));
  if (tenant) invalidateTenantCache(tenant.subdomain);
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "tenant", entityId: id,
    description: `Deleted tenant "${tenant?.name}"`,
  });
  res.status(204).send();
});

export default router;
