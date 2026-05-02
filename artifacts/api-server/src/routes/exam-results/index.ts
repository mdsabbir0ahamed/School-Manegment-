import { Router } from "express";
import { db } from "@workspace/db";
import { examResultsTable, studentsTable, subjectsTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAcademic } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";

const router = Router();

function gradeFromPercent(pct: number): string {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
}

async function formatResult(r: typeof examResultsTable.$inferSelect) {
  const [student] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable).where(eq(studentsTable.id, r.studentId)).limit(1);
  const [subject] = await db.select({ name: subjectsTable.name, code: subjectsTable.code })
    .from(subjectsTable).where(eq(subjectsTable.id, r.subjectId)).limit(1);
  const obtained = parseFloat(r.marksObtained);
  const total = parseFloat(r.totalMarks);
  const pct = total > 0 ? Math.round((obtained / total) * 100) : 0;
  return {
    id: r.id,
    studentId: r.studentId,
    studentName: student ? `${student.firstName} ${student.lastName}` : "Unknown",
    subjectId: r.subjectId,
    subjectName: subject?.name ?? "Unknown",
    subjectCode: subject?.code ?? "",
    examType: r.examType,
    examName: r.examName,
    marksObtained: obtained,
    totalMarks: total,
    percentage: pct,
    grade: r.grade ?? gradeFromPercent(pct),
    remarks: r.remarks,
    examDate: r.examDate,
    createdAt: r.createdAt.toISOString(),
  };
}

// ── List ───────────────────────────────────────────────────────────────────

router.get("/exam-results", requireAuth, requireAcademic, async (req, res): Promise<void> => {
  const studentId = req.query["studentId"] ? parseInt(String(req.query["studentId"]), 10) : undefined;
  const subjectId = req.query["subjectId"] ? parseInt(String(req.query["subjectId"]), 10) : undefined;
  const examType = req.query["examType"] as string | undefined;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10), 200);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10);

  const conditions = [];
  if (studentId) conditions.push(eq(examResultsTable.studentId, studentId));
  if (subjectId) conditions.push(eq(examResultsTable.subjectId, subjectId));
  if (examType) conditions.push(eq(examResultsTable.examType, examType as any));
  const where = conditions.length ? and(...conditions) : undefined;

  const [results, totalResult] = await Promise.all([
    db.select().from(examResultsTable).where(where).limit(limit).offset(offset)
      .orderBy(examResultsTable.examDate),
    db.select({ count: count() }).from(examResultsTable).where(where),
  ]);
  res.json({
    results: await Promise.all(results.map(formatResult)),
    total: totalResult[0]?.count ?? 0,
  });
});

// ── Create ─────────────────────────────────────────────────────────────────

router.post("/exam-results", requireAuth, requireAcademic, async (req: AuthRequest, res): Promise<void> => {
  const { studentId, subjectId, examType, examName, marksObtained, totalMarks, remarks, examDate } = req.body as {
    studentId?: number; subjectId?: number; examType?: string; examName?: string;
    marksObtained?: number; totalMarks?: number; remarks?: string; examDate?: string;
  };
  if (!studentId || !subjectId || !examType || !examName || marksObtained === undefined || !totalMarks || !examDate) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "All fields are required" });
    return;
  }
  if (marksObtained > totalMarks) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Marks obtained cannot exceed total marks" });
    return;
  }
  const pct = Math.round((marksObtained / totalMarks) * 100);
  const grade = gradeFromPercent(pct);
  const [result] = await db.insert(examResultsTable).values({
    studentId, subjectId, examType: examType as any, examName,
    marksObtained: String(marksObtained), totalMarks: String(totalMarks),
    grade, remarks: remarks ?? null, examDate,
  }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "exam_result", entityId: result.id,
    description: `Recorded ${examType} result for student #${studentId}: ${marksObtained}/${totalMarks} (${grade})`,
  });
  res.status(201).json(await formatResult(result));
});

// ── Update ─────────────────────────────────────────────────────────────────

router.put("/exam-results/:id", requireAuth, requireAcademic, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const { marksObtained, totalMarks, remarks, examName } = req.body as {
    marksObtained?: number; totalMarks?: number; remarks?: string; examName?: string;
  };
  const [existing] = await db.select().from(examResultsTable).where(eq(examResultsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "NOT_FOUND" }); return; }

  const newObtained = marksObtained ?? parseFloat(existing.marksObtained);
  const newTotal = totalMarks ?? parseFloat(existing.totalMarks);
  const pct = Math.round((newObtained / newTotal) * 100);
  const grade = gradeFromPercent(pct);

  const [updated] = await db.update(examResultsTable).set({
    marksObtained: String(newObtained), totalMarks: String(newTotal),
    grade, remarks: remarks ?? existing.remarks,
    examName: examName ?? existing.examName, updatedAt: new Date(),
  }).where(eq(examResultsTable.id, id)).returning();

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "exam_result", entityId: id,
    description: `Updated exam result #${id}`,
  });
  res.json(await formatResult(updated));
});

// ── Delete ─────────────────────────────────────────────────────────────────

router.delete("/exam-results/:id", requireAuth, requireAcademic, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [deleted] = await db.delete(examResultsTable).where(eq(examResultsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "exam_result", entityId: id,
    description: `Deleted exam result #${id}`,
  });
  res.json({ message: "Deleted" });
});

export default router;
