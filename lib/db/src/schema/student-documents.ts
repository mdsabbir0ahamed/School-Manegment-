import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { studentsTable } from "./students";

export const documentTypeEnum = pgEnum("document_type", [
  "PROFILE_PHOTO",
  "ADMIT_CARD",
  "BIRTH_CERTIFICATE",
  "NATIONAL_ID",
  "TRANSFER_CERTIFICATE",
  "OTHER",
]);

export const studentDocumentsTable = pgTable("student_documents", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  studentId: integer("student_id").notNull().references(() => studentsTable.id),
  type: documentTypeEnum("type").notNull(),
  title: text("title").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StudentDocument = typeof studentDocumentsTable.$inferSelect;
