import { Router } from "express";
import { db } from "@workspace/db";
import { studentsTable, classesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { requireAdmin } from "../../middlewares/requireRole.js";
import { audit } from "../../lib/audit.js";

const router = Router();

function generateStudentId(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `STU-${year}-${rand}`;
}

function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

router.post("/students/bulk-import", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { csv } = req.body as { csv?: string };
  if (!csv?.trim()) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "CSV data is required" });
    return;
  }
  const rows = parseCSV(csv);
  if (!rows.length) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "No valid rows found in CSV" });
    return;
  }

  const results: { row: number; status: "success" | "error"; name?: string; error?: string }[] = [];
  let successCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const firstName = row["first_name"] ?? row["firstname"] ?? "";
    const lastName = row["last_name"] ?? row["lastname"] ?? "";
    if (!firstName.trim() || !lastName.trim()) {
      results.push({ row: i + 2, status: "error", error: "Missing first_name or last_name" });
      continue;
    }
    try {
      const admissionDate = row["admission_date"] ?? row["admissiondate"] ?? new Date().toISOString().split("T")[0]!;
      const [student] = await db.insert(studentsTable).values({
        studentId: generateStudentId(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        gender: (row["gender"]?.toUpperCase() as any) || null,
        dateOfBirth: row["date_of_birth"] ?? row["dob"] ?? null,
        parentName: row["parent_name"] ?? row["parentname"] ?? null,
        parentPhone: row["parent_phone"] ?? row["parentphone"] ?? null,
        parentEmail: row["parent_email"] ?? row["parentemail"] ?? null,
        address: row["address"] ?? null,
        admissionDate,
        status: "ACTIVE",
      }).returning();
      results.push({ row: i + 2, status: "success", name: `${student.firstName} ${student.lastName}` });
      successCount++;
    } catch {
      results.push({ row: i + 2, status: "error", name: `${firstName} ${lastName}`, error: "Insert failed" });
    }
  }

  await audit({
    userId: req.userId, userEmail: req.userEmail, userRole: req.userRole,
    action: "BULK_IMPORT", entity: "student",
    description: `Bulk imported ${successCount} of ${rows.length} students`,
    metadata: { total: rows.length, success: successCount, failed: rows.length - successCount },
  });

  res.json({
    message: `Imported ${successCount} of ${rows.length} students`,
    success: successCount,
    failed: rows.length - successCount,
    results,
  });
});

export default router;
