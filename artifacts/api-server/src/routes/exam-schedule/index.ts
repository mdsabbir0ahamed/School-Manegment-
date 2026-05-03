import { Router } from "express";
import { db } from "@workspace/db";
import {
  examScheduleTable, classesTable, subjectsTable, usersTable,
  studentsTable, parentStudentsTable, notificationsTable, tenantsTable,
} from "@workspace/db";
import { eq, desc, inArray, and, gte } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireRole } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { sendMail, sendMailWithConfig, type SmtpConfig } from "../../lib/mailer.js";
import { sseManager } from "../../lib/sse-manager.js";
import { logger } from "../../lib/logger.js";

const router = Router();

const requireStaff     = requireRole("SUPER_ADMIN", "TEACHER");
const requireStaffView = requireRole("SUPER_ADMIN", "TEACHER", "ACCOUNTANT");

const EXAM_TYPE_LABELS: Record<string, string> = {
  MIDTERM: "Midterm", FINAL: "Final", UNIT_TEST: "Unit Test",
  ASSIGNMENT: "Assignment", QUIZ: "Quiz", PRACTICAL: "Practical",
};

// ── Notification helper ───────────────────────────────────────────────────────
async function dispatchExamNotifications(opts: {
  classId: number; className: string; authorName: string;
  title: string; examType: string; examDate: string;
  startTime: string | null; subjectName: string | null; room: string | null;
}): Promise<void> {
  const { classId, className, authorName, title, examType, examDate, startTime, subjectName, room } = opts;

  const [tenant, students] = await Promise.all([
    db.select({
      name: tenantsTable.name,
      smtpHost: tenantsTable.smtpHost, smtpPort: tenantsTable.smtpPort,
      smtpUser: tenantsTable.smtpUser, smtpPass: tenantsTable.smtpPass,
      smtpFrom: tenantsTable.smtpFrom, smtpSecure: tenantsTable.smtpSecure,
    }).from(tenantsTable).limit(1).then(r => r[0] ?? null),
    db.select({
      id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName,
      parentEmail: studentsTable.parentEmail,
    }).from(studentsTable).where(eq(studentsTable.classId, classId)),
  ]);

  if (!students.length) return;

  const schoolName = tenant?.name ?? "Smart School ERP";
  const dbSmtp: SmtpConfig | null =
    tenant?.smtpHost && tenant.smtpUser && tenant.smtpPass
      ? { host: tenant.smtpHost, port: tenant.smtpPort ?? 587, user: tenant.smtpUser, pass: tenant.smtpPass, from: tenant.smtpFrom ?? `"${schoolName}" <no-reply@school.edu>`, secure: tenant.smtpSecure ?? false }
      : null;

  const studentIds = students.map(s => s.id);
  const studentNameMap = new Map(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));
  const typeLabel = EXAM_TYPE_LABELS[examType] ?? examType;
  const dateStr = new Date(examDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortMsg = `${typeLabel}: ${title}${subjectName ? ` (${subjectName})` : ""} — ${dateStr}${startTime ? ` at ${startTime}` : ""}`;

  const [linkedStudentUsers, parentLinks] = await Promise.all([
    db.select({ userId: usersTable.id, linkedStudentId: usersTable.linkedStudentId })
      .from(usersTable).where(inArray(usersTable.linkedStudentId, studentIds)),
    db.select({
      studentId: parentStudentsTable.studentId, parentUserId: parentStudentsTable.parentUserId,
      parentEmail: usersTable.email, parentFirstName: usersTable.firstName, parentLastName: usersTable.lastName,
    }).from(parentStudentsTable)
      .innerJoin(usersTable, eq(usersTable.id, parentStudentsTable.parentUserId))
      .where(inArray(parentStudentsTable.studentId, studentIds)),
  ]);

  // In-app notifications
  const inAppRows: (typeof notificationsTable.$inferInsert)[] = [];
  for (const u of linkedStudentUsers) {
    if (!u.userId) continue;
    inAppRows.push({ userId: u.userId, title: `📅 Exam Scheduled — ${className}`, message: shortMsg, type: "WARNING" as const, link: "/student" });
  }
  const seenParents = new Set<number>();
  for (const p of parentLinks) {
    if (seenParents.has(p.parentUserId)) continue;
    seenParents.add(p.parentUserId);
    const sName = studentNameMap.get(p.studentId) ?? "";
    inAppRows.push({ userId: p.parentUserId, title: `📅 Exam for ${sName}`, message: shortMsg, type: "WARNING" as const, link: "/parent" });
  }
  if (inAppRows.length) await db.insert(notificationsTable).values(inAppRows);

  // SSE push
  const allUserIds = new Set<number>();
  for (const u of linkedStudentUsers) { if (u.userId) allUserIds.add(u.userId); }
  for (const p of parentLinks) { allUserIds.add(p.parentUserId); }
  for (const uid of allUserIds) {
    sseManager.sendToUser(uid, "update", { notification: { title: "📅 Exam Scheduled", message: shortMsg, type: "WARNING" }, unreadBump: true });
  }

  // Email
  function buildHtml(recipientName: string, studentName: string): string {
    return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:24px">
      <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
        <div style="border-bottom:1px solid #e5e7eb;padding-bottom:20px;margin-bottom:24px">
          <h2 style="margin:0;font-size:18px;color:#111827">${schoolName}</h2>
          <p style="margin:2px 0 0;font-size:13px;color:#6b7280">Exam Notice — ${className}</p>
        </div>
        <p style="color:#374151;font-size:14px;margin:0 0 16px">Dear ${recipientName},</p>
        <div style="background:#fff7ed;border-left:4px solid #f97316;border-radius:6px;padding:16px;margin:0 0 20px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <span style="font-size:24px">📅</span>
            <div>
              <p style="margin:0;font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:.05em">${typeLabel}</p>
              <h3 style="margin:0;color:#111827;font-size:17px">${title}</h3>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            ${subjectName ? `<tr><td style="padding:6px 0;color:#6b7280;width:35%">Subject</td><td style="padding:6px 0;font-weight:600;color:#111827">${subjectName}</td></tr>` : ""}
            <tr><td style="padding:6px 0;color:#6b7280">Date</td><td style="padding:6px 0;font-weight:700;color:#dc2626">${dateStr}</td></tr>
            ${startTime ? `<tr><td style="padding:6px 0;color:#6b7280">Time</td><td style="padding:6px 0;font-weight:600">${startTime}</td></tr>` : ""}
            ${room ? `<tr><td style="padding:6px 0;color:#6b7280">Room / Venue</td><td style="padding:6px 0;font-weight:600">${room}</td></tr>` : ""}
            <tr><td style="padding:6px 0;color:#6b7280">Student</td><td style="padding:6px 0">${studentName}</td></tr>
          </table>
        </div>
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px">Scheduled by: <strong>${authorName}</strong></p>
        <p style="margin:0;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px">Automated message from ${schoolName}. Do not reply.</p>
      </div>
    </div>`;
  }

  const emailTasks: Promise<void>[] = [];
  const parentUserEmails = new Set(parentLinks.map(p => p.parentEmail).filter(Boolean));
  for (const p of parentLinks) {
    if (!p.parentEmail) continue;
    const sName = studentNameMap.get(p.studentId) ?? "";
    const payload = { to: p.parentEmail, subject: `[${schoolName}] Exam notice for ${sName}: ${title}`, html: buildHtml(`${p.parentFirstName} ${p.parentLastName}`, sName) };
    emailTasks.push((dbSmtp ? sendMailWithConfig(dbSmtp, payload) : sendMail(payload)).then(() => undefined).catch(err => { logger.warn({ err }, "Exam email failed"); }));
  }
  for (const s of students) {
    if (!s.parentEmail || parentUserEmails.has(s.parentEmail)) continue;
    const sName = `${s.firstName} ${s.lastName}`;
    const payload = { to: s.parentEmail, subject: `[${schoolName}] Exam notice for ${sName}: ${title}`, html: buildHtml("Parent/Guardian", sName) };
    emailTasks.push((dbSmtp ? sendMailWithConfig(dbSmtp, payload) : sendMail(payload)).then(() => undefined).catch(err => { logger.warn({ err }, "Exam email (parentEmail) failed"); }));
  }
  await Promise.allSettled(emailTasks);
  logger.info({ classId, title, inApp: inAppRows.length, emails: emailTasks.length, sse: allUserIds.size }, "Exam notifications dispatched");
}

// ── Staff: list exam schedule for a class ────────────────────────────────────
router.get("/exam-schedule", requireAuth, requireStaffView, async (req: AuthRequest, res): Promise<void> => {
  const classId = parseInt(String(req.query["classId"]), 10);
  if (isNaN(classId)) { res.status(400).json({ error: "BAD_REQUEST", message: "classId required" }); return; }

  if (req.userRole === "TEACHER") {
    const [cls] = await db.select({ teacherId: classesTable.teacherId }).from(classesTable).where(eq(classesTable.id, classId)).limit(1);
    if (!cls || cls.teacherId !== req.userId) { res.status(403).json({ error: "FORBIDDEN" }); return; }
  }

  const upcoming = req.query["upcoming"] === "true";
  const today = new Date().toISOString().split("T")[0]!;

  const exams = await db
    .select({ ex: examScheduleTable, subjectName: subjectsTable.name, subjectCode: subjectsTable.code })
    .from(examScheduleTable)
    .leftJoin(subjectsTable, eq(subjectsTable.id, examScheduleTable.subjectId))
    .where(and(
      eq(examScheduleTable.classId, classId),
      upcoming ? gte(examScheduleTable.examDate, today) : undefined,
    ))
    .orderBy(examScheduleTable.examDate);

  res.json({ exams: exams.map(r => ({ ...r.ex, subjectName: r.subjectName, subjectCode: r.subjectCode })) });
});

// ── Staff: create exam ────────────────────────────────────────────────────────
router.post("/exam-schedule", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const { classId, subjectId, title, examType, examDate, startTime, endTime, room, notes } = req.body ?? {};
  if (!classId || !title?.trim() || !examType || !examDate) {
    res.status(400).json({ error: "BAD_REQUEST", message: "classId, title, examType and examDate are required" }); return;
  }

  const cid = parseInt(String(classId), 10);
  const [cls] = await db.select({ teacherId: classesTable.teacherId, name: classesTable.name })
    .from(classesTable).where(eq(classesTable.id, cid)).limit(1);
  if (!cls) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  if (req.userRole === "TEACHER" && cls.teacherId !== req.userId) { res.status(403).json({ error: "FORBIDDEN" }); return; }

  const [author] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  const authorName = author ? `${author.firstName} ${author.lastName}` : "Unknown";

  let subjectName: string | null = null;
  let sid: number | null = null;
  if (subjectId) {
    sid = parseInt(String(subjectId), 10);
    const [sub] = await db.select({ name: subjectsTable.name }).from(subjectsTable).where(eq(subjectsTable.id, sid)).limit(1);
    subjectName = sub?.name ?? null;
  }

  const [created] = await db.insert(examScheduleTable).values({
    classId: cid, subjectId: sid ?? undefined,
    authorUserId: req.userId!, authorName,
    title: title.trim(), examType,
    examDate, startTime: startTime?.trim() || null, endTime: endTime?.trim() || null,
    room: room?.trim() || null, notes: notes?.trim() || null,
  }).returning();

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "CREATE", entity: "exam_schedule", entityId: created!.id,
    description: `Scheduled ${examType} exam for class #${cid}: ${title} on ${examDate}`,
    metadata: { classId: cid, className: cls.name },
  });

  void dispatchExamNotifications({ classId: cid, className: cls.name, authorName, title: title.trim(), examType, examDate, startTime: startTime?.trim() || null, subjectName, room: room?.trim() || null }).catch(() => undefined);

  res.status(201).json({ exam: { ...created, subjectName } });
});

