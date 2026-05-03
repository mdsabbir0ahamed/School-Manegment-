import {
  pgTable, serial, integer, numeric, text, boolean, timestamp, unique,
} from "drizzle-orm/pg-core";
import { classesTable } from "./classes";
import { feeTypesTable } from "./finance";
import { usersTable } from "./users";

export const classFeeSchedulesTable = pgTable(
  "class_fee_schedules",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().default(1),
    classId: integer("class_id").notNull().references(() => classesTable.id),
    feeTypeId: integer("fee_type_id").notNull().references(() => feeTypesTable.id),
    academicYear: text("academic_year").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => [unique("uq_fee_schedule_class_feetype_year").on(t.classId, t.feeTypeId, t.academicYear)],
);

export type ClassFeeSchedule = typeof classFeeSchedulesTable.$inferSelect;
