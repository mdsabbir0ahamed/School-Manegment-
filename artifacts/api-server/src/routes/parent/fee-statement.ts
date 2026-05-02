import { Router } from "express";
import { db } from "@workspace/db";
import {
  invoicesTable, transactionsTable, studentsTable,
  feeTypesTable, parentStudentsTable, classesTable,
} from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import PDFDocument from "pdfkit";

const router = Router();

// ── Auth guard: PARENT may only view their own linked students ─────────────

async function canViewStudent(req: AuthRequest, studentId: number): Promise<boolean> {
  const role = req.userRole;
  if (role === "SUPER_ADMIN" || role === "ACCOUNTANT") return true;
  if (role === "PARENT") {
    const [link] = await db
      .select({ id: parentStudentsTable.id })
      .from(parentStudentsTable)
      .where(
        and(
          eq(parentStudentsTable.parentUserId, req.userId!),
          eq(parentStudentsTable.studentId, studentId),
        ),
      )
      .limit(1);
    return !!link;
  }
  return false;
}

// ── GET /parent/fee-statement/:studentId ──────────────────────────────────

router.get(
  "/parent/fee-statement/:studentId",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const studentId = parseInt(String(req.params["studentId"]), 10);
    if (isNaN(studentId)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

    if (!(await canViewStudent(req, studentId))) {
      res.status(403).json({ error: "FORBIDDEN" }); return;
    }

    // Fetch student
    const [student] = await db
      .select({
        id: studentsTable.id,
        studentId: studentsTable.studentId,
        firstName: studentsTable.firstName,
        lastName: studentsTable.lastName,
        classId: studentsTable.classId,
        admissionDate: studentsTable.admissionDate,
        parentName: studentsTable.parentName,
        parentEmail: studentsTable.parentEmail,
      })
      .from(studentsTable)
      .where(eq(studentsTable.id, studentId))
      .limit(1);

    if (!student) { res.status(404).json({ error: "STUDENT_NOT_FOUND" }); return; }

    // Class name
    let className: string | null = null;
    if (student.classId) {
      const [cls] = await db.select({ name: classesTable.name, section: classesTable.section })
        .from(classesTable).where(eq(classesTable.id, student.classId)).limit(1);
      if (cls) className = cls.section ? `${cls.name} – ${cls.section}` : cls.name;
    }

    // All invoices for the student
    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.studentId, studentId))
      .orderBy(asc(invoicesTable.dueDate));

    // All fee types (for name lookup)
    const feeTypes = await db.select({ id: feeTypesTable.id, name: feeTypesTable.name }).from(feeTypesTable);
    const feeTypeMap = new Map(feeTypes.map(f => [f.id, f.name]));

    // All transactions for this student
    const transactions = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.studentId, studentId))
      .orderBy(asc(transactionsTable.paidAt));

    const txByInvoice = new Map<number, typeof transactions>();
    for (const tx of transactions) {
      const list = txByInvoice.get(tx.invoiceId) ?? [];
      list.push(tx);
      txByInvoice.set(tx.invoiceId, list);
    }

    const formattedInvoices = invoices.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      feeTypeId: inv.feeTypeId,
      feeTypeName: feeTypeMap.get(inv.feeTypeId) ?? "Unknown",
      month: inv.month,
      totalAmount: parseFloat(inv.totalAmount),
      paidAmount: parseFloat(inv.paidAmount),
      dueDate: inv.dueDate,
      status: inv.status,
      createdAt: inv.createdAt.toISOString(),
      transactions: (txByInvoice.get(inv.id) ?? []).map(tx => ({
        id: tx.id,
        amountPaid: parseFloat(tx.amountPaid),
        method: tx.method,
        transactionId: tx.transactionId,
        paidAt: tx.paidAt.toISOString(),
        notes: tx.notes,
      })),
    }));

    const totalInvoiced = formattedInvoices.reduce((s, i) => s + i.totalAmount, 0);
    const totalPaid = formattedInvoices.reduce((s, i) => s + i.paidAmount, 0);
    const totalOutstanding = formattedInvoices
      .filter(i => i.status !== "CANCELLED")
      .reduce((s, i) => s + Math.max(0, i.totalAmount - i.paidAmount), 0);
    const overdueCount = formattedInvoices.filter(i => i.status === "OVERDUE").length;

    res.json({
      student: {
        id: student.id,
        studentId: student.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        className,
        admissionDate: student.admissionDate,
        parentName: student.parentName,
        parentEmail: student.parentEmail,
      },
      summary: { totalInvoiced, totalPaid, totalOutstanding, overdueCount, invoiceCount: formattedInvoices.length },
      invoices: formattedInvoices,
      generatedAt: new Date().toISOString(),
    });
  },
);

