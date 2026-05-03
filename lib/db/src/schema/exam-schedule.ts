import { pgTable, serial, text, integer, timestamp, date } from "drizzle-orm/pg-core";
import { classesTable } from "./classes";
import { subjectsTable } from "./subjects";
import { usersTable } from "./users";
import { examTypeEnum } from "./exam-results";

export const examScheduleTable = pgTable("exam_schedule", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  subjectId: integer("subject_id").references(() => subjectsTable.id, { onDelete: "set null" }),
  authorUserId: integer("author_user_id").notNull().references(() => usersTable.id),
  authorName: text("author_name").notNull(),
  title: text("title").notNull(),
  examType: examTypeEnum("exam_type").notNull(),
  examDate: date("exam_date").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  room: text("room"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ExamSchedule = typeof examScheduleTable.$inferSelect;
