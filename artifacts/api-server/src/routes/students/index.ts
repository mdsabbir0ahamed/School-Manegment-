import { Router } from "express";
import { db } from "@workspace/db";
import {
  studentsTable, classesTable, parentStudentsTable,
  invoicesTable, transactionsTable, feeTypesTable,
} from "@workspace/db";
import { eq, ilike, and, count, sql, inArray, asc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAdmin } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";
import { CreateStudentBody, UpdateStudentBody, ListStudentsQueryParams } from "@workspace/api-zod";

const router = Router();

function genStudentId(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `STU-${year}-${rand}`;
}

async function formatStudent(s: typeof studentsTable.$inferSelect) {
  let className: string | null = null;
  if (s.classId) {
    const [cls] = await db.select({ name: classesTable.name, section: classesTable.section })
      .from(classesTable).where(eq(classesTable.id, s.classId)).limit(1);
    if (cls) className = cls.section ? `${cls.name} - ${cls.section}` : cls.name;
  }
  return {
    id: s.id, studentId: s.studentId, firstName: s.firstName, lastName: s.lastName,
    dateOfBirth: s.dateOfBirth, gender: s.gender, address: s.address,
    phoneNumber: s.phoneNumber, parentName: s.parentName, parentPhone: s.parentPhone,
    parentEmail: s.parentEmail, classId: s.classId, className,
    status: s.status, admissionDate: s.admissionDate, createdAt: s.createdAt.toISOString(),
  };
}

async function getTeacherClassIds(teacherId: number): Promise<number[]> {
  const classes = await db.select({ id: classesTable.id }).from(classesTable).where(eq(classesTable.teacherId, teacherId));
  return classes.map(c => c.id);
}

router.get("/students", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole;
  // PARENT role: can only query their own linked students (explicit links + email fallback)
  if (role === "PARENT") {
    if (!req.userId) { res.status(403).json({ error: "FORBIDDEN" }); return; }
    // 1. Explicit parent_students links
    const links = await db.select({ studentId: parentStudentsTable.studentId })
      .from(parentStudentsTable).where(eq(parentStudentsTable.parentUserId, req.userId));
    const explicitIds = links.map(l => l.studentId);
    // 2. Email-based fallback
    const parentEmail = req.userEmail;
    const emailStudents = parentEmail
      ? await db.select({ id: studentsTable.id }).from(studentsTable)
          .where(eq(studentsTable.parentEmail, parentEmail))
      : [];
    const emailIds = emailStudents.map(s => s.id);
    // Merge both sources (deduplicated)
    const allIds = [...new Set([...explicitIds, ...emailIds])];
    if (allIds.length === 0) { res.json({ students: [], total: 0 }); return; }
    const students = await db.select().from(studentsTable)
      .where(inArray(studentsTable.id, allIds));
    res.json({ students: await Promise.all(students.map(formatStudent)), total: students.length });
    return;
  }
  if (role === "ACCOUNTANT" || role === "STUDENT") {
    res.status(403).json({ error: "FORBIDDEN" }); return;
  }
  let teacherClassIds: number[] | null = null;
  if (role === "TEACHER" && req.userId) {
    teacherClassIds = await getTeacherClassIds(req.userId);
    if (teacherClassIds.length === 0) { res.json({ students: [], total: 0 }); return; }
  }
  const parsed = ListStudentsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : { limit: 20, offset: 0 };
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const conditions = [];
  if (teacherClassIds) {
    if (params.classId) {
      if (!teacherClassIds.includes(params.classId)) { res.status(403).json({ error: "FORBIDDEN", message: "Not your class" }); return; }
      conditions.push(eq(studentsTable.classId, params.classId));
    } else {
      conditions.push(inArray(studentsTable.classId, teacherClassIds));
    }
  } else if (params.classId) {
    conditions.push(eq(studentsTable.classId, params.classId));
  }
  if (params.status) conditions.push(eq(studentsTable.status, params.status as any));
  if (params.search) {
    const search = `%${params.search}%`;
    conditions.push(sql`(${ilike(studentsTable.firstName, search)} OR ${ilike(studentsTable.lastName, search)} OR ${ilike(studentsTable.studentId, search)})`);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const [students, totalResult] = await Promise.all([
    db.select().from(studentsTable).where(where).limit(limit).offset(offset).orderBy(studentsTable.createdAt),
    db.select({ count: count() }).from(studentsTable).where(where),
  ]);
  res.json({ students: await Promise.all(students.map(formatStudent)), total: totalResult[0]?.count ?? 0 });
});

