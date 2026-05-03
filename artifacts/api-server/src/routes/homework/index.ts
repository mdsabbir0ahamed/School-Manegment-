import { Router } from "express";
import { db } from "@workspace/db";
import {
  homeworkTable, classesTable, subjectsTable, usersTable,
  studentsTable, parentStudentsTable, notificationsTable, tenantsTable,
} from "@workspace/db";
import { eq, desc, inArray, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireRole } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { sendMail, sendMailWithConfig, type SmtpConfig } from "../../lib/mailer.js";
import { sseManager } from "../../lib/sse-manager.js";
import { logger } from "../../lib/logger.js";

const router = Router();

const requireStaff      = requireRole("SUPER_ADMIN", "TEACHER");
const requireStaffView  = requireRole("SUPER_ADMIN", "TEACHER", "ACCOUNTANT");

// ── Notification helper ───────────────────────────────────────────────────────
async function dispatchHomeworkNotifications(opts: {
  classId: number; className: string; authorName: string;
  title: string; description: string; dueDate: string | null; subjectName: string | null;
}): Promise<void> {
  const { classId, className, authorName, title, description, dueDate, subjectName } = opts;

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

  const [linkedStudentUsers, parentLinks] = await Promise.all([
    db.select({ userId: usersTable.id, linkedStudentId: usersTable.linkedStudentId })
      .from(usersTable).where(inArray(usersTable.linkedStudentId, studentIds)),
    db.select({
      studentId: parentStudentsTable.studentId,
      parentUserId: parentStudentsTable.parentUserId,
      parentEmail: usersTable.email,
      parentFirstName: usersTable.firstName,
      parentLastName: usersTable.lastName,
    }).from(parentStudentsTable)
      .innerJoin(usersTable, eq(usersTable.id, parentStudentsTable.parentUserId))
      .where(inArray(parentStudentsTable.studentId, studentIds)),
  ]);

  const dueLine = dueDate ? ` Due: ${new Date(dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "";
  const subjectLine = subjectName ? ` (${subjectName})` : "";
  const shortMsg = `${title}${subjectLine}.${dueLine}`;

  const inAppRows: (typeof notificationsTable.$inferInsert)[] = [];
  for (const u of linkedStudentUsers) {
    if (!u.userId) continue;
    inAppRows.push({ userId: u.userId, title: `📚 New Homework — ${className}`, message: shortMsg, type: "INFO" as const, link: "/student" });
  }
  const seenParentIds = new Set<number>();
  for (const p of parentLinks) {
    if (seenParentIds.has(p.parentUserId)) continue;
    seenParentIds.add(p.parentUserId);
    const sName = studentNameMap.get(p.studentId) ?? "";
    inAppRows.push({ userId: p.parentUserId, title: `📚 Homework for ${sName}'s class`, message: shortMsg, type: "INFO" as const, link: "/parent" });
  }
  if (inAppRows.length) await db.insert(notificationsTable).values(inAppRows);

  const allUserIds = new Set<number>();
  for (const u of linkedStudentUsers) { if (u.userId) allUserIds.add(u.userId); }
  for (const p of parentLinks) { allUserIds.add(p.parentUserId); }
  const ssePayload = { notification: { title: "📚 New Homework", message: shortMsg, type: "INFO" }, unreadBump: true };
  for (const uid of allUserIds) sseManager.sendToUser(uid, "update", ssePayload);

  // Email
  function buildHtml(recipientName: string, studentName: string): string {
    return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:24px">
      <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
        <div style="border-bottom:1px solid #e5e7eb;padding-bottom:20px;margin-bottom:24px">
          <h2 style="margin:0;font-size:18px;color:#111827">${schoolName}</h2>
          <p style="margin:2px 0 0;font-size:13px;color:#6b7280">New Homework — ${className}</p>
        </div>
        <p style="color:#374151;font-size:14px;margin:0 0 16px">Dear ${recipientName},</p>
        <div style="background:#fefce8;border-left:4px solid #eab308;border-radius:6px;padding:16px;margin:0 0 20px">
          <h3 style="margin:0 0 8px;color:#111827;font-size:16px">📚 ${title}</h3>
          ${subjectName ? `<p style="margin:0 0 8px;font-size:12px;color:#6b7280;font-weight:600">Subject: ${subjectName}</p>` : ""}
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;white-space:pre-wrap">${description}</p>
        </div>
        ${dueDate ? `<div style="background:#fef2f2;border-radius:6px;padding:12px 16px;margin:0 0 20px;display:flex;align-items:center;gap:8px"><span style="font-size:20px">⏰</span><div><p style="margin:0;font-size:12px;color:#6b7280">Due Date</p><p style="margin:0;font-size:15px;font-weight:700;color:#dc2626">${new Date(dueDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p></div></div>` : ""}
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px">Posted by: <strong>${authorName}</strong> | Student: <strong>${studentName}</strong></p>
        <p style="margin:0;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px">Automated message from ${schoolName}. Do not reply.</p>
      </div>
    </div>`;
  }

  const emailTasks: Promise<void>[] = [];
  const parentUserEmails = new Set(parentLinks.map(p => p.parentEmail).filter(Boolean));
  for (const p of parentLinks) {
    if (!p.parentEmail) continue;
    const sName = studentNameMap.get(p.studentId) ?? "";
    const payload = { to: p.parentEmail, subject: `[${schoolName}] New homework for ${sName}: ${title}`, html: buildHtml(`${p.parentFirstName} ${p.parentLastName}`, sName) };
    emailTasks.push((dbSmtp ? sendMailWithConfig(dbSmtp, payload) : sendMail(payload)).then(() => undefined).catch(err => { logger.warn({ err }, "Homework email failed"); }));
  }
  for (const s of students) {
    if (!s.parentEmail || parentUserEmails.has(s.parentEmail)) continue;
    const sName = `${s.firstName} ${s.lastName}`;
    const payload = { to: s.parentEmail, subject: `[${schoolName}] New homework for ${sName}: ${title}`, html: buildHtml("Parent/Guardian", sName) };
    emailTasks.push((dbSmtp ? sendMailWithConfig(dbSmtp, payload) : sendMail(payload)).then(() => undefined).catch(err => { logger.warn({ err }, "Homework email (parentEmail) failed"); }));
  }
  await Promise.allSettled(emailTasks);

  logger.info({ classId, title, inApp: inAppRows.length, emails: emailTasks.length, sse: allUserIds.size }, "Homework notifications dispatched");
}

// ── Staff: list homework for a class ─────────────────────────────────────────
router.get("/homework", requireAuth, requireStaffView, async (req: AuthRequest, res): Promise<void> => {
  const classId = parseInt(String(req.query["classId"]), 10);
  if (isNaN(classId)) { res.status(400).json({ error: "BAD_REQUEST", message: "classId required" }); return; }

  if (req.userRole === "TEACHER") {
    const [cls] = await db.select({ teacherId: classesTable.teacherId }).from(classesTable).where(eq(classesTable.id, classId)).limit(1);
    if (!cls || cls.teacherId !== req.userId) { res.status(403).json({ error: "FORBIDDEN" }); return; }
  }

  const hw = await db
    .select({ hw: homeworkTable, subjectName: subjectsTable.name, subjectCode: subjectsTable.code })
    .from(homeworkTable)
    .leftJoin(subjectsTable, eq(subjectsTable.id, homeworkTable.subjectId))
    .where(eq(homeworkTable.classId, classId))
    .orderBy(desc(homeworkTable.createdAt));

  res.json({ homework: hw.map(r => ({ ...r.hw, subjectName: r.subjectName, subjectCode: r.subjectCode })) });
});

// ── Staff: create homework ────────────────────────────────────────────────────
router.post("/homework", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const { classId, subjectId, title, description, dueDate } = req.body ?? {};
  if (!classId || !title?.trim() || !description?.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "classId, title and description are required" }); return;
  }

  const cid = parseInt(String(classId), 10);
  const [cls] = await db.select({ teacherId: classesTable.teacherId, name: classesTable.name })
    .from(classesTable).where(eq(classesTable.id, cid)).limit(1);
  if (!cls) { res.status(404).json({ error: "NOT_FOUND", message: "Class not found" }); return; }
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

  const [created] = await db.insert(homeworkTable).values({
    classId: cid, subjectId: sid ?? undefined,
    authorUserId: req.userId!, authorName,
    title: title.trim(), description: description.trim(),
    dueDate: dueDate ?? null,
  }).returning();

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "CREATE", entity: "homework", entityId: created!.id,
    description: `Posted homework to class #${cid}: ${title}`,
    metadata: { classId: cid, className: cls.name },
  });

  void dispatchHomeworkNotifications({ classId: cid, className: cls.name, authorName, title: title.trim(), description: description.trim(), dueDate: dueDate ?? null, subjectName }).catch(() => undefined);

  res.status(201).json({ homework: { ...created, subjectName } });
});

