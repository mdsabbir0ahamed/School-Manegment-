import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const studentNotesTable = pgTable("student_notes", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  authorUserId: integer("author_user_id").notNull(),
  authorName: text("author_name").notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
