import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  studentsTable,
  classesTable,
  attendanceTable,
  examResultsTable,
  subjectsTable,
  timetableTable,
} from "@workspace/db";
import { eq, and, desc, asc, gte } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";

const router = Router();

async function resolveLinkedStudent(userId: number) {
  const [user] = await db
    .select({ linkedStudentId: usersTable.linkedStudentId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user?.linkedStudentId ?? null;
}

function requireStudentRole(req: AuthRequest, res: any): boolean {
  if (req.userRole !== "STUDENT") {
    res.status(403).json({ error: "FORBIDDEN" });
    return false;
  }
  return true;
}

// GET /student/me — profile + class + summary stats
router.get("/student/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireStudentRole(req, res)) return;

  const linkedStudentId = await resolveLinkedStudent(req.userId!);
  if (!linkedStudentId) {
    res.status(404).json({ error: "NO_LINKED_STUDENT", message: "Your account is not linked to a student record. Please contact the school administrator." });
    return;
  }

  const [student] = await db
    .select({
      id: studentsTable.id,
      studentId: studentsTable.studentId,
      firstName: studentsTable.firstName,
      lastName: studentsTable.lastName,
      dateOfBirth: studentsTable.dateOfBirth,
      gender: studentsTable.gender,
      address: studentsTable.address,
      phoneNumber: studentsTable.phoneNumber,
      parentName: studentsTable.parentName,
      parentPhone: studentsTable.parentPhone,
      parentEmail: studentsTable.parentEmail,
      admissionDate: studentsTable.admissionDate,
      status: studentsTable.status,
      classId: studentsTable.classId,
    })
    .from(studentsTable)
    .where(eq(studentsTable.id, linkedStudentId))
    .limit(1);

  if (!student) {
    res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    return;
  }

  let className: string | null = null;
  let section: string | null = null;
  let grade: number | null = null;
  if (student.classId) {
    const [cls] = await db
      .select({ name: classesTable.name, section: classesTable.section, gradeLevel: classesTable.gradeLevel })
      .from(classesTable)
      .where(eq(classesTable.id, student.classId))
      .limit(1);
    if (cls) { className = cls.name; section = cls.section; grade = cls.gradeLevel; }
  }

  // Attendance summary (all time)
  const attendanceRows = await db
    .select({ status: attendanceTable.status })
    .from(attendanceTable)
    .where(eq(attendanceTable.studentId, linkedStudentId));

  const totalClasses = attendanceRows.length;
  const presentCount = attendanceRows.filter(r => r.status === "PRESENT" || r.status === "LATE").length;
  const absentCount  = attendanceRows.filter(r => r.status === "ABSENT").length;
  const attendanceRate = totalClasses > 0 ? Math.round((presentCount / totalClasses) * 100) : 0;

  // Exam summary
  const results = await db
    .select({ marksObtained: examResultsTable.marksObtained, totalMarks: examResultsTable.totalMarks })
    .from(examResultsTable)
    .where(eq(examResultsTable.studentId, linkedStudentId));

  const totalExams = results.length;
  const avgScore = totalExams > 0
    ? Math.round(results.reduce((s, r) => s + (parseFloat(r.marksObtained) / parseFloat(r.totalMarks)) * 100, 0) / totalExams)
    : 0;

  res.json({
    student: {
      ...student,
      className,
      section,
      grade,
    },
    stats: { totalClasses, presentCount, absentCount, attendanceRate, totalExams, avgScore },
  });
});

// GET /student/attendance — recent 90 days attendance
router.get("/student/attendance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireStudentRole(req, res)) return;

  const linkedStudentId = await resolveLinkedStudent(req.userId!);
  if (!linkedStudentId) { res.status(404).json({ error: "NO_LINKED_STUDENT" }); return; }

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString().split("T")[0]!;

  const rows = await db
    .select({
      id: attendanceTable.id,
      date: attendanceTable.date,
      status: attendanceTable.status,
      checkInTime: attendanceTable.checkInTime,
      method: attendanceTable.method,
      notes: attendanceTable.notes,
    })
    .from(attendanceTable)
    .where(and(eq(attendanceTable.studentId, linkedStudentId), gte(attendanceTable.date, sinceStr)))
    .orderBy(desc(attendanceTable.date));

  const total   = rows.length;
  const present = rows.filter(r => r.status === "PRESENT").length;
  const absent  = rows.filter(r => r.status === "ABSENT").length;
  const late    = rows.filter(r => r.status === "LATE").length;
  const excused = rows.filter(r => r.status === "EXCUSED").length;
  const rate    = total > 0 ? Math.round(((present + late) / total) * 100) : 0;

  res.json({ records: rows, stats: { total, present, absent, late, excused, rate } });
});