router.post("/students", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "ACCOUNTANT" || role === "PARENT" || role === "STUDENT") { res.status(403).json({ error: "FORBIDDEN" }); return; }
  if (role === "TEACHER" && req.userId) {
    const teacherClassIds = await getTeacherClassIds(req.userId);
    const parsed2 = CreateStudentBody.safeParse(req.body);
    if (parsed2.success && parsed2.data.classId && !teacherClassIds.includes(parsed2.data.classId)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Not your class" }); return;
    }
  }
  const parsed = CreateStudentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid input" }); return; }
  const d = parsed.data;
  const toDateStr = (dt: Date | undefined | null): string | null => dt ? dt.toISOString().split("T")[0]! : null;
  const admissionDate = d.admissionDate ? toDateStr(d.admissionDate)! : new Date().toISOString().split("T")[0]!;
  const [student] = await db.insert(studentsTable).values({
    studentId: genStudentId(), firstName: d.firstName, lastName: d.lastName,
    dateOfBirth: toDateStr(d.dateOfBirth), gender: d.gender ?? null, address: d.address ?? null,
    phoneNumber: d.phoneNumber ?? null, parentName: d.parentName ?? null,
    parentPhone: d.parentPhone ?? null, parentEmail: d.parentEmail ?? null,
    classId: d.classId ?? null, status: "ACTIVE", admissionDate,
  }).returning();
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "student", entityId: student.id,
    description: `Admitted student ${student.firstName} ${student.lastName} (${student.studentId})`,
    metadata: { studentId: student.studentId, classId: student.classId },
  });
  res.status(201).json(await formatStudent(student));
});

router.get("/students/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "ACCOUNTANT" || role === "PARENT" || role === "STUDENT") { res.status(403).json({ error: "FORBIDDEN" }); return; }
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, id)).limit(1);
  if (!student) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  if (role === "TEACHER" && req.userId && student.classId) {
    const teacherClassIds = await getTeacherClassIds(req.userId);
    if (!teacherClassIds.includes(student.classId)) { res.status(403).json({ error: "FORBIDDEN" }); return; }
  }
  res.json(await formatStudent(student));
});

router.put("/students/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole;
  if (role === "ACCOUNTANT" || role === "PARENT" || role === "STUDENT") { res.status(403).json({ error: "FORBIDDEN" }); return; }
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  if (role === "TEACHER" && req.userId) {
    const [existing] = await db.select({ classId: studentsTable.classId }).from(studentsTable).where(eq(studentsTable.id, id)).limit(1);
    if (existing?.classId) {
      const teacherClassIds = await getTeacherClassIds(req.userId);
      if (!teacherClassIds.includes(existing.classId)) { res.status(403).json({ error: "FORBIDDEN", message: "Not your class" }); return; }
    }
  }
  const parsed = UpdateStudentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
  const d = parsed.data;
  const toDateStr = (dt: Date | undefined | null): string | null => dt ? dt.toISOString().split("T")[0]! : null;
  const updateFields: Record<string, unknown> = { updatedAt: new Date() };
  if (d.firstName !== undefined) updateFields["firstName"] = d.firstName;
  if (d.lastName !== undefined) updateFields["lastName"] = d.lastName;
  if (d.dateOfBirth !== undefined) updateFields["dateOfBirth"] = toDateStr(d.dateOfBirth);
  if (d.gender !== undefined) updateFields["gender"] = d.gender;
  if (d.address !== undefined) updateFields["address"] = d.address;
  if (d.phoneNumber !== undefined) updateFields["phoneNumber"] = d.phoneNumber;
  if (d.parentName !== undefined) updateFields["parentName"] = d.parentName;
  if (d.parentPhone !== undefined) updateFields["parentPhone"] = d.parentPhone;
  if (d.parentEmail !== undefined) updateFields["parentEmail"] = d.parentEmail;
  if (d.classId !== undefined) updateFields["classId"] = d.classId;
  if (d.status !== undefined) updateFields["status"] = d.status;
  const [student] = await db.update(studentsTable).set(updateFields as any).where(eq(studentsTable.id, id)).returning();
  if (!student) { res.status(404).json({ error: "NOT_FOUND" }); return; }
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "UPDATE", entity: "student", entityId: id,
    description: `Updated student ${student.firstName} ${student.lastName}`,
    metadata: updateFields as Record<string, unknown>,
  });
  res.json(await formatStudent(student));
});

