import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  Plus, Loader2, Download, CheckCircle2, Wallet,
  ChevronDown, ChevronUp, Pencil, Trash2, Zap,
} from "lucide-react";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700",
  APPROVED: "bg-blue-100 text-blue-700",
  PAID: "bg-green-100 text-green-700",
};

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Admin",
  TEACHER: "Teacher",
  ACCOUNTANT: "Accountant",
};

type PayrollRecord = {
  id: number;
  userId: number;
  staffName: string;
  staffEmail: string;
  staffRole: string;
  month: number;
  year: number;
  basicSalary: number;
  allowances: number;
  deductions: number;
  grossSalary: number;
  netSalary: number;
  status: "DRAFT" | "APPROVED" | "PAID";
  notes: string | null;
  paidAt: string | null;
};

function authedFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("erp_token") ?? "";
  return fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options?.headers },
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data as any)?.error ?? "Request failed");
    return data as T;
  });
}

// ── Edit / Create Dialog ──────────────────────────────────────────────────
function PayrollFormDialog({
  open, onClose, record, month, year,
}: {
  open: boolean;
  onClose: () => void;
  record: PayrollRecord | null;
  month: number;
  year: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [basic, setBasic] = useState(String(record?.basicSalary ?? 20000));
  const [allowances, setAllowances] = useState(String(record?.allowances ?? 0));
  const [deductions, setDeductions] = useState(String(record?.deductions ?? 0));
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [userId, setUserId] = useState<number | null>(record?.userId ?? null);
  const [loading, setLoading] = useState(false);

  const { data: usersData } = useQuery({
    queryKey: ["payroll-users"],
    queryFn: () => authedFetch<{ users: { id: number; firstName: string; lastName: string; role: string }[] }>("/api/users?limit=100"),
    enabled: !record,
  });
  const staffUsers = (usersData?.users ?? []).filter(u =>
    ["SUPER_ADMIN", "TEACHER", "ACCOUNTANT"].includes(u.role),
  );

  const gross = (parseFloat(basic) || 0) + (parseFloat(allowances) || 0);
  const net = gross - (parseFloat(deductions) || 0);

  const handleSave = async () => {
    setLoading(true);
    try {
      if (record) {
        await authedFetch(`/api/payroll/${record.id}`, {
          method: "PUT",
          body: JSON.stringify({ basicSalary: parseFloat(basic), allowances: parseFloat(allowances), deductions: parseFloat(deductions), notes }),
        });
        toast({ title: "Payroll updated" });
      } else {
        if (!userId) { toast({ title: "Select a staff member", variant: "destructive" }); setLoading(false); return; }
        await authedFetch("/api/payroll", {
          method: "POST",
          body: JSON.stringify({ userId, month, year, basicSalary: parseFloat(basic), allowances: parseFloat(allowances), deductions: parseFloat(deductions), notes }),
        });
        toast({ title: "Payroll record created" });
      }
      qc.invalidateQueries({ queryKey: ["payroll"] });
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{record ? `Edit — ${record.staffName}` : "Add Payroll Record"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {!record && (
            <div className="space-y-1.5">
              <Label>Staff Member *</Label>
              <Select onValueChange={v => setUserId(parseInt(v))}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>
                  {staffUsers.map(u => (
                    <SelectItem key={u.id} value={u.id.toString()}>
                      {u.firstName} {u.lastName} ({ROLE_LABEL[u.role] ?? u.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Basic Salary</Label>
              <Input type="number" min="0" value={basic} onChange={e => setBasic(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Allowances</Label>
              <Input type="number" min="0" value={allowances} onChange={e => setAllowances(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Deductions</Label>
              <Input type="number" min="0" value={deductions} onChange={e => setDeductions(e.target.value)} />
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 border border-border p-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Gross Salary</p>
              <p className="font-semibold text-blue-600">৳{gross.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net (Take-Home)</p>
              <p className="font-bold text-lg text-green-600">৳{net.toLocaleString()}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Includes overtime" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {record ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk Generate Dialog ──────────────────────────────────────────────────
function GenerateDialog({ open, onClose, month, year }: { open: boolean; onClose: () => void; month: number; year: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [defaultSalary, setDefaultSalary] = useState("20000");
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await authedFetch<{ created: number; skipped: number }>("/api/payroll/generate", {
        method: "POST",
        body: JSON.stringify({ month, year, defaultBasicSalary: parseFloat(defaultSalary) }),
      });
      toast({
        title: `${result.created} payroll records generated`,
        description: result.skipped > 0 ? `${result.skipped} already existed and were skipped.` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["payroll"] });
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            Bulk Generate — {MONTH_NAMES[month]} {year}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-sm text-muted-foreground">
            Creates draft payroll records for all active staff who don't yet have an entry for this month. Existing records are preserved.
          </p>
          <div className="space-y-1.5">
            <Label>Default Basic Salary (৳)</Label>
            <Input type="number" min="0" value={defaultSalary} onChange={e => setDefaultSalary(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function PayrollPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [editRecord, setEditRecord] = useState<PayrollRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ records: PayrollRecord[]; total: number }>({
    queryKey: ["payroll", month, year],
    queryFn: () => authedFetch(`/api/payroll?month=${month}&year=${year}`),
  });

  const records = data?.records ?? [];
  const totalNet = records.reduce((s, r) => s + r.netSalary, 0);
  const paidCount = records.filter(r => r.status === "PAID").length;
  const approvedCount = records.filter(r => r.status === "APPROVED").length;
  const draftCount = records.filter(r => r.status === "DRAFT").length;

  const doAction = async (id: number, endpoint: string, label: string) => {
    setActionLoading(id);
    try {
      await authedFetch(`/api/payroll/${id}/${endpoint}`, { method: "PATCH" });
      toast({ title: label });
      qc.invalidateQueries({ queryKey: ["payroll"] });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const doDelete = async (id: number) => {
    setActionLoading(id);
    try {
      await authedFetch(`/api/payroll/${id}`, { method: "DELETE" });
      toast({ title: "Record deleted" });
      qc.invalidateQueries({ queryKey: ["payroll"] });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const downloadPayslip = async (id: number, name: string) => {
    const token = localStorage.getItem("erp_token") ?? "";
    const res = await fetch(`/api/payroll/${id}/payslip`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { toast({ title: "Failed to download payslip", variant: "destructive" }); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `payslip-${name.replace(/ /g, "-").toLowerCase()}-${MONTH_NAMES[month]?.toLowerCase()}-${year}.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Payroll</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monthly staff salaries, approvals, and payslips</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowGenerate(true)}>
            <Zap className="mr-2 h-4 w-4 text-yellow-500" /> Bulk Generate
          </Button>
          <Button onClick={() => { setEditRecord(null); setShowForm(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add Record
          </Button>
        </div>
      </div>

      {/* Month / Year filter */}
      <div className="flex items-center gap-3">
        <Select value={String(month)} onValueChange={v => setMonth(parseInt(v))}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.slice(1).map((m, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={v => setYear(parseInt(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{records.length} staff records</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Payroll", value: `৳${totalNet.toLocaleString()}`, sub: `${MONTH_NAMES[month]} ${year}`, color: "text-foreground" },
          { label: "Paid", value: paidCount, sub: "records", color: "text-green-600" },
          { label: "Approved", value: approvedCount, sub: "awaiting payment", color: "text-blue-600" },
          { label: "Drafts", value: draftCount, sub: "need approval", color: "text-amber-600" },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</p>
            <p className={cn("text-xl font-bold mt-1 tabular-nums", s.color)}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Staff Member", "Role", "Basic", "Allowances", "Deductions", "Gross", "Net", "Status", "Actions"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 9 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                ))}</tr>
              ))
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <Wallet className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">No payroll records for {MONTH_NAMES[month]} {year}</p>
                  <p className="text-xs text-muted-foreground mt-1">Use "Bulk Generate" to create records for all staff at once.</p>
                </td>
              </tr>
            ) : records.map(r => {
              const busy = actionLoading === r.id;
              return (
                <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.staffName}</p>
                    <p className="text-xs text-muted-foreground">{r.staffEmail}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{ROLE_LABEL[r.staffRole] ?? r.staffRole}</td>
                  <td className="px-4 py-3 tabular-nums">৳{r.basicSalary.toLocaleString()}</td>
                  <td className="px-4 py-3 tabular-nums text-blue-600">+৳{r.allowances.toLocaleString()}</td>
                  <td className="px-4 py-3 tabular-nums text-red-500">-৳{r.deductions.toLocaleString()}</td>
                  <td className="px-4 py-3 tabular-nums font-medium">৳{r.grossSalary.toLocaleString()}</td>
                  <td className="px-4 py-3 tabular-nums font-bold text-green-600">৳{r.netSalary.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[r.status] ?? "")}>
                      {r.status}
                    </span>
                    {r.paidAt && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(r.paidAt).toLocaleDateString()}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          {r.status === "DRAFT" && (
                            <>
                              <button onClick={() => { setEditRecord(r); setShowForm(true); }}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" title="Edit">
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button onClick={() => doAction(r.id, "approve", "Payroll approved")}
                                className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium">
                                <CheckCircle2 className="h-3 w-3" /> Approve
                              </button>
                              <button onClick={() => doDelete(r.id)}
                                className="flex items-center gap-1 text-xs text-red-500 hover:underline" title="Delete">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          )}
                          {r.status === "APPROVED" && (
                            <button onClick={() => doAction(r.id, "mark-paid", "Marked as paid")}
                              className="flex items-center gap-1 text-xs text-green-600 hover:underline font-medium">
                              <Wallet className="h-3 w-3" /> Mark Paid
                            </button>
                          )}
                          <button onClick={() => downloadPayslip(r.id, r.staffName)}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" title="Download payslip PDF">
                            <Download className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <PayrollFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditRecord(null); }}
        record={editRecord}
        month={month}
        year={year}
      />
      <GenerateDialog
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        month={month}
        year={year}
      />
    </div>
  );
}
