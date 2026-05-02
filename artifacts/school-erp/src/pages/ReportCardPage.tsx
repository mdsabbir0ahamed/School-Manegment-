import { useState } from "react";
import { useListStudents, customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { usePermissions } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Printer, GraduationCap, CalendarCheck, Banknote, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Student {
  id: number; firstName: string; lastName: string; studentId: string;
  className?: string | null; dateOfBirth?: string | null;
  parentName?: string | null; admissionDate: string;
}

interface ExamResult {
  id: number; subjectName: string; subjectCode: string;
  examType: string; examName: string;
  marksObtained: number; totalMarks: number; percentage: number; grade: string;
  examDate: string;
}

interface AttendanceRecord { status: string; }
interface Invoice {
  id: number; invoiceNumber: string; totalAmount: number; paidAmount: number;
  dueDate: string; status: string; feeTypeName: string; month: string | null;
}

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  "A+": { bg: "bg-green-100", text: "text-green-800" },
  "A":  { bg: "bg-green-100", text: "text-green-800" },
  "B":  { bg: "bg-blue-100",  text: "text-blue-800"  },
  "C":  { bg: "bg-yellow-100", text: "text-yellow-800" },
  "D":  { bg: "bg-orange-100", text: "text-orange-800" },
  "F":  { bg: "bg-red-100",    text: "text-red-800"   },
};

function useStudentExamResults(studentId?: number) {
  return useQuery<{ results: ExamResult[] }>({
    queryKey: ["report-card-exams", studentId],
    queryFn: () => customFetch(`/api/exam-results?studentId=${studentId}&limit=200`),
    enabled: !!studentId,
  });
}

function useStudentAttendance(studentId?: number) {
  return useQuery<{ records: AttendanceRecord[] }>({
    queryKey: ["report-card-attendance", studentId],
    queryFn: () => customFetch(`/api/attendance?studentId=${studentId}&limit=400`),
    enabled: !!studentId,
  });
}

function useStudentInvoices(studentId?: number) {
  return useQuery<{ invoices: Invoice[] }>({
    queryKey: ["report-card-invoices", studentId],
    queryFn: () => customFetch(`/api/invoices?studentId=${studentId}&limit=50`),
    enabled: !!studentId,
  });
}

function GradeCell({ grade }: { grade: string }) {
  const colors = GRADE_COLORS[grade] ?? { bg: "bg-gray-100", text: "text-gray-700" };
  return (
    <span className={cn("inline-flex items-center justify-center rounded-full h-7 w-7 text-xs font-bold", colors.bg, colors.text)}>
      {grade}
    </span>
  );
}

function ProgressBar({ value, max = 100, color = "bg-primary" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums w-10 text-right">{pct}%</span>
    </div>
  );
}

