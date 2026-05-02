import { Router } from "express";
import { db } from "@workspace/db";
import { parentStudentsTable, studentsTable, usersTable, classesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAdmin } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";

const router = Router();

// ── List linked students for a parent user ─────────────────────────────────

router.get("/parent-students", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parentUserId = req.query["parentUserId"]
    ? parseInt(String(req.query["parentUserId"]), 10)
    : req.userId!;

  // PARENT role can only see their own links
  if (req.userRole === "PARENT" && parentUserId !== req.userId) {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }

  const links = await db
    .select({
      linkId: parentStudentsTable.id,
      relationship: parentStudentsTable.relationship,
      createdAt: parentStudentsTable.createdAt,
      studentId: studentsTable.id,
      studentKey: studentsTable.studentId,
      firstName: studentsTable.firstName,
      lastName: studentsTable.lastName,
      dateOfBirth: studentsTable.dateOfBirth,
      gender: studentsTable.gender,
      classId: studentsTable.classId,
      status: studentsTable.status,
      admissionDate: studentsTable.admissionDate,
      parentName: studentsTable.parentName,
      parentPhone: studentsTable.parentPhone,
      parentEmail: studentsTable.parentEmail,
    })
    .from(parentStudentsTable)
    .innerJoin(studentsTable, eq(parentStudentsTable.studentId, studentsTable.id))
    .where(eq(parentStudentsTable.parentUserId, parentUserId));

  // Enrich with className
  const enriched = await Promise.all(links.map(async l => {
    let className: string | null = null;
    if (l.classId) {
      const [cls] = await db.select({ name: classesTable.name, section: classesTable.section })
        .from(classesTable).where(eq(classesTable.id, l.classId)).limit(1);
      if (cls) className = cls.section ? `${cls.name} - ${cls.section}` : cls.name;
    }
    return {
      linkId: l.linkId,
      relationship: l.relationship,
      linkedAt: l.createdAt.toISOString(),
      id: l.studentId,
      studentId: l.studentKey,
      firstName: l.firstName,
      lastName: l.lastName,
      dateOfBirth: l.dateOfBirth,
      gender: l.gender,
      classId: l.classId,
      className,
      status: l.status,
      admissionDate: l.admissionDate,
      parentName: l.parentName,
      parentPhone: l.parentPhone,
      parentEmail: l.parentEmail,
    };
  }));

  res.json({ links: enriched, total: enriched.length });
});

// ── Add a parent-student link ───────────────────────────────────────────────

router.post("/parent-students", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { parentUserId, studentId, relationship } = req.body as {
    parentUserId?: number; studentId?: number; relationship?: string;
  };

  if (!parentUserId || !studentId) {
    res.status(400).json({ error: "parentUserId and studentId are required" });
    return;
  }

  // Verify parent user exists and has PARENT role
  const [parentUser] = await db.select({ id: usersTable.id, role: usersTable.role, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, parentUserId)).limit(1);
  if (!parentUser) { res.status(404).json({ error: "Parent user not found" }); return; }
  if (parentUser.role !== "PARENT") {
    res.status(400).json({ error: "User must have PARENT role to be linked to a student" });
    return;
  }

  // Verify student exists
  const [student] = await db.select({ id: studentsTable.id, firstName: studentsTable.firstName, lastName: studentsTable.lastName })
    .from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }

  // Check for existing link
  const [existing] = await db.select({ id: parentStudentsTable.id })
    .from(parentStudentsTable)
    .where(and(
      eq(parentStudentsTable.parentUserId, parentUserId),
      eq(parentStudentsTable.studentId, studentId),
    )).limit(1);

  if (existing) {
    res.status(409).json({ error: "Link already exists" });
    return;
  }

  const [link] = await db.insert(parentStudentsTable).values({
    parentUserId,
    studentId,
    relationship: relationship ?? "PARENT",
  }).returning();

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "CREATE", entity: "parent_student_link", entityId: link.id,
    description: `Linked parent user #${parentUserId} (${parentUser.email}) to student ${student.firstName} ${student.lastName}`,
    metadata: { parentUserId, studentId, relationship: link.relationship },
  });

  res.status(201).json({
    id: link.id,
    parentUserId: link.parentUserId,
    studentId: link.studentId,
    relationship: link.relationship,
    createdAt: link.createdAt.toISOString(),
  });
});

// ── Remove a parent-student link ───────────────────────────────────────────

router.delete("/parent-students/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "BAD_REQUEST" }); return; }

  const [link] = await db.select().from(parentStudentsTable)
    .where(eq(parentStudentsTable.id, id)).limit(1);
  if (!link) { res.status(404).json({ error: "Link not found" }); return; }

  await db.delete(parentStudentsTable).where(eq(parentStudentsTable.id, id));

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "DELETE", entity: "parent_student_link", entityId: id,
    description: `Removed parent-student link #${id} (parent #${link.parentUserId} → student #${link.studentId})`,
    metadata: { linkId: id, parentUserId: link.parentUserId, studentId: link.studentId },
  });

  res.json({ message: "Link removed" });
});

export default router;
