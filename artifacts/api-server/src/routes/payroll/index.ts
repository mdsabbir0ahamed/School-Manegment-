import { Router } from "express";
import { db } from "@workspace/db";
import {
  payrollRecordsTable,
  payrollDeductionsTable,
  usersTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAdmin, requireFinance } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import PDFDocument from "pdfkit";

const router = Router();

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmt(n: string | number) {
  return parseFloat(String(n)).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// ── List payroll records ───────────────────────────────────────────────────
router.get("/payroll", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const month = req.query["month"] ? parseInt(String(req.query["month"])) : undefined;
  const year = req.query["year"] ? parseInt(String(req.query["year"])) : undefined;
  const status = req.query["status"] ? String(req.query["status"]) : undefined;

  const conditions = [];
  if (month) conditions.push(eq(payrollRecordsTable.month, month));
  if (year) conditions.push(eq(payrollRecordsTable.year, year));
  if (status && status !== "all") conditions.push(eq(payrollRecordsTable.status, status as any));
  const where = conditions.length ? and(...conditions) : undefined;

  const records = await db
    .select({
      id: payrollRecordsTable.id,
      userId: payrollRecordsTable.userId,
      month: payrollRecordsTable.month,
      year: payrollRecordsTable.year,
      basicSalary: payrollRecordsTable.basicSalary,
      allowances: payrollRecordsTable.allowances,
      deductions: payrollRecordsTable.deductions,
      grossSalary: payrollRecordsTable.grossSalary,
      netSalary: payrollRecordsTable.netSalary,
      status: payrollRecordsTable.status,
      notes: payrollRecordsTable.notes,
      paidAt: payrollRecordsTable.paidAt,
      createdAt: payrollRecordsTable.createdAt,
      staffName: usersTable.firstName,
      staffLastName: usersTable.lastName,
      staffEmail: usersTable.email,
      staffRole: usersTable.role,
    })
    .from(payrollRecordsTable)
    .innerJoin(usersTable, eq(payrollRecordsTable.userId, usersTable.id))
    .where(where)
    .orderBy(desc(payrollRecordsTable.createdAt));

  const enriched = records.map(r => ({
    ...r,
    staffName: `${r.staffName} ${r.staffLastName}`,
    basicSalary: parseFloat(r.basicSalary),
    allowances: parseFloat(r.allowances),
    deductions: parseFloat(r.deductions),
    grossSalary: parseFloat(r.grossSalary),
    netSalary: parseFloat(r.netSalary),
  }));

  res.json({ records: enriched, total: enriched.length });
});

// ── Create single payroll record ───────────────────────────────────────────
router.post("/payroll", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const { userId, month, year, basicSalary, allowances = 0, deductions = 0, notes } = req.body;

  if (!userId || !month || !year || !basicSalary) {
    res.status(400).json({ error: "userId, month, year, and basicSalary are required" });
    return;
  }

  const existing = await db
    .select({ id: payrollRecordsTable.id })
    .from(payrollRecordsTable)
    .where(and(
      eq(payrollRecordsTable.userId, userId),
      eq(payrollRecordsTable.month, month),
      eq(payrollRecordsTable.year, year),
    ));

  if (existing.length > 0) {
    res.status(409).json({ error: "Payroll record already exists for this staff member and month" });
    return;
  }

  const gross = parseFloat(basicSalary) + parseFloat(allowances);
  const net = gross - parseFloat(deductions);

  const [record] = await db.insert(payrollRecordsTable).values({
    userId,
    month,
    year,
    basicSalary: String(basicSalary),
    allowances: String(allowances),
    deductions: String(deductions),
    grossSalary: String(gross),
    netSalary: String(net),
    notes,
    status: "DRAFT",
  }).returning();

  await audit({
    userId: req.userId,
    action: "CREATE",
    entity: "payroll",
    entityId: record!.id,
    description: `Created payroll for userId=${userId} (${MONTH_NAMES[month]} ${year})`,
  });

  res.status(201).json(record);
});

