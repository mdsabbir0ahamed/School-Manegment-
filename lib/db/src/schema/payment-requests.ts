import {
  pgTable, serial, integer, text, numeric, timestamp, pgEnum, date,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { studentsTable } from "./students";
import { invoicesTable } from "./finance";

export const paymentRequestStatusEnum = pgEnum("payment_request_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const paymentRequestMethodEnum = pgEnum("payment_request_method", [
  "BKASH",
  "NAGAD",
  "ROCKET",
  "BANK_TRANSFER",
  "CASH",
  "CHEQUE",
  "OTHER",
]);

export const paymentRequestsTable = pgTable("payment_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  studentId: integer("student_id").notNull().references(() => studentsTable.id),
  parentUserId: integer("parent_user_id").notNull().references(() => usersTable.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: paymentRequestMethodEnum("method").notNull(),
  transactionRef: text("transaction_ref"),
  paymentDate: date("payment_date").notNull(),
  note: text("note"),
  status: paymentRequestStatusEnum("status").notNull().default("PENDING"),
  rejectionReason: text("rejection_reason"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PaymentRequest = typeof paymentRequestsTable.$inferSelect;
