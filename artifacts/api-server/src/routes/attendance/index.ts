import { Router } from "express";
import { db } from "@workspace/db";
import { attendanceTable, studentsTable, classesTable } from "@workspace/db";
import { eq, and, count, inArray } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { audit } from "../../lib/audit.js";
import {
  MarkAttendanceBody, UpdateAttendanceBody,
  ListAttendanceQueryParams, MarkBulkAttendanceBody,
} from "@workspace/api-zod";

const router = Router();

async function getTeacherClassIds(teacherId: number): Promise<number[]> {
  const classes = await db.select({ id: classesTable.id }).from(classesTable).where(eq(classesTable.teacherId, teacherId));
  return classes.map(c => c.id);
}

async function formatAttendance(a: typeof attendanceTable.$inferSelect) {
  const [student] = await db
    .select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable).where(eq(studentsTable.id, a.studentId)).limit(1);
  return {
    id: a.id, studentId: a.studentId,
    studentName: student ? `${student.firstName} ${student.lastName}` : "Unknown",
    classId: a.classId, date: a.date, status: a.status,
    checkInTime: a.checkInTime, method: a.method, notes: a.notes,
    createdAt: a.createdAt.toISOString(),
  };
}

const toDateStr = (dt: Date | string): string =>
  dt instanceof Date ? dt.toISOString().split("T")[0]! : dt;

router.get("/attendance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "ACCOUNTANT" || role === "PARENT" || role === "STUDENT") { res.status(403).json({ error: "FORBIDDEN" }); return; }
  let teacherClassIds: number[] | null = null;
  if (role === "TEACHER" && req.userId) {
    teacherClassIds = await getTeacherClassIds(req.userId);
    if (teacherClassIds.length === 0) { res.json({ records: [], total: 0 }); return; }
  }
  const parsed = ListAttendanceQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : { limit: 50, offset: 0 };
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const conditions = [];
  if (params.studentId) conditions.push(eq(attendanceTable.studentId, params.studentId));
  if (teacherClassIds) {
    if (params.classId) {
      if (!teacherClassIds.includes(params.classId)) { res.status(403).json({ error: "FORBIDDEN", message: "Not your class" }); return; }
      conditions.push(eq(attendanceTable.classId, params.classId));
    } else {
      conditions.push(inArray(attendanceTable.classId, teacherClassIds));
    }
  } else if (params.classId) {
    conditions.push(eq(attendanceTable.classId, params.classId));
  }
  if (params.date) conditions.push(eq(attendanceTable.date, toDateStr(params.date)));
  const where = conditions.length ? and(...conditions) : undefined;
  const [records, totalResult] = await Promise.all([
    db.select().from(attendanceTable).where(where).limit(limit).offset(offset).orderBy(attendanceTable.date),
    db.select({ count: count() }).from(attendanceTable).where(where),
  ]);
  res.json({ records: await Promise.all(records.map(formatAttendance)), total: totalResult[0]?.count ?? 0 });
});

router.post("/attendance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "ACCOUNTANT" || role === "PARENT" || role === "STUDENT") { res.status(403).json({ error: "FORBIDDEN" }); return; }
  const parsed = MarkAttendanceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
  const d = parsed.data;
  const [record] = await db.insert(attendanceTable).values({
    studentId: d.studentId, date: toDateStr(d.date as any), status: d.status,
    checkInTime: d.checkInTime ?? null, notes: d.notes ?? null, method: d.method ?? "MANUAL",
  } as any).returning();
  res.status(201).json(await formatAttendance(record));
});

router.post("/attendance/bulk", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "ACCOUNTANT" || role === "PARENT" || role === "STUDENT") { res.status(403).json({ error: "FORBIDDEN" }); return; }
  const parsed = MarkBulkAttendanceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
  const { date, method, records, classId } = parsed.data;
  if (role === "TEACHER" && req.userId && classId) {
    const teacherClassIds = await getTeacherClassIds(req.userId);
    if (!teacherClassIds.includes(classId)) { res.status(403).json({ error: "FORBIDDEN", message: "Not your class" }); return; }
  }
  const dateStr = toDateStr(date as any);
  const inserted = await db.insert(attendanceTable).values(records.map(r => ({
    studentId: r.studentId, date: dateStr, status: r.status,
    checkInTime: r.checkInTime ?? null, notes: r.notes ?? null,
    method: method ?? "MANUAL", classId: classId ?? null,
  })) as any).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "BULK_ATTENDANCE", entity: "attendance",
    description: `Marked attendance for ${inserted.length} students on ${dateStr}`,
    metadata: { date: dateStr, classId, count: inserted.length },
  });
  res.status(201).json({ count: inserted.length, records: await Promise.all(inserted.map(formatAttendance)) });
});

router.put("/attendance/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "ACCOUNTANT" || role === "PARENT" || role === "STUDENT") { res.status(403).json({ error: "FORBIDDEN" }); return; }
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  if (role === "TEACHER" && req.userId) {
    const [existing] = await db.select({ classId: attendanceTable.classId }).from(attendanceTable).where(eq(attendanceTable.id, id)).limit(1);
    if (existing?.classId) {
      const teacherClassIds = await getTeacherClassIds(req.userId);
      if (!teacherClassIds.includes(existing.classId)) { res.status(403).json({ error: "FORBIDDEN" }); return; }
    }
  }
  const parsed = UpdateAttendanceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
  const d = parsed.data;
  const updateFields: Record<string, unknown> = { updatedAt: new Date() };
  if (d.status !== undefined) updateFields["status"] = d.status;
  if (d.checkInTime !== undefined) updateFields["checkInTime"] = d.checkInTime;
  if (d.notes !== undefined) updateFields["notes"] = d.notes;
  const [record] = await db.update(attendanceTable).set(updateFields as any).where(eq(attendanceTable.id, id)).returning();
  if (!record) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  res.json(await formatAttendance(record));
});

export default router;
