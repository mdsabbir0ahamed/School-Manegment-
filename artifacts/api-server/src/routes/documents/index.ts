import { Router } from "express";
import { db } from "@workspace/db";
import { studentDocumentsTable, studentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAcademic } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";

const router = Router();

const ALLOWED_TYPES = ["PROFILE_PHOTO", "ADMIT_CARD", "BIRTH_CERTIFICATE", "NATIONAL_ID", "TRANSFER_CERTIFICATE", "OTHER"];

router.get("/students/:studentId/documents", requireAuth, requireAcademic, async (req, res): Promise<void> => {
  const studentId = parseInt(String(req.params["studentId"]), 10);
  if (isNaN(studentId)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const docs = await db.select().from(studentDocumentsTable)
    .where(eq(studentDocumentsTable.studentId, studentId))
    .orderBy(studentDocumentsTable.uploadedAt);
  res.json({
    documents: docs.map(d => ({
      id: d.id, studentId: d.studentId, type: d.type, title: d.title,
      fileUrl: d.fileUrl, fileSize: d.fileSize, mimeType: d.mimeType,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    total: docs.length,
  });
});

router.post("/students/:studentId/documents", requireAuth, requireAcademic, async (req: AuthRequest, res): Promise<void> => {
  const studentId = parseInt(String(req.params["studentId"]), 10);
  if (isNaN(studentId)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const { type, title, fileUrl, fileSize, mimeType } = req.body as {
    type?: string; title?: string; fileUrl?: string; fileSize?: number; mimeType?: string;
  };
  if (!type || !ALLOWED_TYPES.includes(type) || !title?.trim() || !fileUrl?.trim()) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "type, title, fileUrl required" });
    return;
  }
  const [student] = await db.select({ id: studentsTable.id }).from(studentsTable)
    .where(eq(studentsTable.id, studentId)).limit(1);
  if (!student) { res.status(404).json({ error: "STUDENT_NOT_FOUND" }); return; }

  const [doc] = await db.insert(studentDocumentsTable).values({
    studentId, type: type as any, title: title.trim(),
    fileUrl: fileUrl.trim(), fileSize: fileSize ?? null, mimeType: mimeType ?? null,
  }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "student_document", entityId: doc.id,
    description: `Uploaded ${type} for student #${studentId}: "${title}"`,
  });
  res.status(201).json({
    id: doc.id, studentId: doc.studentId, type: doc.type, title: doc.title,
    fileUrl: doc.fileUrl, fileSize: doc.fileSize, mimeType: doc.mimeType,
    uploadedAt: doc.uploadedAt.toISOString(),
  });
});

router.delete("/students/:studentId/documents/:docId", requireAuth, requireAcademic, async (req: AuthRequest, res): Promise<void> => {
  const studentId = parseInt(String(req.params["studentId"]), 10);
  const docId = parseInt(String(req.params["docId"]), 10);
  if (isNaN(studentId) || isNaN(docId)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [deleted] = await db.delete(studentDocumentsTable)
    .where(and(eq(studentDocumentsTable.id, docId), eq(studentDocumentsTable.studentId, studentId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "student_document", entityId: docId,
    description: `Deleted document "${deleted.title}" for student #${studentId}`,
  });
  res.json({ message: "Deleted" });
});

export default router;
