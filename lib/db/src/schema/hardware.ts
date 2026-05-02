import { pgTable, serial, text, integer, timestamp, pgEnum, date, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const assetTypeEnum = pgEnum("asset_type", [
  "COMPUTER",
  "LAPTOP",
  "TABLET",
  "PRINTER",
  "PROJECTOR",
  "IP_CAMERA",
  "ROUTER",
  "SWITCH",
  "SERVER",
  "SMART_BOARD",
  "UPS",
  "OTHER",
]);

export const assetStatusEnum = pgEnum("asset_status", [
  "ONLINE",
  "OFFLINE",
  "MAINTENANCE",
  "RETIRED",
  "STORAGE",
]);

export const hardwareAssetsTable = pgTable("hardware_assets", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id).default(1),
  name: text("name").notNull(),
  type: assetTypeEnum("type").notNull(),
  ipAddress: text("ip_address"),
  macAddress: text("mac_address"),
  serialNumber: text("serial_number"),
  location: text("location"),
  status: assetStatusEnum("status").notNull().default("ONLINE"),
  manufacturer: text("manufacturer"),
  model: text("model"),
  purchaseDate: date("purchase_date"),
  warrantyExpiry: date("warranty_expiry"),
  purchaseCost: numeric("purchase_cost", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const maintenanceLogsTable = pgTable("maintenance_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id).default(1),
  assetId: integer("asset_id").notNull().references(() => hardwareAssetsTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  performedBy: text("performed_by").notNull(),
  performedAt: timestamp("performed_at").notNull().defaultNow(),
  cost: numeric("cost", { precision: 12, scale: 2 }),
  nextMaintenanceDate: date("next_maintenance_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertHardwareAssetSchema = createInsertSchema(hardwareAssetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMaintenanceLogSchema = createInsertSchema(maintenanceLogsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertHardwareAsset = z.infer<typeof insertHardwareAssetSchema>;
export type HardwareAsset = typeof hardwareAssetsTable.$inferSelect;
export type InsertMaintenanceLog = z.infer<typeof insertMaintenanceLogSchema>;
export type MaintenanceLog = typeof maintenanceLogsTable.$inferSelect;
