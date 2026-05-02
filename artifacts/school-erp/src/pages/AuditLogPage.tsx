import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, ShieldCheck, Download, Loader2 } from "lucide-react";
import { useState as useStateAlias } from "react";

const PAGE_SIZE = 30;

interface AuditLog {
  id: number;
  userId: number | null;
  userEmail: string | null;
  userRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditLogResponse {
  logs: AuditLog[];
  total: number;
}

const ACTION_STYLES: Record<string, string> = {
  CREATE: "bg-green-100 text-green-700",
  UPDATE: "bg-yellow-100 text-yellow-700",
  DELETE: "bg-red-100 text-red-700",
  PAYMENT: "bg-purple-100 text-purple-700",
  BULK_ATTENDANCE: "bg-blue-100 text-blue-700",
  LOGIN: "bg-slate-100 text-slate-600",
  LOGIN_FAILED: "bg-red-100 text-red-600",
};

const ENTITY_LABELS: Record<string, string> = {
  student: "Student",
  user: "Staff",
  class: "Class",
  attendance: "Attendance",
  invoice: "Invoice",
  fee_type: "Fee Type",
  transaction: "Payment",
  auth: "Auth",
};

const ALL_ACTIONS = ["CREATE", "UPDATE", "DELETE", "PAYMENT", "BULK_ATTENDANCE", "LOGIN", "LOGIN_FAILED"];
const ALL_ENTITIES = ["student", "user", "class", "attendance", "invoice", "fee_type", "transaction", "auth"];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function escapeCsv(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(logs: AuditLog[]): string {
  const headers = ["ID", "Timestamp", "User Email", "User Role", "Action", "Entity", "Entity ID", "Description", "IP Address"];
  const rows = logs.map(l => [
    l.id, l.createdAt, l.userEmail ?? "", l.userRole ?? "", l.action, l.entity,
    l.entityId ?? "", l.description ?? "", l.ipAddress ?? "",
  ].map(escapeCsv).join(","));
  return [headers.join(","), ...rows].join("\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditLogPage() {
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exporting, setExporting] = useState(false);

  const buildParams = (extra: Record<string, string> = {}) => {
    const p: Record<string, string> = {};
    if (actionFilter) p["action"] = actionFilter;
    if (entityFilter) p["entity"] = entityFilter;
    if (dateFrom) p["dateFrom"] = dateFrom;
    if (dateTo) p["dateTo"] = dateTo;
    return { ...p, ...extra };
  };

  const queryString = new URLSearchParams({
    ...buildParams(),
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  }).toString();

  const { data, isLoading } = useQuery<AuditLogResponse>({
    queryKey: ["audit-logs", page, actionFilter, entityFilter, dateFrom, dateTo],
    queryFn: () => customFetch<AuditLogResponse>(`/api/audit-logs?${queryString}`),
    staleTime: 15_000,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);

  const resetFilters = () => {
    setActionFilter("");
    setEntityFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  };

  const hasFilters = !!(actionFilter || entityFilter || dateFrom || dateTo);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ ...buildParams(), export: "true" });
      const result = await customFetch<AuditLogResponse>(`/api/audit-logs?${params}`);
      const csv = buildCsv(result.logs);
      const today = new Date().toISOString().split("T")[0];
      const suffix = hasFilters ? `-filtered` : "";
      downloadCsv(csv, `audit-log-${today}${suffix}.csv`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Audit Log</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Complete trail of all actions performed across the system
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
            {data?.total ?? 0} total events
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || isLoading}
            className="h-8 gap-1.5 text-xs"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={actionFilter} onValueChange={v => { setActionFilter(v === "all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All actions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {ALL_ACTIONS.map(a => (
              <SelectItem key={a} value={a}>{a.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={v => { setEntityFilter(v === "all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="All entities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entities</SelectItem>
            {ALL_ENTITIES.map(e => (
              <SelectItem key={e} value={e}>{ENTITY_LABELS[e] ?? e}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0); }}
            className="h-8 text-xs w-36" />
          <span className="text-muted-foreground text-xs">to</span>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0); }}
            className="h-8 text-xs w-36" />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 text-xs">
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Time", "User", "Action", "Entity", "Description", "IP"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : data?.logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No audit events found
                </td>
              </tr>
            ) : (
              data?.logs.map(log => (
                <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                    {formatTime(log.createdAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-xs font-medium">{log.userEmail ?? "System"}</div>
                    {log.userRole && (
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{log.userRole.replace("_", " ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      ACTION_STYLES[log.action] ?? "bg-gray-100 text-gray-600"
                    )}>
                      {log.action.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {ENTITY_LABELS[log.entity] ?? log.entity}
                    {log.entityId && <span className="ml-1 text-muted-foreground/60">#{log.entityId}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-foreground max-w-xs truncate">
                    {log.description ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                    {log.ipAddress ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground text-xs">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data?.total ?? 0)} of {data?.total} events
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
