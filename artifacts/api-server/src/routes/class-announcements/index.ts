import { Router } from "express";
import { db } from "@workspace/db";
import {
  classAnnouncementsTable, classesTable, usersTable,
  studentsTable, parentStudentsTable, notificationsTable, tenantsTable,
} from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireRole } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { sendMail, sendMailWithConfig, type SmtpConfig } from "../../lib/mailer.js";
import { sseManager } from "../../lib/sse-manager.js";
import { logger } from "../../lib/logger.js";

const router = Router();

const requireStaff      = requireRole("SUPER_ADMIN", "TEACHER");
const requireStaffView  = requireRole("SUPER_ADMIN", "TEACHER", "ACCOUNTANT");

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSmtpConfig() {
  const [tenant] = await db.select({
    name: tenantsTable.name,
    smtpHost: tenantsTable.smtpHost, smtpPort: tenantsTable.smtpPort,
    smtpUser: tenantsTable.smtpUser, smtpPass: tenantsTable.smtpPass,
    smtpFrom: tenantsTable.smtpFrom, smtpSecure: tenantsTable.smtpSecure,
  }).from(tenantsTable).limit(1);
  return tenant ?? null;
}

function buildAnnouncementEmail(opts: {
  schoolName: string; authorName: string; className: string;
  title: string; body: string; recipientName: string;
}): string {
  const { schoolName, authorName, className, title, body, recipientName } = opts;
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:24px">
      <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;border-bottom:1px solid #e5e7eb;padding-bottom:20px">
          <div style="width:40px;height:40px;border-radius:50%;background:#e0e7ff;display:flex;align-items:center;justify-content:center">
            <span style="font-size:20px">📢</span>
          </div>
          <div>
            <h2 style="margin:0;font-size:18px;color:#111827">${schoolName}</h2>
            <p style="margin:2px 0 0;font-size:13px;color:#6b7280">Class Announcement — ${className}</p>
          </div>
        </div>
        <p style="color:#374151;font-size:14px;margin:0 0 16px">Dear ${recipientName},</p>
        <div style="background:#f0f4ff;border-left:4px solid #6366f1;border-radius:6px;padding:16px;margin:0 0 20px">
          <h3 style="margin:0 0 8px;color:#111827;font-size:16px">${title}</h3>
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;white-space:pre-wrap">${body}</p>
        </div>
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px">Posted by: <strong>${authorName}</strong></p>
        <p style="color:#6b7280;font-size:13px;margin:0 0 20px">Class: <strong>${className}</strong></p>
        <p style="margin:0;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px">
          This is an automated message from ${schoolName}. Please do not reply to this email.
        </p>
      </div>
    </div>`;
}

/**
 * Fire-and-forget: send in-app + email + SSE notifications to all students
 * and parents in a class when a new announcement is posted.
 */
async function dispatchAnnouncementNotifications(opts: {
  classId: number; className: string; authorName: string; title: string; body: string;
}): Promise<void> {
  const { classId, className, authorName, title, body } = opts;

  const [tenant, students] = await Promise.all([
    getSmtpConfig(),
    db.select({
      id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName,
      parentEmail: studentsTable.parentEmail,
    }).from(studentsTable).where(eq(studentsTable.classId, classId)),
  ]);

  if (!students.length) return;

  const schoolName = tenant?.name ?? "Smart School ERP";

  const dbSmtp: SmtpConfig | null =
    tenant?.smtpHost && tenant.smtpUser && tenant.smtpPass
      ? {
          host: tenant.smtpHost,
          port: tenant.smtpPort ?? 587,
          user: tenant.smtpUser,
          pass: tenant.smtpPass,
          from: tenant.smtpFrom ?? `"${schoolName}" <no-reply@school.edu>`,
          secure: tenant.smtpSecure ?? false,
        }
      : null;

  const studentIds = students.map(s => s.id);

  // ── 1. Linked user accounts (students themselves) ──────────────────────
  const linkedStudentUsers = await db
    .select({ userId: usersTable.id, linkedStudentId: usersTable.linkedStudentId, email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.linkedStudentId, studentIds));

  // ── 2. Linked parent user accounts ────────────────────────────────────
  const parentLinks = await db
    .select({
      studentId: parentStudentsTable.studentId,
      parentUserId: parentStudentsTable.parentUserId,
      parentEmail: usersTable.email,
      parentFirstName: usersTable.firstName,
      parentLastName: usersTable.lastName,
    })
    .from(parentStudentsTable)
    .innerJoin(usersTable, eq(usersTable.id, parentStudentsTable.parentUserId))
    .where(inArray(parentStudentsTable.studentId, studentIds));

  const studentNameMap = new Map(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));

  // ── 3. In-app notifications (bulk insert) ─────────────────────────────
  const inAppRows: (typeof notificationsTable.$inferInsert)[] = [];

  // For each linked student user account
  for (const u of linkedStudentUsers) {
    if (!u.userId) continue;
    inAppRows.push({
      userId: u.userId,
      title: `📢 New Announcement — ${className}`,
      message: title,
      type: "INFO" as const,
      link: "/student",
    });
  }

  // For each linked parent user account (deduplicate by parentUserId)
  const seenParentUserIds = new Set<number>();
  for (const p of parentLinks) {
    if (seenParentUserIds.has(p.parentUserId)) continue;
    seenParentUserIds.add(p.parentUserId);
    const studentName = studentNameMap.get(p.studentId) ?? "";
    inAppRows.push({
      userId: p.parentUserId,
      title: `📢 Announcement for ${studentName}'s class`,
      message: title,
      type: "INFO" as const,
      link: "/parent",
    });
  }

  if (inAppRows.length) {
    await db.insert(notificationsTable).values(inAppRows);
  }

  // ── 4. SSE push to connected users ────────────────────────────────────
  const allUserIds = new Set<number>();
  for (const u of linkedStudentUsers) { if (u.userId) allUserIds.add(u.userId); }
  for (const p of parentLinks) { allUserIds.add(p.parentUserId); }

  const ssePayload = {
    notification: {
      title: `📢 New Class Announcement`,
      message: title,
      type: "INFO",
    },
    unreadBump: true,
  };

  for (const uid of allUserIds) {
    sseManager.sendToUser(uid, "update", ssePayload);
  }

  // ── 5. Email notifications (non-blocking, best-effort) ────────────────
  const emailTasks: Promise<void>[] = [];

  // Email linked parent users (they have registered email addresses)
  for (const p of parentLinks) {
    if (!p.parentEmail) continue;
    const studentName = studentNameMap.get(p.studentId) ?? "";
    const html = buildAnnouncementEmail({
      schoolName, authorName, className,
      title, body,
      recipientName: `${p.parentFirstName} ${p.parentLastName}`,
    });
    const mailPayload = {
      to: p.parentEmail,
      subject: `[${schoolName}] New announcement for ${studentName}'s class: ${title}`,
      html,
    };
    emailTasks.push(
      (dbSmtp ? sendMailWithConfig(dbSmtp, mailPayload) : sendMail(mailPayload))
        .then(() => undefined)
        .catch(err => { logger.warn({ err, to: p.parentEmail }, "Announcement email failed"); }),
    );
  }

  // Email student.parentEmail fields (for students without portal accounts)
  const parentUserEmails = new Set(parentLinks.map(p => p.parentEmail).filter(Boolean));
  for (const student of students) {
    if (!student.parentEmail || parentUserEmails.has(student.parentEmail)) continue;
    const studentName = `${student.firstName} ${student.lastName}`;
    const html = buildAnnouncementEmail({
      schoolName, authorName, className,
      title, body,
      recipientName: "Parent/Guardian",
    });
    const mailPayload = {
      to: student.parentEmail,
      subject: `[${schoolName}] New announcement for ${studentName}'s class: ${title}`,
      html,
    };
    emailTasks.push(
      (dbSmtp ? sendMailWithConfig(dbSmtp, mailPayload) : sendMail(mailPayload))
        .then(() => undefined)
        .catch(err => { logger.warn({ err, to: student.parentEmail }, "Announcement email (parentEmail) failed"); }),
    );
  }

  await Promise.allSettled(emailTasks);

  logger.info(
    { classId, className, title, inApp: inAppRows.length, emails: emailTasks.length, sse: allUserIds.size },
    "Announcement notifications dispatched",
  );
}