// ── GET /students/:id/fee-ledger ──────────────────────────────────────────
// Staff-facing read-only fee ledger for any student. PARENT role blocked.
router.get("/students/:id/fee-ledger", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole === "PARENT") { res.status(403).json({ error: "FORBIDDEN" }); return; }
  const studentId = parseInt(String(req.params["id"]), 10);
  if (isNaN(studentId)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [student] = await db
    .select({
      id: studentsTable.id, studentId: studentsTable.studentId,
      firstName: studentsTable.firstName, lastName: studentsTable.lastName,
      classId: studentsTable.classId, admissionDate: studentsTable.admissionDate,
      parentName: studentsTable.parentName, parentEmail: studentsTable.parentEmail,
    })
    .from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);

  if (!student) { res.status(404).json({ error: "STUDENT_NOT_FOUND" }); return; }

  let className: string | null = null;
  if (student.classId) {
    const [cls] = await db.select({ name: classesTable.name, section: classesTable.section })
      .from(classesTable).where(eq(classesTable.id, student.classId)).limit(1);
    if (cls) className = cls.section ? `${cls.name} – ${cls.section}` : cls.name;
  }

  const [invoices, feeTypes, transactions] = await Promise.all([
    db.select().from(invoicesTable).where(eq(invoicesTable.studentId, studentId)).orderBy(asc(invoicesTable.dueDate)),
    db.select({ id: feeTypesTable.id, name: feeTypesTable.name }).from(feeTypesTable),
    db.select().from(transactionsTable).where(eq(transactionsTable.studentId, studentId)).orderBy(asc(transactionsTable.paidAt)),
  ]);

  const feeTypeMap = new Map(feeTypes.map(f => [f.id, f.name]));
  const txByInvoice = new Map<number, typeof transactions>();
  for (const tx of transactions) {
    const list = txByInvoice.get(tx.invoiceId) ?? [];
    list.push(tx);
    txByInvoice.set(tx.invoiceId, list);
  }

  const formattedInvoices = invoices.map(inv => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    feeTypeId: inv.feeTypeId,
    feeTypeName: feeTypeMap.get(inv.feeTypeId) ?? "Unknown",
    month: inv.month,
    totalAmount: parseFloat(inv.totalAmount),
    paidAmount: parseFloat(inv.paidAmount ?? "0"),
    dueDate: inv.dueDate,
    status: inv.status,
    escalationLevel: inv.escalationLevel,
    createdAt: inv.createdAt.toISOString(),
    transactions: (txByInvoice.get(inv.id) ?? []).map(tx => ({
      id: tx.id,
      amountPaid: parseFloat(tx.amountPaid),
      method: tx.method,
      transactionId: tx.transactionId,
      paidAt: tx.paidAt.toISOString(),
    })),
  }));

  const totalInvoiced = formattedInvoices.reduce((s, i) => s + i.totalAmount, 0);
  const totalPaid = formattedInvoices.reduce((s, i) => s + i.paidAmount, 0);
  const totalOutstanding = formattedInvoices.reduce((s, i) => s + Math.max(0, i.totalAmount - i.paidAmount), 0);
  const overdueCount = formattedInvoices.filter(i => i.status === "OVERDUE").length;

  res.json({
    student: {
      id: student.id, studentId: student.studentId,
      firstName: student.firstName, lastName: student.lastName,
      className, admissionDate: student.admissionDate,
      parentName: student.parentName, parentEmail: student.parentEmail,
    },
    summary: { totalInvoiced, totalPaid, totalOutstanding, overdueCount, invoiceCount: formattedInvoices.length },
    invoices: formattedInvoices,
    generatedAt: new Date().toISOString(),
  });
});

router.delete("/students/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }
  const [student] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable).where(eq(studentsTable.id, id)).limit(1);
  await db.delete(studentsTable).where(eq(studentsTable.id, id));
  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "student", entityId: id,
    description: `Deleted student ${student ? `${student.firstName} ${student.lastName}` : id}`,
  });
  res.status(204).send();
});

export default router;