// ── Staff: update exam ────────────────────────────────────────────────────────
router.patch("/exam-schedule/:id", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select().from(examScheduleTable).where(eq(examScheduleTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  if (req.userRole !== "SUPER_ADMIN" && existing.authorUserId !== req.userId) { res.status(403).json({ error: "FORBIDDEN" }); return; }

  const { title, examType, examDate, startTime, endTime, room, notes, subjectId } = req.body ?? {};
  const [updated] = await db.update(examScheduleTable).set({
    ...(title     ? { title: title.trim() }         : {}),
    ...(examType  ? { examType }                    : {}),
    ...(examDate  ? { examDate }                    : {}),
    ...(startTime !== undefined ? { startTime: startTime?.trim() || null } : {}),
    ...(endTime   !== undefined ? { endTime: endTime?.trim() || null }     : {}),
    ...(room      !== undefined ? { room: room?.trim() || null }           : {}),
    ...(notes     !== undefined ? { notes: notes?.trim() || null }         : {}),
    ...(subjectId !== undefined ? { subjectId: subjectId ? parseInt(String(subjectId), 10) : null } : {}),
    updatedAt: new Date(),
  }).where(eq(examScheduleTable.id, id)).returning();

  res.json({ exam: updated });
});

// ── Staff: delete exam ────────────────────────────────────────────────────────
router.delete("/exam-schedule/:id", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select().from(examScheduleTable).where(eq(examScheduleTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  if (req.userRole !== "SUPER_ADMIN" && existing.authorUserId !== req.userId) { res.status(403).json({ error: "FORBIDDEN" }); return; }

  await db.delete(examScheduleTable).where(eq(examScheduleTable.id, id));
  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "DELETE", entity: "exam_schedule", entityId: id,
    description: `Deleted exam #${id}`,
    metadata: { classId: existing.classId },
  });
  res.status(204).send();
});

