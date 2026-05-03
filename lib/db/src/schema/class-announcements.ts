import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const classAnnouncementsTable = pgTable("class_announcements", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull(),
  authorUserId: integer("author_user_id").notNull(),
  authorName: text("author_name").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
