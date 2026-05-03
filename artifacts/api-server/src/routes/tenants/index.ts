import { Router } from "express";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireSuperAdmin } from "../../middlewares/requireRole.js";
import { invalidateTenantCache } from "../../middlewares/requireTenant.js";
import { audit } from "../../lib/audit.js";
import { buildTransporter, type SmtpConfig } from "../../lib/mailer.js";
import { sendSms, sendWhatsapp, type SmsConfig } from "../../lib/sms.js";

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

// ── SMTP Settings ─────────────────────────────────────────────────────────

router.get("/tenants/smtp-settings", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const [tenant] = await db.select({
    smtpHost: tenantsTable.smtpHost,
    smtpPort: tenantsTable.smtpPort,
    smtpUser: tenantsTable.smtpUser,
    smtpPass: tenantsTable.smtpPass,
    smtpFrom: tenantsTable.smtpFrom,
    smtpSecure: tenantsTable.smtpSecure,
  }).from(tenantsTable).where(eq(tenantsTable.id, 1)).limit(1);

  if (!tenant) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  // Mask password: return "••••••••" if set, empty string if not
  res.json({
    smtpHost: tenant.smtpHost ?? "",
    smtpPort: tenant.smtpPort ?? 587,
    smtpUser: tenant.smtpUser ?? "",
    smtpPassSet: !!tenant.smtpPass,
    smtpFrom: tenant.smtpFrom ?? "",
    smtpSecure: tenant.smtpSecure ?? false,
  });
});

router.put("/tenants/smtp-settings", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, smtpSecure } =
    req.body as {
      smtpHost?: string; smtpPort?: number; smtpUser?: string;
      smtpPass?: string; smtpFrom?: string; smtpSecure?: boolean;
    };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (smtpHost !== undefined) updates["smtpHost"] = smtpHost || null;
  if (smtpPort !== undefined) updates["smtpPort"] = smtpPort;
  if (smtpUser !== undefined) updates["smtpUser"] = smtpUser || null;
  // Only overwrite password if a non-empty value is provided
  if (smtpPass !== undefined && smtpPass !== "") updates["smtpPass"] = smtpPass;
  if (smtpFrom !== undefined) updates["smtpFrom"] = smtpFrom || null;
  if (smtpSecure !== undefined) updates["smtpSecure"] = smtpSecure;

  await db.update(tenantsTable).set(updates as any).where(eq(tenantsTable.id, 1));

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "tenant", entityId: 1,
    description: "Updated SMTP email settings",
  });

  res.json({ success: true });
});

