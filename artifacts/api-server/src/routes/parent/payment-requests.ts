import { Router } from "express";
import { db } from "@workspace/db";
import {
  paymentRequestsTable, invoicesTable, studentsTable,
  transactionsTable, notificationsTable, usersTable, parentStudentsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { audit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";

const router = Router();

const ALLOWED_METHODS = ["BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CASH", "CHEQUE", "OTHER"] as const;

async function canViewStudent(req: AuthRequest, studentId: number): Promise<boolean> {
  const role = req.userRole;
  if (role === "SUPER_ADMIN" || role === "ACCOUNTANT") return true;
  if (role === "PARENT") {
    const [link] = await db.select({ id: parentStudentsTable.id })
      .from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parentUserId, req.userId!),
        eq(parentStudentsTable.studentId, studentId),
      )).limit(1);
    return !!link;
  }
  return false;
}

async function formatRequest(r: typeof paymentRequestsTable.$inferSelect) {
  const [student] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName, studentId: studentsTable.studentId })
    .from(studentsTable).where(eq(studentsTable.id, r.studentId)).limit(1);
  const [inv] = await db.select({ invoiceNumber: invoicesTable.invoiceNumber })
    .from(invoicesTable).where(eq(invoicesTable.id, r.invoiceId)).limit(1);
  const [parent] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, r.parentUserId)).limit(1);
  let reviewer: string | null = null;
  if (r.reviewedByUserId) {
    const [rv] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(eq(usersTable.id, r.reviewedByUserId)).limit(1);
    reviewer = rv ? `${rv.firstName} ${rv.lastName}` : null;
  }
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    invoiceNumber: inv?.invoiceNumber ?? `#${r.invoiceId}`,
    studentId: r.studentId,
    studentName: student ? `${student.firstName} ${student.lastName}` : `Student #${r.studentId}`,
    studentKey: student?.studentId ?? "",
    parentUserId: r.parentUserId,
    parentName: parent ? `${parent.firstName} ${parent.lastName}` : null,
    parentEmail: parent?.email ?? null,
    amount: parseFloat(r.amount),
    method: r.method,
    transactionRef: r.transactionRef,
    paymentDate: r.paymentDate,
    note: r.note,
    status: r.status,
    rejectionReason: r.rejectionReason,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewedBy: reviewer,
    createdAt: r.createdAt.toISOString(),
  };
}

// ── POST /parent/payment-requests — submit a payment request ─────────────

router.post(
  "/parent/payment-requests",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const { invoiceId, amount, method, transactionRef, paymentDate, note } = req.body as {
      invoiceId?: number; amount?: number; method?: string;
      transactionRef?: string; paymentDate?: string; note?: string;
    };

    if (!invoiceId || !amount || !method || !paymentDate) {
      res.status(400).json({ error: "invoiceId, amount, method, paymentDate are required" }); return;
    }
    if (!ALLOWED_METHODS.includes(method as any)) {
      res.status(400).json({ error: "Invalid payment method" }); return;
    }
    if (amount <= 0) {
      res.status(400).json({ error: "Amount must be positive" }); return;
    }

    // Fetch invoice
    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
    if (!inv) { res.status(404).json({ error: "INVOICE_NOT_FOUND" }); return; }
    if (inv.status === "PAID" || inv.status === "CANCELLED") {
      res.status(400).json({ error: "Invoice is already paid or cancelled" }); return;
    }

    // Check access
    if (!(await canViewStudent(req, inv.studentId))) {
      res.status(403).json({ error: "FORBIDDEN" }); return;
    }

    // Check for existing pending request for same invoice
    const [existing] = await db.select({ id: paymentRequestsTable.id })
      .from(paymentRequestsTable)
      .where(and(
        eq(paymentRequestsTable.invoiceId, invoiceId),
        eq(paymentRequestsTable.status, "PENDING"),
      )).limit(1);
    if (existing) {
      res.status(409).json({ error: "A pending payment request already exists for this invoice" }); return;
    }

    const [pr] = await db.insert(paymentRequestsTable).values({
      invoiceId,
      studentId: inv.studentId,
      parentUserId: req.userId!,
      amount: String(amount),
      method: method as any,
      transactionRef: transactionRef ?? null,
      paymentDate,
      note: note ?? null,
    }).returning();

    // Notify finance staff
    const staffUsers = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.isActive, true), sql`${usersTable.role} IN ('SUPER_ADMIN', 'ACCOUNTANT')`));

    const [student] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
      .from(studentsTable).where(eq(studentsTable.id, inv.studentId)).limit(1);
    const studentName = student ? `${student.firstName} ${student.lastName}` : `Student #${inv.studentId}`;

    for (const user of staffUsers) {
      await db.insert(notificationsTable).values({
        userId: user.id,
        title: "Payment Request Submitted",
        message: `${studentName} — ৳${amount.toLocaleString()} via ${method} for ${inv.invoiceNumber}. Review and approve in Finance.`,
        type: "INFO",
        link: "/finance",
      });
    }

    await audit({
      userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
      action: "CREATE", entity: "payment_request", entityId: pr.id,
      description: `Payment request submitted for invoice ${inv.invoiceNumber} — ৳${amount} via ${method}`,
      metadata: { invoiceId, amount, method, transactionRef },
    });

    logger.info({ prId: pr.id, invoiceId, amount, method }, "Payment request submitted");
    res.status(201).json(await formatRequest(pr));
  },
);

// ── GET /parent/payment-requests — list (parent: own; finance: all) ────────

