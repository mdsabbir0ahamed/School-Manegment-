import { pgTable, serial, text, boolean, timestamp, pgEnum, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tenantPlanEnum = pgEnum("tenant_plan", ["FREE", "BASIC", "PRO", "ENTERPRISE"]);

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subdomain: text("subdomain").notNull().unique(),
  primaryColor: text("primary_color").notNull().default("#4F46E5"),
  primaryColorDark: text("primary_color_dark").notNull().default("#3730A3"),
  logoUrl: text("logo_url"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  address: text("address"),
  plan: tenantPlanEnum("plan").notNull().default("FREE"),
  isActive: boolean("is_active").notNull().default(true),
  // SMTP settings (stored per-tenant; password stored as plaintext — encrypt in production)
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port").default(587),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),
  smtpFrom: text("smtp_from"),
  smtpSecure: boolean("smtp_secure").default(false),
  // SMS / WhatsApp via Twilio (auth token stored as plaintext — encrypt in production)
  twilioAccountSid: text("twilio_account_sid"),
  twilioAuthToken: text("twilio_auth_token"),
  twilioFromPhone: text("twilio_from_phone"),
  twilioWhatsappFrom: text("twilio_whatsapp_from"),
  smsEnabled: boolean("sms_enabled").default(false),
  whatsappEnabled: boolean("whatsapp_enabled").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