// ── Admin / Teacher: list announcements for a class ──────────────────────────
router.get("/class-announcements", requireAuth, requireStaffView, async (req: AuthRequest, res): Promise<void> => {
  const classId = parseInt(String(req.query["classId"]), 10);
  if (isNaN(classId)) { res.status(400).json({ error: "BAD_REQUEST", message: "classId required" }); return; }

  if (req.userRole === "TEACHER") {
    const [cls] = await db.select({ teacherId: classesTable.teacherId })
      .from(classesTable).where(eq(classesTable.id, classId)).limit(1);
    if (!cls || cls.teacherId !== req.userId) {
      res.status(403).json({ error: "FORBIDDEN", message: "You can only view announcements for your own classes" }); return;
    }
  }

  const announcements = await db
    .select()
    .from(classAnnouncementsTable)
    .where(eq(classAnnouncementsTable.classId, classId))
    .orderBy(desc(classAnnouncementsTable.createdAt));

  res.json({ announcements });
});

// ── Admin / Teacher: post announcement ───────────────────────────────────────
router.post("/class-announcements", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const { classId, title, body } = req.body ?? {};
  if (!classId || !title?.trim() || !body?.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "classId, title and body are required" }); return;
  }

  const cid = parseInt(String(classId), 10);

  const [cls] = await db.select({ teacherId: classesTable.teacherId, name: classesTable.name })
    .from(classesTable).where(eq(classesTable.id, cid)).limit(1);
  if (!cls) { res.status(404).json({ error: "NOT_FOUND", message: "Class not found" }); return; }

  if (req.userRole === "TEACHER" && cls.teacherId !== req.userId) {
    res.status(403).json({ error: "FORBIDDEN", message: "You can only post to your own classes" }); return;
  }

  const [author] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  const authorName = author ? `${author.firstName} ${author.lastName}` : "Unknown";

  const [created] = await db.insert(classAnnouncementsTable).values({
    classId: cid,
    authorUserId: req.userId!,
    authorName,
    title: title.trim(),
    body: body.trim(),
  }).returning();

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "CREATE", entity: "class_announcement", entityId: created!.id,
    description: `Posted announcement to class #${cid}: ${title}`,
    metadata: { classId: cid, className: cls.name },
  });

  // Fire notifications non-blocking
  void dispatchAnnouncementNotifications({
    classId: cid, className: cls.name, authorName,
    title: title.trim(), body: body.trim(),
  }).catch(err => logger.warn({ err }, "Announcement notification dispatch failed"));

  res.status(201).json({ announcement: created });
});

