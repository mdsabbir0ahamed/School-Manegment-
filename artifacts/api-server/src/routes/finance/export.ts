import { Router } from "express";
import { db } from "@workspace/db";
import {
  invoicesTable, transactionsTable, studentsTable, feeTypesTable, tenantsTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";
import PDFDocument from "pdfkit";

const router = Router();

const STATUS_LABEL: Record<string, string> = {
  PAID: "PAID",
  PENDING: "PENDING",
  OVERDUE: "OVERDUE",
  CANCELLED: "CANCELLED",
};

function formatCurrency(n: number) {
  return `BDT ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function hrLine(doc: InstanceType<typeof PDFDocument>, y: number, color = "#E2E8F0") {
  doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor(color).lineWidth(0.5).stroke();
}

function tableRow(
  doc: InstanceType<typeof PDFDocument>,
  cols: { text: string; x: number; width: number; align?: "left" | "right" | "center" }[],
  y: number,
  fontSize = 8,
  color = "#374151",
) {
  doc.fontSize(fontSize).fillColor(color);
  for (const col of cols) {
    doc.text(col.text, col.x, y, { width: col.width, align: col.align ?? "left" });
  }
}

router.get(
  "/finance/export",
  requireAuth,
  requireFinance,
  async (req, res): Promise<void> => {
    const exportType = req.query["type"] === "transactions" ? "transactions" : "invoices";
    const status = req.query["status"] ? String(req.query["status"]) : undefined;
    const dateFrom = req.query["dateFrom"] ? String(req.query["dateFrom"]) : undefined;
    const dateTo = req.query["dateTo"] ? String(req.query["dateTo"]) : undefined;

    const [tenant] = await db.select().from(tenantsTable).limit(1);
    const schoolName = tenant?.name ?? "Smart School ERP";

    const dateLabel = dateFrom && dateTo
      ? `${dateFrom} to ${dateTo}`
      : dateFrom
        ? `From ${dateFrom}`
        : dateTo
          ? `Until ${dateTo}`
          : "All time";

    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportType}-report-${new Date().toISOString().slice(0, 10)}.pdf"`,
    );
    doc.pipe(res);

    const PAGE_W = doc.page.width;
    const CONTENT_W = PAGE_W - 80;
    const PRIMARY = "#4F46E5";

    // ── Header banner ──────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 70).fill(PRIMARY);
    doc.fillColor("#FFFFFF").fontSize(18).font("Helvetica-Bold")
      .text(schoolName, 40, 18, { width: CONTENT_W });
    doc.fontSize(10).font("Helvetica")
      .text(
        `${exportType === "invoices" ? "Invoice" : "Transaction"} Report  ·  ${dateLabel}`,
        40, 42, { width: CONTENT_W },
      );

    doc.fillColor("#374151");

    // ── Meta row ──────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor("#6B7280")
      .text(
        `Generated: ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` +
        (status ? `  ·  Status filter: ${status}` : ""),
        40, 82,
      );

    let y = 102;

    if (exportType === "invoices") {
      // ── Fetch invoices ─────────────────────────────────────────────────
      const conditions = [];
      if (status && status !== "all") conditions.push(eq(invoicesTable.status, status as any));
      if (dateFrom) conditions.push(gte(invoicesTable.createdAt, new Date(dateFrom)));
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        conditions.push(lte(invoicesTable.createdAt, end));
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const invoices = await db.select().from(invoicesTable).where(where).orderBy(invoicesTable.createdAt);

      const studentIds = [...new Set(invoices.map(i => i.studentId))];
      const feeTypeIds = [...new Set(invoices.map(i => i.feeTypeId))];

      const [students, feeTypes] = await Promise.all([
        studentIds.length
          ? db.select({ id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
              .from(studentsTable).where(eq(studentsTable.id, studentIds[0]!))
          : Promise.resolve([]),
        feeTypeIds.length
          ? db.select({ id: feeTypesTable.id, name: feeTypesTable.name })
              .from(feeTypesTable)
          : Promise.resolve([]),
      ]);
      const studentMap = new Map(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));
      const feeTypeMap = new Map(feeTypes.map(f => [f.id, f.name]));

      // Fetch ALL students for mapping (not just first one)
      const allStudents = await db.select({ id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
        .from(studentsTable);
      allStudents.forEach(s => studentMap.set(s.id, `${s.firstName} ${s.lastName}`));

      // ── Summary cards ──────────────────────────────────────────────────
      const totalAmt = invoices.reduce((s, i) => s + parseFloat(i.totalAmount), 0);
      const paidAmt = invoices.reduce((s, i) => s + parseFloat(i.paidAmount), 0);
      const pendingCount = invoices.filter(i => i.status === "PENDING").length;
      const overdueCount = invoices.filter(i => i.status === "OVERDUE").length;
      const paidCount = invoices.filter(i => i.status === "PAID").length;

      const cardW = (CONTENT_W - 12) / 4;
      const cards = [
        { label: "Total Invoices", value: String(invoices.length), color: "#4F46E5" },
        { label: "Total Amount", value: formatCurrency(totalAmt), color: "#059669" },
        { label: "Amount Paid", value: formatCurrency(paidAmt), color: "#0EA5E9" },
        { label: "Outstanding", value: formatCurrency(totalAmt - paidAmt), color: "#DC2626" },
      ];
      cards.forEach((card, i) => {
        const cx = 40 + i * (cardW + 4);
        doc.rect(cx, y, cardW, 44).fill("#F8FAFC").stroke("#E2E8F0");
        doc.rect(cx, y, 3, 44).fill(card.color);
        doc.fillColor("#6B7280").fontSize(7).font("Helvetica")
          .text(card.label.toUpperCase(), cx + 8, y + 8, { width: cardW - 12 });
        doc.fillColor("#111827").fontSize(10).font("Helvetica-Bold")
          .text(card.value, cx + 8, y + 21, { width: cardW - 12 });
      });

      y += 54;

      // Status breakdown line
      doc.fontSize(8).font("Helvetica").fillColor("#6B7280")
        .text(`Paid: ${paidCount}  ·  Pending: ${pendingCount}  ·  Overdue: ${overdueCount}`, 40, y);
      y += 16;
      hrLine(doc, y);
      y += 10;

      // ── Table header ──────────────────────────────────────────────────
      doc.rect(40, y, CONTENT_W, 18).fill("#F1F5F9");
      const INV_COLS = [
        { text: "INVOICE NO.", x: 40, width: 90, align: "left" as const },
        { text: "STUDENT", x: 134, width: 100, align: "left" as const },
        { text: "FEE TYPE", x: 238, width: 90, align: "left" as const },
        { text: "MONTH", x: 332, width: 50, align: "left" as const },
        { text: "TOTAL", x: 386, width: 56, align: "right" as const },
        { text: "PAID", x: 446, width: 50, align: "right" as const },
        { text: "DUE DATE", x: 500, width: 55, align: "left" as const },
        { text: "STATUS", x: 555, width: 50, align: "left" as const },
      ];
      tableRow(doc, INV_COLS, y + 5, 7, "#6B7280");
      y += 20;

      // ── Table rows ────────────────────────────────────────────────────
      const STATUS_COLORS: Record<string, string> = {
        PAID: "#059669", PENDING: "#D97706", OVERDUE: "#DC2626", CANCELLED: "#6B7280",
      };

      for (const inv of invoices) {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = 40;
          doc.rect(40, y, CONTENT_W, 18).fill("#F1F5F9");
          tableRow(doc, INV_COLS, y + 5, 7, "#6B7280");
          y += 20;
        }

        const rowColor = invoices.indexOf(inv) % 2 === 0 ? "#FFFFFF" : "#F9FAFB";
        doc.rect(40, y, CONTENT_W, 16).fill(rowColor);

        const total = parseFloat(inv.totalAmount);
        const paid = parseFloat(inv.paidAmount);
        const statusColor = STATUS_COLORS[inv.status] ?? "#6B7280";

        doc.fontSize(7.5).font("Helvetica").fillColor("#1F2937")
          .text(inv.invoiceNumber, 40, y + 4, { width: 90 })
          .text(studentMap.get(inv.studentId) ?? "Unknown", 134, y + 4, { width: 100 })
          .text(feeTypeMap.get(inv.feeTypeId) ?? "Unknown", 238, y + 4, { width: 90 })
          .text(inv.month ?? "-", 332, y + 4, { width: 50 });
        doc.fillColor("#111827").font("Helvetica-Bold")
          .text(total.toFixed(2), 386, y + 4, { width: 56, align: "right" })
          .text(paid.toFixed(2), 446, y + 4, { width: 50, align: "right" });
        doc.fillColor("#1F2937").font("Helvetica")
          .text(inv.dueDate ?? "-", 500, y + 4, { width: 55 });
        doc.fillColor(statusColor).font("Helvetica-Bold")
          .text(STATUS_LABEL[inv.status] ?? inv.status, 555, y + 4, { width: 50 });

        y += 16;
        hrLine(doc, y, "#F1F5F9");
      }

      if (invoices.length === 0) {
        doc.fillColor("#9CA3AF").fontSize(10).font("Helvetica")
          .text("No invoices found for the selected filters.", 40, y + 10, { align: "center", width: CONTENT_W });
        y += 30;
      }

    } else {
      // ── Fetch transactions ─────────────────────────────────────────────
      const conditions = [];
      if (dateFrom) conditions.push(gte(transactionsTable.paidAt, new Date(dateFrom)));
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        conditions.push(lte(transactionsTable.paidAt, end));
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const txns = await db.select().from(transactionsTable).where(where).orderBy(transactionsTable.paidAt);

      const allStudents = await db.select({ id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
        .from(studentsTable);
      const studentMap = new Map(allStudents.map(s => [s.id, `${s.firstName} ${s.lastName}`]));

      const totalCollected = txns.reduce((s, t) => s + parseFloat(t.amountPaid), 0);
      const methodBreakdown = txns.reduce((acc, t) => {
        acc[t.method] = (acc[t.method] ?? 0) + parseFloat(t.amountPaid);
        return acc;
      }, {} as Record<string, number>);

      // ── Summary cards ──────────────────────────────────────────────────
      const cardW = (CONTENT_W - 8) / 3;
      const summaryCards = [
        { label: "Total Transactions", value: String(txns.length), color: "#4F46E5" },
        { label: "Total Collected", value: formatCurrency(totalCollected), color: "#059669" },
        { label: "Avg per Transaction", value: txns.length ? formatCurrency(totalCollected / txns.length) : "—", color: "#0EA5E9" },
      ];
      summaryCards.forEach((card, i) => {
        const cx = 40 + i * (cardW + 4);
        doc.rect(cx, y, cardW, 44).fill("#F8FAFC").stroke("#E2E8F0");
        doc.rect(cx, y, 3, 44).fill(card.color);
        doc.fillColor("#6B7280").fontSize(7).font("Helvetica")
          .text(card.label.toUpperCase(), cx + 8, y + 8, { width: cardW - 12 });
        doc.fillColor("#111827").fontSize(10).font("Helvetica-Bold")
          .text(card.value, cx + 8, y + 21, { width: cardW - 12 });
      });
      y += 54;

      // Method breakdown
      const breakdown = Object.entries(methodBreakdown)
        .map(([m, v]) => `${m.replace("_", " ")}: ${formatCurrency(v)}`).join("  ·  ");
      if (breakdown) {
        doc.fontSize(8).font("Helvetica").fillColor("#6B7280").text(breakdown, 40, y);
        y += 16;
      }
      hrLine(doc, y);
      y += 10;

      // ── Table header ──────────────────────────────────────────────────
      doc.rect(40, y, CONTENT_W, 18).fill("#F1F5F9");
      const TXN_COLS = [
        { text: "STUDENT", x: 40, width: 130, align: "left" as const },
        { text: "INVOICE #", x: 174, width: 60, align: "left" as const },
        { text: "AMOUNT", x: 238, width: 80, align: "right" as const },
        { text: "METHOD", x: 322, width: 100, align: "left" as const },
        { text: "TRANSACTION ID", x: 426, width: 100, align: "left" as const },
        { text: "DATE", x: 530, width: 75, align: "left" as const },
      ];
      tableRow(doc, TXN_COLS, y + 5, 7, "#6B7280");
      y += 20;

      for (const txn of txns) {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = 40;
          doc.rect(40, y, CONTENT_W, 18).fill("#F1F5F9");
          tableRow(doc, TXN_COLS, y + 5, 7, "#6B7280");
          y += 20;
        }

        const rowColor = txns.indexOf(txn) % 2 === 0 ? "#FFFFFF" : "#F9FAFB";
        doc.rect(40, y, CONTENT_W, 16).fill(rowColor);

        doc.fontSize(7.5).font("Helvetica").fillColor("#1F2937")
          .text(studentMap.get(txn.studentId) ?? "Unknown", 40, y + 4, { width: 130 })
          .text(`#${txn.invoiceId}`, 174, y + 4, { width: 60 });
        doc.fillColor("#059669").font("Helvetica-Bold")
          .text(parseFloat(txn.amountPaid).toFixed(2), 238, y + 4, { width: 80, align: "right" });
        doc.fillColor("#1F2937").font("Helvetica")
          .text(txn.method.replace(/_/g, " "), 322, y + 4, { width: 100 })
          .text(txn.transactionId ?? "-", 426, y + 4, { width: 100 })
          .text(new Date(txn.paidAt).toLocaleDateString("en-US", { dateStyle: "short" }), 530, y + 4, { width: 75 });

        y += 16;
        hrLine(doc, y, "#F1F5F9");
      }

      if (txns.length === 0) {
        doc.fillColor("#9CA3AF").fontSize(10).font("Helvetica")
          .text("No transactions found for the selected filters.", 40, y + 10, { align: "center", width: CONTENT_W });
        y += 30;
      }
    }

    // ── Footer on every page ───────────────────────────────────────────────
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 28;
      hrLine(doc, footerY - 4);
      doc.fontSize(7).fillColor("#9CA3AF").font("Helvetica")
        .text(`Smart School ERP  ·  Confidential`, 40, footerY, { width: CONTENT_W / 2 })
        .text(`Page ${i + 1} of ${pageCount}`, 40, footerY, { width: CONTENT_W, align: "right" });
    }

    doc.end();
  },
);

export default router;
