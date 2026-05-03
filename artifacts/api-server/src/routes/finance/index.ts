import { Router } from "express";
import { db } from "@workspace/db";
import { feeTypesTable, invoicesTable, transactionsTable, studentsTable, classesTable } from "@workspace/db";
import { eq, and, count, inArray } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { sendInvoiceReminder } from "../../lib/overdue-cron.js";
import {
  CreateFeeTypeBody, CreateInvoiceBody, CreateTransactionBody,
  ListInvoicesQueryParams, ListTransactionsQueryParams,
} from "@workspace/api-zod";

const router = Router();

function genInvoiceNumber(): string {
  const now = new Date();
  return `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
}

async function formatInvoice(inv: typeof invoicesTable.$inferSelect) {
  const [student] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable).where(eq(studentsTable.id, inv.studentId)).limit(1);
  const [feeType] = await db.select({ name: feeTypesTable.name })
    .from(feeTypesTable).where(eq(feeTypesTable.id, inv.feeTypeId)).limit(1);
  return {
    id: inv.id, invoiceNumber: inv.invoiceNumber, studentId: inv.studentId,
    studentName: student ? `${student.firstName} ${student.lastName}` : "Unknown",
    feeTypeId: inv.feeTypeId, feeTypeName: feeType?.name ?? "Unknown",
    month: inv.month, totalAmount: parseFloat(inv.totalAmount),
    paidAmount: parseFloat(inv.paidAmount), dueDate: inv.dueDate,
    status: inv.status, createdAt: inv.createdAt.toISOString(),
  };
}

// ── Fee Types ──────────────────────────────────────────────────────────────

router.get("/fee-types", requireAuth, requireFinance, async (_req, res): Promise<void> => {
  const feeTypes = await db.select().from(feeTypesTable).orderBy(feeTypesTable.name);
  res.json({
    feeTypes: feeTypes.map(f => ({
      id: f.id, name: f.name, description: f.description,
      amount: parseFloat(f.amount), isRecurring: f.isRecurring, createdAt: f.createdAt.toISOString(),
    })),
  });
});

router.post("/fee-types", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateFeeTypeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
  const [feeType] = await db.insert(feeTypesTable).values({ ...parsed.data, amount: String(parsed.data.amount) }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "fee_type", entityId: feeType.id,
    description: `Created fee type "${feeType.name}" — amount: ${feeType.amount}`,
    metadata: { name: feeType.name, amount: parseFloat(feeType.amount) },
  });
  res.status(201).json({
    id: feeType.id, name: feeType.name, description: feeType.description,
    amount: parseFloat(feeType.amount), isRecurring: feeType.isRecurring, createdAt: feeType.createdAt.toISOString(),
  });
});

// ── Invoices ───────────────────────────────────────────────────────────────

router.get("/invoices", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const parsed = ListInvoicesQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : { limit: 20, offset: 0 };
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const conditions = [];
  if (params.studentId) conditions.push(eq(invoicesTable.studentId, params.studentId));
  if (params.status) conditions.push(eq(invoicesTable.status, params.status as any));
  if (params.month) conditions.push(eq(invoicesTable.month, params.month));
  const where = conditions.length ? and(...conditions) : undefined;
  const [invoices, totalResult] = await Promise.all([
    db.select().from(invoicesTable).where(where).limit(limit).offset(offset).orderBy(invoicesTable.createdAt),
    db.select({ count: count() }).from(invoicesTable).where(where),
  ]);
  res.json({ invoices: await Promise.all(invoices.map(formatInvoice)), total: totalResult[0]?.count ?? 0 });
});

router.post("/invoices", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
  const d = parsed.data;
  const dueDate = d.dueDate instanceof Date ? d.dueDate.toISOString().split("T")[0]! : String(d.dueDate);
  const [inv] = await db.insert(invoicesTable).values({
    invoiceNumber: genInvoiceNumber(), studentId: d.studentId, feeTypeId: d.feeTypeId,
    month: d.month ?? null, totalAmount: String(d.totalAmount), dueDate,
  } as any).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "invoice", entityId: inv.id,
    description: `Created invoice ${inv.invoiceNumber} for student #${inv.studentId}`,
    metadata: { invoiceNumber: inv.invoiceNumber, amount: parseFloat(inv.totalAmount) },
  });
  res.status(201).json(await formatInvoice(inv));
});

router.get("/invoices/:id", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!inv) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  res.json(await formatInvoice(inv));
});

// ── Send payment reminder notification ─────────────────────────────────────

router.post("/invoices/:id/notify", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const result = await sendInvoiceReminder(id);
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "NOTIFY", entity: "invoice", entityId: id,
    description: `Payment reminder sent for invoice #${id} — ${result.message}`,
    metadata: { invoiceId: id, parentNotified: result.parentNotified, staffNotified: result.staffNotified },
  });
  res.json(result);
});

// ── Transactions ───────────────────────────────────────────────────────────

router.get("/transactions", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const parsed = ListTransactionsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : { limit: 20, offset: 0 };
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const conditions = [];
  if (params.invoiceId) conditions.push(eq(transactionsTable.invoiceId, params.invoiceId));
  if (params.studentId) conditions.push(eq(transactionsTable.studentId, params.studentId));
  const where = conditions.length ? and(...conditions) : undefined;
  const [txns, totalResult] = await Promise.all([
    db.select().from(transactionsTable).where(where).limit(limit).offset(offset).orderBy(transactionsTable.paidAt),
    db.select({ count: count() }).from(transactionsTable).where(where),
  ]);
  const formatted = await Promise.all(txns.map(async t => {
    const [student] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
      .from(studentsTable).where(eq(studentsTable.id, t.studentId)).limit(1);
    return {
      id: t.id, invoiceId: t.invoiceId, studentId: t.studentId,
      studentName: student ? `${student.firstName} ${student.lastName}` : "Unknown",
      amountPaid: parseFloat(t.amountPaid), method: t.method,
      transactionId: t.transactionId, paidAt: t.paidAt.toISOString(), notes: t.notes,
    };
  }));
  res.json({ transactions: formatted, total: totalResult[0]?.count ?? 0 });
});

