import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { studentsTable } from "./students";

export const parentStudentsTable = pgTable("parent_students", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  parentUserId: integer("parent_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  relationship: text("relationship").notNull().default("PARENT"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("parent_students_unique").on(t.parentUserId, t.studentId),
]);

export type ParentStudent = typeof parentStudentsTable.$inferSelect;
