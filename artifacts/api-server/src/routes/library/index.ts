import { Router } from "express";
import { db } from "@workspace/db";
import {
  booksTable, bookLoansTable, studentsTable, usersTable,
  notificationsTable, parentStudentsTable,
} from "@workspace/db";
import { eq, desc, like, or, and, sql, lt } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireRole } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { sseManager } from "../../lib/sse-manager.js";

const router = Router();

const requireStaff = requireRole("SUPER_ADMIN", "TEACHER", "ACCOUNTANT");
const requireAcademic = requireRole("SUPER_ADMIN", "TEACHER");

// ── List books (all roles) ───────────────────────────────────────────────────
router.get("/library/books", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const search = String(req.query["search"] ?? "").trim();
  const books = await db
    .select({
      book: booksTable,
      activeLoans: sql<number>`(select count(*) from book_loans where book_id = ${booksTable.id} and status = 'ACTIVE')`.mapWith(Number),
    })
    .from(booksTable)
    .where(
      search
        ? or(
            like(booksTable.title,   `%${search}%`),
            like(booksTable.author,  `%${search}%`),
            like(booksTable.subject, `%${search}%`),
            like(booksTable.isbn,    `%${search}%`),
          )
        : undefined,
    )
    .orderBy(desc(booksTable.createdAt));
  res.json({ books: books.map(r => ({ ...r.book, activeLoans: r.activeLoans })) });
});

// ── Add book (staff) ─────────────────────────────────────────────────────────
router.post("/library/books", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const { title, author, isbn, subject, publisher, publishedYear, totalCopies, location, description } = req.body ?? {};
  if (!title?.trim() || !author?.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "title and author are required" }); return;
  }
  const copies = Math.max(1, parseInt(String(totalCopies ?? 1), 10) || 1);
  const [book] = await db.insert(booksTable).values({
    title: title.trim(), author: author.trim(),
    isbn: isbn?.trim() || null, subject: subject?.trim() || null,
    publisher: publisher?.trim() || null,
    publishedYear: publishedYear ? parseInt(String(publishedYear), 10) : null,
    totalCopies: copies, availableCopies: copies,
    location: location?.trim() || null, description: description?.trim() || null,
    addedByUserId: req.userId,
  }).returning();
  await audit({ userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!, action: "CREATE", entity: "book", entityId: book!.id, description: `Added book: ${title}`, metadata: {} });
  res.status(201).json({ book });
});

