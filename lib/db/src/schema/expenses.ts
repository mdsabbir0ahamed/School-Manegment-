import {
  pgTable, serial, integer, text, numeric, date, timestamp, pgEnum,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const expenseCategoryEnum = pgEnum("expense_category", [
  "SALARY",
  "RENT",
  "UTILITIES",
  "MAINTENANCE",
  "SUPPLIES",
  "TRANSPORT",
  "FOOD",
  "EVENTS",
  "TECHNOLOGY",
  "OTHER",
]);

export const expenseStatusEnum = pgEnum("expense_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PAID",
]);

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  category: expenseCategoryEnum("category").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  expenseDate: date("expense_date").notNull(),
  payee: text("payee"),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  status: expenseStatusEnum("status").notNull().default("PENDING"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Expense = typeof expensesTable.$inferSelect;
