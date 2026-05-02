import { Router } from "express";
import { db } from "@workspace/db";
import {
  studentsTable, usersTable, classesTable,
  attendanceTable, invoicesTable, transactionsTable,
  notificationsTable,
} from "@workspace/db";
import { eq, count, sum, and, gte, sql } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import OpenAI from "openai";
import { logger } from "../../lib/logger.js";

const router = Router();

const openai = new OpenAI({
  apiKey: process.env["AI_INTEGRATIONS_OPENAI_API_KEY"],
  baseURL: process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"],
});

router.get("/dashboard/ai-summary", requireAuth, async (_req, res): Promise<void> => {
  try {
    const today = new Date().toISOString().split("T")[0]!;
    const monthStart = `${today.slice(0, 7)}-01`;

    const [
      totalStudents, todayPresent, todayAbsent, todayLate, todayTotal,
      pendingInvoices, overdueInvoices, monthRevenue,
      newAdmissions, totalTeachers,
    ] = await Promise.all([
      db.select({ c: count() }).from(studentsTable).where(eq(studentsTable.status, "ACTIVE")),
      db.select({ c: count() }).from(attendanceTable).where(and(eq(attendanceTable.date, today), eq(attendanceTable.status, "PRESENT"))),
      db.select({ c: count() }).from(attendanceTable).where(and(eq(attendanceTable.date, today), eq(attendanceTable.status, "ABSENT"))),
      db.select({ c: count() }).from(attendanceTable).where(and(eq(attendanceTable.date, today), eq(attendanceTable.status, "LATE"))),
      db.select({ c: count() }).from(attendanceTable).where(eq(attendanceTable.date, today)),
      db.select({ c: count() }).from(invoicesTable).where(eq(invoicesTable.status, "PENDING")),
      db.select({ c: count() }).from(invoicesTable).where(eq(invoicesTable.status, "OVERDUE")),
      db.select({ t: sum(transactionsTable.amountPaid) }).from(transactionsTable).where(gte(transactionsTable.paidAt, new Date(monthStart))),
      db.select({ c: count() }).from(studentsTable).where(gte(studentsTable.admissionDate, monthStart)),
      db.select({ c: count() }).from(usersTable).where(eq(usersTable.role, "TEACHER")),
    ]);

    const ts = totalStudents[0]?.c ?? 0;
    const tp = todayPresent[0]?.c ?? 0;
    const ta = todayAbsent[0]?.c ?? 0;
    const tl = todayLate[0]?.c ?? 0;
    const tt = todayTotal[0]?.c ?? 0;
    const attRate = tt > 0 ? Math.round((tp / tt) * 100) : 0;
    const rev = parseFloat(monthRevenue[0]?.t ?? "0");
    const pi = pendingInvoices[0]?.c ?? 0;
    const oi = overdueInvoices[0]?.c ?? 0;
    const na = newAdmissions[0]?.c ?? 0;
    const teachers = totalTeachers[0]?.c ?? 0;

    const dateStr = new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    const prompt = `You are the AI assistant for Smart School ERP system. Generate a concise, professional daily summary for school administrators.

Today is ${dateStr}.

School Data:
- Total active students: ${ts}
- Total teachers: ${teachers}
- Today's attendance: ${tp} present, ${ta} absent, ${tl} late out of ${tt} recorded (${attRate}% attendance rate)
- Pending invoices: ${pi}
- Overdue invoices: ${oi}
- Revenue collected this month: ৳${rev.toLocaleString()}
- New admissions this month: ${na}

Write a 3-4 sentence summary highlighting:
1. Today's attendance situation (is it good, concerning, or normal?)
2. Financial status (pending/overdue invoices, monthly revenue)
3. Any action items or recommendations for the admin

Keep the tone professional and helpful. Use plain text, no markdown formatting.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 2000,
    });

    const choice = completion.choices[0];
    const msg = choice?.message as unknown as Record<string, unknown>;
    const rawContent = msg?.["content"] as string | null | undefined;
    const rawReasoning = msg?.["reasoning_content"] as string | null | undefined;
    const summary = rawContent?.trim() || rawReasoning?.trim() || "Unable to generate summary at this time.";

    res.json({
      summary,
      generatedAt: new Date().toISOString(),
      metrics: {
        totalStudents: ts,
        totalTeachers: teachers,
        attendanceRate: attRate,
        todayPresent: tp,
        todayAbsent: ta,
        todayLate: tl,
        pendingInvoices: pi,
        overdueInvoices: oi,
        monthlyRevenue: rev,
        newAdmissions: na,
      },
    });
  } catch (err) {
    logger.error(err, "AI summary generation failed");
    res.status(500).json({ error: "AI_SUMMARY_FAILED", message: "Could not generate AI summary" });
  }
});

export default router;