// ── GET /parent/fee-statement/:studentId/pdf ──────────────────────────────

router.get(
  "/parent/fee-statement/:studentId/pdf",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const studentId = parseInt(String(req.params["studentId"]), 10);
    if (isNaN(studentId)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

    if (!(await canViewStudent(req, studentId))) {
      res.status(403).json({ error: "FORBIDDEN" }); return;
    }

    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
    if (!student) { res.status(404).json({ error: "STUDENT_NOT_FOUND" }); return; }

    let className: string | null = null;
    if (student.classId) {
      const [cls] = await db.select({ name: classesTable.name, section: classesTable.section })
        .from(classesTable).where(eq(classesTable.id, student.classId)).limit(1);
      if (cls) className = cls.section ? `${cls.name} – ${cls.section}` : cls.name;
    }

    const invoices = await db.select().from(invoicesTable)
      .where(eq(invoicesTable.studentId, studentId)).orderBy(asc(invoicesTable.dueDate));

    const feeTypes = await db.select({ id: feeTypesTable.id, name: feeTypesTable.name }).from(feeTypesTable);
    const feeTypeMap = new Map(feeTypes.map(f => [f.id, f.name]));

    const transactions = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.studentId, studentId)).orderBy(asc(transactionsTable.paidAt));

    const totalInvoiced = invoices.reduce((s, i) => s + parseFloat(i.totalAmount), 0);
    const totalPaid     = invoices.reduce((s, i) => s + parseFloat(i.paidAmount), 0);
    const totalOutstanding = invoices
      .filter(i => i.status !== "CANCELLED")
      .reduce((s, i) => s + Math.max(0, parseFloat(i.totalAmount) - parseFloat(i.paidAmount)), 0);

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="fee-statement-${student.studentId}-${new Date().toISOString().slice(0, 10)}.pdf"`,
    );
    doc.pipe(res);

    // ── Header ──
    const BRAND = "#4F46E5";
    doc.rect(0, 0, doc.page.width, 90).fill(BRAND);
    doc.fillColor("white").fontSize(20).font("Helvetica-Bold")
      .text("SchoolERP", 50, 28);
    doc.fontSize(10).font("Helvetica").fillColor("rgba(255,255,255,0.85)")
      .text("Student Fee Statement", 50, 52);
    doc.fillColor("white").fontSize(9)
      .text(`Generated: ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`, 50, 68);

    let y = 110;

    // ── Student info box ──
    doc.roundedRect(50, y, 495, 80, 6).fillAndStroke("#F8F7FF", "#E0DCFF");
    doc.fillColor("#1E1B4B").fontSize(13).font("Helvetica-Bold")
      .text(`${student.firstName} ${student.lastName}`, 65, y + 12);
    doc.fillColor("#4338CA").fontSize(9).font("Helvetica")
      .text(`ID: ${student.studentId}`, 65, y + 28);
    if (className) doc.text(`Class: ${className}`, 65, y + 42);
    doc.fillColor("#6B7280").fontSize(9)
      .text(`Admission: ${student.admissionDate}`, 65, y + 56);
    if (student.parentName) {
      doc.text(`Parent/Guardian: ${student.parentName}`, 300, y + 12);
    }
    if (student.parentEmail) {
      doc.text(`Email: ${student.parentEmail}`, 300, y + 28);
    }
    y += 100;

    // ── Summary boxes ──
    const boxes = [
      { label: "Total Invoiced", value: `৳${totalInvoiced.toLocaleString()}`, color: "#EEF2FF", border: "#C7D2FE", text: "#3730A3" },
      { label: "Total Paid",     value: `৳${totalPaid.toLocaleString()}`,     color: "#F0FDF4", border: "#BBF7D0", text: "#166534" },
      { label: "Outstanding",    value: `৳${totalOutstanding.toLocaleString()}`, color: "#FFF7ED", border: "#FED7AA", text: totalOutstanding > 0 ? "#9A3412" : "#166534" },
    ];
    const bw = 152;
    boxes.forEach((b, i) => {
      const bx = 50 + i * (bw + 10);
      doc.roundedRect(bx, y, bw, 54, 5).fillAndStroke(b.color, b.border);
      doc.fillColor(b.text).fontSize(9).font("Helvetica").text(b.label, bx + 10, y + 10);
      doc.fontSize(16).font("Helvetica-Bold").text(b.value, bx + 10, y + 24, { width: bw - 20 });
    });
    y += 74;

    // ── Invoice table ──
    doc.fillColor(BRAND).fontSize(11).font("Helvetica-Bold").text("Invoice History", 50, y);
    y += 18;

    const cols = { num: 50, fee: 155, month: 255, total: 320, paid: 380, status: 445 };
    const headers = ["Invoice No.", "Fee Type", "Month", "Total (৳)", "Paid (৳)", "Status"];
    const colX = Object.values(cols);

    // Header row
    doc.rect(50, y, 495, 20).fill("#4F46E5");
    doc.fillColor("white").fontSize(7.5).font("Helvetica-Bold");
    headers.forEach((h, i) => doc.text(h, colX[i]! + 3, y + 6, { width: 100 }));
    y += 20;

    // Data rows
    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i]!;
      const rowBg = i % 2 === 0 ? "#FAFAFA" : "white";
      doc.rect(50, y, 495, 18).fill(rowBg);

      const statusColors: Record<string, string> = {
        PAID: "#166534", PENDING: "#92400E", OVERDUE: "#991B1B", CANCELLED: "#6B7280",
      };
      const sColor = statusColors[inv.status] ?? "#374151";

      doc.fillColor("#374151").fontSize(7.5).font("Helvetica");
      doc.text(inv.invoiceNumber, cols.num + 3, y + 5, { width: 100 });
      doc.text(feeTypeMap.get(inv.feeTypeId) ?? "—", cols.fee + 3, y + 5, { width: 95 });
      doc.text(inv.month ?? "—", cols.month + 3, y + 5, { width: 60 });
      doc.text(parseFloat(inv.totalAmount).toLocaleString(), cols.total + 3, y + 5, { width: 55 });
      doc.fillColor("#166534").text(parseFloat(inv.paidAmount).toLocaleString(), cols.paid + 3, y + 5, { width: 55 });
      doc.fillColor(sColor).font("Helvetica-Bold").text(inv.status, cols.status + 3, y + 5, { width: 55 });
      y += 18;

      if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
    }

    // ── Transaction history ──
    if (transactions.length > 0) {
      y += 20;
      if (y > doc.page.height - 120) { doc.addPage(); y = 50; }

      doc.fillColor(BRAND).fontSize(11).font("Helvetica-Bold").text("Payment History", 50, y);
      y += 18;

      const tcols = { date: 50, inv: 160, amount: 265, method: 340, txnId: 430 };
      const theaders = ["Date", "Invoice No.", "Amount (৳)", "Method", "Reference"];
      const tcolX = Object.values(tcols);

      doc.rect(50, y, 495, 20).fill("#4F46E5");
      doc.fillColor("white").fontSize(7.5).font("Helvetica-Bold");
      theaders.forEach((h, i) => doc.text(h, tcolX[i]! + 3, y + 6, { width: 100 }));
      y += 20;

      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i]!;
        const rowBg = i % 2 === 0 ? "#FAFAFA" : "white";
        doc.rect(50, y, 495, 18).fill(rowBg);
        doc.fillColor("#374151").fontSize(7.5).font("Helvetica");
        doc.text(new Date(tx.paidAt).toLocaleDateString("en-US", { dateStyle: "medium" }), tcols.date + 3, y + 5, { width: 105 });

        const invNum = invoices.find(inv => inv.id === tx.invoiceId)?.invoiceNumber ?? `#${tx.invoiceId}`;
        doc.text(invNum, tcols.inv + 3, y + 5, { width: 100 });
        doc.fillColor("#166534").text(parseFloat(tx.amountPaid).toLocaleString(), tcols.amount + 3, y + 5, { width: 70 });
        doc.fillColor("#374151").text(tx.method.replace(/_/g, " "), tcols.method + 3, y + 5, { width: 85 });
        doc.text(tx.transactionId ?? "—", tcols.txnId + 3, y + 5, { width: 65 });
        y += 18;

        if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
      }
    }

    // ── Footer ──
    const pageCount = (doc as any).bufferedPageRange?.()?.count ?? 1;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fillColor("#9CA3AF").fontSize(7.5).font("Helvetica")
        .text(
          `SchoolERP · Confidential · Page ${i + 1} of ${pageCount}`,
          50,
          doc.page.height - 35,
          { align: "center", width: 495 },
        );
    }

    doc.end();
  },
);

export default router;
