import { pgTable, serial, text, integer, timestamp, pgEnum, date } from "drizzle-orm/pg-core";
import { studentsTable } from "./students";
import { usersTable } from "./users";

export const bookStatusEnum = pgEnum("book_status", ["AVAILABLE", "ALL_ISSUED"]);
export const loanStatusEnum = pgEnum("loan_status", ["ACTIVE", "RETURNED", "OVERDUE"]);

export const booksTable = pgTable("books", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  title: text("title").notNull(),
  author: text("author").notNull(),
  isbn: text("isbn"),
  subject: text("subject"),
  publisher: text("publisher"),
  publishedYear: integer("published_year"),
  totalCopies: integer("total_copies").notNull().default(1),
  availableCopies: integer("available_copies").notNull().default(1),
  location: text("location"),
  description: text("description"),
  addedByUserId: integer("added_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const bookLoansTable = pgTable("book_loans", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  bookId: integer("book_id").notNull().references(() => booksTable.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  issuedByUserId: integer("issued_by_user_id").references(() => usersTable.id),
  issuedByName: text("issued_by_name").notNull(),
  borrowDate: date("borrow_date").notNull(),
  dueDate: date("due_date").notNull(),
  returnDate: date("return_date"),
  status: loanStatusEnum("status").notNull().default("ACTIVE"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Book = typeof booksTable.$inferSelect;
export type BookLoan = typeof bookLoansTable.$inferSelect;