// ── Bulk generate payroll for a month ─────────────────────────────────────
router.post("/payroll/generate", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { month, year, defaultBasicSalary = 20000 } = req.body;

  if (!month || !year) {
    res.status(400).json({ error: "month and year are required" });
    return;
  }

  const staffUsers = await db
    .select({ id: usersTable.id, firstName: usersTable.firstName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.isActive, true));

  const staffOnly = staffUsers.filter(u =>
    ["SUPER_ADMIN", "TEACHER", "ACCOUNTANT"].includes(u.role),
  );

  const existing = await db
    .select({ userId: payrollRecordsTable.userId })
    .from(payrollRecordsTable)
    .where(and(eq(payrollRecordsTable.month, month), eq(payrollRecordsTable.year, year)));

  const existingIds = new Set(existing.map(e => e.userId));
  const toCreate = staffOnly.filter(s => !existingIds.has(s.id));

  const gross = parseFloat(defaultBasicSalary);
  const created = await Promise.all(
    toCreate.map(s =>
      db.insert(payrollRecordsTable).values({
        userId: s.id,
        month,
        year,
        basicSalary: String(defaultBasicSalary),
        allowances: "0",
        deductions: "0",
        grossSalary: String(gross),
        netSalary: String(gross),
        status: "DRAFT",
      }).returning(),
    ),
  );

  await audit({
    userId: req.userId,
    action: "CREATE",
    entity: "payroll",
    entityId: 0,
    description: `Bulk generated ${created.length} payroll records for ${MONTH_NAMES[month]} ${year}`,
  });

  res.status(201).json({ created: created.length, skipped: existingIds.size });
});

// ── Update payroll record ──────────────────────────────────────────────────
router.put("/payroll/:id", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]));
  const { basicSalary, allowances = 0, deductions = 0, notes } = req.body;

  const gross = parseFloat(basicSalary) + parseFloat(allowances);
  const net = gross - parseFloat(deductions);

  const [record] = await db
    .update(payrollRecordsTable)
    .set({
      basicSalary: String(basicSalary),
      allowances: String(allowances),
      deductions: String(deductions),
      grossSalary: String(gross),
      netSalary: String(net),
      notes,
      updatedAt: new Date(),
    })
    .where(eq(payrollRecordsTable.id, id))
    .returning();

  if (!record) { res.status(404).json({ error: "Payroll record not found" }); return; }

  await audit({
    userId: req.userId,
    action: "UPDATE",
    entity: "payroll",
    entityId: id,
    description: `Updated payroll record #${id}`,
  });

  res.json(record);
});

// ── Approve payroll ────────────────────────────────────────────────────────
router.patch("/payroll/:id/approve", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]));
  const [record] = await db
    .update(payrollRecordsTable)
    .set({ status: "APPROVED", updatedAt: new Date() })
    .where(eq(payrollRecordsTable.id, id))
    .returning();

  if (!record) { res.status(404).json({ error: "Not found" }); return; }
  await audit({ userId: req.userId, action: "UPDATE", entity: "payroll", entityId: id, description: `Approved payroll #${id}` });
  res.json(record);
});

// ── Mark paid ─────────────────────────────────────────────────────────────
router.patch("/payroll/:id/mark-paid", requireAuth, requireFinance, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]));
  const [record] = await db
    .update(payrollRecordsTable)
    .set({ status: "PAID", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(payrollRecordsTable.id, id))
    .returning();

  if (!record) { res.status(404).json({ error: "Not found" }); return; }
  await audit({ userId: req.userId, action: "UPDATE", entity: "payroll", entityId: id, description: `Marked payroll #${id} as PAID` });
  res.json(record);
});

