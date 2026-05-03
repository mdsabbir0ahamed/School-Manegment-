import { useState, useEffect } from "react";
import {
  useListInvoices, useCreateInvoice, useListFeeTypes,
  useListTransactions, useCreateTransaction, useListStudents,
  getListInvoicesQueryKey, getListTransactionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Invoice } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Plus, Loader2, CreditCard, ChevronLeft, ChevronRight,
  Bell, CheckCircle2, Download, Clock, Play, RefreshCw,
  Inbox, ThumbsUp, ThumbsDown, AlertCircle, XCircle,
  Layers, SkipForward, ListChecks, Tag, Percent, ToggleLeft, ToggleRight, Trash2, UserCheck,
  Receipt, TrendingDown, BarChart3, CheckCheck, Circle,
  TrendingUp, ArrowUpRight, ArrowDownRight, Minus, Activity,
  Target, PencilLine, AlertTriangle, ShieldCheck,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ComposedChart, Line, ReferenceLine,
} from "recharts";
import { customFetch } from "@workspace/api-client-react";

const PAGE_SIZE = 15;

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-600",
};

// ── Zod schemas ────────────────────────────────────────────────────────────

const invoiceSchema = z.object({
  studentId: z.number({ required_error: "Student required" }),
  feeTypeId: z.number({ required_error: "Fee type required" }),
  month: z.string().optional(),
  totalAmount: z.number({ required_error: "Amount required" }).positive(),
  discountAmount: z.number().min(0).optional(),
  discountReason: z.string().optional(),
  dueDate: z.string().min(1, "Due date required"),
});
type InvoiceForm = z.infer<typeof invoiceSchema>;

const paymentSchema = z.object({
  amountPaid: z.number().positive("Enter valid amount"),
  method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_BANKING", "CHEQUE"]),
  transactionId: z.string().optional(),
  notes: z.string().optional(),
});
type PaymentForm = z.infer<typeof paymentSchema>;

// ── Reminder settings types ────────────────────────────────────────────────

type ReminderSettings = {
  id: number;
  isEnabled: boolean;
  reminderDays: number[];
  lastRunAt: string | null;
  lastRunCount: number;
};

// ── Helper ─────────────────────────────────────────────────────────────────

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

// ── Bulk Generate Dialog ───────────────────────────────────────────────────

type ClassItem = { id: number; name: string; gradeLevel: number; studentCount?: number };
type FeeTypeItem = { id: number; name: string; amount: number; isRecurring: boolean };
type BulkResult = { created: number; skipped: number; total: number; message: string };

function BulkGenerateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [classId, setClassId] = useState<string>("");
  const [feeTypeId, setFeeTypeId] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [amountOverride, setAmountOverride] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const { data: classesData } = useQuery<{ classes: ClassItem[] }>({
    queryKey: ["classes-list"],
    queryFn: () => authedFetch("/api/classes"),
    enabled: open,
  });
  const { data: feeTypesData } = useQuery<{ feeTypes: FeeTypeItem[] }>({
    queryKey: ["fee-types-list"],
    queryFn: () => authedFetch("/api/fee-types"),
    enabled: open,
  });

  const { data: studentsData } = useQuery<{ students: unknown[]; total: number }>({
    queryKey: ["students-by-class", classId],
    queryFn: () => authedFetch(`/api/students?classId=${classId}&status=ACTIVE&limit=200`),
    enabled: !!classId,
  });

  const selectedFeeType = feeTypesData?.feeTypes.find(f => f.id === Number(feeTypeId));
  const eligibleCount = studentsData?.total ?? null;

  const reset = () => {
    setClassId(""); setFeeTypeId(""); setMonth(""); setDueDate("");
    setAmountOverride(""); setResult(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleGenerate = async () => {
    if (!classId || !feeTypeId || !dueDate) {
      toast({ title: "Class, fee type, and due date are required", variant: "destructive" }); return;
    }
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        classId: Number(classId), feeTypeId: Number(feeTypeId), dueDate,
      };
      if (month) body["month"] = month;
      if (amountOverride && parseFloat(amountOverride) > 0) body["amount"] = parseFloat(amountOverride);

      const r = await authedFetch<BulkResult>("/api/invoices/bulk-generate", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
      setResult(r);
      if (r.created > 0) {
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey({}) });
        toast({ title: `${r.created} invoice${r.created !== 1 ? "s" : ""} generated`, description: r.message });
      } else {
        toast({ title: "Nothing to generate", description: r.message });
      }
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Bulk Invoice Generation
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-create invoices for all active students in a class. Already-invoiced students are skipped automatically.
          </p>
        </DialogHeader>

        {result ? (
          /* ── Results screen ── */
          <div className="space-y-4 py-2">
            <div className={cn(
              "rounded-xl border p-5 text-center",
              result.created > 0 ? "border-green-200 bg-green-50" : "border-muted bg-muted/30",
            )}>
              {result.created > 0
                ? <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
                : <SkipForward className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />}
              <p className="text-2xl font-bold tabular-nums">{result.created}</p>
              <p className="text-sm text-muted-foreground">invoice{result.created !== 1 ? "s" : ""} created</p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: "Total Students", value: result.total, cls: "text-foreground" },
                { label: "Created",        value: result.created, cls: "text-green-600" },
                { label: "Skipped",        value: result.skipped, cls: "text-amber-600" },
              ].map(s => (
                <div key={s.label} className="rounded-lg border border-border bg-card p-3">
                  <p className={cn("text-xl font-bold tabular-nums", s.cls)}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {result.skipped > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <SkipForward className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {result.skipped} student{result.skipped !== 1 ? "s were" : " was"} skipped because they already have an invoice for this fee type and period.
              </div>
            )}

            <p className="text-xs text-center text-muted-foreground">{result.message}</p>
          </div>
        ) : (
          /* ── Form screen ── */
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Class *</Label>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger><SelectValue placeholder="Select class…" /></SelectTrigger>
                  <SelectContent>
                    {(classesData?.classes ?? [])
                      .sort((a, b) => a.gradeLevel - b.gradeLevel)
                      .map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name} <span className="text-muted-foreground">(Grade {c.gradeLevel})</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Fee Type *</Label>
                <Select value={feeTypeId} onValueChange={v => { setFeeTypeId(v); setAmountOverride(""); }}>
                  <SelectTrigger><SelectValue placeholder="Select fee type…" /></SelectTrigger>
                  <SelectContent>
                    {(feeTypesData?.feeTypes ?? []).map(f => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        {f.name} <span className="text-muted-foreground">৳{f.amount.toLocaleString()}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Month <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  type="month"
                  value={month}
                  onChange={e => setMonth(e.target.value)}
                  placeholder="YYYY-MM"
                />
                <p className="text-[10px] text-muted-foreground">Leave blank for one-time fees</p>
              </div>
              <div className="space-y-1.5">
                <Label>Due Date *</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>
                Amount Override <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">৳</span>
                <Input
                  type="number" step="0.01" min="0"
                  className="pl-7"
                  value={amountOverride}
                  onChange={e => setAmountOverride(e.target.value)}
                  placeholder={selectedFeeType ? String(selectedFeeType.amount) : "Default from fee type"}
                />
              </div>
              {selectedFeeType && (
                <p className="text-[10px] text-muted-foreground">
                  Default: ৳{selectedFeeType.amount.toLocaleString()} from "{selectedFeeType.name}"
                </p>
              )}
            </div>

            {/* Eligibility preview */}
            {classId && (
              <div className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
                eligibleCount === null
                  ? "border-border bg-muted/30 text-muted-foreground"
                  : eligibleCount > 0
                    ? "border-blue-200 bg-blue-50 text-blue-800"
                    : "border-red-200 bg-red-50 text-red-700",
              )}>
                <ListChecks className="h-4 w-4 shrink-0" />
                {eligibleCount === null
                  ? "Counting students…"
                  : eligibleCount === 0
                    ? "No active students found in this class"
                    : <><span className="font-semibold">{eligibleCount}</span> active student{eligibleCount !== 1 ? "s" : ""} will receive invoices (duplicates skipped automatically)</>}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button variant="outline" onClick={reset}>Generate More</Button>
              <Button onClick={handleClose}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
              <Button
                onClick={handleGenerate}
                disabled={loading || !classId || !feeTypeId || !dueDate || eligibleCount === 0}
              >
                {loading
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
                  : <><Layers className="mr-2 h-4 w-4" /> Generate Invoices</>}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Export PDF Dialog ──────────────────────────────────────────────────────

function ExportPdfDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [exportType, setExportType] = useState("invoices");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: exportType });
      if (status && status !== "all") params.set("status", status);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const token = localStorage.getItem("erp_token") ?? "";
      const res = await fetch(`/api/finance/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportType}-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "PDF exported", description: `${exportType} report downloaded.` });
      onClose();
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" /> Export PDF Report
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Report Type</Label>
            <Select value={exportType} onValueChange={setExportType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="invoices">Invoices</SelectItem>
                <SelectItem value="transactions">Transactions</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {exportType === "invoices" && (
            <div className="space-y-1.5">
              <Label>Status Filter</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {["PAID", "PENDING", "OVERDUE", "CANCELLED"].map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date From</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Date To</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Leave dates empty to export all records.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleExport} disabled={loading}>
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</> : <><Download className="mr-2 h-4 w-4" /> Export</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Invoice Dialog ──────────────────────────────────────────────────

function CreateInvoiceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: studentsData } = useListStudents({ limit: 100 });
  const { data: feeTypesData } = useListFeeTypes();
  const createMutation = useCreateInvoice();

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<InvoiceForm>({
    resolver: zodResolver(invoiceSchema),
  });

  const onSubmit = (data: InvoiceForm) => {
    createMutation.mutate({ data }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        toast({ title: "Invoice created" });
        onClose();
      },
      onError: () => toast({ title: "Failed to create invoice", variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create Invoice</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label>Student *</Label>
            <Select onValueChange={v => setValue("studentId", parseInt(v))}>
              <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
              <SelectContent>
                {studentsData?.students.map(s => (
                  <SelectItem key={s.id} value={s.id.toString()}>{s.firstName} {s.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Fee Type *</Label>
            <Select onValueChange={v => setValue("feeTypeId", parseInt(v))}>
              <SelectTrigger><SelectValue placeholder="Select fee type" /></SelectTrigger>
              <SelectContent>
                {feeTypesData?.feeTypes.map(f => (
                  <SelectItem key={f.id} value={f.id.toString()}>{f.name} (৳{f.amount})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Month</Label>
              <Input type="month" {...register("month")} />
            </div>
            <div className="space-y-1">
              <Label>Total Amount *</Label>
              <Input type="number" step="0.01" {...register("totalAmount", { valueAsNumber: true })} />
              {errors.totalAmount && <p className="text-xs text-destructive">{errors.totalAmount.message}</p>}
            </div>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-3">
            <p className="text-xs font-semibold text-emerald-800">Scholarship / Discount (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Discount Amount (৳)</Label>
                <Input type="number" step="0.01" min="0" {...register("discountAmount", { valueAsNumber: true })} placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reason / Note</Label>
                <Input {...register("discountReason")} placeholder="e.g. Merit scholarship" />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Due Date *</Label>
            <Input type="date" {...register("dueDate")} />
            {errors.dueDate && <p className="text-xs text-destructive">{errors.dueDate.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Invoice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Record Payment Dialog ──────────────────────────────────────────────────

function RecordPaymentDialog({ invoice, open, onClose }: { invoice: Invoice | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createMutation = useCreateTransaction();

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { method: "CASH" },
  });

  const onSubmit = (data: PaymentForm) => {
    if (!invoice) return;
    createMutation.mutate({ data: { invoiceId: invoice.id, ...data } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        qc.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
        toast({ title: "Payment recorded" });
        onClose();
      },
      onError: () => toast({ title: "Failed to record payment", variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          {invoice && (
            <p className="text-sm text-muted-foreground">
              {invoice.invoiceNumber} — {invoice.studentName}
              <br />
              Due: ৳{invoice.totalAmount.toLocaleString()} | Paid: ৳{invoice.paidAmount.toLocaleString()}
            </p>
          )}
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label>Amount Paid *</Label>
            <Input type="number" step="0.01"
              defaultValue={invoice ? invoice.totalAmount - invoice.paidAmount : ""}
              {...register("amountPaid", { valueAsNumber: true })} />
            {errors.amountPaid && <p className="text-xs text-destructive">{errors.amountPaid.message}</p>}
          </div>
          <div className="space-y-1">
            <Label>Payment Method *</Label>
            <Select defaultValue="CASH" onValueChange={v => setValue("method", v as PaymentForm["method"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["CASH", "BANK_TRANSFER", "MOBILE_BANKING", "CHEQUE"].map(m => (
                  <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Transaction ID</Label>
            <Input {...register("transactionId")} placeholder="Optional reference" />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input {...register("notes")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Reminders Tab ──────────────────────────────────────────────────────────

const OFFSET_OPTIONS = [
  { value: -7, label: "7 days before due date" },
  { value: -3, label: "3 days before due date" },
  { value: -1, label: "1 day before due date" },
  { value: 0,  label: "On the due date" },
  { value: 1,  label: "1 day after due (overdue)" },
  { value: 3,  label: "3 days after due (overdue)" },
  { value: 7,  label: "7 days after due (overdue)" },
  { value: 14, label: "14 days after due (overdue)" },
];

function RemindersTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [localDays, setLocalDays] = useState<number[] | null>(null);
  const [localEnabled, setLocalEnabled] = useState<boolean | null>(null);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery<ReminderSettings>({
    queryKey: ["reminder-settings"],
    queryFn: () => authedFetch("/api/reminder-settings"),
  });

  const effectiveDays = localDays ?? settings?.reminderDays ?? [-3, -1, 0, 1, 3, 7];
  const effectiveEnabled = localEnabled ?? settings?.isEnabled ?? true;

  const saveMutation = useMutation({
    mutationFn: (body: { isEnabled: boolean; reminderDays: number[] }) =>
      authedFetch("/api/reminder-settings", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminder-settings"] });
      setLocalDays(null);
      setLocalEnabled(null);
      toast({ title: "Reminder settings saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const triggerMutation = useMutation({
    mutationFn: () =>
      authedFetch<{ message: string; sent: number }>("/api/reminder-settings/trigger", { method: "POST" }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reminder-settings"] });
      setTriggerResult(data.message);
      toast({ title: data.sent > 0 ? `${data.sent} reminder${data.sent > 1 ? "s" : ""} sent` : "No matches found", description: data.message });
    },
    onError: (e: Error) => toast({ title: "Trigger failed", description: e.message, variant: "destructive" }),
  });

  const toggleDay = (day: number) => {
    const current = effectiveDays;
    setLocalDays(
      current.includes(day) ? current.filter(d => d !== day) : [...current, day].sort((a, b) => a - b),
    );
  };

  const isDirty = localDays !== null || localEnabled !== null;

  if (isLoading) return (
    <div className="space-y-3 py-4">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );

  return (
    <div className="space-y-6 py-2">
      {/* Status + last run */}
      <div className="flex items-start justify-between rounded-xl border border-border bg-card p-5">
        <div>
          <h3 className="font-semibold text-sm">Automated Fee Reminders</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            The scheduler runs once per day. For each enabled day-offset, it finds all PENDING or OVERDUE invoices
            whose due date matches and sends in-app notifications to parents and finance staff automatically.
          </p>
          {settings?.lastRunAt && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last run: {new Date(settings.lastRunAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              {" · "}{settings.lastRunCount} reminder{settings.lastRunCount !== 1 ? "s" : ""} sent
            </p>
          )}
          {!settings?.lastRunAt && (
            <p className="text-xs text-amber-600 mt-2">Has not run yet — will run on the next hourly check or use "Send Now".</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <span className="text-xs font-medium text-muted-foreground">
            {effectiveEnabled ? "Enabled" : "Disabled"}
          </span>
          <Switch
            checked={effectiveEnabled}
            onCheckedChange={v => setLocalEnabled(v)}
          />
        </div>
      </div>

      {/* Day offset checkboxes */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-sm">Reminder Windows</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose when reminders are sent relative to each invoice's due date.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {OFFSET_OPTIONS.map(opt => {
            const active = effectiveDays.includes(opt.value);
            const isAfterDue = opt.value > 0;
            return (
              <button
                key={opt.value}
                onClick={() => toggleDay(opt.value)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-all",
                  active
                    ? isAfterDue
                      ? "border-red-300 bg-red-50 text-red-800"
                      : "border-indigo-300 bg-indigo-50 text-indigo-800"
                    : "border-border bg-background text-muted-foreground hover:border-muted-foreground/40",
                )}
              >
                <span className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                  active
                    ? isAfterDue ? "border-red-400 bg-red-500 text-white" : "border-indigo-400 bg-indigo-500 text-white"
                    : "border-muted-foreground/30",
                )}>
                  {active ? "✓" : ""}
                </span>
                <span className="font-medium">{opt.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 mr-1" />Before due = early reminders.{" "}
          <span className="inline-block h-2 w-2 rounded-full bg-red-500 mr-1 ml-2" />After due = overdue follow-ups.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={() => saveMutation.mutate({ isEnabled: effectiveEnabled, reminderDays: effectiveDays })}
          disabled={saveMutation.isPending || !isDirty}
        >
          {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {isDirty ? "Save Changes" : "Saved"}
        </Button>

        <Button
          variant="outline"
          onClick={() => { setTriggerResult(null); triggerMutation.mutate(); }}
          disabled={triggerMutation.isPending}
        >
          {triggerMutation.isPending
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>
            : <><Play className="mr-2 h-4 w-4" /> Send Now</>}
        </Button>

        {isDirty && (
          <Button variant="ghost" size="sm" onClick={() => { setLocalDays(null); setLocalEnabled(null); }}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Reset
          </Button>
        )}
      </div>

      {/* Trigger result */}
      {triggerResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {triggerResult}
        </div>
      )}

      {/* How it works */}
      <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How it works</h4>
        <ul className="space-y-1.5 text-xs text-muted-foreground list-none">
          <li className="flex gap-2"><span className="text-indigo-500 font-bold">1.</span> The server checks for matching invoices every hour, but only sends once per calendar day.</li>
          <li className="flex gap-2"><span className="text-indigo-500 font-bold">2.</span> For each enabled window, it finds PENDING or OVERDUE invoices with a due date matching that offset from today.</li>
          <li className="flex gap-2"><span className="text-indigo-500 font-bold">3.</span> Parents linked to the student receive an in-app notification. Finance staff receive a copy.</li>
          <li className="flex gap-2"><span className="text-indigo-500 font-bold">4.</span> "Send Now" bypasses the daily limit for manual testing or urgent batches.</li>
        </ul>
      </div>
    </div>
  );
}

// ── Budget Tab ─────────────────────────────────────────────────────────────

type BudgetRow = {
  id: number | null;
  category: ExpenseCategory;
  year: number;
  budget: number | null;
  actual: number;
  variance: number | null;
  variancePct: number | null;
  notes: string | null;
  updatedAt: string | null;
};

type BudgetData = {
  year: number;
  rows: BudgetRow[];
  totals: { budget: number; actual: number; variance: number };
};

function EditBudgetDialog({ row, year, open, onClose, onSaved }: {
  row: BudgetRow | null; year: number;
  open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [notes, setNotes]   = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (row && open) {
      setAmount(row.budget !== null ? String(row.budget) : "");
      setNotes(row.notes ?? "");
    }
  }, [row, open]);

  const handleClose = () => { setAmount(""); setNotes(""); onClose(); };

  const handleSave = async () => {
    if (!row) return;
    const val = parseFloat(amount);
    if (isNaN(val) || val < 0) {
      toast({ title: "Enter a valid budget amount (0 or more)", variant: "destructive" }); return;
    }
    setLoading(true);
    try {
      await authedFetch("/api/finance/budgets", {
        method: "PUT",
        body: JSON.stringify({ category: row.category, year, budgetAmount: val, notes: notes.trim() || undefined }),
        headers: { "Content-Type": "application/json" },
      });
      toast({ title: "Budget saved", description: `${row.category}: ৳${val.toLocaleString()} for ${year}` });
      onSaved(); handleClose();
    } catch (e: any) {
      toast({ title: "Failed to save budget", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  const handleClear = async () => {
    if (!row?.id) return;
    setLoading(true);
    try {
      await authedFetch(`/api/finance/budgets/${row.id}`, { method: "DELETE" });
      toast({ title: "Budget removed" });
      onSaved(); handleClose();
    } catch (e: any) {
      toast({ title: "Failed to remove budget", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  if (!row) return null;
  const catName = row.category.charAt(0) + row.category.slice(1).toLowerCase();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: CATEGORY_COLORS[row.category] }} />
            {catName} Budget — {year}
          </DialogTitle>
          {row.actual > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Current spend: <span className="font-semibold text-foreground">৳{row.actual.toLocaleString()}</span>
            </p>
          )}
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label>Annual Budget (৳) *</Label>
            <Input
              type="number" min="0" step="100"
              placeholder={`e.g. ${row.category === "SALARY" ? "3000000" : "50000"}`}
              value={amount} onChange={e => setAmount(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            <Input placeholder="Any detail about this budget line…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {row.id && (
            <Button variant="outline" onClick={handleClear} disabled={loading}
              className="text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50 mr-auto">
              Remove
            </Button>
          )}
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save Budget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BudgetTab() {
  const qc = useQueryClient();
  const [year, setYear]         = useState(new Date().getFullYear());
  const [editRow, setEditRow]   = useState<BudgetRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery<BudgetData>({
    queryKey: ["budgets", year],
    queryFn: () => authedFetch(`/api/finance/budgets?year=${year}`),
  });

  const rows    = data?.rows ?? [];
  const totals  = data?.totals;
  const budgetedRows   = rows.filter(r => r.budget !== null);
  const overBudget     = budgetedRows.filter(r => (r.variance ?? 0) > 0);
  const totalBudgeted  = budgetedRows.length;

  const openEdit = (row: BudgetRow) => { setEditRow(row); setEditOpen(true); };

  const totalVariancePct = (totals?.budget ?? 0) > 0
    ? ((totals!.actual - totals!.budget) / totals!.budget) * 100
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Annual Expense Budgets</h2>
          <span className="text-xs text-muted-foreground">— click any row to set or edit</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setYear(y => y - 1)} className="p-1.5 rounded border border-border hover:bg-muted transition-colors">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-sm font-bold tabular-nums w-14 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-1.5 rounded border border-border hover:bg-muted transition-colors">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* KPI strip */}
      {!isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Budget",   value: `৳${(totals?.budget ?? 0).toLocaleString()}`,  cls: "text-indigo-600",  icon: <Target className="h-4 w-4 text-indigo-400" /> },
            { label: "Actual Spend",   value: `৳${(totals?.actual ?? 0).toLocaleString()}`,  cls: "text-foreground",  icon: <Receipt className="h-4 w-4 text-muted-foreground" /> },
            { label: "Variance",
              value: totals?.budget
                ? ((totals.variance ?? 0) >= 0 ? `+৳${Math.abs(totals.variance).toLocaleString()}` : `-৳${Math.abs(totals.variance).toLocaleString()}`)
                : "—",
              cls: (totals?.variance ?? 0) <= 0 ? "text-green-600" : "text-red-600",
              icon: (totals?.variance ?? 0) <= 0
                ? <ShieldCheck className="h-4 w-4 text-green-500" />
                : <AlertTriangle className="h-4 w-4 text-red-500" /> },
            { label: "Over Budget",    value: `${overBudget.length} / ${totalBudgeted} categories`, cls: overBudget.length > 0 ? "text-red-600 text-base" : "text-green-600 text-base",
              icon: <AlertTriangle className="h-4 w-4 text-muted-foreground" /> },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</p>
                {s.icon}
              </div>
              <p className={cn("text-xl font-bold tabular-nums", s.cls)}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2.5 text-xs text-indigo-800">
        <PencilLine className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>Set annual budgets per expense category. Actual spend is compared against your budget in real time. <strong>Actual</strong> = only PAID expenses count toward spend.</span>
      </div>

      {/* Budget table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Category", "Annual Budget", "Actual Spend", "Remaining", "Progress", ""].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                  ))}</tr>
                ))
              : rows.map(row => {
                  const pct = row.budget && row.budget > 0 ? Math.min((row.actual / row.budget) * 100, 100) : 0;
                  const over = (row.variance ?? 0) > 0;
                  const remaining = row.budget !== null ? row.budget - row.actual : null;
                  const catName = row.category.charAt(0) + row.category.slice(1).toLowerCase();

                  return (
                    <tr key={row.category}
                      onClick={() => openEdit(row)}
                      className="hover:bg-muted/30 transition-colors cursor-pointer group">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: CATEGORY_COLORS[row.category] }} />
                          <span className="font-medium">{catName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {row.budget !== null
                          ? <span className="font-medium tabular-nums text-indigo-700">৳{row.budget.toLocaleString()}</span>
                          : <span className="text-xs text-muted-foreground italic">Not set — click to add</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("font-medium tabular-nums", row.actual > 0 ? "text-foreground" : "text-muted-foreground")}>
                          {row.actual > 0 ? `৳${row.actual.toLocaleString()}` : "৳0"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {remaining !== null ? (
                          <span className={cn("font-semibold tabular-nums text-sm", over ? "text-red-600" : "text-green-600")}>
                            {over
                              ? <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />+৳{Math.abs(remaining).toLocaleString()} over</span>
                              : `৳${remaining.toLocaleString()} left`}
                          </span>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 min-w-[140px]">
                        {row.budget !== null ? (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span>{Math.min((row.actual / row.budget) * 100, 999).toFixed(1)}% used</span>
                              {over && <span className="text-red-500 font-semibold">OVER</span>}
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-visible relative">
                              <div
                                className={cn("h-full rounded-full transition-all", over ? "bg-red-500" : pct > 80 ? "bg-yellow-500" : "bg-green-500")}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="h-2 rounded-full bg-muted/50 w-full" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <PencilLine className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </td>
                    </tr>
                  );
                })}
          </tbody>
          {/* Totals footer */}
          {!isLoading && totalBudgeted > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40 font-bold">
                <td className="px-4 py-3 text-sm">Total ({totalBudgeted} budgeted)</td>
                <td className="px-4 py-3 tabular-nums text-indigo-700">৳{(totals?.budget ?? 0).toLocaleString()}</td>
                <td className="px-4 py-3 tabular-nums">{totals?.actual ? `৳${totals.actual.toLocaleString()}` : "৳0"}</td>
                <td className="px-4 py-3">
                  {totals?.budget ? (
                    <span className={cn("font-bold", (totals.variance ?? 0) <= 0 ? "text-green-600" : "text-red-600")}>
                      {(totals.variance ?? 0) <= 0
                        ? `৳${Math.abs(totals.variance).toLocaleString()} under`
                        : `৳${Math.abs(totals.variance).toLocaleString()} over`}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 min-w-[140px]">
                  {totals?.budget && totals.budget > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">
                        {((totals.actual / totals.budget) * 100).toFixed(1)}% of total budget
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn("h-full rounded-full",
                            (totalVariancePct ?? 0) > 0 ? "bg-red-500" : (totalVariancePct ?? 0) > -20 ? "bg-yellow-500" : "bg-green-500")}
                          style={{ width: `${Math.min((totals.actual / totals.budget) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <EditBudgetDialog
        row={editRow} year={year}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => { refetch(); qc.invalidateQueries({ queryKey: ["budgets"] }); }}
      />
    </div>
  );
}

// ── P&L Tab ────────────────────────────────────────────────────────────────

type PnLMonth = { month: string; label: string; income: number; expenses: number; net: number };
type PnLData = {
  year: number;
  kpis: {
    totalIncome: number; totalExpenses: number; netSurplus: number; marginPct: number;
    trailing3Avg: number;
    bestMonth:  { label: string; net: number } | null;
    worstMonth: { label: string; net: number } | null;
  };
  monthly: PnLMonth[];
};

function PnLTab() {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading } = useQuery<PnLData>({
    queryKey: ["pnl", year],
    queryFn: () => authedFetch(`/api/finance/pnl?year=${year}`),
  });

  const kpis = data?.kpis;
  const monthly = data?.monthly ?? [];

  // Chart data — only show months up to today when viewing current year
  const now = new Date();
  const cutoffIdx = year < now.getFullYear() ? 12 : now.getMonth(); // 0-based, show up to current month
  const chartData = monthly.slice(0, year < now.getFullYear() ? 12 : cutoffIdx + 1).map(m => ({
    name: m.label,
    Income:   m.income,
    Expenses: m.expenses,
    Net:      m.net,
  }));

  const surplus = (kpis?.netSurplus ?? 0) >= 0;
  const hasData = monthly.some(m => m.income > 0 || m.expenses > 0);

  const fmt = (v: number) => `৳${Math.abs(v).toLocaleString()}`;
  const fmtSigned = (v: number) => (v >= 0 ? `+৳${v.toLocaleString()}` : `-৳${Math.abs(v).toLocaleString()}`);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-white shadow-lg p-3 text-xs min-w-[160px]">
        <p className="font-semibold mb-2 text-foreground">{label}</p>
        {payload.map((p: any) => (
          <div key={p.name} className="flex justify-between gap-6 mb-0.5">
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="font-mono font-medium">{`৳${Number(p.value).toLocaleString()}`}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Year navigator */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Profit & Loss Statement</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setYear(y => y - 1)}
            className="p-1.5 rounded border border-border hover:bg-muted transition-colors">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-sm font-bold tabular-nums w-14 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)}
            className="p-1.5 rounded border border-border hover:bg-muted transition-colors">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* KPI cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 h-24 animate-pulse bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Total Income */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Income</p>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </div>
            <p className="text-xl font-bold tabular-nums text-green-600">{fmt(kpis?.totalIncome ?? 0)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Collected payments</p>
          </div>

          {/* Total Expenses */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Expenses</p>
              <TrendingDown className="h-4 w-4 text-red-500" />
            </div>
            <p className="text-xl font-bold tabular-nums text-red-600">{fmt(kpis?.totalExpenses ?? 0)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Paid expenses</p>
          </div>

          {/* Net Surplus / Deficit */}
          <div className={cn("rounded-lg border p-4", surplus ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50")}>
            <div className="flex items-center justify-between mb-2">
              <p className={cn("text-xs uppercase tracking-wider font-medium", surplus ? "text-green-700" : "text-red-700")}>
                Net {surplus ? "Surplus" : "Deficit"}
              </p>
              {surplus
                ? <ArrowUpRight className="h-4 w-4 text-green-600" />
                : <ArrowDownRight className="h-4 w-4 text-red-600" />}
            </div>
            <p className={cn("text-xl font-bold tabular-nums", surplus ? "text-green-700" : "text-red-700")}>
              {fmtSigned(kpis?.netSurplus ?? 0)}
            </p>
            <p className={cn("text-[10px] mt-1", surplus ? "text-green-600" : "text-red-600")}>
              {Math.abs(kpis?.marginPct ?? 0).toFixed(1)}% margin
            </p>
          </div>

          {/* 3-month trailing avg */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">3-Mo Avg Net</p>
              <Minus className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className={cn("text-xl font-bold tabular-nums",
              (kpis?.trailing3Avg ?? 0) >= 0 ? "text-green-600" : "text-red-600")}>
              {fmtSigned(Math.round(kpis?.trailing3Avg ?? 0))}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">Last 3 active months</p>
          </div>
        </div>
      )}

      {/* Best / worst month badges */}
      {!isLoading && hasData && (
        <div className="flex gap-3 flex-wrap">
          {kpis?.bestMonth && (
            <div className="flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
              <ArrowUpRight className="h-3.5 w-3.5" />
              Best month: <span className="font-bold">{kpis.bestMonth.label}</span>
              &nbsp;({fmtSigned(kpis.bestMonth.net)})
            </div>
          )}
          {kpis?.worstMonth && kpis.worstMonth.label !== kpis.bestMonth?.label && (
            <div className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
              <ArrowDownRight className="h-3.5 w-3.5" />
              Worst month: <span className="font-bold">{kpis.worstMonth.label}</span>
              &nbsp;({fmtSigned(kpis.worstMonth.net)})
            </div>
          )}
        </div>
      )}

      {/* Main chart */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          Income vs Expenses — {year}
          <span className="ml-auto flex items-center gap-3 text-xs font-normal text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#22c55e]" />Income</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#ef4444]" />Expenses</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full border-2 border-[#6366f1] bg-white" />Net</span>
          </span>
        </h3>
        {!hasData ? (
          <div className="h-64 flex flex-col items-center justify-center text-sm text-muted-foreground">
            <BarChart3 className="h-10 w-10 mb-3 opacity-20" />
            <p className="font-medium">No financial data for {year}</p>
            <p className="text-xs mt-1">Record income (via transactions) and expenses to see your P&L</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => v >= 1000 ? `৳${(v / 1000).toFixed(0)}k` : `৳${v}`} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1.5} />
              <Bar dataKey="Income"   fill="#22c55e" radius={[4,4,0,0]} maxBarSize={32} />
              <Bar dataKey="Expenses" fill="#ef4444" radius={[4,4,0,0]} maxBarSize={32} />
              <Line dataKey="Net" type="monotone" stroke="#6366f1" strokeWidth={2.5}
                dot={{ r: 4, fill: "#6366f1", strokeWidth: 2, stroke: "#fff" }}
                activeDot={{ r: 6 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Monthly breakdown table */}
      {hasData && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="text-sm font-semibold">Monthly Breakdown</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Month", "Income", "Expenses", "Net Surplus / Deficit", "Margin"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {monthly.map(m => {
                const active = m.income > 0 || m.expenses > 0;
                const isPos  = m.net >= 0;
                const margin = m.income > 0 ? (m.net / m.income) * 100 : null;
                return (
                  <tr key={m.month} className={cn("transition-colors", active ? "hover:bg-muted/20" : "opacity-40")}>
                    <td className="px-4 py-3 font-medium text-sm">{m.label}</td>
                    <td className="px-4 py-3 tabular-nums text-green-600 font-medium">
                      {m.income > 0 ? `৳${m.income.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-red-600 font-medium">
                      {m.expenses > 0 ? `৳${m.expenses.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {active ? (
                        <span className={cn("inline-flex items-center gap-1.5 font-bold tabular-nums text-sm",
                          isPos ? "text-green-700" : "text-red-700")}>
                          {isPos
                            ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                            : <ArrowDownRight className="h-3.5 w-3.5 shrink-0" />}
                          {fmtSigned(m.net)}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">No activity</span>}
                    </td>
                    <td className="px-4 py-3">
                      {margin !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all", isPos ? "bg-green-500" : "bg-red-500")}
                              style={{ width: `${Math.min(Math.abs(margin), 100)}%` }}
                            />
                          </div>
                          <span className={cn("text-xs font-medium tabular-nums", isPos ? "text-green-600" : "text-red-600")}>
                            {margin.toFixed(1)}%
                          </span>
                        </div>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Annual totals footer */}
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40 font-bold">
                <td className="px-4 py-3 text-sm">Annual Total</td>
                <td className="px-4 py-3 tabular-nums text-green-700">{fmt(kpis?.totalIncome ?? 0)}</td>
                <td className="px-4 py-3 tabular-nums text-red-700">{fmt(kpis?.totalExpenses ?? 0)}</td>
                <td className="px-4 py-3">
                  <span className={cn("inline-flex items-center gap-1.5 font-bold text-sm",
                    surplus ? "text-green-700" : "text-red-700")}>
                    {surplus ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {fmtSigned(kpis?.netSurplus ?? 0)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("text-sm font-bold", surplus ? "text-green-600" : "text-red-600")}>
                    {(kpis?.marginPct ?? 0).toFixed(1)}%
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Expenses Tab ───────────────────────────────────────────────────────────

const EXPENSE_CATEGORIES = [
  "SALARY","RENT","UTILITIES","MAINTENANCE","SUPPLIES","TRANSPORT","FOOD","EVENTS","TECHNOLOGY","OTHER",
] as const;
type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
const EXPENSE_STATUSES = ["PENDING","APPROVED","REJECTED","PAID"] as const;
type ExpenseStatus = typeof EXPENSE_STATUSES[number];

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  SALARY: "#6366f1", RENT: "#f59e0b", UTILITIES: "#14b8a6", MAINTENANCE: "#f97316",
  SUPPLIES: "#8b5cf6", TRANSPORT: "#3b82f6", FOOD: "#ec4899", EVENTS: "#10b981",
  TECHNOLOGY: "#06b6d4", OTHER: "#94a3b8",
};

const STATUS_STYLES: Record<ExpenseStatus, string> = {
  PENDING:  "bg-yellow-50 text-yellow-700 border-yellow-200",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  PAID:     "bg-green-50 text-green-700 border-green-200",
};

type ExpenseRow = {
  id: number; category: ExpenseCategory; description: string; amount: number;
  expenseDate: string; payee: string | null; referenceNumber: string | null;
  notes: string | null; status: ExpenseStatus;
  createdBy: string | null; approvedBy: string | null; createdAt: string;
};

type ExpenseSummary = {
  year: number;
  totals: { all: number; paid: number; pending: number; count: number };
  monthly: { month: string; total: number }[];
  byCategory: { category: ExpenseCategory; total: number; count: number }[];
};

function AddExpenseDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [category, setCategory]   = useState<string>("OTHER");
  const [description, setDesc]    = useState("");
  const [amount, setAmount]       = useState("");
  const [expenseDate, setDate]    = useState(new Date().toISOString().slice(0, 10));
  const [payee, setPayee]         = useState("");
  const [refNum, setRefNum]       = useState("");
  const [notes, setNotes]         = useState("");
  const [loading, setLoading]     = useState(false);

  const reset = () => {
    setCategory("OTHER"); setDesc(""); setAmount("");
    setDate(new Date().toISOString().slice(0, 10));
    setPayee(""); setRefNum(""); setNotes("");
  };
  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!description.trim() || !amount || !expenseDate) {
      toast({ title: "Description, amount and date are required", variant: "destructive" }); return;
    }
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      toast({ title: "Enter a valid positive amount", variant: "destructive" }); return;
    }
    setLoading(true);
    try {
      await authedFetch("/api/finance/expenses", {
        method: "POST",
        body: JSON.stringify({ category, description: description.trim(), amount: val, expenseDate,
          payee: payee.trim() || undefined, referenceNumber: refNum.trim() || undefined,
          notes: notes.trim() || undefined }),
        headers: { "Content-Type": "application/json" },
      });
      toast({ title: "Expense recorded", description: `৳${val.toLocaleString()} — ${category}` });
      onCreated(); handleClose();
    } catch (e: any) {
      toast({ title: "Failed to record expense", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Record Expense
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: CATEGORY_COLORS[c as ExpenseCategory] }} />
                        {c.charAt(0) + c.slice(1).toLowerCase()}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount (৳) *</Label>
              <Input type="number" min="0.01" step="0.01" placeholder="e.g. 15000"
                value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description *</Label>
            <Input placeholder="e.g. Monthly electricity bill — July 2026"
              value={description} onChange={e => setDesc(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input type="date" value={expenseDate} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Payee <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input placeholder="Vendor / supplier name" value={payee} onChange={e => setPayee(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Reference # <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input placeholder="Invoice / voucher #" value={refNum} onChange={e => setRefNum(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input placeholder="Any extra detail…" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              : <><Receipt className="mr-2 h-4 w-4" />Record Expense</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpensesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen]         = useState(false);
  const [view, setView]               = useState<"list" | "summary">("summary");
  const [catFilter, setCatFilter]     = useState<string>("all");
  const [statusFilter2, setStatus2]   = useState<string>("all");
  const [year, setYear]               = useState(new Date().getFullYear());
  const [updatingId, setUpdatingId]   = useState<number | null>(null);
  const [deletingId, setDeletingId]   = useState<number | null>(null);

  const listQ = useQuery<{ expenses: ExpenseRow[]; total: number }>({
    queryKey: ["expenses-list", catFilter, statusFilter2],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (catFilter !== "all")   params.set("category", catFilter);
      if (statusFilter2 !== "all") params.set("status", statusFilter2);
      return authedFetch(`/api/finance/expenses?${params}`);
    },
  });

  const summaryQ = useQuery<ExpenseSummary>({
    queryKey: ["expenses-summary", year],
    queryFn: () => authedFetch(`/api/finance/expenses/summary?year=${year}`),
  });

  const refetchAll = () => {
    listQ.refetch(); summaryQ.refetch();
    qc.invalidateQueries({ queryKey: ["expenses-list"] });
    qc.invalidateQueries({ queryKey: ["expenses-summary"] });
  };

  const setStatus = async (id: number, status: ExpenseStatus) => {
    setUpdatingId(id);
    try {
      await authedFetch(`/api/finance/expenses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
        headers: { "Content-Type": "application/json" },
      });
      toast({ title: `Expense marked as ${status.toLowerCase()}` });
      refetchAll();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally { setUpdatingId(null); }
  };

  const deleteExpense = async (id: number) => {
    setDeletingId(id);
    try {
      await authedFetch(`/api/finance/expenses/${id}`, { method: "DELETE" });
      toast({ title: "Expense deleted" });
      refetchAll();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally { setDeletingId(null); }
  };

  const summary = summaryQ.data;
  const expenses = listQ.data?.expenses ?? [];
  const monthLabels: Record<string, string> = {
    "01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun",
    "07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec",
  };
  const chartData = summary?.monthly.map(m => ({
    name: monthLabels[m.month.slice(5)] ?? m.month.slice(5),
    amount: m.total,
  })) ?? [];

  const pieData = summary?.byCategory.map(c => ({
    name: c.category.charAt(0) + c.category.slice(1).toLowerCase(),
    value: c.total,
    fill: CATEGORY_COLORS[c.category],
  })) ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg p-1">
          {(["summary","list"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize",
                view === v ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {v === "summary" ? <span className="flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Summary</span>
                               : <span className="flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5" />All Expenses</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {view === "summary" && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setYear(y => y - 1)} className="p-1.5 rounded border hover:bg-muted"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <span className="text-sm font-medium tabular-nums w-12 text-center">{year}</span>
              <button onClick={() => setYear(y => y + 1)} className="p-1.5 rounded border hover:bg-muted"><ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Record Expense
          </Button>
        </div>
      </div>

      {/* ── SUMMARY VIEW ── */}
      {view === "summary" && (
        <div className="space-y-4">
          {/* KPI cards */}
          {summaryQ.isLoading ? (
            <div className="grid grid-cols-4 gap-3">{Array.from({length:4}).map((_,i) => <div key={i} className="rounded-lg border bg-card p-4 h-20 animate-pulse bg-muted" />)}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Expenses",  value: `৳${(summary?.totals.all ?? 0).toLocaleString()}`,     cls: "text-foreground" },
                { label: "Paid",            value: `৳${(summary?.totals.paid ?? 0).toLocaleString()}`,    cls: "text-green-600" },
                { label: "Pending Approval",value: `৳${(summary?.totals.pending ?? 0).toLocaleString()}`, cls: "text-yellow-600" },
                { label: "Records",         value: summary?.totals.count ?? 0,                             cls: "text-indigo-600" },
              ].map(s => (
                <div key={s.label} className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className={cn("text-xl font-bold mt-1 tabular-nums", s.cls)}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Monthly bar chart */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" /> Monthly Paid Expenses — {year}
            </h3>
            {chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No paid expenses recorded for {year}</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `৳${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => [`৳${v.toLocaleString()}`, "Paid"]} contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Pie + table side-by-side */}
          {pieData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold mb-3">Spending by Category</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `৳${v.toLocaleString()}`} contentStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold mb-3">Category Breakdown</h3>
                <div className="space-y-2">
                  {summary?.byCategory.map(c => {
                    const pct = summary.totals.paid > 0 ? (c.total / summary.totals.paid) * 100 : 0;
                    return (
                      <div key={c.category}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ background: CATEGORY_COLORS[c.category] }} />
                            {c.category.charAt(0) + c.category.slice(1).toLowerCase()}
                            <span className="text-muted-foreground">({c.count})</span>
                          </span>
                          <span className="font-medium tabular-nums">৳{c.total.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CATEGORY_COLORS[c.category] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {view === "list" && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.charAt(0)+c.slice(1).toLowerCase()}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter2} onValueChange={setStatus2}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {EXPENSE_STATUSES.map(s => <SelectItem key={s} value={s}>{s.charAt(0)+s.slice(1).toLowerCase()}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground self-center ml-auto">{listQ.data?.total ?? 0} records</p>
          </div>

          {/* Table */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Date","Category","Description","Payee","Amount","Status","Actions"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {listQ.isLoading ? (
                  Array.from({length:5}).map((_,i) => (
                    <tr key={i}>{Array.from({length:7}).map((_,j) => (
                      <td key={j} className="px-3 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                    ))}</tr>
                  ))
                ) : expenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-14 text-center text-sm text-muted-foreground">
                      <Receipt className="h-8 w-8 mx-auto mb-2 opacity-25" />
                      <p className="font-medium">No expenses found</p>
                      <p className="text-xs mt-1">Record your first expense using the button above</p>
                    </td>
                  </tr>
                ) : expenses.map(e => (
                  <tr key={e.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-3 text-xs whitespace-nowrap">
                      {new Date(e.expenseDate).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                        <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: CATEGORY_COLORS[e.category] }} />
                        {e.category.charAt(0)+e.category.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-3 py-3 max-w-[200px]">
                      <p className="text-sm font-medium line-clamp-1">{e.description}</p>
                      {e.referenceNumber && <p className="text-xs text-muted-foreground font-mono">#{e.referenceNumber}</p>}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{e.payee ?? "—"}</td>
                    <td className="px-3 py-3 font-bold tabular-nums text-sm whitespace-nowrap">৳{e.amount.toLocaleString()}</td>
                    <td className="px-3 py-3">
                      <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold border uppercase tracking-wide", STATUS_STYLES[e.status])}>
                        {e.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        {updatingId === e.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <>
                            {e.status === "PENDING" && (
                              <button onClick={() => setStatus(e.id, "APPROVED")} title="Approve"
                                className="p-1 rounded hover:bg-blue-50 text-blue-500 hover:text-blue-700 transition-colors">
                                <CheckCheck className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {e.status === "APPROVED" && (
                              <button onClick={() => setStatus(e.id, "PAID")} title="Mark Paid"
                                className="p-1 rounded hover:bg-green-50 text-green-600 hover:text-green-800 transition-colors">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {(e.status === "PENDING" || e.status === "APPROVED") && (
                              <button onClick={() => setStatus(e.id, "REJECTED")} title="Reject"
                                className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-700 transition-colors">
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {e.status !== "PAID" && (
                              <button onClick={() => deleteExpense(e.id)} disabled={deletingId === e.id} title="Delete"
                                className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50">
                                {deletingId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddExpenseDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={refetchAll} />
    </div>
  );
}

// ── Discounts Tab ──────────────────────────────────────────────────────────

type Discount = {
  id: number; studentId: number; studentName: string; studentKey: string;
  feeTypeId: number | null; feeTypeName: string | null;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: number; reason: string | null; isActive: boolean;
  createdBy: string | null; createdAt: string;
};

function AddDiscountDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [studentId, setStudentId] = useState<string>("");
  const [feeTypeId, setFeeTypeId] = useState<string>("all");
  const [discountType, setDiscountType] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const { data: studentsData } = useListStudents({ limit: 200 });
  const { data: feeTypesData } = useQuery<{ feeTypes: { id: number; name: string; amount: number }[] }>({
    queryKey: ["fee-types-list"],
    queryFn: () => authedFetch("/api/fee-types"),
    enabled: open,
  });

  const reset = () => {
    setStudentId(""); setFeeTypeId("all"); setDiscountType("PERCENTAGE");
    setDiscountValue(""); setReason("");
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!studentId || !discountValue) {
      toast({ title: "Student and discount value are required", variant: "destructive" }); return;
    }
    const val = parseFloat(discountValue);
    if (isNaN(val) || val <= 0) {
      toast({ title: "Enter a valid positive discount value", variant: "destructive" }); return;
    }
    if (discountType === "PERCENTAGE" && val > 100) {
      toast({ title: "Percentage cannot exceed 100%", variant: "destructive" }); return;
    }
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        studentId: Number(studentId), discountType, discountValue: val,
      };
      if (feeTypeId && feeTypeId !== "all") body["feeTypeId"] = Number(feeTypeId);
      if (reason.trim()) body["reason"] = reason.trim();

      await authedFetch("/api/finance/discounts", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
      toast({ title: "Discount created", description: `${discountType === "PERCENTAGE" ? val + "%" : "৳" + val} discount applied` });
      onCreated();
      handleClose();
    } catch (e: any) {
      toast({ title: "Failed to create discount", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" /> Add Discount / Scholarship
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Discounts are automatically applied when bulk-generating invoices. Fee-type-specific discounts take priority over catch-all discounts.
          </p>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Student *</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger><SelectValue placeholder="Search student…" /></SelectTrigger>
              <SelectContent>
                {(studentsData?.students ?? []).map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.firstName} {s.lastName}
                    <span className="text-muted-foreground ml-1.5 font-mono text-xs">({s.studentId})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Applies To</Label>
            <Select value={feeTypeId} onValueChange={setFeeTypeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Fee Types (catch-all)</SelectItem>
                {(feeTypesData?.feeTypes ?? []).map(f => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Discount Type *</Label>
              <Select value={discountType} onValueChange={v => setDiscountType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                  <SelectItem value="FIXED">Fixed Amount (৳)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Value *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {discountType === "PERCENTAGE" ? "%" : "৳"}
                </span>
                <Input
                  type="number" step="0.01" min="0.01"
                  max={discountType === "PERCENTAGE" ? "100" : undefined}
                  className="pl-7"
                  value={discountValue}
                  onChange={e => setDiscountValue(e.target.value)}
                  placeholder={discountType === "PERCENTAGE" ? "e.g. 25" : "e.g. 500"}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reason / Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Merit scholarship, sibling discount, financial aid…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : <><Tag className="mr-2 h-4 w-4" /> Add Discount</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiscountsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery<{ discounts: Discount[]; total: number }>({
    queryKey: ["discounts", activeFilter],
    queryFn: () => authedFetch(
      activeFilter === "active"
        ? "/api/finance/discounts?active=true"
        : "/api/finance/discounts",
    ),
  });

  const discounts = (data?.discounts ?? []).filter(d =>
    activeFilter === "inactive" ? !d.isActive : true,
  );

  const toggleActive = async (d: Discount) => {
    setTogglingId(d.id);
    try {
      await authedFetch(`/api/finance/discounts/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !d.isActive }),
        headers: { "Content-Type": "application/json" },
      });
      toast({ title: d.isActive ? "Discount deactivated" : "Discount activated" });
      qc.invalidateQueries({ queryKey: ["discounts"] });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to update", description: e.message, variant: "destructive" });
    } finally { setTogglingId(null); }
  };

  const deleteDiscount = async (id: number) => {
    setDeletingId(id);
    try {
      await authedFetch(`/api/finance/discounts/${id}`, { method: "DELETE" });
      toast({ title: "Discount deleted" });
      qc.invalidateQueries({ queryKey: ["discounts"] });
      refetch();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally { setDeletingId(null); }
  };

  const activeCount  = (data?.discounts ?? []).filter(d => d.isActive).length;
  const pctCount     = (data?.discounts ?? []).filter(d => d.discountType === "PERCENTAGE").length;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {(["all", "active", "inactive"] as const).map(f => (
            <button key={f} onClick={() => setActiveFilter(f)}
              className={cn("rounded-full px-3 py-1 text-xs font-medium border transition-colors capitalize",
                activeFilter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:border-primary/50 text-muted-foreground")}
            >
              {f}
              {f === "active" && activeCount > 0 && (
                <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[10px] text-white font-bold">{activeCount}</span>
              )}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Discount
        </Button>
      </div>

      {/* Summary strip */}
      {(data?.discounts.length ?? 0) > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Discounts", value: data?.total ?? 0, cls: "text-foreground" },
            { label: "Active",          value: activeCount,       cls: "text-green-600" },
            { label: "Percentage",      value: pctCount,          cls: "text-indigo-600" },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-3 text-center">
              <p className={cn("text-2xl font-bold tabular-nums", s.cls)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-800">
        <UserCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Active discounts are <strong>automatically applied</strong> when bulk-generating invoices. Fee-type-specific discounts take priority over catch-all discounts for the same student.
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Student", "Applies To", "Discount", "Reason", "Status", "Created By", "Actions"].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                  <td key={j} className="px-3 py-3"><div className="h-4 bg-muted rounded animate-pulse w-full" /></td>
                ))}</tr>
              ))
            ) : discounts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center text-sm text-muted-foreground">
                  <Tag className="h-8 w-8 mx-auto mb-2 opacity-25" />
                  <p className="font-medium">No discounts found</p>
                  <p className="text-xs mt-1">Add a discount or scholarship to get started</p>
                </td>
              </tr>
            ) : discounts.map(d => (
              <tr key={d.id} className={cn("hover:bg-muted/20 transition-colors", !d.isActive && "opacity-50")}>
                <td className="px-3 py-3">
                  <p className="font-medium text-sm">{d.studentName}</p>
                  <p className="text-xs text-muted-foreground font-mono">{d.studentKey}</p>
                </td>
                <td className="px-3 py-3 text-xs">
                  {d.feeTypeName
                    ? <span className="inline-block rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-indigo-700 font-medium">{d.feeTypeName}</span>
                    : <span className="inline-block rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground">All fees</span>}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    {d.discountType === "PERCENTAGE"
                      ? <Percent className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                      : <span className="text-xs font-bold text-green-600 shrink-0">৳</span>}
                    <span className="font-bold tabular-nums text-sm">
                      {d.discountType === "PERCENTAGE" ? `${d.discountValue}%` : `৳${d.discountValue.toLocaleString()}`}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{d.discountType === "PERCENTAGE" ? "Percentage" : "Fixed Amount"}</p>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground max-w-[180px]">
                  <span className="line-clamp-2">{d.reason ?? "—"}</span>
                </td>
                <td className="px-3 py-3">
                  <button
                    onClick={() => toggleActive(d)}
                    disabled={togglingId === d.id}
                    className="flex items-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                    title={d.isActive ? "Click to deactivate" : "Click to activate"}
                  >
                    {togglingId === d.id
                      ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      : d.isActive
                        ? <ToggleRight className="h-5 w-5 text-green-500" />
                        : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                    <span className={d.isActive ? "text-green-600" : "text-muted-foreground"}>
                      {d.isActive ? "Active" : "Inactive"}
                    </span>
                  </button>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground">
                  <p>{d.createdBy ?? "—"}</p>
                  <p className="text-[10px] mt-0.5">{new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                </td>
                <td className="px-3 py-3">
                  <button
                    onClick={() => deleteDiscount(d.id)}
                    disabled={deletingId === d.id}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                  >
                    {deletingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddDiscountDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => { refetch(); qc.invalidateQueries({ queryKey: ["discounts"] }); }} />
    </div>
  );
}

// ── Payment Requests Tab ───────────────────────────────────────────────────

type PaymentRequest = {
  id: number; invoiceId: number; invoiceNumber: string;
  studentName: string; studentKey: string;
  parentName: string | null; parentEmail: string | null;
  amount: number; method: string; transactionRef: string | null;
  paymentDate: string; note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null; reviewedAt: string | null; reviewedBy: string | null;
  createdAt: string;
};

const PR_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:  { label: "Pending",  cls: "bg-yellow-100 text-yellow-700" },
  APPROVED: { label: "Approved", cls: "bg-green-100 text-green-700" },
  REJECTED: { label: "Rejected", cls: "bg-red-100 text-red-700" },
};

function RejectDialog({
  open, onClose, onConfirm, loading,
}: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void; loading: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Reject Payment Request</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-muted-foreground">Provide a reason so the parent understands why the request was rejected.</p>
          <div className="space-y-1">
            <Label>Reason (optional)</Label>
            <Input
              value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Transaction ID not found, wrong amount…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentRequestsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setPrStatusFilter] = useState<string>("PENDING");
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery<{ requests: PaymentRequest[]; total: number }>({
    queryKey: ["payment-requests", statusFilter],
    queryFn: () => authedFetch("/api/parent/payment-requests"),
  });

  const filtered = (data?.requests ?? []).filter(r =>
    statusFilter === "all" ? true : r.status === statusFilter,
  );
  const pendingCount = (data?.requests ?? []).filter(r => r.status === "PENDING").length;

  const approve = async (id: number) => {
    setApprovingId(id);
    try {
      await authedFetch(`/api/finance/payment-requests/${id}/approve`, { method: "PATCH" });
      toast({ title: "Payment approved", description: "Invoice updated and parent notified." });
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
      refetch();
    } catch (e: any) {
      toast({ title: "Approval failed", description: e.message, variant: "destructive" });
    } finally { setApprovingId(null); }
  };

  const reject = async (id: number, reason: string) => {
    setRejectingId(id);
    try {
      await authedFetch(`/api/finance/payment-requests/${id}/reject`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
        headers: { "Content-Type": "application/json" },
      });
      toast({ title: "Request rejected", description: "Parent has been notified." });
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
      setRejectTarget(null);
      refetch();
    } catch (e: any) {
      toast({ title: "Rejection failed", description: e.message, variant: "destructive" });
    } finally { setRejectingId(null); }
  };

  return (
    <div className="space-y-4">
      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {pendingCount} pending payment request{pendingCount > 1 ? "s" : ""} awaiting review
        </div>
      )}

      <div className="flex items-center gap-2">
        {["PENDING", "APPROVED", "REJECTED", "all"].map(s => (
          <button key={s} onClick={() => setPrStatusFilter(s)}
            className={cn("rounded-full px-3 py-1 text-xs font-medium border transition-colors",
              statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50 text-muted-foreground")}
          >
            {s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            {s === "PENDING" && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] text-white font-bold">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Student", "Invoice", "Amount", "Method", "Ref", "Pay Date", "Submitted", "Status", "Actions"].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 9 }).map((_, j) => (
                  <td key={j} className="px-3 py-3"><Skeleton className="h-4 w-full" /></td>
                ))}</tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No {statusFilter !== "all" ? statusFilter.toLowerCase() : ""} payment requests
                </td>
              </tr>
            ) : filtered.map(pr => {
              const s = PR_STATUS[pr.status] ?? PR_STATUS["PENDING"]!;
              return (
                <tr key={pr.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-3">
                    <p className="font-medium text-sm">{pr.studentName}</p>
                    {pr.parentName && <p className="text-xs text-muted-foreground">{pr.parentName}</p>}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{pr.invoiceNumber}</td>
                  <td className="px-3 py-3 tabular-nums font-semibold text-green-700">৳{pr.amount.toLocaleString()}</td>
                  <td className="px-3 py-3 text-xs">
                    <span className="inline-block rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-indigo-700 font-medium">{pr.method}</span>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{pr.transactionRef ?? "—"}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{pr.paymentDate}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {new Date(pr.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </td>
                  <td className="px-3 py-3">
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", s.cls)}>{s.label}</span>
                    {pr.status === "REJECTED" && pr.rejectionReason && (
                      <p className="text-[10px] text-red-500 mt-0.5 max-w-[120px] truncate" title={pr.rejectionReason}>{pr.rejectionReason}</p>
                    )}
                    {pr.status !== "PENDING" && pr.reviewedBy && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">by {pr.reviewedBy}</p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {pr.status === "PENDING" && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => approve(pr.id)}
                          disabled={approvingId === pr.id}
                          className="flex items-center gap-1 rounded-md bg-green-50 border border-green-200 px-2 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
                        >
                          {approvingId === pr.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
                          Approve
                        </button>
                        <button
                          onClick={() => setRejectTarget(pr.id)}
                          className="flex items-center gap-1 rounded-md bg-red-50 border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100 transition-colors"
                        >
                          <ThumbsDown className="h-3 w-3" /> Reject
                        </button>
                      </div>
                    )}
                    {pr.status !== "PENDING" && (
                      <span className="text-xs text-muted-foreground">
                        {pr.reviewedAt ? new Date(pr.reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <RejectDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => rejectTarget !== null && reject(rejectTarget, reason)}
        loading={rejectingId !== null}
      />
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function FinancePage() {
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [remindingId, setRemindingId] = useState<number | null>(null);
  const [remindedIds, setRemindedIds] = useState<Set<number>>(new Set());
  const { toast } = useToast();

  const sendReminder = async (invoiceId: number) => {
    setRemindingId(invoiceId);
    try {
      const result = await customFetch<{ message: string; parentNotified: boolean }>(`/api/invoices/${invoiceId}/notify`, { method: "POST" });
      setRemindedIds(prev => new Set(prev).add(invoiceId));
      toast({
        title: result.parentNotified ? "Reminder sent to parent & staff" : "Reminder sent to staff",
        description: result.message,
      });
    } catch {
      toast({ title: "Failed to send reminder", variant: "destructive" });
    } finally {
      setRemindingId(null);
    }
  };

  const params = { status: statusFilter as any || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const { data: invoicesData, isLoading } = useListInvoices(params);
  const { data: transactionsData } = useListTransactions({ limit: 20 });

  const totalRevenue = transactionsData?.transactions.reduce((s, t) => s + t.amountPaid, 0) ?? 0;
  const pendingTotal = invoicesData?.invoices
    .filter(i => i.status === "PENDING" || i.status === "OVERDUE")
    .reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0) ?? 0;

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Finance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Invoices, payments, and transactions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setExportDialogOpen(true)}>
            <Download className="mr-2 h-4 w-4" /> Export PDF
          </Button>
          <Button variant="outline" onClick={() => setBulkDialogOpen(true)}>
            <Layers className="mr-2 h-4 w-4" /> Bulk Generate
          </Button>
          <Button onClick={() => setInvoiceDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Create Invoice
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Invoices", value: invoicesData?.total ?? 0 },
          { label: "Total Collected", value: `৳${totalRevenue.toLocaleString()}` },
          { label: "Pending Amount", value: `৳${pendingTotal.toLocaleString()}` },
          { label: "Transactions", value: transactionsData?.total ?? 0 },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-bold mt-1 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reminders" className="flex items-center gap-1.5">
            <Bell className="h-3.5 w-3.5" /> Reminders
          </TabsTrigger>
          <TabsTrigger value="payment-requests" className="flex items-center gap-1.5">
            <Inbox className="h-3.5 w-3.5" /> Payment Requests
          </TabsTrigger>
          <TabsTrigger value="discounts" className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" /> Discounts
          </TabsTrigger>
          <TabsTrigger value="expenses" className="flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" /> Expenses
          </TabsTrigger>
          <TabsTrigger value="pnl" className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" /> P&amp;L
          </TabsTrigger>
          <TabsTrigger value="budgets" className="flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5" /> Budgets
          </TabsTrigger>
        </TabsList>

        {/* ── Invoices tab ── */}
        <TabsContent value="invoices" className="space-y-4 mt-4">
          <div className="flex gap-3">
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {["PENDING", "PAID", "OVERDUE", "CANCELLED"].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Invoice No.", "Student", "Fee Type", "Month", "Total", "Paid", "Due Date", "Status", "Action"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}</tr>
                  ))
                ) : invoicesData?.invoices.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">No invoices found</td></tr>
                ) : invoicesData?.invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 font-medium">{inv.studentName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{inv.feeTypeName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{inv.month ?? "-"}</td>
                    <td className="px-4 py-3 tabular-nums">৳{inv.totalAmount.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular-nums text-green-600">৳{inv.paidAmount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted-foreground">{inv.dueDate}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", statusColors[inv.status] ?? "")}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                          <button
                            onClick={() => setPaymentInvoice(inv)}
                            className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                          >
                            <CreditCard className="h-3 w-3" /> Pay
                          </button>
                        )}
                        {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                          remindedIds.has(inv.id) ? (
                            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                              <CheckCircle2 className="h-3 w-3" /> Sent
                            </span>
                          ) : (
                            <button
                              onClick={() => sendReminder(inv.id)}
                              disabled={remindingId === inv.id}
                              className="flex items-center gap-1 text-xs text-amber-600 hover:underline font-medium disabled:opacity-50"
                              title="Send payment reminder"
                            >
                              {remindingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
                              Remind
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {(invoicesData?.total ?? 0) > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, invoicesData?.total ?? 0)} of {invoicesData?.total} invoices
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-3 text-muted-foreground tabular-nums">
                  {page + 1} / {Math.ceil((invoicesData?.total ?? 0) / PAGE_SIZE)}
                </span>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= (invoicesData?.total ?? 0)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Transactions tab ── */}
        <TabsContent value="transactions" className="mt-4">
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Student", "Invoice", "Amount", "Method", "Txn ID", "Date"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactionsData?.transactions.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No transactions yet</td></tr>
                ) : transactionsData?.transactions.map(t => (
                  <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{t.studentName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{t.invoiceId}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-green-600">৳{t.amountPaid.toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted-foreground">{t.method.replace("_", " ")}</td>
                    <td className="px-4 py-3 font-mono text-xs">{t.transactionId ?? "-"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(t.paidAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── Reminders tab ── */}
        <TabsContent value="reminders" className="mt-4">
          <RemindersTab />
        </TabsContent>

        {/* ── Payment Requests tab ── */}
        <TabsContent value="payment-requests" className="mt-4">
          <PaymentRequestsTab />
        </TabsContent>

        {/* ── Discounts tab ── */}
        <TabsContent value="discounts" className="mt-4">
          <DiscountsTab />
        </TabsContent>

        {/* ── Expenses tab ── */}
        <TabsContent value="expenses" className="mt-4">
          <ExpensesTab />
        </TabsContent>

        {/* ── P&L tab ── */}
        <TabsContent value="pnl" className="mt-4">
          <PnLTab />
        </TabsContent>

        {/* ── Budgets tab ── */}
        <TabsContent value="budgets" className="mt-4">
          <BudgetTab />
        </TabsContent>
      </Tabs>

      <CreateInvoiceDialog open={invoiceDialogOpen} onClose={() => setInvoiceDialogOpen(false)} />
      <RecordPaymentDialog invoice={paymentInvoice} open={!!paymentInvoice} onClose={() => setPaymentInvoice(null)} />
      <ExportPdfDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
      <BulkGenerateDialog open={bulkDialogOpen} onClose={() => setBulkDialogOpen(false)} />
    </div>
  );
}
