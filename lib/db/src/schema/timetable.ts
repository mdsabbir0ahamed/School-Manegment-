import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { classesTable } from "./classes";
import { subjectsTable } from "./subjects";
import { usersTable } from "./users";

export const dayOfWeekEnum = pgEnum("day_of_week", [
  "SATURDAY",
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
]);

export const timetableTable = pgTable("timetable", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  classId: integer("class_id").notNull().references(() => classesTable.id),
  subjectId: integer("subject_id").notNull().references(() => subjectsTable.id),
  teacherId: integer("teacher_id").references(() => usersTable.id),
  dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  room: text("room"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTimetableSchema = createInsertSchema(timetableTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTimetable = z.infer<typeof insertTimetableSchema>;
export type Timetable = typeof timetableTable.$inferSelect;
