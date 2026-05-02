import { pgTable, serial, integer, timestamp, pgEnum, date, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { studentsTable } from "./students";
import { classesTable } from "./classes";

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "PRESENT",
  "ABSENT",
  "LATE",
  "EXCUSED",
]);

export const attendanceMethodEnum = pgEnum("attendance_method", [
  "MANUAL",
  "RFID",
]);

export const attendanceTable = pgTable("attendance", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  studentId: integer("student_id")
    .notNull()
    .references(() => studentsTable.id),
  classId: integer("class_id").references(() => classesTable.id),
  date: date("date").notNull(),
  status: attendanceStatusEnum("status").notNull(),
  checkInTime: text("check_in_time"),
  method: attendanceMethodEnum("method").notNull().default("MANUAL"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
