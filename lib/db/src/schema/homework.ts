import { pgTable, serial, text, integer, timestamp, date, pgEnum } from "drizzle-orm/pg-core";
import { classesTable } from "./classes";
import { subjectsTable } from "./subjects";
import { usersTable } from "./users";

export const homeworkStatusEnum = pgEnum("homework_status", ["ACTIVE", "CLOSED"]);

export const homeworkTable = pgTable("homework", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  subjectId: integer("subject_id").references(() => subjectsTable.id, { onDelete: "set null" }),
  authorUserId: integer("author_user_id").notNull().references(() => usersTable.id),
  authorName: text("author_name").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  dueDate: date("due_date"),
  status: homeworkStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Homework = typeof homeworkTable.$inferSelect;
