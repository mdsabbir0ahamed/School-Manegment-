import { pgTable, serial, text, integer, numeric, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { studentsTable } from "./students";
import { subjectsTable } from "./subjects";

export const examTypeEnum = pgEnum("exam_type", [
  "MIDTERM",
  "FINAL",
  "UNIT_TEST",
  "ASSIGNMENT",
  "QUIZ",
  "PRACTICAL",
]);

export const examResultsTable = pgTable("exam_results", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  studentId: integer("student_id").notNull().references(() => studentsTable.id),
  subjectId: integer("subject_id").notNull().references(() => subjectsTable.id),
  examType: examTypeEnum("exam_type").notNull(),
  examName: text("exam_name").notNull(),
  marksObtained: numeric("marks_obtained", { precision: 6, scale: 2 }).notNull(),
  totalMarks: numeric("total_marks", { precision: 6, scale: 2 }).notNull(),
  grade: text("grade"),
  remarks: text("remarks"),
  examDate: text("exam_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertExamResultSchema = createInsertSchema(examResultsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertExamResult = z.infer<typeof insertExamResultSchema>;
export type ExamResult = typeof examResultsTable.$inferSelect;
