import {
  pgTable, serial, integer, text, numeric, boolean, timestamp, pgEnum,
} from "drizzle-orm/pg-core";
import { studentsTable } from "./students";
import { feeTypesTable } from "./finance";
import { usersTable } from "./users";

export const discountTypeEnum = pgEnum("discount_type", ["PERCENTAGE", "FIXED"]);

export const studentDiscountsTable = pgTable("student_discounts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  studentId: integer("student_id").notNull().references(() => studentsTable.id),
  feeTypeId: integer("fee_type_id").references(() => feeTypesTable.id),
  discountType: discountTypeEnum("discount_type").notNull(),
  discountValue: numeric("discount_value", { precision: 12, scale: 2 }).notNull(),
  reason: text("reason"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type StudentDiscount = typeof studentDiscountsTable.$inferSelect;
