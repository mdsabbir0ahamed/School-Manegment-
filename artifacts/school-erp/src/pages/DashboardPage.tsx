import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetDashboardStats,
  useGetRevenueTrend,
  useGetAttendanceSummary,
  useGetRecentActivity,
  customFetch,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  GraduationCap, Users, BookOpen, CalendarCheck,
  Banknote, AlertCircle, TrendingUp, UserPlus,
  ShieldCheck, ArrowRight, Sparkles, RefreshCw,
  BellRing, ShieldAlert, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────

interface AuditLog {
  id: number;
  userEmail: string | null;
  userRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  description: string | null;
  createdAt: string;
}

interface AiSummaryResponse {
  summary: string;
  generatedAt: string;
  metrics: {
    totalStudents: number;
    totalTeachers: number;
    attendanceRate: number;
    todayPresent: number;
    todayAbsent: number;
    todayLate: number;
    pendingInvoices: number;
    overdueInvoices: number;
    monthlyRevenue: number;
    newAdmissions: number;
  };
}

// ── Constants ──────────────────────────────────────────────────────────────

const ACTION_DOT: Record<string, string> = {
  CREATE: "bg-green-500",
  UPDATE: "bg-yellow-500",
  DELETE: "bg-red-500",
  PAYMENT: "bg-purple-500",
  BULK_ATTENDANCE: "bg-blue-500",
  LOGIN: "bg-slate-400",
  LOGIN_FAILED: "bg-red-400",
};

const ACTION_BADGE: Record<string, string> = {
  CREATE: "bg-green-100 text-green-700",
  UPDATE: "bg-yellow-100 text-yellow-700",
  DELETE: "bg-red-100 text-red-700",
  PAYMENT: "bg-purple-100 text-purple-700",
  BULK_ATTENDANCE: "bg-blue-100 text-blue-700",
  LOGIN: "bg-slate-100 text-slate-600",
  LOGIN_FAILED: "bg-red-100 text-red-500",
};