// GET /student/results — all exam results with subject names
router.get("/student/results", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireStudentRole(req, res)) return;

  const linkedStudentId = await resolveLinkedStudent(req.userId!);
  if (!linkedStudentId) { res.status(404).json({ error: "NO_LINKED_STUDENT" }); return; }

  const rows = await db
    .select({
      id: examResultsTable.id,
      examType: examResultsTable.examType,
      examName: examResultsTable.examName,
      marksObtained: examResultsTable.marksObtained,
      totalMarks: examResultsTable.totalMarks,
      grade: examResultsTable.grade,
      remarks: examResultsTable.remarks,
      examDate: examResultsTable.examDate,
      subjectName: subjectsTable.name,
      subjectCode: subjectsTable.code,
    })
    .from(examResultsTable)
    .innerJoin(subjectsTable, eq(examResultsTable.subjectId, subjectsTable.id))
    .where(eq(examResultsTable.studentId, linkedStudentId))
    .orderBy(desc(examResultsTable.examDate));

  const totalExams = rows.length;
  const avgPct = totalExams > 0
    ? Math.round(rows.reduce((s, r) => s + (parseFloat(r.marksObtained) / parseFloat(r.totalMarks)) * 100, 0) / totalExams)
    : 0;
  const best = rows.length
    ? rows.reduce((b, r) => {
        const pct = parseFloat(r.marksObtained) / parseFloat(r.totalMarks);
        const bPct = parseFloat(b.marksObtained) / parseFloat(b.totalMarks);
        return pct > bPct ? r : b;
      })
    : null;

  res.json({ results: rows, stats: { totalExams, avgPct, bestSubject: best?.subjectName ?? null } });
});

// GET /student/timetable — class timetable
router.get("/student/timetable", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireStudentRole(req, res)) return;

  const linkedStudentId = await resolveLinkedStudent(req.userId!);
  if (!linkedStudentId) { res.status(404).json({ error: "NO_LINKED_STUDENT" }); return; }

  const [student] = await db
    .select({ classId: studentsTable.classId })
    .from(studentsTable)
    .where(eq(studentsTable.id, linkedStudentId))
    .limit(1);

  if (!student?.classId) { res.json({ slots: [] }); return; }

  const slots = await db
    .select({
      id: timetableTable.id,
      dayOfWeek: timetableTable.dayOfWeek,
      startTime: timetableTable.startTime,
      endTime: timetableTable.endTime,
      room: timetableTable.room,
      subjectName: subjectsTable.name,
      subjectCode: subjectsTable.code,
      teacherFirst: usersTable.firstName,
      teacherLast: usersTable.lastName,
    })
    .from(timetableTable)
    .innerJoin(subjectsTable, eq(timetableTable.subjectId, subjectsTable.id))
    .leftJoin(usersTable, eq(timetableTable.teacherId, usersTable.id))
    .where(eq(timetableTable.classId, student.classId))
    .orderBy(asc(timetableTable.dayOfWeek), asc(timetableTable.startTime));

  res.json({ slots });
});

export default router;
