import {
  pgTable,
  serial,
  integer,
  numeric,
  text,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const payrollStatusEnum = pgEnum("payroll_status", [
  "DRAFT",
  "APPROVED",
  "PAID",
]);

export const payrollRecordsTable = pgTable("payroll_records", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  basicSalary: numeric("basic_salary", { precision: 12, scale: 2 }).notNull(),
  allowances: numeric("allowances", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  deductions: numeric("deductions", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  grossSalary: numeric("gross_salary", { precision: 12, scale: 2 }).notNull(),
  netSalary: numeric("net_salary", { precision: 12, scale: 2 }).notNull(),
  status: payrollStatusEnum("status").notNull().default("DRAFT"),
  notes: text("notes"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const payrollDeductionsTable = pgTable("payroll_deductions", {
  id: serial("id").primaryKey(),
  payrollId: integer("payroll_id")
    .notNull()
    .references(() => payrollRecordsTable.id),
  type: text("type").notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
});

export const insertPayrollSchema = createInsertSchema(payrollRecordsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPayrollDeductionSchema = createInsertSchema(
  payrollDeductionsTable,
).omit({ id: true });

export type InsertPayroll = z.infer<typeof insertPayrollSchema>;
export type PayrollRecord = typeof payrollRecordsTable.$inferSelect;
export type InsertPayrollDeduction = z.infer<typeof insertPayrollDeductionSchema>;
export type PayrollDeduction = typeof payrollDeductionsTable.$inferSelect;