// ── Staff: update homework ────────────────────────────────────────────────────
router.patch("/homework/:id", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select().from(homeworkTable).where(eq(homeworkTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  const isAdmin = req.userRole === "SUPER_ADMIN";
  const isOwner = existing.authorUserId === req.userId;
  if (!isAdmin && !isOwner) { res.status(403).json({ error: "FORBIDDEN" }); return; }

  const { title, description, dueDate, status, subjectId } = req.body ?? {};
  const [updated] = await db.update(homeworkTable).set({
    ...(title       ? { title: title.trim() }           : {}),
    ...(description ? { description: description.trim() } : {}),
    ...(dueDate !== undefined ? { dueDate }              : {}),
    ...(status      ? { status }                         : {}),
    ...(subjectId !== undefined ? { subjectId: subjectId ? parseInt(String(subjectId), 10) : null } : {}),
    updatedAt: new Date(),
  }).where(eq(homeworkTable.id, id)).returning();

  res.json({ homework: updated });
});

// ── Staff: delete homework ────────────────────────────────────────────────────
router.delete("/homework/:id", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select().from(homeworkTable).where(eq(homeworkTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  const isAdmin = req.userRole === "SUPER_ADMIN";
  const isOwner = existing.authorUserId === req.userId;
  if (!isAdmin && !isOwner) { res.status(403).json({ error: "FORBIDDEN" }); return; }

  await db.delete(homeworkTable).where(eq(homeworkTable.id, id));
  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "DELETE", entity: "homework", entityId: id,
    description: `Deleted homework #${id}`,
    metadata: { classId: existing.classId },
  });

  res.status(204).send();
});

