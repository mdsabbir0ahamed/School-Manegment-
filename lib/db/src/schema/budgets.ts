import {
  pgTable, serial, integer, numeric, text, timestamp, unique,
} from "drizzle-orm/pg-core";
import { expenseCategoryEnum } from "./expenses";
import { usersTable } from "./users";

export const expenseBudgetsTable = pgTable(
  "expense_budgets",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().default(1),
    category: expenseCategoryEnum("category").notNull(),
    year: integer("year").notNull(),
    budgetAmount: numeric("budget_amount", { precision: 12, scale: 2 }).notNull(),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => [unique("uq_budget_category_year").on(t.category, t.year)],
);

export type ExpenseBudget = typeof expenseBudgetsTable.$inferSelect;