const activityTypeColors: Record<string, string> = {
  ADMISSION: "bg-blue-500",
  PAYMENT: "bg-green-500",
  ATTENDANCE: "bg-yellow-500",
  USER_CREATED: "bg-purple-500",
};

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({ title, value, icon: Icon, sub, color }: {
  title: string; value: string | number; icon: React.ComponentType<{ className?: string }>;
  sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", color ?? "bg-primary/10")}>
            <Icon className={cn("h-4.5 w-4.5", color ? "text-white" : "text-primary")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Escalation Summary Card ─────────────────────────────────────────────────

interface EscalationSummary {
  criticalCount: number;
  warningCount: number;
  totalEscalated: number;
  totalAtRisk: number;
  criticalAtRisk: number;
  warningAtRisk: number;
}

function EscalationSummaryCard() {
  const { data, isLoading, refetch, isFetching } = useQuery<EscalationSummary>({
    queryKey: ["dashboard-escalation-summary"],
    queryFn: () => customFetch("/api/dashboard/escalation-summary"),
    refetchInterval: 60_000,
  });

  const allClear = !isLoading && data && data.totalEscalated === 0;
  const hasAlerts = !isLoading && data && data.totalEscalated > 0;

  return (
    <Card className={cn(
      "border",
      allClear ? "border-green-200 bg-green-50/40" :
      data?.criticalCount ? "border-red-200 bg-red-50/30" : "border-amber-200 bg-amber-50/30"
    )}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left — icon + heading */}
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg",
              allClear ? "bg-green-100" : data?.criticalCount ? "bg-red-100" : "bg-amber-100"
            )}>
              {allClear
                ? <ShieldCheck className="h-4.5 w-4.5 text-green-600" />
                : data?.criticalCount
                  ? <ShieldAlert className="h-4.5 w-4.5 text-red-600" />
                  : <BellRing className="h-4.5 w-4.5 text-amber-600" />
              }
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Overdue Escalations</p>
              {isLoading ? (
                <Skeleton className="h-5 w-40 mt-1" />
              ) : allClear ? (
                <p className="text-sm font-semibold text-green-700">All clear — no escalated invoices</p>
              ) : (
                <p className="text-sm font-semibold">
                  {data!.totalEscalated} invoice{data!.totalEscalated !== 1 ? "s" : ""} escalated
                  {" · "}৳{data!.totalAtRisk.toLocaleString()} at risk
                </p>
              )}
            </div>
          </div>

          {/* Middle — badges */}
          {hasAlerts && (
            <div className="flex items-center gap-2 flex-wrap">
              {data!.criticalCount > 0 && (
                <div className="flex items-center gap-1.5 rounded-full bg-red-100 border border-red-200 px-3 py-1">
                  <ShieldAlert className="h-3.5 w-3.5 text-red-600" />
                  <span className="text-sm font-bold text-red-700 tabular-nums">{data!.criticalCount}</span>
                  <span className="text-xs text-red-600">CRITICAL</span>
                </div>
              )}
              {data!.warningCount > 0 && (
                <div className="flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-200 px-3 py-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  <span className="text-sm font-bold text-amber-700 tabular-nums">{data!.warningCount}</span>
                  <span className="text-xs text-amber-600">WARNING</span>
                </div>
              )}
            </div>
          )}

          {/* Right — actions */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </button>
            {hasAlerts && (
              <Link href="/finance">
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs border-red-300 text-red-700 hover:bg-red-50">
                  View Escalations <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── AI Daily Summary ────────────────────────────────────────────────────────

function AiDailySummary() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<AiSummaryResponse>({
    queryKey: ["ai-daily-summary"],
    queryFn: () => customFetch("/api/dashboard/ai-summary"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <CardTitle className="text-sm font-semibold">AI Daily Summary</CardTitle>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-primary border-primary/30">
              Powered by AI
            </Badge>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh AI summary"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </button>
        </div>
        {data?.generatedAt && (
          <p className="text-[10px] text-muted-foreground">
            Generated {timeAgo(data.generatedAt)}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-5/6" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <p className="text-xs text-muted-foreground">Could not generate AI summary</p>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-foreground/80">{data?.summary}</p>
        )}

        {data?.metrics && (
          <div className="mt-3 grid grid-cols-3 gap-2 pt-3 border-t border-border/50">
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums text-primary">{data.metrics.attendanceRate}%</p>
              <p className="text-[10px] text-muted-foreground">Attendance</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums text-amber-600">{data.metrics.pendingInvoices}</p>
              <p className="text-[10px] text-muted-foreground">Pending Bills</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums text-green-600">
                ৳{(data.metrics.monthlyRevenue / 1000).toFixed(1)}k
              </p>
              <p className="text-[10px] text-muted-foreground">Monthly Rev.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Live Audit Feed ────────────────────────────────────────────────────────

function LiveAuditFeed() {
  const { data, isLoading } = useQuery<{ logs: AuditLog[]; total: number }>({
    queryKey: ["dashboard-audit-feed"],
    queryFn: () => customFetch("/api/audit-logs?limit=5"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">Live Audit Feed</CardTitle>
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          </div>
          <Link
            href="/audit"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">Last 5 system events · refreshes every 30s</p>
      </CardHeader>
      <CardContent className="flex-1 space-y-0 divide-y divide-border">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5">
              <Skeleton className="h-2 w-2 rounded-full shrink-0" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2.5 w-24" />
              </div>
              <Skeleton className="h-4 w-14 rounded-full" />
            </div>
          ))
        ) : data?.logs.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No audit events yet</p>
        ) : (
          data?.logs.map(log => (
            <div key={log.id} className="flex items-start gap-3 py-2.5">
              <div className={cn("mt-1 h-2 w-2 rounded-full shrink-0", ACTION_DOT[log.action] ?? "bg-muted-foreground")} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-foreground truncate leading-tight">
                  {log.description ?? `${log.action} ${log.entity}`}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {log.userEmail ?? "System"} · {timeAgo(log.createdAt)}
                </p>
              </div>
              <span className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                ACTION_BADGE[log.action] ?? "bg-gray-100 text-gray-600"
              )}>
                {log.action.replace("_", " ")}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ── Dashboard Page ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: trend, isLoading: trendLoading } = useGetRevenueTrend();
  const { data: attendance } = useGetAttendanceSummary();
  const { data: activity } = useGetRecentActivity();

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isFinanceRole = user?.role === "SUPER_ADMIN" || user?.role === "ACCOUNTANT";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold">Dashboard Overview</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* AI Daily Summary — shown to SUPER_ADMIN and TEACHER */}
      {(isSuperAdmin || user?.role === "TEACHER") && (
        <AiDailySummary />
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-5 pb-5"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : stats ? (
          <>
            <StatCard title="Total Students" value={stats.totalStudents.toLocaleString()} icon={GraduationCap} sub={`${stats.activeStudents} active`} />
            <StatCard title="Teachers" value={stats.totalTeachers} icon={Users} sub="Teaching staff" />
            <StatCard title="Classes" value={stats.totalClasses} icon={BookOpen} sub="Active classes" />
            <StatCard title="Attendance Today" value={`${stats.todayAttendanceRate}%`} icon={CalendarCheck} sub="Present rate" />
            <StatCard title="Monthly Revenue" value={`৳${stats.monthlyRevenue.toLocaleString()}`} icon={Banknote} sub="This month" />
            <StatCard title="Total Revenue" value={`৳${stats.totalRevenue.toLocaleString()}`} icon={TrendingUp} sub="All time" />
            <StatCard title="Pending Invoices" value={stats.pendingInvoices} icon={AlertCircle} sub={`${stats.overdueInvoices} overdue`} />
            <StatCard title="New Admissions" value={stats.newAdmissionsThisMonth} icon={UserPlus} sub="This month" />
          </>
        ) : null}
      </div>

      {/* Escalation summary banner — finance roles only */}
      {isFinanceRole && <EscalationSummaryCard />}

      {/* Charts row: Revenue trend + activity/audit */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue trend chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Revenue Trend</CardTitle>
            <p className="text-xs text-muted-foreground">Collected vs pending over 6 months</p>
          </CardHeader>
          <CardContent>
            {trendLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : trend ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trend.months} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={v => `৳${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    formatter={(v: number) => [`৳${v.toLocaleString()}`, undefined]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="collected" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Collected" />
                  <Line type="monotone" dataKey="pending" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} strokeDasharray="5 5" name="Pending" />
                </LineChart>
              </ResponsiveContainer>
            ) : null}
          </CardContent>
        </Card>

        {/* Right card: Audit Feed for SUPER_ADMIN, recent activity otherwise */}
        {isSuperAdmin ? (
          <LiveAuditFeed />
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 max-h-56 overflow-y-auto">
              {activity?.activities.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No recent activity</p>
              ) : activity?.activities.map(a => (
                <div key={a.id} className="flex items-start gap-2.5">
                  <div className={cn("mt-0.5 h-2 w-2 rounded-full shrink-0", activityTypeColors[a.type] ?? "bg-muted-foreground")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{a.description}</p>
                    <p className="text-[10px] text-muted-foreground">{a.entityName} · {new Date(a.timestamp).toLocaleDateString()}</p>
                  </div>
                  {a.amount != null && (
                    <span className="text-xs font-medium text-green-600">৳{a.amount.toLocaleString()}</span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Attendance summary table */}
      {attendance && attendance.summary.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Today's Attendance by Class</CardTitle>
            <p className="text-xs text-muted-foreground">
              Overall: {attendance.overall.present}/{attendance.overall.total} ({attendance.overall.rate}%)
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {["Class", "Total", "Present", "Absent", "Late", "Rate"].map(h => (
                      <th key={h} className="pb-2 pr-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {attendance.summary.map(row => (
                    <tr key={row.classId} className="text-sm">
                      <td className="py-2 pr-4 font-medium">{row.className}</td>
                      <td className="py-2 pr-4 tabular-nums">{row.total}</td>
                      <td className="py-2 pr-4 tabular-nums text-green-600">{row.present}</td>
                      <td className="py-2 pr-4 tabular-nums text-red-500">{row.absent}</td>
                      <td className="py-2 pr-4 tabular-nums text-yellow-600">{row.late}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-muted rounded-full h-1.5 max-w-16">
                            <div
                              className="bg-primary h-1.5 rounded-full"
                              style={{ width: `${row.rate}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-xs">{row.rate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