// ── Delete payroll (DRAFT only) ────────────────────────────────────────────
router.delete("/payroll/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]));
  const [existing] = await db.select().from(payrollRecordsTable).where(eq(payrollRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status !== "DRAFT") {
    res.status(400).json({ error: "Only DRAFT payroll records can be deleted" });
    return;
  }
  await db.delete(payrollRecordsTable).where(eq(payrollRecordsTable.id, id));
  await audit({ userId: req.userId, action: "DELETE", entity: "payroll", entityId: id, description: `Deleted payroll record #${id}` });
  res.json({ success: true });
});

// ── Payslip PDF ────────────────────────────────────────────────────────────
router.get("/payroll/:id/payslip", requireAuth, requireFinance, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]));

  const [row] = await db
    .select({
      id: payrollRecordsTable.id,
      month: payrollRecordsTable.month,
      year: payrollRecordsTable.year,
      basicSalary: payrollRecordsTable.basicSalary,
      allowances: payrollRecordsTable.allowances,
      deductions: payrollRecordsTable.deductions,
      grossSalary: payrollRecordsTable.grossSalary,
      netSalary: payrollRecordsTable.netSalary,
      status: payrollRecordsTable.status,
      notes: payrollRecordsTable.notes,
      paidAt: payrollRecordsTable.paidAt,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      role: usersTable.role,
    })
    .from(payrollRecordsTable)
    .innerJoin(usersTable, eq(payrollRecordsTable.userId, usersTable.id))
    .where(eq(payrollRecordsTable.id, id));

  if (!row) { res.status(404).json({ error: "Payroll record not found" }); return; }

  const [tenant] = await db.select().from(tenantsTable).limit(1);
  const schoolName = tenant?.name ?? "Smart School ERP";
  const monthName = MONTH_NAMES[row.month] ?? String(row.month);

  const doc = new PDFDocument({ margin: 50, size: "A4", bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="payslip-${row.firstName.toLowerCase()}-${monthName.toLowerCase()}-${row.year}.pdf"`,
  );
  doc.pipe(res);

  const PRIMARY = "#4F46E5";
  const PAGE_W = doc.page.width;
  const CONTENT_W = PAGE_W - 100;

  // Header
  doc.rect(0, 0, PAGE_W, 80).fill(PRIMARY);
  doc.fillColor("#FFFFFF").fontSize(20).font("Helvetica-Bold")
    .text(schoolName, 50, 20, { width: CONTENT_W });
  doc.fontSize(11).font("Helvetica")
    .text("SALARY SLIP / PAYSLIP", 50, 48, { width: CONTENT_W });

  // Pay period & status badge
  const statusColor: Record<string, string> = { DRAFT: "#D97706", APPROVED: "#4F46E5", PAID: "#059669" };
  doc.rect(0, 80, PAGE_W, 36).fill("#F1F5F9");
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#374151")
    .text(`Pay Period: ${monthName} ${row.year}`, 50, 92, { width: CONTENT_W / 2 });
  const sc = statusColor[row.status] ?? "#6B7280";
  doc.fillColor(sc)
    .text(`Status: ${row.status}${row.status === "PAID" && row.paidAt ? `  (Paid: ${new Date(row.paidAt).toLocaleDateString("en-US", { dateStyle: "medium" })})` : ""}`,
      50, 92, { width: CONTENT_W, align: "right" });

  let y = 136;

  // Employee details box
  doc.rect(50, y, CONTENT_W, 72).fill("#F8FAFC").stroke("#E2E8F0");
  doc.rect(50, y, 3, 72).fill(PRIMARY);
  doc.fontSize(8).fillColor("#6B7280").font("Helvetica")
    .text("EMPLOYEE NAME", 60, y + 10)
    .text("EMAIL ADDRESS", 60, y + 28)
    .text("DESIGNATION", 60, y + 46);
  doc.fontSize(10).fillColor("#111827").font("Helvetica-Bold")
    .text(`${row.firstName} ${row.lastName}`, 175, y + 9)
    .text(row.email, 175, y + 27)
    .text(row.role.replace("_", " "), 175, y + 45);

  y += 90;

  // Earnings / Deductions side by side
  const COL_W = (CONTENT_W - 12) / 2;

  // Earnings
  doc.rect(50, y, COL_W, 24).fill(PRIMARY);
  doc.fillColor("#FFFFFF").fontSize(9).font("Helvetica-Bold")
    .text("EARNINGS", 58, y + 8, { width: COL_W - 16 });

  let ey = y + 28;
  const earnings = [
    { label: "Basic Salary", value: row.basicSalary },
    { label: "Allowances", value: row.allowances },
  ];
  for (const e of earnings) {
    doc.rect(50, ey, COL_W, 22).fill(ey % 2 === 0 ? "#FFFFFF" : "#F9FAFB");
    doc.fillColor("#374151").fontSize(9).font("Helvetica")
      .text(e.label, 58, ey + 6, { width: COL_W / 2 });
    doc.fillColor("#059669").font("Helvetica-Bold")
      .text(`BDT ${fmt(e.value)}`, 58, ey + 6, { width: COL_W - 16, align: "right" });
    ey += 22;
  }
  doc.rect(50, ey, COL_W, 26).fill("#ECFDF5");
  doc.fillColor("#065F46").fontSize(9).font("Helvetica-Bold")
    .text("GROSS SALARY", 58, ey + 8, { width: COL_W / 2 });
  doc.fillColor("#059669")
    .text(`BDT ${fmt(row.grossSalary)}`, 58, ey + 8, { width: COL_W - 16, align: "right" });

  // Deductions
  const dx = 50 + COL_W + 12;
  doc.rect(dx, y, COL_W, 24).fill("#DC2626");
  doc.fillColor("#FFFFFF").fontSize(9).font("Helvetica-Bold")
    .text("DEDUCTIONS", dx + 8, y + 8, { width: COL_W - 16 });

  let dy = y + 28;
  doc.rect(dx, dy, COL_W, 22).fill("#FFFFFF");
  doc.fillColor("#374151").fontSize(9).font("Helvetica")
    .text("Total Deductions", dx + 8, dy + 6, { width: COL_W / 2 });
  doc.fillColor("#DC2626").font("Helvetica-Bold")
    .text(`BDT ${fmt(row.deductions)}`, dx + 8, dy + 6, { width: COL_W - 16, align: "right" });
  dy += 22;

  if (row.notes) {
    doc.rect(dx, dy, COL_W, 22).fill("#F9FAFB");
    doc.fillColor("#6B7280").fontSize(8).font("Helvetica")
      .text(`Note: ${row.notes}`, dx + 8, dy + 6, { width: COL_W - 16 });
    dy += 22;
  }

  y = Math.max(ey + 26, dy) + 16;

  // Net Salary banner
  doc.rect(50, y, CONTENT_W, 50).fill(PRIMARY);
  doc.fillColor("#A5B4FC").fontSize(10).font("Helvetica")
    .text("NET SALARY (TAKE-HOME PAY)", 66, y + 10);
  doc.fillColor("#FFFFFF").fontSize(22).font("Helvetica-Bold")
    .text(`BDT ${fmt(row.netSalary)}`, 66, y + 24, { width: CONTENT_W - 32, align: "right" });

  y += 70;

  // Footer note
  doc.fontSize(8).fillColor("#9CA3AF").font("Helvetica")
    .text("This is a computer-generated payslip and does not require a signature.", 50, y, { width: CONTENT_W, align: "center" });

  // Page footer
  const footerY = doc.page.height - 28;
  doc.moveTo(50, footerY - 4).lineTo(PAGE_W - 50, footerY - 4).strokeColor("#E2E8F0").lineWidth(0.5).stroke();
  doc.fontSize(7).fillColor("#9CA3AF")
    .text(`${schoolName}  ·  Confidential`, 50, footerY, { width: CONTENT_W / 2 })
    .text(`Generated: ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`, 50, footerY, { width: CONTENT_W, align: "right" });

  doc.end();
});

export default router;