router.post("/transactions", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, parsed.data.invoiceId)).limit(1);
  if (!invoice) { res.status(404).json({ error: "INVOICE_NOT_FOUND" }); return; }
  const newPaidAmount = parseFloat(invoice.paidAmount) + parsed.data.amountPaid;
  const newStatus = newPaidAmount >= parseFloat(invoice.totalAmount) ? "PAID" : "PENDING";
  const d = parsed.data;
  const [txn] = await db.insert(transactionsTable).values({
    invoiceId: d.invoiceId, studentId: invoice.studentId,
    amountPaid: String(d.amountPaid), method: d.method,
    transactionId: d.transactionId ?? null, notes: d.notes ?? null,
    paidAt: d.paidAt ? new Date(d.paidAt) : new Date(),
  }).returning();
  await db.update(invoicesTable).set({ paidAmount: String(newPaidAmount), status: newStatus, updatedAt: new Date() })
    .where(eq(invoicesTable.id, parsed.data.invoiceId));
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "PAYMENT", entity: "transaction", entityId: txn.id,
    description: `Payment of ${d.amountPaid} received for invoice #${invoice.invoiceNumber}`,
    metadata: { amount: d.amountPaid, method: d.method, invoiceNumber: invoice.invoiceNumber, newStatus },
  });
  const [student] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable).where(eq(studentsTable.id, txn.studentId)).limit(1);
  res.status(201).json({
    id: txn.id, invoiceId: txn.invoiceId, studentId: txn.studentId,
    studentName: student ? `${student.firstName} ${student.lastName}` : "Unknown",
    amountPaid: parseFloat(txn.amountPaid), method: txn.method,
    transactionId: txn.transactionId, paidAt: txn.paidAt.toISOString(), notes: txn.notes,
  });
});

// ── Bulk Invoice Generation ────────────────────────────────────────────────

router.post("/invoices/bulk-generate", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const { classId, feeTypeId, month, dueDate, amount } = req.body as {
    classId?: number; feeTypeId?: number; month?: string; dueDate?: string; amount?: number;
  };

  if (!classId || !feeTypeId || !dueDate) {
    res.status(400).json({ error: "classId, feeTypeId, and dueDate are required" }); return;
  }

  // Verify class exists
  const [cls] = await db.select({ id: classesTable.id, name: classesTable.name })
    .from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  if (!cls) { res.status(404).json({ error: "CLASS_NOT_FOUND" }); return; }

  // Verify fee type exists
  const [feeType] = await db.select().from(feeTypesTable).where(eq(feeTypesTable.id, feeTypeId)).limit(1);
  if (!feeType) { res.status(404).json({ error: "FEE_TYPE_NOT_FOUND" }); return; }

  const unitAmount = amount ?? parseFloat(feeType.amount);

  // All ACTIVE students in the class
  const students = await db.select({ id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable)
    .where(and(eq(studentsTable.classId, classId), eq(studentsTable.status, "ACTIVE")));

  if (students.length === 0) {
    res.json({ created: 0, skipped: 0, total: 0, invoices: [], message: "No active students found in this class" }); return;
  }

  // Check which students already have an invoice for this feeType+month combo
  const studentIds = students.map(s => s.id);
  const existingConditions = [
    inArray(invoicesTable.studentId, studentIds),
    eq(invoicesTable.feeTypeId, feeTypeId),
  ];
  if (month) existingConditions.push(eq(invoicesTable.month, month));

  const existing = await db.select({ studentId: invoicesTable.studentId })
    .from(invoicesTable)
    .where(and(...existingConditions));

  const existingStudentIds = new Set(existing.map(e => e.studentId));
  const toCreate = students.filter(s => !existingStudentIds.has(s.id));
  const skipped = students.length - toCreate.length;

  if (toCreate.length === 0) {
    res.json({ created: 0, skipped, total: students.length, invoices: [], message: "All students already have an invoice for this period" }); return;
  }

  // Batch insert
  const inserted = await db.insert(invoicesTable).values(
    toCreate.map(s => ({
      invoiceNumber: genInvoiceNumber(),
      studentId: s.id,
      feeTypeId,
      month: month ?? null,
      totalAmount: String(unitAmount),
      dueDate,
    }))
  ).returning();

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "BULK_CREATE", entity: "invoice", entityId: classId,
    description: `Bulk generated ${inserted.length} invoices for class "${cls.name}" — fee: ${feeType.name}${month ? `, month: ${month}` : ""}`,
    metadata: { classId, className: cls.name, feeTypeId, feeTypeName: feeType.name, month, dueDate, created: inserted.length, skipped },
  });

  const formatted = await Promise.all(inserted.map(formatInvoice));
  res.status(201).json({
    created: inserted.length,
    skipped,
    total: students.length,
    invoices: formatted,
    message: `Created ${inserted.length} invoice${inserted.length !== 1 ? "s" : ""}${skipped > 0 ? `, skipped ${skipped} (already exists)` : ""}`,
  });
});

export default router;
