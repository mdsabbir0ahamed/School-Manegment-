import { pgTable, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const feeStatementScheduleTable = pgTable("fee_statement_schedule", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1).unique(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  dayOfMonth: integer("day_of_month").notNull().default(1),
  hour: integer("hour").notNull().default(8),
  lastRunAt: timestamp("last_run_at"),
  lastRunCount: integer("last_run_count").notNull().default(0),
  lastRunErrors: integer("last_run_errors").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FeeStatementSchedule = typeof feeStatementScheduleTable.$inferSelect;
