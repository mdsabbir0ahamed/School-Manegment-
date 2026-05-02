import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import type { Tenant } from "@workspace/db";

export interface TenantRequest extends Request {
  tenant?: Tenant;
}

let defaultTenantCache: Tenant | null = null;
const tenantCache = new Map<string, { tenant: Tenant; expiresAt: number }>();
const CACHE_TTL = 60_000;

async function getDefaultTenant(): Promise<Tenant | null> {
  if (defaultTenantCache) return defaultTenantCache;
  const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.subdomain, "default")).limit(1);
  if (t) defaultTenantCache = t;
  return t ?? null;
}

export async function resolveTenant(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
  const host = req.headers.host ?? "";
  const xTenantId = req.headers["x-tenant-id"] as string | undefined;

  let tenant: Tenant | null = null;

  if (xTenantId) {
    const cached = tenantCache.get(`id:${xTenantId}`);
    if (cached && cached.expiresAt > Date.now()) {
      tenant = cached.tenant;
    } else {
      const id = parseInt(xTenantId, 10);
      if (!isNaN(id)) {
        const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1);
        tenant = t ?? null;
        if (tenant) tenantCache.set(`id:${xTenantId}`, { tenant, expiresAt: Date.now() + CACHE_TTL });
      }
    }
  }

  if (!tenant) {
    const parts = host.split(".");
    if (parts.length >= 3) {
      const subdomain = parts[0]!;
      if (subdomain && subdomain !== "www") {
        const cached = tenantCache.get(`sub:${subdomain}`);
        if (cached && cached.expiresAt > Date.now()) {
          tenant = cached.tenant;
        } else {
          const [t] = await db.select().from(tenantsTable)
            .where(or(eq(tenantsTable.subdomain, subdomain), eq(tenantsTable.isActive, true)))
            .limit(1);
          if (t && t.subdomain === subdomain) {
            tenant = t;
            tenantCache.set(`sub:${subdomain}`, { tenant, expiresAt: Date.now() + CACHE_TTL });
          }
        }
      }
    }
  }

  if (!tenant) {
    tenant = await getDefaultTenant();
  }

  req.tenant = tenant ?? undefined;
  next();
}

export function requireTenant(req: TenantRequest, res: Response, next: NextFunction): void {
  if (!req.tenant) {
    res.status(400).json({ error: "TENANT_NOT_FOUND", message: "Could not resolve tenant" });
    return;
  }
  next();
}

export function invalidateTenantCache(key?: string): void {
  if (key) {
    tenantCache.delete(`id:${key}`);
    tenantCache.delete(`sub:${key}`);
  } else {
    tenantCache.clear();
    defaultTenantCache = null;
  }
}
