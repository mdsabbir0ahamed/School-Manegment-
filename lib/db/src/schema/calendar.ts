import { pgTable, serial, text, timestamp, boolean, pgEnum, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const calendarEventTypeEnum = pgEnum("calendar_event_type", [
  "HOLIDAY",
  "EXAM",
  "EVENT",
  "MEETING",
  "SPORTS",
  "OTHER",
]);

export const calendarEventsTable = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  title: text("title").notNull(),
  description: text("description"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  type: calendarEventTypeEnum("type").notNull().default("EVENT"),
  isAllDay: boolean("is_all_day").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCalendarEventSchema = createInsertSchema(calendarEventsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEventsTable.$inferSelect;
