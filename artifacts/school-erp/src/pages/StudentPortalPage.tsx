import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import {
  GraduationCap, CalendarCheck, BookOpen, Clock,
  CheckCircle2, XCircle, AlertCircle, MinusCircle,
  TrendingUp, Award, BarChart3, User, Megaphone, BookMarked, CalendarDays,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function authedFetch<T>(path: string): Promise<T> {
  const token = localStorage.getItem("erp_token");
  return fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(r => r.json() as Promise<T>);
}

// ── Types ───────────────────────────────────────────────────────────────────
type Profile = {
  student: {
    id: number; studentId: string; firstName: string; lastName: string;
    dateOfBirth: string | null; gender: string | null; address: string | null;
    parentName: string | null; parentPhone: string | null; parentEmail: string | null;
    admissionDate: string; status: string; className: string | null; section: string | null; grade: number | null;
  };
  stats: { totalClasses: number; presentCount: number; absentCount: number; attendanceRate: number; totalExams: number; avgScore: number };
};
type AttendanceResp = {
  records: { id: number; date: string; status: string; checkInTime: string | null; method: string; notes: string | null }[];
  stats: { total: number; present: number; absent: number; late: number; excused: number; rate: number };
};
type ResultsResp = {
  results: { id: number; examType: string; examName: string; marksObtained: string; totalMarks: string; grade: string | null; remarks: string | null; examDate: string; subjectName: string; subjectCode: string }[];
  stats: { totalExams: number; avgPct: number; bestSubject: string | null };
};
type TimetableResp = {
  slots: { id: number; dayOfWeek: string; startTime: string; endTime: string; room: string | null; subjectName: string; subjectCode: string; teacherFirst: string | null; teacherLast: string | null }[];
};
type AnnouncementsResp = {
  announcements: { id: number; classId: number; authorName: string; title: string; body: string; createdAt: string }[];
  classId: number | null;
};
type HomeworkResp = {
  homework: {
    id: number; classId: number; subjectId: number | null; subjectName: string | null;
    authorName: string; title: string; description: string; dueDate: string | null;
    status: string; createdAt: string;
  }[];
};
type ExamScheduleResp = {
  exams: {
    id: number; classId: number; subjectId: number | null; subjectName: string | null;
    authorName: string; title: string; examType: string; examDate: string;
    startTime: string | null; endTime: string | null; room: string | null; notes: string | null;
  }[];
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const DAY_ORDER = ["SATURDAY","SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"];
const statusColors: Record<string, string> = {
  PRESENT: "bg-green-100 text-green-700",
  ABSENT:  "bg-red-100   text-red-700",
  LATE:    "bg-amber-100 text-amber-700",
  EXCUSED: "bg-blue-100  text-blue-700",
};
const statusIcons: Record<string, React.ReactNode> = {
  PRESENT: <CheckCircle2 className="h-3.5 w-3.5" />,
  ABSENT:  <XCircle      className="h-3.5 w-3.5" />,
  LATE:    <AlertCircle  className="h-3.5 w-3.5" />,
  EXCUSED: <MinusCircle  className="h-3.5 w-3.5" />,
};
const examTypeColors: Record<string, string> = {
  MIDTERM:    "bg-indigo-100 text-indigo-700",
  FINAL:      "bg-purple-100 text-purple-700",
  UNIT_TEST:  "bg-blue-100   text-blue-700",
  ASSIGNMENT: "bg-teal-100   text-teal-700",
  QUIZ:       "bg-orange-100 text-orange-700",
  PRACTICAL:  "bg-pink-100   text-pink-700",
};
function gradeColor(pct: number) {
  if (pct >= 90) return "text-green-700 font-bold";
  if (pct >= 75) return "text-blue-700 font-semibold";
  if (pct >= 60) return "text-amber-700 font-semibold";
  return "text-red-700 font-semibold";
}

// ── Component ────────────────────────────────────────────────────────────────
export default function StudentPortalPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("overview");

  const { data: profile, isLoading: profLoading, error: profError } = useQuery<Profile>({
    queryKey: ["student-me"],
    queryFn: () => authedFetch<Profile>("/api/student/me"),
    retry: false,
  });
  const { data: attendance, isLoading: attLoading } = useQuery<AttendanceResp>({
    queryKey: ["student-attendance"],
    queryFn: () => authedFetch<AttendanceResp>("/api/student/attendance"),
    enabled: tab === "attendance" || tab === "overview",
  });
  const { data: resultsData, isLoading: resLoading } = useQuery<ResultsResp>({
    queryKey: ["student-results"],
    queryFn: () => authedFetch<ResultsResp>("/api/student/results"),
    enabled: tab === "results" || tab === "overview",
  });
  const { data: timetable, isLoading: ttLoading } = useQuery<TimetableResp>({
    queryKey: ["student-timetable"],
    queryFn: () => authedFetch<TimetableResp>("/api/student/timetable"),
    enabled: tab === "timetable",
  });

  // ── No linked student ──────────────────────────────────────────────────────
  if (!profLoading && (profError || (profile as any)?.error === "NO_LINKED_STUDENT")) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="rounded-full bg-amber-50 p-5 mb-4">
          <GraduationCap className="h-10 w-10 text-amber-500" />
        </div>
        <h2 className="text-xl font-bold mb-2">Account Not Linked</h2>
        <p className="text-muted-foreground max-w-md">
          Your login account hasn't been linked to a student record yet.
          Please contact the school administrator to complete the setup.
        </p>
      </div>
    );
  }

  const s    = profile?.student;
  const st   = profile?.stats;
  const recs = attendance?.records ?? [];
  const res  = resultsData?.results ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white shadow-lg">
        {profLoading ? (
          <div className="space-y-2">
            <div className="h-7 w-48 bg-white/20 rounded animate-pulse" />
            <div className="h-4 w-36 bg-white/15 rounded animate-pulse" />
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="rounded-full bg-white/20 p-4 w-fit">
              <GraduationCap className="h-8 w-8 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">
                {s?.firstName} {s?.lastName}
              </h1>
              <p className="text-indigo-100 text-sm mt-0.5">
                {s?.studentId} · {s?.className ?? "No class assigned"}{s?.section ? ` – ${s.section}` : ""}
              </p>
              <p className="text-indigo-200 text-xs mt-1">
                Admitted {s?.admissionDate ? new Date(s.admissionDate).toLocaleDateString("en-US", { dateStyle: "medium" }) : "—"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                s?.status === "ACTIVE" ? "bg-green-400/30 text-green-100" : "bg-red-400/30 text-red-100"
              }`}>
                {s?.status ?? "—"}
              </span>
              {s?.grade != null && (
                <span className="text-xs px-3 py-1 rounded-full font-medium bg-white/20 text-white">
                  Grade {s.grade}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Attendance Rate",  value: profLoading ? "—" : `${st?.attendanceRate ?? 0}%`, icon: <CalendarCheck className="h-5 w-5" />, color: "text-green-600",  bg: "bg-green-50",  desc: `${st?.presentCount ?? 0} of ${st?.totalClasses ?? 0} days` },
          { label: "Classes Attended", value: profLoading ? "—" : (st?.presentCount ?? 0),       icon: <CheckCircle2  className="h-5 w-5" />, color: "text-blue-600",   bg: "bg-blue-50",   desc: `${st?.absentCount ?? 0} absent` },
          { label: "Exams Taken",      value: profLoading ? "—" : (st?.totalExams ?? 0),          icon: <BookOpen      className="h-5 w-5" />, color: "text-violet-600", bg: "bg-violet-50", desc: resultsData?.stats.bestSubject ?? "No exams yet" },
          { label: "Average Score",    value: profLoading ? "—" : `${st?.avgScore ?? 0}%`,        icon: <TrendingUp    className="h-5 w-5" />, color: "text-amber-600",  bg: "bg-amber-50",  desc: resultsData?.stats.totalExams ? `across ${resultsData.stats.totalExams} exams` : "—" },
        ].map(k => (
          <div key={k.label} className="rounded-xl border bg-card p-4 flex items-center gap-3">
            <div className={`rounded-lg p-2 ${k.bg} ${k.color} shrink-0`}>{k.icon}</div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate">{k.label}</p>
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-muted-foreground truncate">{k.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-7 w-full max-w-4xl">
          <TabsTrigger value="overview"       className="text-xs">Overview</TabsTrigger>
          <TabsTrigger value="attendance"     className="text-xs">Attendance</TabsTrigger>
          <TabsTrigger value="results"        className="text-xs">Results</TabsTrigger>
          <TabsTrigger value="timetable"      className="text-xs">Timetable</TabsTrigger>
          <TabsTrigger value="exams"          className="text-xs">Exams</TabsTrigger>
          <TabsTrigger value="homework"       className="text-xs">Homework</TabsTrigger>
          <TabsTrigger value="announcements"  className="text-xs">Notices</TabsTrigger>
        </TabsList>

        {/* ── Overview ─────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">

            {/* Profile card */}
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-1.5"><User className="h-4 w-4 text-muted-foreground" /> Profile</h3>
              {profLoading ? <div className="h-24 bg-muted animate-pulse rounded" /> : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {[
                    ["Student ID",   s?.studentId],
                    ["Date of Birth",s?.dateOfBirth ?? "—"],
                    ["Gender",       s?.gender ?? "—"],
                    ["Address",      s?.address ?? "—"],
                    ["Parent Name",  s?.parentName ?? "—"],
                    ["Parent Phone", s?.parentPhone ?? "—"],
                  ].map(([label, val]) => (
                    <div key={label as string}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-medium truncate">{val}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            {/* Recent attendance */}
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-1.5"><CalendarCheck className="h-4 w-4 text-muted-foreground" /> Recent Attendance</h3>
              {attLoading ? <div className="h-24 bg-muted animate-pulse rounded" /> : recs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attendance records yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {recs.slice(0, 10).map(r => (
                    <div key={r.id} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{new Date(r.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status] ?? ""}`}>
                        {statusIcons[r.status]} {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent results */}
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-1.5"><Award className="h-4 w-4 text-muted-foreground" /> Recent Exam Results</h3>
              {resLoading ? <div className="h-24 bg-muted animate-pulse rounded" /> : res.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exam results yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {res.slice(0, 6).map(r => {
                    const pct = Math.round((parseFloat(r.marksObtained) / parseFloat(r.totalMarks)) * 100);
                    return (
                      <div key={r.id} className="flex items-center justify-between text-sm gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{r.subjectName}</p>
                          <p className="text-xs text-muted-foreground">{r.examName}</p>
                        </div>
                        <span className={`shrink-0 text-sm ${gradeColor(pct)}`}>{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Attendance breakdown */}
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-1.5"><BarChart3 className="h-4 w-4 text-muted-foreground" /> Attendance Breakdown (90 days)</h3>
              {attLoading ? <div className="h-24 bg-muted animate-pulse rounded" /> : (
                <div className="space-y-2">
                  {[
                    { label: "Present", count: attendance?.stats.present ?? 0, total: attendance?.stats.total ?? 0, color: "bg-green-500" },
                    { label: "Late",    count: attendance?.stats.late    ?? 0, total: attendance?.stats.total ?? 0, color: "bg-amber-400" },
                    { label: "Excused", count: attendance?.stats.excused ?? 0, total: attendance?.stats.total ?? 0, color: "bg-blue-400" },
                    { label: "Absent",  count: attendance?.stats.absent  ?? 0, total: attendance?.stats.total ?? 0, color: "bg-red-400" },
                  ].map(b => (
                    <div key={b.label}>
                      <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
                        <span>{b.label}</span><span>{b.count} / {b.total}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${b.color} transition-all`} style={{ width: b.total ? `${(b.count / b.total) * 100}%` : "0%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Attendance ───────────────────────────────────────────────── */}
        <TabsContent value="attendance" className="mt-4">
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Attendance Records (last 90 days)</h3>
              {attendance && (
                <span className="text-xs text-muted-foreground">
                  Rate: <span className={`font-semibold ${attendance.stats.rate >= 80 ? "text-green-600" : attendance.stats.rate >= 60 ? "text-amber-600" : "text-red-600"}`}>{attendance.stats.rate}%</span>
                </span>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/20">
                  {["Date","Day","Status","Check-in","Method","Notes"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attLoading && Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-3 py-2.5"><div className="h-4 bg-muted animate-pulse rounded w-20" /></td>
                    ))}
                  </tr>
                ))}
                {!attLoading && recs.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                    <CalendarCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No attendance records in the last 90 days.</p>
                  </td></tr>
                )}
                {recs.map((r, i) => {
                  const d = new Date(r.date);
                  return (
                    <tr key={r.id} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <td className="px-3 py-2.5 text-sm">{d.toLocaleDateString("en-US", { dateStyle: "medium" })}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.toLocaleDateString("en-US", { weekday: "long" })}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status] ?? ""}`}>
                          {statusIcons[r.status]} {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs">{r.checkInTime ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.method}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.notes ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── Results ──────────────────────────────────────────────────── */}
        <TabsContent value="results" className="mt-4">
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Exam Results</h3>
              {resultsData && (
                <span className="text-xs text-muted-foreground">
                  Average: <span className={`font-semibold ${gradeColor(resultsData.stats.avgPct)}`}>{resultsData.stats.avgPct}%</span>
                </span>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/20">
                  {["Date","Subject","Exam","Type","Marks","Score","Grade","Remarks"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resLoading && Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-3 py-2.5"><div className="h-4 bg-muted animate-pulse rounded w-16" /></td>
                    ))}
                  </tr>
                ))}
                {!resLoading && res.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                    <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No exam results recorded yet.</p>
                  </td></tr>
                )}
                {res.map((r, i) => {
                  const pct = Math.round((parseFloat(r.marksObtained) / parseFloat(r.totalMarks)) * 100);
                  return (
                    <tr key={r.id} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{r.examDate}</td>
                      <td className="px-3 py-2.5 font-medium text-sm">{r.subjectName}</td>
                      <td className="px-3 py-2.5 text-xs">{r.examName}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${examTypeColors[r.examType] ?? "bg-muted text-muted-foreground"}`}>
                          {r.examType.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-sm">{r.marksObtained} / {r.totalMarks}</td>
                      <td className={`px-3 py-2.5 text-sm ${gradeColor(pct)}`}>{pct}%</td>
                      <td className="px-3 py-2.5 text-xs font-medium">{r.grade ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.remarks ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── Timetable ────────────────────────────────────────────────── */}
        <TabsContent value="timetable" className="mt-4">
          {ttLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}
            </div>
          ) : !timetable?.slots.length ? (
            <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No timetable has been set up for your class yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {DAY_ORDER.filter(day => timetable.slots.some(s => s.dayOfWeek === day)).map(day => (
                <div key={day} className="rounded-xl border bg-card overflow-hidden">
                  <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
                    <h3 className="font-semibold text-sm text-indigo-800">{day}</h3>
                  </div>
                  <div className="divide-y divide-border">
                    {timetable.slots.filter(s => s.dayOfWeek === day).map(s => (
                      <div key={s.id} className="flex items-center gap-4 px-4 py-3">
                        <div className="shrink-0 text-center w-20">
                          <p className="text-xs font-semibold text-indigo-600">{s.startTime}</p>
                          <p className="text-xs text-muted-foreground">{s.endTime}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{s.subjectName}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.teacherFirst ? `${s.teacherFirst} ${s.teacherLast}` : "No teacher assigned"}
                            {s.room ? ` · Room ${s.room}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded font-mono">{s.subjectCode}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Exams ─────────────────────────────────────────────────── */}
        <TabsContent value="exams" className="mt-4">
          <ExamScheduleTab />
        </TabsContent>

        {/* ── Homework ──────────────────────────────────────────────── */}
        <TabsContent value="homework" className="mt-4">
          <HomeworkTab />
        </TabsContent>

        {/* ── Announcements ─────────────────────────────────────────── */}
        <TabsContent value="announcements" className="mt-4">
          <AnnouncementsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const EXAM_TYPE_LABELS: Record<string, string> = {
  FINAL: "Final", MIDTERM: "Midterm", UNIT_TEST: "Unit Test",
  QUIZ: "Quiz", ASSIGNMENT: "Assignment", PRACTICAL: "Practical",
};
const EXAM_TYPE_COLORS: Record<string, string> = {
  FINAL: "bg-red-100 text-red-700", MIDTERM: "bg-orange-100 text-orange-700",
  UNIT_TEST: "bg-amber-100 text-amber-700", QUIZ: "bg-blue-100 text-blue-700",
  ASSIGNMENT: "bg-purple-100 text-purple-700", PRACTICAL: "bg-green-100 text-green-700",
};

function ExamScheduleTab() {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading } = useQuery<ExamScheduleResp>({
    queryKey: ["student-exams", showAll],
    queryFn: () => authedFetch(`/api/student/exam-schedule${showAll ? "?all=true" : ""}`),
  });

  const exams = data?.exams ?? [];
  const today = new Date().toISOString().split("T")[0]!;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">Show:</span>
        {[false, true].map(v => (
          <button key={String(v)} onClick={() => setShowAll(v)}
            className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${showAll === v ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {v ? "All" : "Upcoming"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}</div>
      ) : !exams.length ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          <CalendarDays className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{showAll ? "No exams scheduled" : "No upcoming exams"}</p>
          <p className="text-xs mt-1 opacity-70">Your teacher hasn't scheduled any{showAll ? "" : " upcoming"} exams yet.</p>
        </div>
      ) : (
        exams.map(ex => {
          const diff = Math.ceil((new Date(ex.examDate).getTime() - new Date(today).getTime()) / 86400000);
          const isPast = diff < 0;
          return (
            <div key={ex.id} className={`rounded-xl border bg-card p-4 ${isPast ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${isPast ? "bg-gray-100" : "bg-orange-100"}`}>
                  <CalendarDays className={`h-4 w-4 ${isPast ? "text-gray-400" : "text-orange-600"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${EXAM_TYPE_COLORS[ex.examType] ?? "bg-gray-100 text-gray-600"}`}>
                          {EXAM_TYPE_LABELS[ex.examType] ?? ex.examType}
                        </span>
                        <h4 className="font-semibold text-sm">{ex.title}</h4>
                      </div>
                      {ex.subjectName && <p className="text-[11px] text-primary font-medium mt-0.5">{ex.subjectName}</p>}
                    </div>
                    {!isPast && diff <= 7 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${diff === 0 ? "bg-red-100 text-red-600" : diff <= 3 ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-600"}`}>
                        {diff === 0 ? "Today!" : `In ${diff}d`}
                      </span>
                    )}
                    {isPast && <span className="text-[10px] text-muted-foreground shrink-0">Past</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {new Date(ex.examDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    </span>
                    {ex.startTime && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {ex.startTime}{ex.endTime ? ` – ${ex.endTime}` : ""}
                      </span>
                    )}
                    {ex.room && <span>📍 {ex.room}</span>}
                  </div>
                  {ex.notes && <p className="text-xs text-muted-foreground mt-1.5 italic">{ex.notes}</p>}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function HomeworkTab() {
  const [filter, setFilter] = useState<"ACTIVE" | "CLOSED" | "ALL">("ACTIVE");
  const { data, isLoading } = useQuery<HomeworkResp>({
    queryKey: ["student-homework", filter],
    queryFn: () => authedFetch(`/api/student/homework${filter !== "ALL" ? `?status=${filter}` : ""}`),
  });

  const hw = data?.homework ?? [];
  const today = new Date().toISOString().split("T")[0]!;

  function dueBadge(dueDate: string | null) {
    if (!dueDate) return null;
    const diff = Math.ceil((new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000);
    if (diff < 0)  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Overdue</span>;
    if (diff === 0) return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-600">Due today</span>;
    if (diff <= 3)  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Due in {diff}d</span>;
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Due in {diff}d</span>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">Show:</span>
        {(["ACTIVE", "CLOSED", "ALL"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {f === "ALL" ? "All" : f === "ACTIVE" ? "Active" : "Closed"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}</div>
      ) : !hw.length ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          <BookMarked className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No homework</p>
          <p className="text-xs mt-1 opacity-70">No {filter !== "ALL" ? filter.toLowerCase() + " " : ""}assignments for your class yet.</p>
        </div>
      ) : (
        hw.map(h => (
          <div key={h.id} className={`rounded-xl border bg-card p-4 space-y-2 ${h.status === "CLOSED" ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-3">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${h.status === "CLOSED" ? "bg-gray-100" : "bg-amber-100"}`}>
                <BookMarked className={`h-4 w-4 ${h.status === "CLOSED" ? "text-gray-400" : "text-amber-600"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold text-sm">{h.title}</h4>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {h.status === "CLOSED" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">Closed</span>}
                    {dueBadge(h.dueDate)}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {h.subjectName && <span className="font-medium text-primary">{h.subjectName} · </span>}
                  {h.authorName} · {new Date(h.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap pl-11">{h.description}</p>
            {h.dueDate && (
              <div className="pl-11 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Due: {new Date(h.dueDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function AnnouncementsTab() {
  const { data, isLoading } = useQuery<AnnouncementsResp>({
    queryKey: ["student-announcements"],
    queryFn: () => authedFetch("/api/student/announcements"),
  });

  if (isLoading) return (
    <div className="space-y-3">
      {[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}
    </div>
  );

  if (!data?.announcements.length) return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
      <Megaphone className="h-8 w-8 mx-auto mb-3 opacity-30" />
      <p className="font-medium">No announcements yet</p>
      <p className="text-xs mt-1 opacity-70">Your teacher hasn't posted any announcements for your class.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{data.announcements.length} announcement{data.announcements.length !== 1 ? "s" : ""} from your class</p>
      {data.announcements.map(a => (
        <div key={a.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
              <Megaphone className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm">{a.title}</h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {a.authorName} · {new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap pl-11">{a.body}</p>
        </div>
      ))}
    </div>
  );
}
