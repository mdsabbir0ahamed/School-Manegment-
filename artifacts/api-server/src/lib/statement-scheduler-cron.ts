import { db } from "@workspace/db";
import {
  feeStatementScheduleTable,
  feeStatementLogsTable,
  studentsTable,
  invoicesTable,
  transactionsTable,
  feeTypesTable,
  classesTable,
  tenantsTable,
  usersTable,
  parentStudentsTable,
} from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendMail, sendMailWithConfig, type SmtpConfig } from "./mailer.js";
import PDFDocument from "pdfkit";

async function getOrCreateSchedule() {
  const [existing] = await db
    .select()
    .from(feeStatementScheduleTable)
    .where(eq(feeStatementScheduleTable.tenantId, 1))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(feeStatementScheduleTable)
    .values({ tenantId: 1 })
    .returning();

  return created!;
}

async function generateStatementPdf(studentId: number): Promise<Buffer> {
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
  if (!student) throw new Error(`Student ${studentId} not found`);

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

  const txns = await db.select().from(transactionsTable)
    .where(eq(transactionsTable.studentId, studentId)).orderBy(asc(transactionsTable.paidAt));

  const totalInvoiced    = invoices.reduce((s, i) => s + parseFloat(i.totalAmount), 0);
  const totalPaid        = invoices.reduce((s, i) => s + parseFloat(i.paidAmount), 0);
  const totalOutstanding = invoices
    .filter(i => i.status !== "CANCELLED")
    .reduce((s, i) => s + Math.max(0, parseFloat(i.totalAmount) - parseFloat(i.paidAmount)), 0);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const BRAND = "#4F46E5";
    doc.rect(0, 0, doc.page.width, 90).fill(BRAND);
    doc.fillColor("white").fontSize(20).font("Helvetica-Bold").text("SchoolERP", 50, 28);
    doc.fontSize(10).font("Helvetica").fillColor("rgba(255,255,255,0.85)").text("Monthly Fee Statement", 50, 52);
    doc.fillColor("white").fontSize(9)
      .text(`Generated: ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`, 50, 68);

    let y = 110;
    doc.roundedRect(50, y, 495, 80, 6).fillAndStroke("#F8F7FF", "#E0DCFF");
    doc.fillColor("#1E1B4B").fontSize(13).font("Helvetica-Bold")
      .text(`${student.firstName} ${student.lastName}`, 65, y + 12);
    doc.fillColor("#4338CA").fontSize(9).font("Helvetica").text(`ID: ${student.studentId}`, 65, y + 28);
    if (className) doc.text(`Class: ${className}`, 65, y + 42);
    doc.fillColor("#6B7280").fontSize(9).text(`Admission: ${student.admissionDate}`, 65, y + 56);
    if (student.parentName) doc.text(`Parent/Guardian: ${student.parentName}`, 300, y + 12);
    if (student.parentEmail) doc.text(`Email: ${student.parentEmail}`, 300, y + 28);
    y += 100;

    const boxes = [
      { label: "Total Invoiced", value: `BDT ${totalInvoiced.toLocaleString()}`,    color: "#EEF2FF", border: "#C7D2FE", text: "#3730A3" },
      { label: "Total Paid",     value: `BDT ${totalPaid.toLocaleString()}`,         color: "#F0FDF4", border: "#BBF7D0", text: "#166534" },
      { label: "Outstanding",    value: `BDT ${totalOutstanding.toLocaleString()}`,  color: "#FFF7ED", border: "#FED7AA", text: totalOutstanding > 0 ? "#9A3412" : "#166534" },
    ];
    const bw = 152;
    boxes.forEach((b, i) => {
      const bx = 50 + i * (bw + 10);
      doc.roundedRect(bx, y, bw, 54, 5).fillAndStroke(b.color, b.border);
      doc.fillColor(b.text).fontSize(9).font("Helvetica").text(b.label, bx + 10, y + 10);
      doc.fontSize(16).font("Helvetica-Bold").text(b.value, bx + 10, y + 24, { width: bw - 20 });
    });
    y += 74;

    doc.fillColor(BRAND).fontSize(11).font("Helvetica-Bold").text("Invoice History", 50, y);
    y += 18;
    const cols = { num: 50, fee: 155, month: 255, total: 320, paid: 380, status: 445 };
    const headers = ["Invoice No.", "Fee Type", "Month", "Total", "Paid", "Status"];
    const colX = Object.values(cols);
    doc.rect(50, y, 495, 20).fill(BRAND);
    doc.fillColor("white").fontSize(7.5).font("Helvetica-Bold");
    headers.forEach((h, i) => doc.text(h, colX[i]! + 3, y + 6, { width: 100 }));
    y += 20;

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i]!;
      doc.rect(50, y, 495, 18).fill(i % 2 === 0 ? "#FAFAFA" : "white");
      const sc: Record<string, string> = { PAID: "#166534", PENDING: "#92400E", OVERDUE: "#991B1B", CANCELLED: "#6B7280" };
      doc.fillColor("#374151").fontSize(7.5).font("Helvetica");
      doc.text(inv.invoiceNumber, cols.num + 3, y + 5, { width: 100 });
      doc.text(feeTypeMap.get(inv.feeTypeId) ?? "—", cols.fee + 3, y + 5, { width: 95 });
      doc.text(inv.month ?? "—", cols.month + 3, y + 5, { width: 60 });
      doc.text(parseFloat(inv.totalAmount).toLocaleString(), cols.total + 3, y + 5, { width: 55 });
      doc.fillColor("#166534").text(parseFloat(inv.paidAmount).toLocaleString(), cols.paid + 3, y + 5, { width: 55 });
      doc.fillColor(sc[inv.status] ?? "#374151").font("Helvetica-Bold").text(inv.status, cols.status + 3, y + 5, { width: 55 });
      y += 18;
      if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
    }

    if (txns.length > 0) {
      y += 16;
      if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
      doc.fillColor(BRAND).fontSize(11).font("Helvetica-Bold").text("Payment History", 50, y);
      y += 18;
      const tcols = { date: 50, inv: 160, amount: 265, method: 340, txnId: 430 };
      const theaders = ["Date", "Invoice No.", "Amount", "Method", "Reference"];
      const tcolX = Object.values(tcols);
      doc.rect(50, y, 495, 20).fill(BRAND);
      doc.fillColor("white").fontSize(7.5).font("Helvetica-Bold");
      theaders.forEach((h, i) => doc.text(h, tcolX[i]! + 3, y + 6, { width: 100 }));
      y += 20;
      for (let i = 0; i < txns.length; i++) {
        const tx = txns[i]!;
        doc.rect(50, y, 495, 18).fill(i % 2 === 0 ? "#FAFAFA" : "white");
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

    const pageCount = (doc as any).bufferedPageRange?.()?.count ?? 1;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fillColor("#9CA3AF").fontSize(7.5).font("Helvetica")
        .text(`SchoolERP · Confidential · Page ${i + 1} of ${pageCount}`, 50, doc.page.height - 35, { align: "center", width: 495 });
    }
    doc.end();
  });
}

