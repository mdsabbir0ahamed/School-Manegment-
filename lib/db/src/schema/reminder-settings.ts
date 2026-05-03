import {
  pgTable,
  serial,
  integer,
  boolean,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const reminderSettingsTable = pgTable("reminder_settings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1).unique(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  reminderDays: text("reminder_days").notNull().default("[-3,-1,0,1,3,7]"),
  smsEnabled: boolean("sms_enabled").notNull().default(false),
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),
  digestSmsEnabled: boolean("digest_sms_enabled").notNull().default(false),
  digestWhatsappEnabled: boolean("digest_whatsapp_enabled").notNull().default(false),
  digestLastRunAt: timestamp("digest_last_run_at"),
  digestLastRunCount: integer("digest_last_run_count").notNull().default(0),
  lastRunAt: timestamp("last_run_at"),
  lastRunCount: integer("last_run_count").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ReminderSettings = typeof reminderSettingsTable.$inferSelect;
