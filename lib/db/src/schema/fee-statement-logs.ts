import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const statementActionEnum = pgEnum("statement_action", ["PDF_DOWNLOAD", "EMAIL_SENT"]);

export const feeStatementLogsTable = pgTable("fee_statement_logs", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  triggeredByUserId: integer("triggered_by_user_id"),
  action: statementActionEnum("action").notNull(),
  sentTo: text("sent_to"),
  deliveryMode: text("delivery_mode"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type FeeStatementLog = typeof feeStatementLogsTable.$inferSelect;
export type NewFeeStatementLog = typeof feeStatementLogsTable.$inferInsert;