// ── Student: homework for their linked class ──────────────────────────────────
router.get("/student/homework", requireAuth, requireRole("STUDENT"), async (req: AuthRequest, res): Promise<void> => {
  const [userRow] = await db.select({ linkedStudentId: usersTable.linkedStudentId })
    .from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!userRow?.linkedStudentId) { res.json({ homework: [] }); return; }

  const [student] = await db.select({ classId: studentsTable.classId })
    .from(studentsTable).where(eq(studentsTable.id, userRow.linkedStudentId)).limit(1);
  if (!student?.classId) { res.json({ homework: [] }); return; }

  const status = req.query["status"] as string | undefined;

  const hw = await db
    .select({ hw: homeworkTable, subjectName: subjectsTable.name })
    .from(homeworkTable)
    .leftJoin(subjectsTable, eq(subjectsTable.id, homeworkTable.subjectId))
    .where(and(
      eq(homeworkTable.classId, student.classId),
      status ? eq(homeworkTable.status, status as "ACTIVE" | "CLOSED") : undefined,
    ))
    .orderBy(desc(homeworkTable.createdAt));

  res.json({ homework: hw.map(r => ({ ...r.hw, subjectName: r.subjectName })) });
});

// ── Parent: homework for all linked students' classes ─────────────────────────
router.get("/parent/homework", requireAuth, requireRole("PARENT"), async (req: AuthRequest, res): Promise<void> => {
  const links = await db.select({ studentId: parentStudentsTable.studentId })
    .from(parentStudentsTable).where(eq(parentStudentsTable.parentUserId, req.userId!));
  if (!links.length) { res.json({ homework: [] }); return; }

  const studentIds = links.map(l => l.studentId);
  const students = await db.select({ id: studentsTable.id, classId: studentsTable.classId, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable).where(inArray(studentsTable.id, studentIds));

  const classIds = [...new Set(students.map(s => s.classId).filter((c): c is number => c !== null))];
  if (!classIds.length) { res.json({ homework: [] }); return; }

  const hw = await db
    .select({ hw: homeworkTable, subjectName: subjectsTable.name })
    .from(homeworkTable)
    .leftJoin(subjectsTable, eq(subjectsTable.id, homeworkTable.subjectId))
    .where(inArray(homeworkTable.classId, classIds))
    .orderBy(desc(homeworkTable.createdAt));

  const classStudentMap: Record<number, string> = {};
  for (const s of students) {
    if (s.classId) classStudentMap[s.classId] = `${s.firstName} ${s.lastName}`;
  }

  res.json({ homework: hw.map(r => ({ ...r.hw, subjectName: r.subjectName, studentName: classStudentMap[r.hw.classId] ?? null })) });
});

export default router;
