import { useState, useEffect } from "react";
import {
  useListAttendance, useMarkBulkAttendance, useListStudents, useListClasses,
  getListAttendanceQueryKey, getListStudentsQueryKey, getListAttendanceQueryKey as getAttendanceKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { CheckCircle, XCircle, Clock, AlertCircle, Loader2, Save, Lock } from "lucide-react";

const STATUS_OPTIONS = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
type AttendanceStatus = typeof STATUS_OPTIONS[number];

const statusStyles: Record<AttendanceStatus, string> = {
  PRESENT: "bg-green-100 text-green-700 border-green-200",
  ABSENT: "bg-red-100 text-red-700 border-red-200",
  LATE: "bg-yellow-100 text-yellow-700 border-yellow-200",
  EXCUSED: "bg-blue-100 text-blue-700 border-blue-200",
};

const statusIcons: Record<AttendanceStatus, React.ComponentType<{ className?: string }>> = {
  PRESENT: CheckCircle,
  ABSENT: XCircle,
  LATE: Clock,
  EXCUSED: AlertCircle,
};

export default function AttendancePage() {
  const today = new Date().toISOString().split("T")[0]!;
  const [date, setDate] = useState(today);
  const [classId, setClassId] = useState<string>("");
  const [statuses, setStatuses] = useState<Record<number, AttendanceStatus>>({});

  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isTeacher = user?.role === "TEACHER";

  const { data: classesData } = useListClasses();

  const allowedClasses = isTeacher
    ? (classesData?.classes.filter(c => c.teacherId === user?.id) ?? [])
    : (classesData?.classes ?? []);

  useEffect(() => {
    if (allowedClasses.length > 0 && !classId) {
      setClassId(String(allowedClasses[0]!.id));
    }
  }, [allowedClasses.length, isTeacher]);

  const studentParams = { classId: classId ? parseInt(classId) : undefined, limit: 100 };
  const attendanceParams = { classId: classId ? parseInt(classId) : undefined, date, limit: 100 };
  const { data: studentsData, isLoading: studentsLoading } = useListStudents(
    studentParams,
    { query: { enabled: !!classId, queryKey: getListStudentsQueryKey(studentParams) } }
  );
  const { data: attendanceData } = useListAttendance(
    attendanceParams,
    { query: { enabled: !!classId, queryKey: getAttendanceKey(attendanceParams) } }
  );

  const bulkMutation = useMarkBulkAttendance();

  const existingByStudent: Record<number, AttendanceStatus> = {};
  attendanceData?.records.forEach(r => {
    existingByStudent[r.studentId] = r.status as AttendanceStatus;
  });

  const getStatus = (studentId: number): AttendanceStatus =>
    statuses[studentId] ?? existingByStudent[studentId] ?? "PRESENT";

  const setStatus = (studentId: number, status: AttendanceStatus) => {
    setStatuses(prev => ({ ...prev, [studentId]: status }));
  };

  const markAll = (status: AttendanceStatus) => {
    const updates: Record<number, AttendanceStatus> = {};
    studentsData?.students.forEach(s => { updates[s.id] = status; });
    setStatuses(updates);
  };

  const handleSave = () => {
    if (!classId || !studentsData?.students.length) return;
    const records = studentsData.students.map(s => ({
      studentId: s.id,
      status: getStatus(s.id),
    }));
    bulkMutation.mutate(
      { data: { classId: parseInt(classId), date, records } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
          toast({ title: "Attendance saved successfully" });
          setStatuses({});
        },
        onError: () => toast({ title: "Failed to save attendance", variant: "destructive" }),
      }
    );
  };

  const summary = studentsData?.students.reduce(
    (acc, s) => {
      const status = getStatus(s.id);
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {} as Record<AttendanceStatus, number>
  );

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold">Attendance</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Mark and track daily attendance</p>
      </div>

      {isTeacher && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Showing attendance for your assigned {allowedClasses.length > 1 ? "classes" : "class"} only.
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {isTeacher && allowedClasses.length <= 1 ? (
          <div className="flex items-center gap-2 h-9 rounded-md border border-border bg-muted px-3 text-sm text-muted-foreground w-48">
            <span className="truncate">{allowedClasses[0]?.name ?? "Your class"}</span>
            <Lock className="ml-auto h-3.5 w-3.5 shrink-0" />
          </div>
        ) : (
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select class" /></SelectTrigger>
            <SelectContent>
              {allowedClasses.map(c => (
                <SelectItem key={c.id} value={c.id.toString()}>
                  {c.name}{c.section ? ` - ${c.section}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {classId && (
          <div className="flex gap-1 ml-auto">
            {STATUS_OPTIONS.map(s => (
              <Button key={s} variant="outline" size="sm" onClick={() => markAll(s)} className="text-xs h-8">
                All {s}
              </Button>
            ))}
          </div>
        )}
      </div>

      {!classId ? (
        <div className="flex items-center justify-center h-48 rounded-lg border border-dashed border-border text-muted-foreground text-sm">
          Select a class and date to mark attendance
        </div>
      ) : (
        <>
          {summary && (
            <div className="flex gap-3 flex-wrap">
              {STATUS_OPTIONS.map(s => {
                const Icon = statusIcons[s];
                return (
                  <div key={s} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", statusStyles[s])}>
                    <Icon className="h-3.5 w-3.5" />
                    {s}: {summary[s] ?? 0}
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {studentsLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-64" />
                </div>
              ))
            ) : studentsData?.students.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No students in this class
              </div>
            ) : (
              studentsData?.students.map((s, idx) => {
                const current = getStatus(s.id);
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums w-5">{idx + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{s.firstName} {s.lastName}</p>
                        <p className="text-[11px] text-muted-foreground">{s.studentId}</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {STATUS_OPTIONS.map(status => {
                        const Icon = statusIcons[status];
                        const active = current === status;
                        return (
                          <button
                            key={status}
                            onClick={() => setStatus(s.id, status)}
                            className={cn(
                              "flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all",
                              active ? statusStyles[status] : "border-border text-muted-foreground hover:bg-muted/50"
                            )}
                          >
                            <Icon className="h-3 w-3" />
                            {status === "EXCUSED" ? "Excsd" : status.slice(0, 4)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {studentsData?.students && studentsData.students.length > 0 && (
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={bulkMutation.isPending}>
                {bulkMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Attendance
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
