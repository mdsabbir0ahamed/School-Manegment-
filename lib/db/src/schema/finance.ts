import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  pgEnum,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { studentsTable } from "./students";

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "PENDING",
  "PAID",
  "OVERDUE",
  "CANCELLED",
]);

export const escalationLevelEnum = pgEnum("escalation_level", [
  "NORMAL",
  "WARNING",
  "CRITICAL",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "CASH",
  "BANK_TRANSFER",
  "MOBILE_BANKING",
  "CHEQUE",
]);

export const feeTypesTable = pgTable("fee_types", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  name: text("name").notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  isRecurring: boolean("is_recurring").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  invoiceNumber: text("invoice_number").notNull().unique(),
  studentId: integer("student_id")
    .notNull()
    .references(() => studentsTable.id),
  feeTypeId: integer("fee_type_id")
    .notNull()
    .references(() => feeTypesTable.id),
  month: text("month"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  dueDate: date("due_date").notNull(),
  status: invoiceStatusEnum("status").notNull().default("PENDING"),
  escalationLevel: escalationLevelEnum("escalation_level").notNull().default("NORMAL"),
  escalatedAt: timestamp("escalated_at"),
  escalationNote: text("escalation_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoicesTable.id),
  studentId: integer("student_id")
    .notNull()
    .references(() => studentsTable.id),
  amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).notNull(),
  method: paymentMethodEnum("method").notNull(),
  transactionId: text("transaction_id"),
  paidAt: timestamp("paid_at").notNull().defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFeeTypeSchema = createInsertSchema(feeTypesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTransactionSchema = createInsertSchema(
  transactionsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertFeeType = z.infer<typeof insertFeeTypeSchema>;
export type FeeType = typeof feeTypesTable.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
