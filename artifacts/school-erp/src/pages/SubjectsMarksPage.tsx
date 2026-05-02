import { useState } from "react";
import { useListStudents, useListClasses, customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Pencil, BookOpen, GraduationCap, Loader2, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Subject { id: number; name: string; code: string; description: string | null; classId: number | null; }
interface ExamResult {
  id: number; studentId: number; studentName: string;
  subjectId: number; subjectName: string; subjectCode: string;
  examType: string; examName: string; marksObtained: number; totalMarks: number;
  percentage: number; grade: string; remarks: string | null; examDate: string;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-green-100 text-green-700",
  "A": "bg-green-100 text-green-700",
  "B": "bg-blue-100 text-blue-700",
  "C": "bg-yellow-100 text-yellow-700",
  "D": "bg-orange-100 text-orange-700",
  "F": "bg-red-100 text-red-700",
};

const EXAM_TYPES = ["MIDTERM", "FINAL", "UNIT_TEST", "ASSIGNMENT", "QUIZ", "PRACTICAL"];

function useSubjects(classId?: number) {
  return useQuery<{ subjects: Subject[]; total: number }>({
    queryKey: ["subjects", classId],
    queryFn: () => customFetch(`/api/subjects${classId ? `?classId=${classId}` : ""}`),
  });
}

function useExamResults(studentId?: number, subjectId?: number) {
  return useQuery<{ results: ExamResult[]; total: number }>({
    queryKey: ["exam-results", studentId, subjectId],
    queryFn: () => customFetch(`/api/exam-results?${studentId ? `studentId=${studentId}&` : ""}${subjectId ? `subjectId=${subjectId}` : ""}`),
    enabled: !!(studentId || subjectId),
  });
}

// ── Subject Dialog ─────────────────────────────────────────────────────────

function SubjectDialog({ subject, onClose }: { subject?: Subject; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: classesData } = useListClasses();
  const [name, setName] = useState(subject?.name ?? "");
  const [code, setCode] = useState(subject?.code ?? "");
  const [description, setDescription] = useState(subject?.description ?? "");
  const [classId, setClassId] = useState(subject?.classId ? String(subject.classId) : "");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (subject) {
        await customFetch(`/api/subjects/${subject.id}`, {
          method: "PUT",
          body: JSON.stringify({ name, code, description: description || null, classId: classId ? parseInt(classId) : null }),
        });
        toast({ title: "Subject updated" });
      } else {
        await customFetch("/api/subjects", {
          method: "POST",
          body: JSON.stringify({ name, code, description: description || null, classId: classId ? parseInt(classId) : null }),
        });
        toast({ title: "Subject created" });
      }
      qc.invalidateQueries({ queryKey: ["subjects"] });
      onClose();
    } catch (err: any) {
      toast({ title: err?.data?.message ?? "Failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{subject ? "Edit Subject" : "Add Subject"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Subject Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mathematics" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Code *</Label>
              <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. MATH101" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Class (optional)</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger><SelectValue placeholder="All classes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All classes</SelectItem>
                {(classesData?.classes ?? []).map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}{c.section ? ` - ${c.section}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name || !code || loading}>
              {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {subject ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Mark Entry Dialog ──────────────────────────────────────────────────────

function MarkEntryDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: studentsData } = useListStudents({ limit: 200, offset: 0 });
  const { data: subjectsData } = useSubjects();
  const [studentId, setStudentId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [examType, setExamType] = useState("MIDTERM");
  const [examName, setExamName] = useState("");
  const [obtained, setObtained] = useState("");
  const [total, setTotal] = useState("100");
  const [examDate, setExamDate] = useState(new Date().toISOString().split("T")[0]!);
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);

  const pct = obtained && total ? Math.round((parseFloat(obtained) / parseFloat(total)) * 100) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await customFetch("/api/exam-results", {
        method: "POST",
        body: JSON.stringify({
          studentId: parseInt(studentId), subjectId: parseInt(subjectId),
          examType, examName, marksObtained: parseFloat(obtained),
          totalMarks: parseFloat(total), examDate, remarks: remarks || null,
        }),
      });
      toast({ title: "Result recorded" });
      qc.invalidateQueries({ queryKey: ["exam-results"] });
      onClose();
    } catch (err: any) {
      toast({ title: err?.data?.message ?? "Failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Record Exam Result</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Student *</Label>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
                <SelectContent>
                  {(studentsData?.students ?? []).map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Subject *</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                <SelectContent>
                  {(subjectsData?.subjects ?? []).map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Exam Type *</Label>
              <Select value={examType} onValueChange={setExamType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXAM_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Exam Name *</Label>
              <Input value={examName} onChange={e => setExamName(e.target.value)} placeholder="e.g. Mid-year 2025" required />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Marks Obtained *</Label>
              <Input type="number" value={obtained} onChange={e => setObtained(e.target.value)} min="0" step="0.5" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Total Marks *</Label>
              <Input type="number" value={total} onChange={e => setTotal(e.target.value)} min="1" step="1" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Percentage</Label>
              <div className="h-9 flex items-center rounded-md border border-border bg-muted px-3 text-sm font-medium">
                {pct !== null ? `${pct}%` : "—"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Exam Date *</Label>
              <Input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Remarks</Label>
              <Input value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!studentId || !subjectId || !examName || !obtained || loading}>
              {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Record Result
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function SubjectsMarksPage() {
  const perms = usePermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editSubject, setEditSubject] = useState<Subject | null>(null);
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [showAddMark, setShowAddMark] = useState(false);
  const [filterStudent, setFilterStudent] = useState("");
  const { data: subjectsData, isLoading: subjectsLoading } = useSubjects();
  const { data: studentsData } = useListStudents({ limit: 200, offset: 0 });
  const { data: resultsData, isLoading: resultsLoading } = useExamResults(
    filterStudent ? parseInt(filterStudent) : undefined
  );

  const deleteSubject = async (id: number) => {
    try {
      await customFetch(`/api/subjects/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["subjects"] });
      toast({ title: "Subject deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const deleteResult = async (id: number) => {
    try {
      await customFetch(`/api/exam-results/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["exam-results"] });
      toast({ title: "Result deleted" });
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Subjects & Marks</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage subjects and student exam results</p>
      </div>

      <Tabs defaultValue="subjects">
        <TabsList>
          <TabsTrigger value="subjects" className="gap-1.5"><BookOpen className="h-3.5 w-3.5" />Subjects</TabsTrigger>
          <TabsTrigger value="marks" className="gap-1.5"><GraduationCap className="h-3.5 w-3.5" />Exam Results</TabsTrigger>
        </TabsList>

        {/* ── Subjects Tab ──────────────────────────────────────────────── */}
        <TabsContent value="subjects" className="mt-4 space-y-4">
          <div className="flex justify-end">
            {perms.canManageClasses && (
              <Button size="sm" onClick={() => setShowAddSubject(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Subject
              </Button>
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              {subjectsLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
                </div>
              ) : !subjectsData?.subjects.length ? (
                <div className="flex flex-col items-center py-16 text-muted-foreground">
                  <Code2 className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No subjects yet</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide">Name</th>
                      <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide">Code</th>
                      <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide hidden md:table-cell">Description</th>
                      {perms.canManageClasses && <th className="px-4 py-2.5 text-right font-medium text-xs uppercase tracking-wide">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {subjectsData.subjects.map(s => (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium">{s.name}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="font-mono text-xs">{s.code}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{s.description ?? "—"}</td>
                        {perms.canManageClasses && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button onClick={() => setEditSubject(s)} className="text-muted-foreground hover:text-foreground">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => deleteSubject(s.id)} className="text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Marks Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="marks" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Label className="text-xs whitespace-nowrap">Filter by Student</Label>
              <Select value={filterStudent} onValueChange={setFilterStudent}>
                <SelectTrigger className="max-w-xs"><SelectValue placeholder="All students" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All students</SelectItem>
                  {(studentsData?.students ?? []).map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {perms.canManageStudents && (
              <Button size="sm" onClick={() => setShowAddMark(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Record Result
              </Button>
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              {!filterStudent ? (
                <div className="flex flex-col items-center py-16 text-muted-foreground">
                  <GraduationCap className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">Select a student to view their results</p>
                </div>
              ) : resultsLoading ? (
                <div className="p-4 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
              ) : !resultsData?.results.length ? (
                <div className="flex flex-col items-center py-16 text-muted-foreground">
                  <GraduationCap className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No results recorded for this student</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide">Subject</th>
                      <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide">Exam</th>
                      <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide">Marks</th>
                      <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide">%</th>
                      <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide">Grade</th>
                      <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide hidden md:table-cell">Date</th>
                      {perms.canManageStudents && <th className="px-4 py-2.5 text-right font-medium text-xs uppercase tracking-wide">Del</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {resultsData.results.map(r => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium">{r.subjectName}</td>
                        <td className="px-4 py-3">
                          <div>{r.examName}</div>
                          <div className="text-xs text-muted-foreground">{r.examType.replace("_", " ")}</div>
                        </td>
                        <td className="px-4 py-3 font-mono">{r.marksObtained}/{r.totalMarks}</td>
                        <td className="px-4 py-3">{r.percentage}%</td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", GRADE_COLORS[r.grade] ?? "bg-gray-100 text-gray-700")}>
                            {r.grade}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{r.examDate}</td>
                        {perms.canManageStudents && (
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => deleteResult(r.id)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {showAddSubject && <SubjectDialog onClose={() => setShowAddSubject(false)} />}
      {editSubject && <SubjectDialog subject={editSubject} onClose={() => setEditSubject(null)} />}
      {showAddMark && <MarkEntryDialog onClose={() => setShowAddMark(false)} />}
    </div>
  );
}
