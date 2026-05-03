import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const incidentSeverityEnum = pgEnum("incident_severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const incidentStatusEnum = pgEnum("incident_status", ["OPEN", "RESOLVED", "DISMISSED"]);

export const studentIncidentsTable = pgTable("student_incidents", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  reportedByUserId: integer("reported_by_user_id").notNull(),
  reportedByName: text("reported_by_name").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: incidentSeverityEnum("severity").notNull().default("LOW"),
  actionTaken: text("action_taken"),
  status: incidentStatusEnum("status").notNull().default("OPEN"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