router.post("/tenants/smtp-settings/test", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { to } = req.body as { to?: string };
  if (!to?.trim()) { res.status(400).json({ error: "Recipient email required" }); return; }

  const [tenant] = await db.select({
    smtpHost: tenantsTable.smtpHost, smtpPort: tenantsTable.smtpPort,
    smtpUser: tenantsTable.smtpUser, smtpPass: tenantsTable.smtpPass,
    smtpFrom: tenantsTable.smtpFrom, smtpSecure: tenantsTable.smtpSecure,
    name: tenantsTable.name,
  }).from(tenantsTable).where(eq(tenantsTable.id, 1)).limit(1);

  if (!tenant?.smtpHost || !tenant.smtpUser || !tenant.smtpPass) {
    res.status(422).json({ error: "SMTP not configured — set Host, User and Password first" });
    return;
  }

  const cfg: SmtpConfig = {
    host: tenant.smtpHost,
    port: tenant.smtpPort ?? 587,
    user: tenant.smtpUser,
    pass: tenant.smtpPass,
    from: tenant.smtpFrom ?? `"${tenant.name}" <no-reply@school.edu>`,
    secure: tenant.smtpSecure ?? false,
  };

  try {
    const transporter = buildTransporter(cfg);
    await transporter.sendMail({
      from: cfg.from,
      to: to.trim(),
      subject: `Test Email — ${tenant.name}`,
      html: `<p>This is a test email from <strong>${tenant.name}</strong> School ERP. Your SMTP configuration is working correctly.</p>`,
    });
    res.json({ success: true, message: `Test email sent to ${to.trim()}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown SMTP error";
    res.status(502).json({ error: "SMTP_ERROR", message });
  }
});

// ── SMS / WhatsApp Settings ───────────────────────────────────────────────

router.get("/tenants/sms-settings", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const [tenant] = await db.select({
    twilioAccountSid: tenantsTable.twilioAccountSid,
    twilioAuthToken: tenantsTable.twilioAuthToken,
    twilioFromPhone: tenantsTable.twilioFromPhone,
    twilioWhatsappFrom: tenantsTable.twilioWhatsappFrom,
    smsEnabled: tenantsTable.smsEnabled,
    whatsappEnabled: tenantsTable.whatsappEnabled,
  }).from(tenantsTable).where(eq(tenantsTable.id, 1)).limit(1);

  if (!tenant) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  res.json({
    twilioAccountSid: tenant.twilioAccountSid ?? "",
    twilioAuthTokenSet: !!tenant.twilioAuthToken,
    twilioFromPhone: tenant.twilioFromPhone ?? "",
    twilioWhatsappFrom: tenant.twilioWhatsappFrom ?? "",
    smsEnabled: tenant.smsEnabled ?? false,
    whatsappEnabled: tenant.whatsappEnabled ?? false,
  });
});

router.put("/tenants/sms-settings", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { twilioAccountSid, twilioAuthToken, twilioFromPhone, twilioWhatsappFrom, smsEnabled, whatsappEnabled } =
    req.body as {
      twilioAccountSid?: string; twilioAuthToken?: string;
      twilioFromPhone?: string; twilioWhatsappFrom?: string;
      smsEnabled?: boolean; whatsappEnabled?: boolean;
    };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (twilioAccountSid !== undefined) updates["twilioAccountSid"] = twilioAccountSid || null;
  if (twilioAuthToken !== undefined && twilioAuthToken !== "") updates["twilioAuthToken"] = twilioAuthToken;
  if (twilioFromPhone !== undefined) updates["twilioFromPhone"] = twilioFromPhone || null;
  if (twilioWhatsappFrom !== undefined) updates["twilioWhatsappFrom"] = twilioWhatsappFrom || null;
  if (smsEnabled !== undefined) updates["smsEnabled"] = smsEnabled;
  if (whatsappEnabled !== undefined) updates["whatsappEnabled"] = whatsappEnabled;

  await db.update(tenantsTable).set(updates as any).where(eq(tenantsTable.id, 1));

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "tenant", entityId: 1,
    description: "Updated SMS/WhatsApp settings",
  });

  res.json({ success: true });
});

router.post("/tenants/sms-settings/test", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { to, channel } = req.body as { to?: string; channel?: "sms" | "whatsapp" };
  if (!to?.trim()) { res.status(400).json({ error: "Recipient phone number required" }); return; }

  const [tenant] = await db.select({
    twilioAccountSid: tenantsTable.twilioAccountSid,
    twilioAuthToken: tenantsTable.twilioAuthToken,
    twilioFromPhone: tenantsTable.twilioFromPhone,
    twilioWhatsappFrom: tenantsTable.twilioWhatsappFrom,
    name: tenantsTable.name,
  }).from(tenantsTable).where(eq(tenantsTable.id, 1)).limit(1);

  if (!tenant?.twilioAccountSid || !tenant.twilioAuthToken) {
    res.status(422).json({ error: "Twilio not configured — set Account SID and Auth Token first" });
    return;
  }

  const cfg: SmsConfig = {
    accountSid: tenant.twilioAccountSid,
    authToken: tenant.twilioAuthToken,
    fromPhone: tenant.twilioFromPhone ?? "",
    whatsappFrom: tenant.twilioWhatsappFrom ?? "",
  };

  const body = `Test message from ${tenant.name} School ERP. Your notification settings are working correctly.`;

  try {
    const result = channel === "whatsapp"
      ? await sendWhatsapp(to.trim(), body, cfg)
      : await sendSms(to.trim(), body, cfg);

    if (!result.delivered) {
      res.status(502).json({ error: "TWILIO_ERROR", message: result.error });
      return;
    }
    res.json({ success: true, sid: result.sid, message: `Test ${channel ?? "sms"} sent to ${to.trim()}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: "TWILIO_ERROR", message });
  }
});

export default router;