export async function runStatementSchedulerCron(force = false): Promise<{
  sent: number; skipped: boolean; errors: number; skippedNoEmail: number;
}> {
  const schedule = await getOrCreateSchedule();

  if (!schedule.isEnabled && !force) {
    return { sent: 0, skipped: true, errors: 0, skippedNoEmail: 0 };
  }

  const now = new Date();
  if (!force) {
    if (now.getDate() !== schedule.dayOfMonth) {
      return { sent: 0, skipped: true, errors: 0, skippedNoEmail: 0 };
    }
    if (now.getHours() !== schedule.hour) {
      return { sent: 0, skipped: true, errors: 0, skippedNoEmail: 0 };
    }
    if (schedule.lastRunAt) {
      const lastDay = schedule.lastRunAt.toISOString().split("T")[0];
      const today   = now.toISOString().split("T")[0];
      if (lastDay === today) {
        logger.info({ lastDay }, "Statement scheduler skipped — already ran today");
        return { sent: 0, skipped: true, errors: 0, skippedNoEmail: 0 };
      }
    }
  }

  logger.info("Statement scheduler starting");

  const [tenant] = await db.select().from(tenantsTable).limit(1);
  const schoolName = tenant?.name ?? "SchoolERP";

  const dbSmtp = tenant?.smtpHost && tenant.smtpUser && tenant.smtpPass
    ? {
        host: tenant.smtpHost,
        port: tenant.smtpPort ?? 587,
        user: tenant.smtpUser,
        pass: tenant.smtpPass,
        from: tenant.smtpFrom ?? `"${schoolName}" <no-reply@school.edu>`,
        secure: tenant.smtpSecure ?? false,
      } satisfies SmtpConfig
    : null;

  const students = await db
    .select({
      id: studentsTable.id,
      studentId: studentsTable.studentId,
      firstName: studentsTable.firstName,
      lastName: studentsTable.lastName,
      parentName: studentsTable.parentName,
      parentEmail: studentsTable.parentEmail,
    })
    .from(studentsTable)
    .where(eq(studentsTable.status, "ACTIVE"));

  let totalSent = 0;
  let totalErrors = 0;
  let totalSkippedNoEmail = 0;

  for (const student of students) {
    try {
      // Resolve recipient email: linked parent account → student.parentEmail → skip
      const [linkedParent] = await db
        .select({ email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(parentStudentsTable)
        .innerJoin(usersTable, eq(parentStudentsTable.parentUserId, usersTable.id))
        .where(eq(parentStudentsTable.studentId, student.id))
        .limit(1);

      const recipientEmail = linkedParent?.email ?? student.parentEmail ?? null;
      const recipientName  = linkedParent
        ? `${linkedParent.firstName} ${linkedParent.lastName}`
        : (student.parentName ?? "Parent/Guardian");

      if (!recipientEmail) {
        totalSkippedNoEmail++;
        continue;
      }

      const [invoices] = await Promise.all([
        db.select().from(invoicesTable).where(eq(invoicesTable.studentId, student.id)),
      ]);
      const totalInvoiced    = invoices.reduce((s, i) => s + parseFloat(i.totalAmount), 0);
      const totalPaid        = invoices.reduce((s, i) => s + parseFloat(i.paidAmount), 0);
      const totalOutstanding = invoices
        .filter(i => i.status !== "CANCELLED")
        .reduce((s, i) => s + Math.max(0, parseFloat(i.totalAmount) - parseFloat(i.paidAmount)), 0);

      const pdfBuffer = await generateStatementPdf(student.id);

      const dateLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const mailPayload = {
        to: recipientEmail,
        subject: `Monthly Fee Statement — ${student.firstName} ${student.lastName} — ${dateLabel}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
            <div style="background:#4F46E5;padding:20px 24px;border-radius:8px 8px 0 0">
              <h1 style="color:#fff;margin:0;font-size:20px">${schoolName}</h1>
              <p style="color:#c7d2fe;margin:4px 0 0;font-size:13px">Monthly Fee Statement — ${dateLabel}</p>
            </div>
            <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
              <p style="margin:0 0 16px">Dear <strong>${recipientName}</strong>,</p>
              <p style="margin:0 0 16px">Please find attached the monthly fee statement for <strong>${student.firstName} ${student.lastName}</strong>.</p>
              <table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px">
                <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;width:40%">Student</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">${student.firstName} ${student.lastName} (${student.studentId})</td></tr>
                <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280">Total Invoiced</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">BDT ${totalInvoiced.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td></tr>
                <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280">Total Paid</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;color:#059669">BDT ${totalPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td></tr>
                <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280">Outstanding</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;color:${totalOutstanding > 0 ? "#dc2626" : "#059669"}">BDT ${totalOutstanding.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td></tr>
                <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280">Statement Month</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${dateLabel}</td></tr>
              </table>
              <p style="margin:0;font-size:12px;color:#9ca3af">This is an automated monthly statement from ${schoolName}. Please do not reply to this email.</p>
            </div>
          </div>
        `,
        attachments: [
          {
            filename: `fee-statement-${student.studentId}-${now.toISOString().slice(0, 7)}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      };

      const result = dbSmtp
        ? await sendMailWithConfig(dbSmtp, mailPayload)
        : await sendMail(mailPayload);

      await db.insert(feeStatementLogsTable).values({
        studentId: student.id,
        triggeredByUserId: null,
        action: "EMAIL_SENT",
        sentTo: recipientEmail,
        deliveryMode: result.deliveryMode,
      }).catch(() => {});

      totalSent++;
      logger.info({ studentId: student.id, sentTo: recipientEmail }, "Scheduled statement sent");
    } catch (err) {
      logger.error({ err, studentId: student.id }, "Failed to send scheduled statement");
      totalErrors++;
    }
  }

  await db
    .update(feeStatementScheduleTable)
    .set({ lastRunAt: now, lastRunCount: totalSent, lastRunErrors: totalErrors, updatedAt: now })
    .where(eq(feeStatementScheduleTable.tenantId, 1));

  logger.info({ totalSent, totalErrors, totalSkippedNoEmail }, "Statement scheduler completed");
  return { sent: totalSent, skipped: false, errors: totalErrors, skippedNoEmail: totalSkippedNoEmail };
}

export function startStatementSchedulerCron(): void {
  runStatementSchedulerCron().catch(err =>
    logger.error({ err }, "Statement scheduler initial run failed"),
  );
  setInterval(() => {
    runStatementSchedulerCron().catch(err =>
      logger.error({ err }, "Statement scheduler cron failed"),
    );
  }, 60 * 60 * 1000); // every hour
  logger.info("Statement scheduler cron started (runs hourly, fires once on matching day/hour)");
}