router.get(
  "/parent/payment-requests",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const role = req.userRole;
    const studentId = req.query["studentId"] ? parseInt(String(req.query["studentId"]), 10) : undefined;

    let rows: (typeof paymentRequestsTable.$inferSelect)[];

    if (role === "SUPER_ADMIN" || role === "ACCOUNTANT") {
      rows = await db.select().from(paymentRequestsTable)
        .where(studentId ? eq(paymentRequestsTable.studentId, studentId) : undefined)
        .orderBy(desc(paymentRequestsTable.createdAt))
        .limit(100);
    } else if (role === "PARENT") {
      rows = await db.select().from(paymentRequestsTable)
        .where(eq(paymentRequestsTable.parentUserId, req.userId!))
        .orderBy(desc(paymentRequestsTable.createdAt))
        .limit(50);
    } else {
      res.status(403).json({ error: "FORBIDDEN" }); return;
    }

    const formatted = await Promise.all(rows.map(formatRequest));
    res.json({ requests: formatted, total: formatted.length });
  },
);

// ── PATCH /finance/payment-requests/:id/approve ───────────────────────────

router.patch(
  "/finance/payment-requests/:id/approve",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const role = req.userRole;
    if (role !== "SUPER_ADMIN" && role !== "ACCOUNTANT") {
      res.status(403).json({ error: "FORBIDDEN" }); return;
    }

    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

    const [pr] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id)).limit(1);
    if (!pr) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    if (pr.status !== "PENDING") { res.status(409).json({ error: "Request is not pending" }); return; }

    // Fetch invoice
    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, pr.invoiceId)).limit(1);
    if (!inv) { res.status(404).json({ error: "INVOICE_NOT_FOUND" }); return; }

    const newPaidAmount = parseFloat(inv.paidAmount) + parseFloat(pr.amount);
    const newStatus = newPaidAmount >= parseFloat(inv.totalAmount) ? "PAID" : "PENDING";

    // Create transaction record
    const [txn] = await db.insert(transactionsTable).values({
      invoiceId: pr.invoiceId,
      studentId: pr.studentId,
      amountPaid: pr.amount,
      method: pr.method === "BKASH" || pr.method === "NAGAD" || pr.method === "ROCKET" ? "MOBILE_BANKING" : (pr.method as any),
      transactionId: pr.transactionRef ?? null,
      notes: pr.note ?? null,
      paidAt: pr.paymentDate ? new Date(pr.paymentDate) : new Date(),
    }).returning();

    // Update invoice
    await db.update(invoicesTable)
      .set({ paidAmount: String(newPaidAmount), status: newStatus, updatedAt: new Date() })
      .where(eq(invoicesTable.id, pr.invoiceId));

    // Update payment request
    const [updated] = await db.update(paymentRequestsTable)
      .set({ status: "APPROVED", reviewedAt: new Date(), reviewedByUserId: req.userId!, updatedAt: new Date() })
      .where(eq(paymentRequestsTable.id, id))
      .returning();

    // Notify parent
    await db.insert(notificationsTable).values({
      userId: pr.parentUserId,
      title: "Payment Approved",
      message: `Your payment of ৳${parseFloat(pr.amount).toLocaleString()} for invoice ${inv.invoiceNumber} has been approved.${newStatus === "PAID" ? " Invoice is now fully paid." : ""}`,
      type: "SUCCESS",
      link: "/parent",
    });

    await audit({
      userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
      action: "APPROVE", entity: "payment_request", entityId: id,
      description: `Approved payment request #${id} — ৳${pr.amount} for invoice ${inv.invoiceNumber}`,
      metadata: { invoiceId: pr.invoiceId, amount: pr.amount, transactionId: txn.id, newInvoiceStatus: newStatus },
    });

    logger.info({ prId: id, txnId: txn.id, newStatus }, "Payment request approved");
    res.json(await formatRequest(updated));
  },
);

// ── PATCH /finance/payment-requests/:id/reject ────────────────────────────

router.patch(
  "/finance/payment-requests/:id/reject",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const role = req.userRole;
    if (role !== "SUPER_ADMIN" && role !== "ACCOUNTANT") {
      res.status(403).json({ error: "FORBIDDEN" }); return;
    }

    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

    const { reason } = req.body as { reason?: string };

    const [pr] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id)).limit(1);
    if (!pr) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    if (pr.status !== "PENDING") { res.status(409).json({ error: "Request is not pending" }); return; }

    const [inv] = await db.select({ invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable).where(eq(invoicesTable.id, pr.invoiceId)).limit(1);

    const [updated] = await db.update(paymentRequestsTable)
      .set({
        status: "REJECTED",
        rejectionReason: reason ?? null,
        reviewedAt: new Date(),
        reviewedByUserId: req.userId!,
        updatedAt: new Date(),
      })
      .where(eq(paymentRequestsTable.id, id))
      .returning();

    // Notify parent
    await db.insert(notificationsTable).values({
      userId: pr.parentUserId,
      title: "Payment Request Rejected",
      message: `Your payment request of ৳${parseFloat(pr.amount).toLocaleString()} for invoice ${inv?.invoiceNumber ?? `#${pr.invoiceId}`} was not approved.${reason ? ` Reason: ${reason}` : " Please contact the school for details."}`,
      type: "DANGER",
      link: "/parent",
    });

    await audit({
      userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
      action: "REJECT", entity: "payment_request", entityId: id,
      description: `Rejected payment request #${id}${reason ? ` — reason: ${reason}` : ""}`,
      metadata: { invoiceId: pr.invoiceId, amount: pr.amount, reason },
    });

    logger.info({ prId: id, reason }, "Payment request rejected");
    res.json(await formatRequest(updated));
  },
);

export default router;