// ── Admin / Teacher: delete announcement ─────────────────────────────────────
router.delete("/class-announcements/:id", requireAuth, requireStaff, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [existing] = await db.select()
    .from(classAnnouncementsTable).where(eq(classAnnouncementsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  const isAdmin = req.userRole === "SUPER_ADMIN";
  const isOwner = existing.authorUserId === req.userId;
  if (!isAdmin && !isOwner) {
    res.status(403).json({ error: "FORBIDDEN", message: "You can only delete your own announcements" }); return;
  }

  await db.delete(classAnnouncementsTable).where(eq(classAnnouncementsTable.id, id));

  await audit({
    userId: req.userId!, userEmail: req.userEmail!, userRole: req.userRole!,
    action: "DELETE", entity: "class_announcement", entityId: id,
    description: `Deleted announcement #${id} from class #${existing.classId}`,
    metadata: { classId: existing.classId },
  });

  res.status(204).send();
});

// ── Student: announcements for their linked class ─────────────────────────────
router.get("/student/announcements", requireAuth, requireRole("STUDENT"), async (req: AuthRequest, res): Promise<void> => {
  const [userRow] = await db.select({ linkedStudentId: usersTable.linkedStudentId })
    .from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  if (!userRow?.linkedStudentId) { res.json({ announcements: [], classId: null }); return; }

  const [student] = await db.select({ classId: studentsTable.classId })
    .from(studentsTable).where(eq(studentsTable.id, userRow.linkedStudentId)).limit(1);

  if (!student?.classId) { res.json({ announcements: [], classId: null }); return; }

  const announcements = await db
    .select()
    .from(classAnnouncementsTable)
    .where(eq(classAnnouncementsTable.classId, student.classId))
    .orderBy(desc(classAnnouncementsTable.createdAt));

  res.json({ announcements, classId: student.classId });
});

// ── Parent: announcements for all linked students' classes ───────────────────
router.get("/parent/announcements", requireAuth, requireRole("PARENT"), async (req: AuthRequest, res): Promise<void> => {
  const links = await db
    .select({ studentId: parentStudentsTable.studentId })
    .from(parentStudentsTable)
    .where(eq(parentStudentsTable.parentUserId, req.userId!));

  if (!links.length) { res.json({ announcements: [] }); return; }

  const studentIds = links.map(l => l.studentId);
  const students = await db
    .select({ id: studentsTable.id, classId: studentsTable.classId, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable)
    .where(inArray(studentsTable.id, studentIds));

  const classIds = [...new Set(students.map(s => s.classId).filter((c): c is number => c !== null))];
  if (!classIds.length) { res.json({ announcements: [] }); return; }

  const announcements = await db
    .select()
    .from(classAnnouncementsTable)
    .where(inArray(classAnnouncementsTable.classId, classIds))
    .orderBy(desc(classAnnouncementsTable.createdAt));

  const classStudentMap: Record<number, string> = {};
  for (const s of students) {
    if (s.classId) classStudentMap[s.classId] = `${s.firstName} ${s.lastName}`;
  }

  res.json({
    announcements: announcements.map(a => ({
      ...a,
      studentName: classStudentMap[a.classId] ?? null,
    })),
  });
});

export default router;
