import { useState, useEffect } from "react";
import {
  useListStudents, useCreateStudent, useUpdateStudent, useDeleteStudent,
  useListClasses, getListStudentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Student } from "@workspace/api-client-react";
import { usePermissions, useAuth } from "@/lib/auth";
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
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import { Search, Plus, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, Eye, Lock, Upload, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

const CSV_TEMPLATE = `first_name,last_name,gender,date_of_birth,parent_name,parent_phone,parent_email,address
Ahmed,Khan,MALE,2010-05-15,Mohammad Khan,01711234567,parent@example.com,Dhaka
Fatima,Ali,FEMALE,2011-03-22,Ali Hassan,01811234567,,Chittagong`;

function BulkImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [csv, setCsv] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    message: string; success: number; failed: number;
    results: { row: number; status: "success" | "error"; name?: string; error?: string }[];
  } | null>(null);

  const handleImport = async () => {
    if (!csv.trim()) return;
    setLoading(true);
    try {
      const res = await customFetch<typeof result>("/api/students/bulk-import", {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      setResult(res);
      if (res && res.success > 0) {
        qc.invalidateQueries({ queryKey: getListStudentsQueryKey() });
        toast({ title: `Imported ${res.success} student${res.success !== 1 ? "s" : ""}` });
      }
    } catch (err: any) {
      toast({ title: err?.data?.message ?? "Import failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "students-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => { setCsv(""); setResult(null); };

  return (
    <Dialog open={open} onOpenChange={() => { reset(); onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Import Students</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-4">
          {!result ? (
            <>
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-2">
                <p className="text-xs font-semibold text-blue-800">CSV Format</p>
                <p className="text-xs text-blue-700">
                  Required columns: <code className="bg-blue-100 px-1 rounded">first_name</code>, <code className="bg-blue-100 px-1 rounded">last_name</code>
                  <br />
                  Optional: gender, date_of_birth, parent_name, parent_phone, parent_email, address
                </p>
                <button onClick={downloadTemplate} className="text-xs text-blue-700 hover:text-blue-900 font-medium underline">
                  Download template CSV
                </button>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Paste CSV Data *</Label>
                <textarea
                  value={csv}
                  onChange={e => setCsv(e.target.value)}
                  rows={10}
                  placeholder={CSV_TEMPLATE}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className={`rounded-md border p-3 flex items-center gap-3 ${result.failed === 0 ? "border-green-200 bg-green-50" : "border-yellow-200 bg-yellow-50"}`}>
                {result.failed === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-yellow-600 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-semibold">{result.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {result.success} succeeded · {result.failed} failed
                  </p>
                </div>
              </div>
              <div className="rounded-md border divide-y max-h-60 overflow-y-auto">
                {result.results.map(r => (
                  <div key={r.row} className="flex items-center gap-2.5 px-3 py-2">
                    {r.status === "success"
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                    <span className="text-xs text-muted-foreground w-12 shrink-0">Row {r.row}</span>
                    <span className="text-xs font-medium">{r.name ?? "—"}</span>
                    {r.error && <span className="text-xs text-destructive ml-auto">{r.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="pt-2 border-t">
          {!result ? (
            <>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleImport} disabled={!csv.trim() || loading}>
                {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Import
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={reset}>Import More</Button>
              <Button onClick={onClose}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE = 15;

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  INACTIVE: "bg-gray-100 text-gray-600",
  GRADUATED: "bg-blue-100 text-blue-700",
  TRANSFERRED: "bg-yellow-100 text-yellow-700",
};

const studentSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  parentName: z.string().optional(),
  parentPhone: z.string().optional(),
  parentEmail: z.string().email().optional().or(z.literal("")),
  classId: z.number().optional(),
  admissionDate: z.string().optional(),
});
type StudentForm = z.infer<typeof studentSchema>;

function StudentFormDialog({
  student,
  open,
  onClose,
  lockedClassId,
}: { student?: Student; open: boolean; onClose: () => void; lockedClassId?: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createMutation = useCreateStudent();
  const updateMutation = useUpdateStudent();
  const { data: classesData } = useListClasses();
  const { user } = useAuth();

  const isTeacher = user?.role === "TEACHER";
  const allowedClasses = isTeacher
    ? (classesData?.classes.filter(c => c.teacherId === user?.id) ?? [])
    : (classesData?.classes ?? []);

  const { register, handleSubmit, setValue, formState: { errors }, reset } = useForm<StudentForm>({
    resolver: zodResolver(studentSchema),
    defaultValues: student ? {
      firstName: student.firstName,
      lastName: student.lastName,
      dateOfBirth: student.dateOfBirth ?? "",
      gender: student.gender as any,
      parentName: student.parentName ?? "",
      parentPhone: student.parentPhone ?? "",
      parentEmail: student.parentEmail ?? "",
      classId: student.classId ?? undefined,
    } : { classId: lockedClassId },
  });

  useEffect(() => {
    if (!student && lockedClassId) setValue("classId", lockedClassId);
  }, [lockedClassId, student, setValue]);

  const onSubmit = (data: StudentForm) => {
    const payload = { ...data, parentEmail: data.parentEmail || undefined };
    if (student) {
      updateMutation.mutate({ id: student.id, data: payload }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListStudentsQueryKey() });
          toast({ title: "Student updated" });
          onClose();
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      });
    } else {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListStudentsQueryKey() });
          toast({ title: "Student admitted" });
          onClose();
        },
        onError: () => toast({ title: "Failed to admit student", variant: "destructive" }),
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{student ? "Edit Student" : "Admit New Student"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>First Name *</Label>
              <Input {...register("firstName")} />
              {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Last Name *</Label>
              <Input {...register("lastName")} />
              {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Date of Birth</Label>
              <Input type="date" {...register("dateOfBirth")} />
            </div>
            <div className="space-y-1">
              <Label>Gender</Label>
              <Select onValueChange={v => setValue("gender", v as any)} defaultValue={student?.gender ?? undefined}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Class {isTeacher && lockedClassId && <span className="text-muted-foreground ml-1">(locked to your class)</span>}</Label>
            {isTeacher && lockedClassId ? (
              <div className="h-9 flex items-center rounded-md border border-border bg-muted px-3 text-sm text-muted-foreground">
                {allowedClasses.find(c => c.id === lockedClassId)?.name ?? "Your class"}
                <Lock className="ml-auto h-3.5 w-3.5" />
              </div>
            ) : (
              <Select onValueChange={v => setValue("classId", parseInt(v))} defaultValue={student?.classId?.toString() ?? lockedClassId?.toString()}>
                <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {allowedClasses.map(c => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name}{c.section ? ` - ${c.section}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Parent Name</Label>
              <Input {...register("parentName")} />
            </div>
            <div className="space-y-1">
              <Label>Parent Phone</Label>
              <Input {...register("parentPhone")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Parent Email</Label>
            <Input type="email" {...register("parentEmail")} />
          </div>
          <div className="space-y-1">
            <Label>Admission Date</Label>
            <Input type="date" {...register("admissionDate")} defaultValue={new Date().toISOString().split("T")[0]} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {student ? "Save Changes" : "Admit Student"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ViewDialog({ student, open, onClose }: { student: Student | null; open: boolean; onClose: () => void }) {
  if (!student) return null;
  const fields = [
    ["Student ID", student.studentId],
    ["Full Name", `${student.firstName} ${student.lastName}`],
    ["Date of Birth", student.dateOfBirth ?? "-"],
    ["Gender", student.gender ?? "-"],
    ["Class", student.className ?? "-"],
    ["Parent Name", student.parentName ?? "-"],
    ["Parent Phone", student.parentPhone ?? "-"],
    ["Parent Email", student.parentEmail ?? "-"],
    ["Admission Date", student.admissionDate],
    ["Status", student.status],
  ];
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{student.firstName} {student.lastName}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground uppercase tracking-wider">{label}</dt>
              <dd className="font-medium mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

export default function StudentsPage() {
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | undefined>();
  const [viewStudent, setViewStudent] = useState<Student | null>(null);

  const qc = useQueryClient();
  const { toast } = useToast();
  const perms = usePermissions();
  const { user } = useAuth();
  const deleteMutation = useDeleteStudent();

  const { data: classesData } = useListClasses();
  const isTeacher = user?.role === "TEACHER";

  const teacherClasses = isTeacher
    ? (classesData?.classes.filter(c => c.teacherId === user?.id) ?? [])
    : (classesData?.classes ?? []);

  useEffect(() => {
    if (isTeacher && teacherClasses.length > 0 && !classFilter) {
      setClassFilter(String(teacherClasses[0]!.id));
    }
  }, [isTeacher, teacherClasses.length]);

  const params = {
    search: search || undefined,
    classId: classFilter ? parseInt(classFilter) : undefined,
    status: statusFilter as any || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading } = useListStudents(params);

  const handleDelete = (s: Student) => {
    if (!confirm(`Delete ${s.firstName} ${s.lastName}?`)) return;
    deleteMutation.mutate({ id: s.id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListStudentsQueryKey() });
        toast({ title: "Student deleted" });
      },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  };

  const [importOpen, setImportOpen] = useState(false);
  const lockedClassId = isTeacher && teacherClasses.length > 0 ? teacherClasses[0]!.id : undefined;
  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Students</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{data?.total ?? 0} total students</p>
        </div>
        {perms.canManageStudents && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Bulk Import
            </Button>
            <Button size="sm" onClick={() => { setEditStudent(undefined); setFormOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Admit Student
            </Button>
          </div>
        )}
      </div>

      {isTeacher && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Showing students from your assigned {teacherClasses.length > 1 ? "classes" : "class"} only.
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search students..."
            className="pl-9 w-60"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        {!isTeacher && (
          <Select value={classFilter} onValueChange={v => { setClassFilter(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {classesData?.classes.map(c => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.name}{c.section ? ` - ${c.section}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {isTeacher && teacherClasses.length > 1 && (
          <Select value={classFilter} onValueChange={v => { setClassFilter(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Select class" /></SelectTrigger>
            <SelectContent>
              {teacherClasses.map(c => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.name}{c.section ? ` - ${c.section}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v === "all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["ACTIVE", "INACTIVE", "GRADUATED", "TRANSFERRED"].map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Student ID", "Name", "Class", "Parent", "Status", "Admitted", "Actions"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : data?.students.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No students found
                </td>
              </tr>
            ) : (
              data?.students.map(s => (
                <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.studentId}</td>
                  <td className="px-4 py-3 font-medium">{s.firstName} {s.lastName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.className ?? "-"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.parentName ?? "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[s.status] ?? ""}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.admissionDate}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setViewStudent(s)} className="p-1 text-muted-foreground hover:text-foreground rounded">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      {perms.canManageStudents && (
                        <button onClick={() => { setEditStudent(s); setFormOpen(true); }} className="p-1 text-muted-foreground hover:text-foreground rounded">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {perms.canDeleteStudents && (
                        <button onClick={() => handleDelete(s)} className="p-1 text-muted-foreground hover:text-destructive rounded">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data?.total ?? 0)} of {data?.total} students
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-muted-foreground">Page {page + 1} of {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {perms.canManageStudents && (
        <StudentFormDialog
          student={editStudent}
          open={formOpen}
          onClose={() => setFormOpen(false)}
          lockedClassId={lockedClassId}
        />
      )}
      {perms.canManageStudents && (
        <BulkImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      )}
      <ViewDialog student={viewStudent} open={!!viewStudent} onClose={() => setViewStudent(null)} />
    </div>
  );
}