function ReportCard({ student }: { student: Student }) {
  const { data: examData, isLoading: examLoading } = useStudentExamResults(student.id);
  const { data: attData, isLoading: attLoading } = useStudentAttendance(student.id);
  const { data: invData, isLoading: invLoading } = useStudentInvoices(student.id);

  const results = examData?.results ?? [];
  const attendance = attData?.records ?? [];
  const invoices = invData?.invoices ?? [];

  const attPresent = attendance.filter(r => r.status === "PRESENT").length;
  const attTotal = attendance.length;
  const attPct = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : null;

  const totalDue = invoices
    .filter(i => i.status === "PENDING" || i.status === "OVERDUE")
    .reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0);
  const totalPaid = invoices.reduce((s, i) => s + i.paidAmount, 0);
  const overdueCount = invoices.filter(i => i.status === "OVERDUE").length;

  const subjectMap = new Map<string, ExamResult[]>();
  results.forEach(r => {
    const key = `${r.subjectCode}__${r.subjectName}`;
    if (!subjectMap.has(key)) subjectMap.set(key, []);
    subjectMap.get(key)!.push(r);
  });

  const overallAvg = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / results.length)
    : null;

  const handlePrint = () => window.print();

  const isLoading = examLoading || attLoading || invLoading;

  return (
    <div className="space-y-6">
      {/* Toolbar (hidden in print) */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h2 className="text-base font-semibold">{student.firstName} {student.lastName}</h2>
          <p className="text-xs text-muted-foreground font-mono">{student.studentId} · {student.className ?? "No class"}</p>
        </div>
        <Button size="sm" onClick={handlePrint}>
          <Printer className="h-3.5 w-3.5 mr-1.5" /> Print Report Card
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        /* ── Printable area ─────────────────────────────────────── */
        <div id="report-card-print" className="space-y-5">

          {/* School header */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/[0.03] px-6 py-5 text-center print:border-gray-300 print:bg-white">
            <div className="flex items-center justify-center gap-3 mb-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white font-bold text-lg">S</div>
              <div className="text-left">
                <h1 className="text-xl font-bold tracking-tight">Smart School / Madrasa</h1>
                <p className="text-xs text-muted-foreground">Student Progress Report Card</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Generated on {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>

          {/* Student info grid */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold">Student Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                {[
                  { label: "Full Name", value: `${student.firstName} ${student.lastName}` },
                  { label: "Student ID", value: student.studentId },
                  { label: "Class", value: student.className ?? "—" },
                  { label: "Date of Birth", value: student.dateOfBirth ?? "—" },
                  { label: "Parent / Guardian", value: student.parentName ?? "—" },
                  { label: "Admission Date", value: student.admissionDate },
                  { label: "Academic Year", value: new Date().getFullYear().toString() },
                  { label: "Report Date", value: new Date().toLocaleDateString() },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
                    <p className="font-medium mt-0.5 truncate">{value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Exam results */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <GraduationCap className="h-4 w-4" /> Academic Results
                </CardTitle>
                {overallAvg !== null && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Overall Average</span>
                    <span className={cn(
                      "text-sm font-bold tabular-nums",
                      overallAvg >= 80 ? "text-green-600" : overallAvg >= 60 ? "text-blue-600" : overallAvg >= 40 ? "text-yellow-600" : "text-red-600"
                    )}>
                      {overallAvg}%
                    </span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {results.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">No exam results recorded yet</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subject</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Exam</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Marks</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide w-20">%</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide w-16">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const isFirstOfSubject = i === 0 || results[i - 1]?.subjectCode !== r.subjectCode;
                      return (
                        <tr key={r.id} className={cn("border-b last:border-0", isFirstOfSubject && i > 0 ? "border-t-2 border-t-border" : "")}>
                          <td className="px-4 py-2.5">
                            {isFirstOfSubject ? (
                              <div>
                                <p className="font-medium">{r.subjectName}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">{r.subjectCode}</p>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs pl-2">↳</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-sm">{r.examName}</td>
                          <td className="px-4 py-2.5">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                              {r.examType.replace("_", " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-center font-mono text-sm">
                            {r.marksObtained}/{r.totalMarks}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <ProgressBar value={r.percentage} max={100} color={
                              r.percentage >= 80 ? "bg-green-500" :
                              r.percentage >= 60 ? "bg-blue-500" :
                              r.percentage >= 40 ? "bg-yellow-500" : "bg-red-500"
                            } />
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <GradeCell grade={r.grade} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {results.length > 1 && overallAvg !== null && (
                    <tfoot>
                      <tr className="bg-muted/30 border-t-2 border-border font-semibold">
                        <td className="px-4 py-2.5" colSpan={3}>Overall Average</td>
                        <td className="px-4 py-2.5 text-center">—</td>
                        <td className="px-4 py-2.5 text-center">
                          <ProgressBar value={overallAvg} max={100} color={
                            overallAvg >= 80 ? "bg-green-500" :
                            overallAvg >= 60 ? "bg-blue-500" :
                            overallAvg >= 40 ? "bg-yellow-500" : "bg-red-500"
                          } />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <GradeCell grade={
                            overallAvg >= 90 ? "A+" : overallAvg >= 80 ? "A" :
                            overallAvg >= 70 ? "B" : overallAvg >= 60 ? "C" :
                            overallAvg >= 50 ? "D" : "F"
                          } />
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </CardContent>
          </Card>

          {/* Attendance + Finance row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Attendance */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4" /> Attendance Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {attTotal === 0 ? (
                  <p className="text-sm text-muted-foreground">No attendance data</p>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {[
                        { label: "Total", value: attTotal, color: "" },
                        { label: "Present", value: attPresent, color: "text-green-600" },
                        { label: "Absent", value: attendance.filter(r => r.status === "ABSENT").length, color: "text-red-500" },
                        { label: "Late", value: attendance.filter(r => r.status === "LATE").length, color: "text-yellow-600" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="rounded-lg bg-muted/40 py-2 px-1">
                          <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                    {attPct !== null && (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Attendance Rate</span>
                          <span className={cn("font-bold", attPct >= 75 ? "text-green-600" : "text-red-600")}>
                            {attPct}%
                          </span>
                        </div>
                        <ProgressBar
                          value={attPct}
                          color={attPct >= 75 ? "bg-green-500" : "bg-red-500"}
                        />
                        {attPct < 75 && (
                          <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5">
                            <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                            <p className="text-xs text-red-600">Below minimum 75% threshold</p>
                          </div>
                        )}
                        {attPct >= 75 && (
                          <div className="flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2.5 py-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            <p className="text-xs text-green-700">Satisfactory attendance</p>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Finance */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Banknote className="h-4 w-4" /> Fee Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No invoices</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {[
                        { label: "Invoices", value: invoices.length, color: "" },
                        { label: "Paid", value: `৳${totalPaid.toLocaleString()}`, color: "text-green-600" },
                        { label: "Due", value: `৳${totalDue.toLocaleString()}`, color: totalDue > 0 ? "text-red-500" : "text-muted-foreground" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="rounded-lg bg-muted/40 py-2 px-1">
                          <p className={cn("text-base font-bold", color)}>{value}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                    {overdueCount > 0 && (
                      <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5">
                        <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                        <p className="text-xs text-red-600">{overdueCount} overdue invoice{overdueCount > 1 ? "s" : ""} — payment required</p>
                      </div>
                    )}
                    {totalDue === 0 && (
                      <div className="flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2.5 py-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        <p className="text-xs text-green-700">All fees cleared</p>
                      </div>
                    )}
                    <div className="divide-y text-xs max-h-32 overflow-y-auto print:overflow-visible print:max-h-none">
                      {invoices.slice(0, 8).map(inv => (
                        <div key={inv.id} className="flex items-center justify-between py-1.5">
                          <span className="text-muted-foreground">{inv.feeTypeName}{inv.month ? ` (${inv.month})` : ""}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">৳{inv.totalAmount.toLocaleString()}</span>
                            <span className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-medium",
                              inv.status === "PAID" ? "bg-green-100 text-green-700" :
                              inv.status === "OVERDUE" ? "bg-red-100 text-red-700" :
                              "bg-yellow-100 text-yellow-700"
                            )}>
                              {inv.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Footer / signature area */}
          <div className="rounded-lg border border-dashed border-border px-6 py-4 grid grid-cols-3 gap-4 text-center text-xs text-muted-foreground">
            {["Class Teacher", "Principal", "Parent / Guardian"].map(label => (
              <div key={label}>
                <div className="h-8 border-b border-border mx-4 mb-1" />
                <p className="font-medium">{label}</p>
                <p className="mt-0.5">Signature & Date</p>
              </div>
            ))}
          </div>

          <p className="text-center text-[10px] text-muted-foreground print:text-gray-400">
            This report card was generated automatically by Smart School ERP · {new Date().toLocaleDateString()}
          </p>
        </div>
      )}
    </div>
  );
}

export default function ReportCardPage() {
  const perms = usePermissions();
  const { data: studentsData } = useListStudents({ limit: 300, offset: 0 });
  const [selectedId, setSelectedId] = useState<number | undefined>();

  const selected = studentsData?.students.find(s => s.id === selectedId);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Student Report Card</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Academic results, attendance, and fee summary
        </p>
      </div>

      <Card className="print:hidden">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <Label className="text-xs whitespace-nowrap">Select Student</Label>
            <Select value={selectedId ? String(selectedId) : ""} onValueChange={v => setSelectedId(parseInt(v))}>
              <SelectTrigger className="max-w-xs">
                <SelectValue placeholder="Choose a student to generate report card" />
              </SelectTrigger>
              <SelectContent>
                {(studentsData?.students ?? []).map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.firstName} {s.lastName} — {s.studentId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!selected ? (
        <div className="flex flex-col items-center py-24 text-muted-foreground print:hidden">
          <GraduationCap className="h-12 w-12 mb-3 opacity-20" />
          <p className="text-sm">Select a student above to generate their report card</p>
        </div>
      ) : (
        <ReportCard student={selected as Student} />
      )}

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #report-card-print, #report-card-print * { visibility: visible; }
          #report-card-print { position: absolute; top: 0; left: 0; width: 100%; padding: 24px; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