// ── Student: upcoming exams for their class ───────────────────────────────────
router.get("/student/exam-schedule", requireAuth, requireRole("STUDENT"), async (req: AuthRequest, res): Promise<void> => {
  const [userRow] = await db.select({ linkedStudentId: usersTable.linkedStudentId })
    .from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!userRow?.linkedStudentId) { res.json({ exams: [] }); return; }

  const [student] = await db.select({ classId: studentsTable.classId })
    .from(studentsTable).where(eq(studentsTable.id, userRow.linkedStudentId)).limit(1);
  if (!student?.classId) { res.json({ exams: [] }); return; }

  const showAll = req.query["all"] === "true";
  const today = new Date().toISOString().split("T")[0]!;

  const exams = await db
    .select({ ex: examScheduleTable, subjectName: subjectsTable.name })
    .from(examScheduleTable)
    .leftJoin(subjectsTable, eq(subjectsTable.id, examScheduleTable.subjectId))
    .where(and(
      eq(examScheduleTable.classId, student.classId),
      showAll ? undefined : gte(examScheduleTable.examDate, today),
    ))
    .orderBy(examScheduleTable.examDate);

  res.json({ exams: exams.map(r => ({ ...r.ex, subjectName: r.subjectName })) });
});

// ── Parent: exams for all linked students ─────────────────────────────────────
router.get("/parent/exam-schedule", requireAuth, requireRole("PARENT"), async (req: AuthRequest, res): Promise<void> => {
  const links = await db.select({ studentId: parentStudentsTable.studentId })
    .from(parentStudentsTable).where(eq(parentStudentsTable.parentUserId, req.userId!));
  if (!links.length) { res.json({ exams: [] }); return; }

  const studentIds = links.map(l => l.studentId);
  const students = await db.select({ id: studentsTable.id, classId: studentsTable.classId, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable).where(inArray(studentsTable.id, studentIds));

  const classIds = [...new Set(students.map(s => s.classId).filter((c): c is number => c !== null))];
  if (!classIds.length) { res.json({ exams: [] }); return; }

  const today = new Date().toISOString().split("T")[0]!;
  const showAll = req.query["all"] === "true";

  const exams = await db
    .select({ ex: examScheduleTable, subjectName: subjectsTable.name })
    .from(examScheduleTable)
    .leftJoin(subjectsTable, eq(subjectsTable.id, examScheduleTable.subjectId))
    .where(and(
      inArray(examScheduleTable.classId, classIds),
      showAll ? undefined : gte(examScheduleTable.examDate, today),
    ))
    .orderBy(examScheduleTable.examDate);

  const classStudentMap: Record<number, string> = {};
  for (const s of students) {
    if (s.classId) classStudentMap[s.classId] = `${s.firstName} ${s.lastName}`;
  }

  res.json({ exams: exams.map(r => ({ ...r.ex, subjectName: r.subjectName, studentName: classStudentMap[r.ex.classId] ?? null })) });
});

export default router;