// ── Update book ──────────────────────────────────────────────────────────────
router.patch("/library/books/:id", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [existing] = await db.select().from(booksTable).where(eq(booksTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  const { title, author, isbn, subject, publisher, publishedYear, totalCopies, location, description } = req.body ?? {};
  let availableDelta = 0;
  if (totalCopies !== undefined) {
    const newTotal = Math.max(1, parseInt(String(totalCopies), 10) || 1);
    availableDelta = newTotal - existing.totalCopies;
  }
  const [updated] = await db.update(booksTable).set({
    ...(title        ? { title: title.trim() }                                              : {}),
    ...(author       ? { author: author.trim() }                                            : {}),
    ...(isbn        !== undefined ? { isbn: isbn?.trim() || null }                          : {}),
    ...(subject     !== undefined ? { subject: subject?.trim() || null }                    : {}),
    ...(publisher   !== undefined ? { publisher: publisher?.trim() || null }                : {}),
    ...(publishedYear !== undefined ? { publishedYear: publishedYear ? parseInt(String(publishedYear), 10) : null } : {}),
    ...(totalCopies !== undefined ? { totalCopies: Math.max(1, parseInt(String(totalCopies), 10) || 1), availableCopies: Math.max(0, existing.availableCopies + availableDelta) } : {}),
    ...(location    !== undefined ? { location: location?.trim() || null }                  : {}),
    ...(description !== undefined ? { description: description?.trim() || null }            : {}),
    updatedAt: new Date(),
  }).where(eq(booksTable.id, id)).returning();
  res.json({ book: updated });
});

// ── Delete book ──────────────────────────────────────────────────────────────
router.delete("/library/books/:id", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [existing] = await db.select().from(booksTable).where(eq(booksTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await db.delete(booksTable).where(eq(booksTable.id, id));
  await audit({ userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!, action: "DELETE", entity: "book", entityId: id, description: `Deleted book: ${existing.title}`, metadata: {} });
  res.status(204).send();
});

// ── List active loans for a book ─────────────────────────────────────────────
router.get("/library/books/:id/loans", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  const loans = await db
    .select({ loan: bookLoansTable, firstName: studentsTable.firstName, lastName: studentsTable.lastName, studentId: studentsTable.studentId })
    .from(bookLoansTable)
    .innerJoin(studentsTable, eq(studentsTable.id, bookLoansTable.studentId))
    .where(eq(bookLoansTable.bookId, id))
    .orderBy(desc(bookLoansTable.createdAt));
  res.json({ loans: loans.map(r => ({ ...r.loan, studentFirstName: r.firstName, studentLastName: r.lastName, studentCode: r.studentId })) });
});

// ── Issue book to student ────────────────────────────────────────────────────
router.post("/library/books/:id/issue", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const bookId = parseInt(String(req.params["id"]), 10);
  if (isNaN(bookId)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const { studentId, dueDate, notes } = req.body ?? {};
  if (!studentId || !dueDate) { res.status(400).json({ error: "BAD_REQUEST", message: "studentId and dueDate required" }); return; }
  const sid = parseInt(String(studentId), 10);

  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, bookId)).limit(1);
  if (!book) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  if (book.availableCopies <= 0) { res.status(409).json({ error: "CONFLICT", message: "No copies available" }); return; }

  const [student] = await db.select({ id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName, userId: usersTable.id })
    .from(studentsTable)
    .leftJoin(usersTable, eq(usersTable.linkedStudentId, studentsTable.id))
    .where(eq(studentsTable.id, sid)).limit(1);
  if (!student) { res.status(404).json({ error: "STUDENT_NOT_FOUND" }); return; }

  const [author] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  const issuedByName = author ? `${author.firstName} ${author.lastName}` : "Staff";

  const today = new Date().toISOString().split("T")[0]!;
  const [loan] = await db.insert(bookLoansTable).values({
    bookId, studentId: sid, issuedByUserId: req.userId!, issuedByName,
    borrowDate: today, dueDate, notes: notes?.trim() || null, status: "ACTIVE",
  }).returning();

  await db.update(booksTable).set({ availableCopies: book.availableCopies - 1, updatedAt: new Date() }).where(eq(booksTable.id, bookId));

  // In-app + SSE notification to student
  if (student.userId) {
    const msg = `"${book.title}" issued to you. Due: ${dueDate}`;
    await db.insert(notificationsTable).values({ userId: student.userId, title: "📚 Book Issued", message: msg, type: "INFO", link: "/student" });
    sseManager.sendToUser(student.userId, "update", { notification: { title: "📚 Book Issued", message: msg, type: "INFO" }, unreadBump: true });
  }
  // Notify parents
  void (async () => {
    try {
      const parents = await db.select({ parentUserId: parentStudentsTable.parentUserId }).from(parentStudentsTable).where(eq(parentStudentsTable.studentId, sid));
      if (parents.length) {
        const sName = `${student.firstName} ${student.lastName}`;
        const rows = parents.map(p => ({ userId: p.parentUserId, title: `📚 Book Issued — ${sName}`, message: `"${book.title}" issued. Due: ${dueDate}`, type: "INFO" as const, link: "/parent" }));
        await db.insert(notificationsTable).values(rows);
        for (const p of parents) sseManager.sendToUser(p.parentUserId, "update", { notification: { title: `📚 Book Issued — ${sName}`, message: `"${book.title}" issued. Due: ${dueDate}`, type: "INFO" }, unreadBump: true });
      }
    } catch (err) { logger.warn({ err }, "Library parent notify failed"); }
  })();

  await audit({ userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!, action: "CREATE", entity: "book_loan", entityId: loan!.id, description: `Issued "${book.title}" to student #${sid}`, metadata: { bookId, dueDate } });
  res.status(201).json({ loan });
});

// ── Return book ──────────────────────────────────────────────────────────────
router.patch("/library/loans/:id/return", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [loan] = await db.select().from(bookLoansTable).where(eq(bookLoansTable.id, id)).limit(1);
  if (!loan) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  if (loan.status === "RETURNED") { res.status(409).json({ error: "ALREADY_RETURNED" }); return; }

  const today = new Date().toISOString().split("T")[0]!;
  const [updated] = await db.update(bookLoansTable).set({ status: "RETURNED", returnDate: today, updatedAt: new Date() }).where(eq(bookLoansTable.id, id)).returning();
  await db.update(booksTable).set({ availableCopies: sql`${booksTable.availableCopies} + 1`, updatedAt: new Date() }).where(eq(booksTable.id, loan.bookId));

  await audit({ userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!, action: "UPDATE", entity: "book_loan", entityId: id, description: `Returned loan #${id}`, metadata: { bookId: loan.bookId } });
  res.json({ loan: updated });
});

// ── All loans (staff management view) ────────────────────────────────────────
router.get("/library/loans", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const statusFilter = req.query["status"] ? String(req.query["status"]) : null;
  const today = new Date().toISOString().split("T")[0]!;

  // Auto-mark overdue
  await db.update(bookLoansTable)
    .set({ status: "OVERDUE", updatedAt: new Date() })
    .where(and(eq(bookLoansTable.status, "ACTIVE"), lt(bookLoansTable.dueDate, today)));

  const loans = await db
    .select({
      loan: bookLoansTable,
      bookTitle: booksTable.title, bookAuthor: booksTable.author,
      studentFirst: studentsTable.firstName, studentLast: studentsTable.lastName, studentCode: studentsTable.studentId,
    })
    .from(bookLoansTable)
    .innerJoin(booksTable,    eq(booksTable.id, bookLoansTable.bookId))
    .innerJoin(studentsTable, eq(studentsTable.id, bookLoansTable.studentId))
    .where(statusFilter ? eq(bookLoansTable.status, statusFilter as "ACTIVE" | "RETURNED" | "OVERDUE") : undefined)
    .orderBy(desc(bookLoansTable.createdAt))
    .limit(200);

  res.json({
    loans: loans.map(r => ({
      ...r.loan, bookTitle: r.bookTitle, bookAuthor: r.bookAuthor,
      studentFirstName: r.studentFirst, studentLastName: r.studentLast, studentCode: r.studentCode,
    })),
  });
});

// ── Student: my loans ─────────────────────────────────────────────────────────
router.get("/student/library", requireAuth, requireRole("STUDENT"), async (req: AuthRequest, res): Promise<void> => {
  const [userRow] = await db.select({ linkedStudentId: usersTable.linkedStudentId }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!userRow?.linkedStudentId) { res.json({ loans: [], available: [] }); return; }

  const today = new Date().toISOString().split("T")[0]!;
  await db.update(bookLoansTable).set({ status: "OVERDUE", updatedAt: new Date() }).where(and(eq(bookLoansTable.studentId, userRow.linkedStudentId), eq(bookLoansTable.status, "ACTIVE"), lt(bookLoansTable.dueDate, today)));

  const [loans, available] = await Promise.all([
    db.select({ loan: bookLoansTable, bookTitle: booksTable.title, bookAuthor: booksTable.author, subject: booksTable.subject })
      .from(bookLoansTable)
      .innerJoin(booksTable, eq(booksTable.id, bookLoansTable.bookId))
      .where(eq(bookLoansTable.studentId, userRow.linkedStudentId))
      .orderBy(desc(bookLoansTable.createdAt))
      .limit(50),
    db.select().from(booksTable).where(sql`${booksTable.availableCopies} > 0`).orderBy(booksTable.title).limit(50),
  ]);

  res.json({
    loans: loans.map(r => ({ ...r.loan, bookTitle: r.bookTitle, bookAuthor: r.bookAuthor, subject: r.subject })),
    available,
  });
});

// ── Parent: children's loans ──────────────────────────────────────────────────
router.get("/parent/library", requireAuth, requireRole("PARENT"), async (req: AuthRequest, res): Promise<void> => {
  const links = await db.select({ studentId: parentStudentsTable.studentId }).from(parentStudentsTable).where(eq(parentStudentsTable.parentUserId, req.userId!));
  if (!links.length) { res.json({ loans: [] }); return; }
  const sids = links.map(l => l.studentId);

  const today = new Date().toISOString().split("T")[0]!;
  for (const sid of sids) {
    await db.update(bookLoansTable).set({ status: "OVERDUE", updatedAt: new Date() }).where(and(eq(bookLoansTable.studentId, sid), eq(bookLoansTable.status, "ACTIVE"), lt(bookLoansTable.dueDate, today)));
  }

  const allLoans = await Promise.all(
    sids.map(sid =>
      db.select({ loan: bookLoansTable, bookTitle: booksTable.title, bookAuthor: booksTable.author, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
        .from(bookLoansTable)
        .innerJoin(booksTable,    eq(booksTable.id, bookLoansTable.bookId))
        .innerJoin(studentsTable, eq(studentsTable.id, bookLoansTable.studentId))
        .where(and(eq(bookLoansTable.studentId, sid), eq(bookLoansTable.status, "ACTIVE")))
        .orderBy(bookLoansTable.dueDate)
        .limit(20)
    ),
  );

  const loans = allLoans.flat().map(r => ({ ...r.loan, bookTitle: r.bookTitle, bookAuthor: r.bookAuthor, studentName: `${r.firstName} ${r.lastName}` }));
  res.json({ loans });
});

export default router;
