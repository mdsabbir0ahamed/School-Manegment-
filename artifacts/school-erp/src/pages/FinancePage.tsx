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
  Target, PencilLine, AlertTriangle, ShieldCheck, BookOpen,
  Upload, FileText, X, Users, BellRing, ShieldAlert, Settings, Mail,
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
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  digestSmsEnabled: boolean;
  digestWhatsappEnabled: boolean;
  digestLastRunAt: string | null;
  digestLastRunCount: number;
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
  const [localSms, setLocalSms] = useState<boolean | null>(null);
  const [localWhatsapp, setLocalWhatsapp] = useState<boolean | null>(null);
  const [localDigestSms, setLocalDigestSms] = useState<boolean | null>(null);
  const [localDigestWhatsapp, setLocalDigestWhatsapp] = useState<boolean | null>(null);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [digestResult, setDigestResult] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery<ReminderSettings>({
    queryKey: ["reminder-settings"],
    queryFn: () => authedFetch("/api/reminder-settings"),
  });

  const effectiveDays = localDays ?? settings?.reminderDays ?? [-3, -1, 0, 1, 3, 7];
  const effectiveEnabled = localEnabled ?? settings?.isEnabled ?? true;
  const effectiveSms = localSms ?? settings?.smsEnabled ?? false;
  const effectiveWhatsapp = localWhatsapp ?? settings?.whatsappEnabled ?? false;
  const effectiveDigestSms = localDigestSms ?? settings?.digestSmsEnabled ?? false;
  const effectiveDigestWhatsapp = localDigestWhatsapp ?? settings?.digestWhatsappEnabled ?? false;

  const saveMutation = useMutation({
    mutationFn: (body: {
      isEnabled: boolean; reminderDays: number[];
      smsEnabled: boolean; whatsappEnabled: boolean;
      digestSmsEnabled: boolean; digestWhatsappEnabled: boolean;
    }) =>
      authedFetch("/api/reminder-settings", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminder-settings"] });
      setLocalDays(null);
      setLocalEnabled(null);
      setLocalSms(null);
      setLocalWhatsapp(null);
      setLocalDigestSms(null);
      setLocalDigestWhatsapp(null);
      toast({ title: "Reminder settings saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const digestMutation = useMutation({
    mutationFn: () =>
      authedFetch<{ message: string; sent: number; skipped: boolean }>("/api/reminder-settings/digest/trigger", { method: "POST" }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reminder-settings"] });
      setDigestResult(data.message);
      toast({
        title: data.skipped ? "Digest skipped" : data.sent > 0 ? `Digest sent to ${data.sent} parent${data.sent > 1 ? "s" : ""}` : "No outstanding balances",
        description: data.message,
      });
    },
    onError: (e: Error) => toast({ title: "Digest failed", description: e.message, variant: "destructive" }),
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

  const isDirty = localDays !== null || localEnabled !== null || localSms !== null || localWhatsapp !== null || localDigestSms !== null || localDigestWhatsapp !== null;

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

      {/* SMS / WhatsApp toggles */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-sm">SMS &amp; WhatsApp Reminders</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Also send reminders via SMS and/or WhatsApp when a matching invoice is found. Requires Twilio to be configured in Settings → Tenants.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-lg border border-border p-3 gap-3">
            <div>
              <p className="text-sm font-medium">SMS Reminders</p>
              <p className="text-xs text-muted-foreground">Send a text message to the parent's phone</p>
            </div>
            <Switch checked={effectiveSms} onCheckedChange={v => setLocalSms(v)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3 gap-3">
            <div>
              <p className="text-sm font-medium">WhatsApp Reminders</p>
              <p className="text-xs text-muted-foreground">Send a WhatsApp message to the parent</p>
            </div>
            <Switch checked={effectiveWhatsapp} onCheckedChange={v => setLocalWhatsapp(v)} />
          </div>
        </div>
        {(effectiveSms || effectiveWhatsapp) && (
          <p className="text-xs text-amber-600 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
            Phone resolved from: linked parent account → student's parent phone field. Configure Twilio in <strong>Settings → Tenants → SMS &amp; WhatsApp</strong>.
          </p>
        )}
      </div>

      {/* Daily Digest */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-sm">Daily Fee Digest</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Once per day, send each parent a single consolidated message listing <strong>all</strong> their outstanding invoices — regardless of due-date offset. Runs alongside the regular reminder scheduler.
            </p>
            {settings?.digestLastRunAt && (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last digest: {new Date(settings.digestLastRunAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                {" · "}{settings.digestLastRunCount} message{settings.digestLastRunCount !== 1 ? "s" : ""} sent
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-lg border border-border p-3 gap-3">
            <div>
              <p className="text-sm font-medium">Digest via SMS</p>
              <p className="text-xs text-muted-foreground">One text per parent, all invoices</p>
            </div>
            <Switch checked={effectiveDigestSms} onCheckedChange={v => setLocalDigestSms(v)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3 gap-3">
            <div>
              <p className="text-sm font-medium">Digest via WhatsApp</p>
              <p className="text-xs text-muted-foreground">One WhatsApp per parent, all invoices</p>
            </div>
            <Switch checked={effectiveDigestWhatsapp} onCheckedChange={v => setLocalDigestWhatsapp(v)} />
          </div>
        </div>
        {(effectiveDigestSms || effectiveDigestWhatsapp) && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
              Phone resolved from: linked parent account → student's parent phone field.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setDigestResult(null); digestMutation.mutate(); }}
              disabled={digestMutation.isPending}
            >
              {digestMutation.isPending
                ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Sending…</>
                : <><Play className="mr-2 h-3.5 w-3.5" /> Send Digest Now</>}
            </Button>
          </div>
        )}
        {digestResult && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {digestResult}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={() => saveMutation.mutate({ isEnabled: effectiveEnabled, reminderDays: effectiveDays, smsEnabled: effectiveSms, whatsappEnabled: effectiveWhatsapp, digestSmsEnabled: effectiveDigestSms, digestWhatsappEnabled: effectiveDigestWhatsapp })}
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
          <Button variant="ghost" size="sm" onClick={() => { setLocalDays(null); setLocalEnabled(null); setLocalSms(null); setLocalWhatsapp(null); setLocalDigestSms(null); setLocalDigestWhatsapp(null); }}>
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
          <li className="flex gap-2"><span className="text-indigo-500 font-bold">3.</span> Parents linked to the student receive an in-app notification and, if SMS/WhatsApp is enabled, a text message. Finance staff receive an in-app copy.</li>
          <li className="flex gap-2"><span className="text-indigo-500 font-bold">4.</span> "Send Now" bypasses the daily limit for manual testing or urgent batches.</li>
        </ul>
      </div>
    </div>
  );
}

// ── Fee Schedules Tab ──────────────────────────────────────────────────────

type FeeSchedule = {
  id: number; classId: number; className: string; gradeLevel: number;
  feeTypeId: number; feeTypeName: string; defaultAmount: number | null;
  academicYear: string; amount: number; isActive: boolean;
  notes: string | null; createdBy: string | null; createdAt: string;
};

function currentAcademicYear(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

// ── CSV helpers ────────────────────────────────────────────────────────────

type CsvRow = {
  className: string; feeTypeName: string; academicYear: string;
  amount: string; notes: string;
  _valid: boolean; _error: string;
};

function parseCsv(raw: string, defaultYear: string): CsvRow[] {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  if (!lines.length) return [];

  // Detect if first line is a header
  const firstLower = lines[0]!.toLowerCase();
  const hasHeader = firstLower.includes("class") || firstLower.includes("fee");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map(line => {
    const cols = line.split(",").map(c => c.trim());
    const [className = "", feeTypeName = "", ayOrAmount = "", amountOrNotes = "", notesRaw = ""] = cols;

    // Detect if col3 is a year (2025-26) or an amount
    const col3IsYear = /^\d{4}-\d{2}$/.test(ayOrAmount);
    const academicYear = col3IsYear ? ayOrAmount : defaultYear;
    const amount       = col3IsYear ? amountOrNotes : ayOrAmount;
    const notes        = col3IsYear ? notesRaw : amountOrNotes;

    const amountNum = parseFloat(amount);
    let _error = "";
    if (!className) _error = "Class name is empty";
    else if (!feeTypeName) _error = "Fee type name is empty";
    else if (!academicYear || !/^\d{4}-\d{2}$/.test(academicYear)) _error = `Academic year "${academicYear}" invalid`;
    else if (isNaN(amountNum) || amountNum < 0) _error = `Amount "${amount}" invalid`;

    return { className, feeTypeName, academicYear, amount, notes, _valid: !_error, _error };
  });
}

const CSV_TEMPLATE = `# className,feeTypeName,academicYear,amount,notes
# OR: className,feeTypeName,amount  (academic year defaults to the year above)
Class One,Tuition Fee,2025-26,4500,
Class One,Exam Fee,2025-26,600,Reduced rate
Class Five,Tuition Fee,2025-26,5500,
Class Five,Exam Fee,2025-26,1000,`;

// ── Import CSV dialog ──────────────────────────────────────────────────────

type ImportResult = { imported: number; errors: Array<{ row: number; reason: string }>; total: number };

function ImportSchedulesDialog({ open, onClose, onImported }: {
  open: boolean; onClose: () => void; onImported: () => void;
}) {
  const { toast }      = useToast();
  const [step, setStep]       = useState<"input" | "preview" | "result">("input");
  const [csv, setCsv]         = useState("");
  const [defaultYear, setDY]  = useState(currentAcademicYear());
  const [rows, setRows]       = useState<CsvRow[]>([]);
  const [result, setResult]   = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useState<HTMLInputElement | null>(null);

  const reset = () => { setCsv(""); setRows([]); setResult(null); setStep("input"); };
  const handleClose = () => { reset(); onClose(); };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCsv((ev.target?.result as string) ?? "");
    reader.readAsText(file);
    e.target.value = "";
  };

  const handlePreview = () => {
    const parsed = parseCsv(csv, defaultYear);
    if (!parsed.length) { toast({ title: "No rows found in CSV", variant: "destructive" }); return; }
    setRows(parsed); setStep("preview");
  };

  const validRows = rows.filter(r => r._valid);
  const invalidRows = rows.filter(r => !r._valid);

  const handleImport = async () => {
    if (!validRows.length) { toast({ title: "No valid rows to import", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const res: ImportResult = await authedFetch("/api/finance/fee-schedules/import", {
        method: "POST",
        body: JSON.stringify({
          academicYear: defaultYear,
          rows: validRows.map(r => ({
            className: r.className, feeTypeName: r.feeTypeName,
            academicYear: r.academicYear, amount: parseFloat(r.amount),
            notes: r.notes || undefined,
          })),
        }),
        headers: { "Content-Type": "application/json" },
      });
      setResult(res); setStep("result");
      if (res.imported > 0) onImported();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" /> Import Fee Schedules from CSV
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Paste a CSV or upload a file to bulk-set class fee amounts for an academic year.
          </p>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-2 text-xs mt-1">
          {(["input", "preview", "result"] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-6 bg-border" />}
              <div className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full font-medium",
                step === s ? "bg-indigo-100 text-indigo-700" : "text-muted-foreground"
              )}>
                <span className="h-4 w-4 text-[10px] flex items-center justify-center rounded-full border border-current">{i + 1}</span>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── STEP 1: Input ── */}
          {step === "input" && (
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="space-y-1.5">
                  <Label>Default Academic Year</Label>
                  <Input placeholder="e.g. 2025-26" value={defaultYear} onChange={e => setDY(e.target.value)} />
                  <p className="text-[10px] text-muted-foreground">Used for rows that don't include a year column.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Upload CSV file</Label>
                  <div className="flex items-center gap-2">
                    <input ref={r => fileRef[1](r)} type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={handleFileChange} />
                    <Button variant="outline" size="sm" onClick={() => fileRef[0]?.click()}>
                      <FileText className="mr-1.5 h-3.5 w-3.5" /> Choose file…
                    </Button>
                    {csv && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> File loaded</span>}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>CSV Content</Label>
                  <button onClick={() => setCsv(CSV_TEMPLATE)}
                    className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Load template
                  </button>
                </div>
                <textarea
                  className="w-full h-52 font-mono text-xs rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  placeholder={"className,feeTypeName,academicYear,amount,notes\nClass One,Tuition Fee,2025-26,4500,\nClass Five,Exam Fee,2025-26,1000,Grade 10 rate"}
                  value={csv} onChange={e => setCsv(e.target.value)}
                />
              </div>

              {/* Format reference */}
              <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1">
                <p className="font-semibold text-foreground">Accepted formats:</p>
                <p className="font-mono text-muted-foreground">className, feeTypeName, academicYear, amount [, notes]</p>
                <p className="font-mono text-muted-foreground">className, feeTypeName, amount [, notes] <span className="font-sans italic">← year is inferred from the field above</span></p>
                <p className="text-muted-foreground mt-1">Lines starting with <code>#</code> are treated as comments and skipped. Existing schedules are updated in-place.</p>
              </div>
            </div>
          )}

          {/* ── STEP 2: Preview ── */}
          {step === "preview" && (
            <div className="space-y-3 py-1">
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-green-700 font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {validRows.length} valid
                </span>
                {invalidRows.length > 0 && (
                  <span className="flex items-center gap-1 text-red-600 font-semibold">
                    <AlertCircle className="h-3.5 w-3.5" /> {invalidRows.length} with errors (will be skipped)
                  </span>
                )}
                <span className="text-muted-foreground ml-auto">{rows.length} total rows</span>
              </div>

              <div className="rounded-lg border border-border overflow-auto max-h-[44vh]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                    <tr>
                      {["#", "Class", "Fee Type", "Year", "Amount (৳)", "Notes", "Status"].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {rows.map((r, i) => (
                      <tr key={i} className={cn("hover:bg-muted/20", !r._valid && "bg-red-50/60")}>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">{r.className || <span className="text-red-500 italic">empty</span>}</td>
                        <td className="px-3 py-2">{r.feeTypeName || <span className="text-red-500 italic">empty</span>}</td>
                        <td className="px-3 py-2 tabular-nums">{r.academicYear}</td>
                        <td className="px-3 py-2 tabular-nums font-semibold">
                          {r._valid ? `৳${parseFloat(r.amount).toLocaleString()}` : r.amount}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[120px]">
                          <span className="line-clamp-1">{r.notes || "—"}</span>
                        </td>
                        <td className="px-3 py-2">
                          {r._valid
                            ? <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3" /> OK</span>
                            : <span className="flex items-center gap-1 text-red-600" title={r._error}><AlertCircle className="h-3 w-3" /> {r._error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {invalidRows.length > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-3 py-2">
                  Rows with errors will be skipped. Only the {validRows.length} valid row{validRows.length !== 1 ? "s" : ""} will be imported.
                  Go back to fix the CSV if needed.
                </p>
              )}
            </div>
          )}

          {/* ── STEP 3: Result ── */}
          {step === "result" && result && (
            <div className="py-6 space-y-4">
              <div className="flex flex-col items-center text-center gap-3">
                {result.imported > 0
                  ? <CheckCircle2 className="h-12 w-12 text-green-500" />
                  : <AlertCircle className="h-12 w-12 text-amber-500" />}
                <div>
                  <p className="text-lg font-semibold">
                    {result.imported > 0 ? `${result.imported} schedule${result.imported !== 1 ? "s" : ""} imported` : "Nothing imported"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {result.imported} of {result.total} rows saved successfully.
                    {result.errors.length > 0 && ` ${result.errors.length} row${result.errors.length !== 1 ? "s" : ""} failed.`}
                  </p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1 max-h-40 overflow-y-auto">
                  <p className="text-xs font-semibold text-red-700 mb-1">Import errors:</p>
                  {result.errors.map(e => (
                    <p key={e.row} className="text-xs text-red-600">Row {e.row}: {e.reason}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2 border-t border-border">
          {step === "input" && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handlePreview} disabled={!csv.trim()}>
                Preview <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("input")}>
                <ChevronLeft className="mr-1.5 h-3.5 w-3.5" /> Back
              </Button>
              <Button onClick={handleImport} disabled={loading || !validRows.length}>
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing…</> : <><Upload className="mr-2 h-4 w-4" />Import {validRows.length} row{validRows.length !== 1 ? "s" : ""}</>}
              </Button>
            </>
          )}
          {step === "result" && (
            <>
              <Button variant="outline" onClick={() => { reset(); }}>Import More</Button>
              <Button onClick={handleClose}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── AddSchedule dialog ─────────────────────────────────────────────────────

function AddScheduleDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [classId, setClassId]         = useState("");
  const [feeTypeId, setFeeTypeId]     = useState("");
  const [academicYear, setAcYear]     = useState(currentAcademicYear());
  const [amount, setAmount]           = useState("");
  const [notes, setNotes]             = useState("");
  const [loading, setLoading]         = useState(false);

  const { data: classesData } = useQuery<{ classes: ClassItem[] }>({
    queryKey: ["classes-list"], queryFn: () => authedFetch("/api/classes"), enabled: open,
  });
  const { data: feeTypesData } = useQuery<{ feeTypes: FeeTypeItem[] }>({
    queryKey: ["fee-types-list"], queryFn: () => authedFetch("/api/fee-types"), enabled: open,
  });

  const selectedFeeType = feeTypesData?.feeTypes.find(f => String(f.id) === feeTypeId);

  const reset = () => {
    setClassId(""); setFeeTypeId(""); setAcYear(currentAcademicYear());
    setAmount(""); setNotes("");
  };
  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!classId || !feeTypeId || !academicYear || !amount) {
      toast({ title: "All fields are required", variant: "destructive" }); return;
    }
    const val = parseFloat(amount);
    if (isNaN(val) || val < 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" }); return;
    }
    setLoading(true);
    try {
      await authedFetch("/api/finance/fee-schedules", {
        method: "POST",
        body: JSON.stringify({
          classId: Number(classId), feeTypeId: Number(feeTypeId),
          academicYear, amount: val, notes: notes.trim() || undefined,
        }),
        headers: { "Content-Type": "application/json" },
      });
      toast({ title: "Fee schedule saved", description: `৳${val.toLocaleString()} for ${academicYear}` });
      onCreated(); handleClose();
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Set Class Fee Schedule
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Class-specific amounts override the fee type default when bulk-generating invoices.
          </p>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Class *</Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {[...(classesData?.classes ?? [])].sort((a, b) => a.gradeLevel - b.gradeLevel).map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      Grade {c.gradeLevel} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Fee Type *</Label>
              <Select value={feeTypeId} onValueChange={v => { setFeeTypeId(v); if (!amount) setAmount(String(feeTypesData?.feeTypes.find(f => String(f.id) === v)?.amount ?? "")); }}>
                <SelectTrigger><SelectValue placeholder="Select fee type" /></SelectTrigger>
                <SelectContent>
                  {(feeTypesData?.feeTypes ?? []).map(f => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Academic Year *</Label>
              <Input placeholder="e.g. 2025-26" value={academicYear} onChange={e => setAcYear(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Amount (৳) *</Label>
              <Input type="number" min="0" step="50" placeholder="e.g. 4500"
                value={amount} onChange={e => setAmount(e.target.value)} />
              {selectedFeeType && (
                <p className="text-[10px] text-muted-foreground">
                  Default: ৳{Number(selectedFeeType.amount).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            <Input placeholder="e.g. Reduced rate for Grade 1 students…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : <><BookOpen className="mr-2 h-4 w-4" />Save Schedule</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FeeSchedulesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen]         = useState(false);
  const [importOpen, setImportOpen]   = useState(false);
  const [exporting, setExporting]     = useState(false);
  const [yearFilter, setYearFilter]   = useState(currentAcademicYear());
  const [classFilter, setClassFilter] = useState("all");
  const [togglingId, setTogglingId]   = useState<number | null>(null);
  const [deletingId, setDeletingId]   = useState<number | null>(null);

  const { data: classesData } = useQuery<{ classes: ClassItem[] }>({
    queryKey: ["classes-list"], queryFn: () => authedFetch("/api/classes"),
  });
  const { data, isLoading, refetch } = useQuery<{ schedules: FeeSchedule[]; total: number }>({
    queryKey: ["fee-schedules", yearFilter, classFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (yearFilter) p.set("academicYear", yearFilter);
      if (classFilter !== "all") p.set("classId", classFilter);
      return authedFetch(`/api/finance/fee-schedules?${p}`);
    },
  });

  const schedules = data?.schedules ?? [];

  // Build year options: current + 2 back + 1 forward
  const now = new Date();
  const curStart = (now.getMonth() + 1) >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const yearOptions = [-2, -1, 0, 1].map(d => {
    const s = curStart + d;
    return `${s}-${String(s + 1).slice(-2)}`;
  });

  const refetchAll = () => { refetch(); qc.invalidateQueries({ queryKey: ["fee-schedules"] }); };

  const handleExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem("erp_token") ?? "";
      const params = new URLSearchParams({ academicYear: yearFilter });
      if (classFilter !== "all") params.set("classId", classFilter);
      const res = await fetch(`/api/finance/fee-schedules/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fee-schedules-${yearFilter}${classFilter !== "all" ? `-class${classFilter}` : ""}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", description: `fee-schedules-${yearFilter}.csv downloaded` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally { setExporting(false); }
  };

  const toggleActive = async (s: FeeSchedule) => {
    setTogglingId(s.id);
    try {
      await authedFetch(`/api/finance/fee-schedules/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !s.isActive }),
        headers: { "Content-Type": "application/json" },
      });
      toast({ title: s.isActive ? "Schedule deactivated" : "Schedule activated" });
      refetchAll();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally { setTogglingId(null); }
  };

  const deleteSchedule = async (id: number) => {
    setDeletingId(id);
    try {
      await authedFetch(`/api/finance/fee-schedules/${id}`, { method: "DELETE" });
      toast({ title: "Schedule deleted" });
      refetchAll();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally { setDeletingId(null); }
  };

  // Group schedules by class for a cleaner view
  const grouped = schedules.reduce<Record<string, FeeSchedule[]>>((acc, s) => {
    const key = s.className;
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(s);
    return acc;
  }, {});

  const activeCount = schedules.filter(s => s.isActive).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Class Fee Schedules</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Exporting…</>
              : <><Download className="mr-1.5 h-3.5 w-3.5" />Export CSV</>}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Import CSV
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Set Fee Schedule
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Academic Year" /></SelectTrigger>
          <SelectContent>
            {yearOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All classes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {[...(classesData?.classes ?? [])].sort((a, b) => a.gradeLevel - b.gradeLevel).map(c => (
              <SelectItem key={c.id} value={String(c.id)}>Grade {c.gradeLevel} — {c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-green-600">{activeCount} active</span>
          <span>/ {schedules.length} schedules</span>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
        <BookOpen className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Active schedules <strong>automatically override the fee type default</strong> when bulk-generating invoices for a class.
          The academic year is derived from the invoice due date (July–June cycle).
          A manual amount override in Bulk Generate always takes priority.
        </span>
      </div>

      {/* Grouped schedule cards */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4 h-28 animate-pulse bg-muted" />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium text-foreground">No fee schedules for {yearFilter}</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            Create class-specific fee amounts that override defaults during bulk invoice generation
          </p>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Set First Schedule
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped)
            .sort(([, a], [, b]) => a[0]!.gradeLevel - b[0]!.gradeLevel)
            .map(([className, rows]) => (
              <div key={className} className="rounded-lg border border-border bg-card overflow-hidden">
                {/* Class header */}
                <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                    {rows[0]!.gradeLevel}
                  </span>
                  <span className="text-sm font-semibold">{className}</span>
                  <span className="text-xs text-muted-foreground ml-1">Grade {rows[0]!.gradeLevel}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{rows.length} fee type{rows.length !== 1 ? "s" : ""}</span>
                </div>

                {/* Fee rows */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      {["Fee Type", "Class Amount", "Default Amount", "Difference", "Notes", "Status", "Actions"].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {rows.map(s => {
                      const diff = s.defaultAmount !== null ? s.amount - s.defaultAmount : null;
                      const diffPct = diff !== null && s.defaultAmount! > 0 ? (diff / s.defaultAmount!) * 100 : null;
                      return (
                        <tr key={s.id} className={cn("hover:bg-muted/20 transition-colors", !s.isActive && "opacity-50")}>
                          <td className="px-4 py-3 font-medium">{s.feeTypeName}</td>
                          <td className="px-4 py-3">
                            <span className="font-bold tabular-nums text-indigo-700">৳{s.amount.toLocaleString()}</span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground tabular-nums">
                            {s.defaultAmount !== null ? `৳${s.defaultAmount.toLocaleString()}` : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {diff !== null ? (
                              <span className={cn("flex items-center gap-1 text-xs font-semibold tabular-nums",
                                diff > 0 ? "text-red-600" : diff < 0 ? "text-green-600" : "text-muted-foreground")}>
                                {diff > 0 ? <ArrowUpRight className="h-3 w-3" /> : diff < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                                {diff === 0 ? "Same" : `${diff > 0 ? "+" : ""}৳${diff.toLocaleString()}`}
                                {diffPct !== null && diff !== 0 && (
                                  <span className="font-normal text-muted-foreground">({diffPct > 0 ? "+" : ""}{diffPct.toFixed(1)}%)</span>
                                )}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px]">
                            <span className="line-clamp-1">{s.notes ?? "—"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => toggleActive(s)} disabled={togglingId === s.id}
                              className="flex items-center gap-1 text-xs disabled:opacity-50 transition-colors">
                              {togglingId === s.id
                                ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                : s.isActive
                                  ? <ToggleRight className="h-5 w-5 text-green-500" />
                                  : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                              <span className={s.isActive ? "text-green-600" : "text-muted-foreground"}>
                                {s.isActive ? "Active" : "Inactive"}
                              </span>
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => deleteSchedule(s.id)} disabled={deletingId === s.id}
                              className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50">
                              {deletingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
        </div>
      )}

      <AddScheduleDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={refetchAll} />
      <ImportSchedulesDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={refetchAll} />
    </div>
  );
}

// ── Collection Report Tab ──────────────────────────────────────────────────

type FeeTypeBreakdown = {
  feeTypeId: number; feeTypeName: string; scheduleAmount: number;
  studentCount: number; expected: number; billed: number;
  invoiceCount: number; collected: number; gap: number; collectionRate: number;
};
type ClassCollection = {
  classId: number; className: string; gradeLevel: number; studentCount: number;
  expected: number; billed: number; collected: number; gap: number;
  collectionRate: number; byFeeType: FeeTypeBreakdown[];
};
type CollectionKpis = {
  totalExpected: number; totalBilled: number; totalCollected: number;
  totalGap: number; collectionRate: number; classCount: number; scheduleCount: number;
};
type CollectionReport = { academicYear: string; kpis: CollectionKpis; byClass: ClassCollection[] };

// ── Class Detail types ──────────────────────────────────────────────────────

type StudentInvoice = {
  id: number; invoiceNumber: string; feeTypeName: string; month: string | null;
  totalAmount: number; paidAmount: number; status: string; dueDate: string;
};
type StudentRow = {
  studentId: number; studentCode: string; studentName: string;
  paymentStatus: "FULLY_PAID" | "PARTIAL" | "UNPAID" | "NO_INVOICES";
  invoiceCount: number; paidCount: number; pendingCount: number; overdueCount: number;
  totalBilled: number; totalPaid: number; outstanding: number;
  invoices: StudentInvoice[];
};
type ClassDetailKpis = {
  totalBilled: number; totalPaid: number; outstanding: number; studentCount: number;
  fullyPaidCount: number; partialCount: number; unpaidCount: number; overdueCount: number;
};
type ClassDetail = {
  academicYear: string; classId: number; className: string; gradeLevel: number;
  kpis: ClassDetailKpis; students: StudentRow[];
};

const PAYMENT_STATUS_STYLE: Record<string, string> = {
  FULLY_PAID:  "bg-green-100 text-green-700",
  PARTIAL:     "bg-amber-100 text-amber-700",
  UNPAID:      "bg-red-100 text-red-700",
  NO_INVOICES: "bg-gray-100 text-gray-500",
};
const PAYMENT_STATUS_LABEL: Record<string, string> = {
  FULLY_PAID:  "Fully Paid",
  PARTIAL:     "Partial",
  UNPAID:      "Unpaid",
  NO_INVOICES: "No Invoices",
};

// ── ClassDetailModal ───────────────────────────────────────────────────────

function ClassDetailModal({ classId, className, gradeLevel, academicYear, onClose }: {
  classId: number; className: string; gradeLevel: number;
  academicYear: string; onClose: () => void;
}) {
  const [search, setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedStudents, setExpandedStudents] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery<ClassDetail>({
    queryKey: ["class-detail", classId, academicYear],
    queryFn: () => authedFetch(`/api/finance/collection-report/class-detail?academicYear=${academicYear}&classId=${classId}`),
  });

  const toggleStudent = (id: number) =>
    setExpandedStudents(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const filtered = (data?.students ?? []).filter(s => {
    const matchSearch = !search || s.studentName.toLowerCase().includes(search.toLowerCase()) || s.studentCode.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || s.paymentStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  const k = data?.kpis;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col gap-0 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
              {gradeLevel}
            </span>
            <div>
              <h2 className="text-base font-semibold">{className}</h2>
              <p className="text-xs text-muted-foreground">Fee collection · {academicYear}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* KPI strip */}
              {k && (
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Total Billed",   value: `৳${k.totalBilled.toLocaleString()}`,  color: "text-blue-600"  },
                    { label: "Collected",       value: `৳${k.totalPaid.toLocaleString()}`,    color: "text-green-600" },
                    { label: "Outstanding",     value: `৳${k.outstanding.toLocaleString()}`,  color: k.outstanding > 0 ? "text-red-600" : "text-green-600" },
                    { label: "Collection Rate", value: k.totalBilled > 0 ? `${((k.totalPaid / k.totalBilled) * 100).toFixed(1)}%` : "—",
                      color: k.totalBilled > 0 ? rateColor((k.totalPaid / k.totalBilled) * 100) : "text-muted-foreground" },
                  ].map(c => (
                    <div key={c.label} className="rounded-lg border border-border bg-card px-3 py-2.5 space-y-0.5">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{c.label}</p>
                      <p className={cn("text-lg font-bold tabular-nums", c.color)}>{c.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Status pills */}
              {k && (
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  {[
                    { label: `${k.fullyPaidCount} Fully Paid`,  style: "bg-green-100 text-green-700" },
                    { label: `${k.partialCount} Partial`,       style: "bg-amber-100 text-amber-700" },
                    { label: `${k.unpaidCount} Unpaid`,         style: "bg-red-100 text-red-700" },
                    { label: `${k.overdueCount} with Overdue`,  style: "bg-orange-100 text-orange-700" },
                  ].map(p => (
                    <span key={p.label} className={cn("px-2 py-0.5 rounded-full font-medium", p.style)}>{p.label}</span>
                  ))}
                  <span className="ml-auto text-muted-foreground">{k.studentCount} students total</span>
                </div>
              )}

              {/* Filters */}
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Search by name or ID…"
                  value={search} onChange={e => setSearch(e.target.value)}
                  className="h-8 text-xs w-56"
                />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="FULLY_PAID">Fully Paid</SelectItem>
                    <SelectItem value="PARTIAL">Partial</SelectItem>
                    <SelectItem value="UNPAID">Unpaid</SelectItem>
                    <SelectItem value="NO_INVOICES">No Invoices</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground ml-auto">
                  Showing {filtered.length} of {data?.students.length ?? 0}
                </span>
              </div>

              {/* Student table */}
              {filtered.length === 0 ? (
                <div className="rounded-lg border border-border bg-card py-10 text-center">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm text-muted-foreground">No students match the filter</p>
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  {/* Header */}
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_28px] bg-muted/30 border-b border-border px-4 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    <span>Student</span>
                    <span className="text-right">Invoices</span>
                    <span className="text-right">Billed</span>
                    <span className="text-right">Paid</span>
                    <span className="text-right">Outstanding</span>
                    <span className="text-right">Status</span>
                    <span />
                  </div>

                  <div className="divide-y divide-border/50">
                    {filtered.map(s => {
                      const isOpen = expandedStudents.has(s.studentId);
                      return (
                        <div key={s.studentId}>
                          {/* Student row */}
                          <button
                            onClick={() => toggleStudent(s.studentId)}
                            className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_28px] px-4 py-3 text-sm hover:bg-muted/20 transition-colors text-left items-center"
                          >
                            <span className="flex flex-col gap-0.5">
                              <span className="font-medium">{s.studentName}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">{s.studentCode}</span>
                            </span>
                            <span className="text-right tabular-nums text-muted-foreground text-xs">
                              {s.invoiceCount}
                              {s.overdueCount > 0 && (
                                <span className="ml-1 text-red-500">({s.overdueCount} OD)</span>
                              )}
                            </span>
                            <span className="text-right tabular-nums">৳{s.totalBilled.toLocaleString()}</span>
                            <span className="text-right tabular-nums text-green-600">৳{s.totalPaid.toLocaleString()}</span>
                            <span className={cn("text-right tabular-nums font-semibold", s.outstanding > 0 ? "text-red-600" : "text-green-600")}>
                              {s.outstanding > 0 ? `৳${s.outstanding.toLocaleString()}` : "৳0"}
                            </span>
                            <span className="flex justify-end">
                              <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold", PAYMENT_STATUS_STYLE[s.paymentStatus])}>
                                {PAYMENT_STATUS_LABEL[s.paymentStatus]}
                              </span>
                            </span>
                            <span className="flex justify-center">
                              <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                            </span>
                          </button>

                          {/* Invoice sub-rows */}
                          {isOpen && (
                            <div className="border-t border-border/30 bg-muted/10">
                              {s.invoices.length === 0 ? (
                                <p className="px-8 py-3 text-xs text-muted-foreground italic">No invoices in {academicYear}</p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-border/30">
                                      {["Invoice #", "Fee Type", "Month", "Due Date", "Amount", "Paid", "Status"].map(h => (
                                        <th key={h} className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/30">
                                    {s.invoices.map(inv => (
                                      <tr key={inv.id} className="hover:bg-muted/10">
                                        <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{inv.invoiceNumber}</td>
                                        <td className="px-4 py-2">{inv.feeTypeName}</td>
                                        <td className="px-4 py-2 text-muted-foreground">{inv.month ?? "—"}</td>
                                        <td className="px-4 py-2 tabular-nums text-muted-foreground">{inv.dueDate}</td>
                                        <td className="px-4 py-2 tabular-nums font-medium">৳{inv.totalAmount.toLocaleString()}</td>
                                        <td className="px-4 py-2 tabular-nums text-green-600">৳{inv.paidAmount.toLocaleString()}</td>
                                        <td className="px-4 py-2">
                                          <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase", statusColors[inv.status])}>
                                            {inv.status}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer totals */}
                  {k && (
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_28px] border-t border-border bg-muted/30 px-4 py-3 text-sm font-semibold">
                      <span className="text-muted-foreground">Total ({k.studentCount} students)</span>
                      <span />
                      <span className="text-right tabular-nums">৳{k.totalBilled.toLocaleString()}</span>
                      <span className="text-right tabular-nums text-green-700">৳{k.totalPaid.toLocaleString()}</span>
                      <span className={cn("text-right tabular-nums", k.outstanding > 0 ? "text-red-700" : "text-green-700")}>
                        {k.outstanding > 0 ? `৳${k.outstanding.toLocaleString()}` : "৳0"}
                      </span>
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function rateColor(rate: number) {
  if (rate >= 90) return "text-green-600";
  if (rate >= 60) return "text-amber-600";
  return "text-red-600";
}
function rateBg(rate: number) {
  if (rate >= 90) return "bg-green-500";
  if (rate >= 60) return "bg-amber-400";
  return "bg-red-500";
}

function CollectionReportTab() {
  const { toast } = useToast();
  const [academicYear, setAcademicYear] = useState(currentAcademicYear());
  const [expanded, setExpanded]         = useState<Set<number>>(new Set());
  const [drillClass, setDrillClass]     = useState<{ classId: number; className: string; gradeLevel: number } | null>(null);

  const now = new Date();
  const curStart = (now.getMonth() + 1) >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const yearOptions = [-2, -1, 0, 1].map(d => {
    const s = curStart + d;
    return `${s}-${String(s + 1).slice(-2)}`;
  });

  const { data, isLoading, isError, refetch } = useQuery<CollectionReport>({
    queryKey: ["collection-report", academicYear],
    queryFn: () => authedFetch(`/api/finance/collection-report?academicYear=${academicYear}`),
    retry: false,
  });

  const toggleExpand = (classId: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId); else next.add(classId);
      return next;
    });
  };
  const expandAll   = () => setExpanded(new Set(data?.byClass.map(c => c.classId) ?? []));
  const collapseAll = () => setExpanded(new Set());

  const handleExportReport = async () => {
    if (!data) return;
    const token = localStorage.getItem("erp_token") ?? "";
    const res = await fetch(`/api/finance/fee-schedules/export?academicYear=${academicYear}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `collection-report-${academicYear}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const k = data?.kpis;
  const chartData = (data?.byClass ?? []).map(c => ({
    name: c.className.replace("Class ", "Cls "),
    expected:  c.expected,
    billed:    c.billed,
    collected: c.collected,
    gap:       c.gap,
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Fee Collection Report</h2>
        </div>
        <div className="flex items-center gap-2">
          <Select value={academicYear} onValueChange={setAcademicYear}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yearOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportReport} disabled={!data}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-border animate-pulse bg-muted" />
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-400" />
          <p className="text-sm font-medium text-red-700">Failed to load report</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {data && (
        <>
          {/* KPI Cards */}
          {k && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: "Expected Revenue", value: `৳${k.totalExpected.toLocaleString()}`, sub: `${k.scheduleCount} fee schedule${k.scheduleCount !== 1 ? "s" : ""}`, color: "text-indigo-600" },
                { label: "Total Billed", value: `৳${k.totalBilled.toLocaleString()}`, sub: "invoices issued", color: "text-blue-600" },
                { label: "Collected", value: `৳${k.totalCollected.toLocaleString()}`, sub: "payments received", color: "text-green-600" },
                { label: "Outstanding Gap", value: `৳${k.totalGap.toLocaleString()}`, sub: "expected vs collected", color: k.totalGap > 0 ? "text-red-600" : "text-green-600" },
                { label: "Collection Rate", value: `${k.collectionRate.toFixed(1)}%`, sub: `${k.classCount} class${k.classCount !== 1 ? "es" : ""}`, color: rateColor(k.collectionRate) },
              ].map(card => (
                <div key={card.label} className="rounded-xl border border-border bg-card p-4 space-y-1">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{card.label}</p>
                  <p className={cn("text-xl font-bold tabular-nums", card.color)}>{card.value}</p>
                  <p className="text-[11px] text-muted-foreground">{card.sub}</p>
                </div>
              ))}
            </div>
          )}

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Expected vs Collected by Class</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} barGap={2} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `৳${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number, n: string) => [`৳${Number(v).toLocaleString()}`, n.charAt(0).toUpperCase() + n.slice(1)]} />
                  <Bar dataKey="expected"  name="Expected"  fill="hsl(239 84% 67% / 0.25)" radius={[3,3,0,0]} stroke="hsl(239 84% 67%)" strokeWidth={1} />
                  <Bar dataKey="billed"    name="Billed"    fill="hsl(217 91% 60% / 0.4)"  radius={[3,3,0,0]} />
                  <Bar dataKey="collected" name="Collected" fill="hsl(142 71% 45% / 0.8)"  radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Per-class breakdown table */}
          {data.byClass.length === 0 ? (
            <div className="rounded-lg border border-border bg-card py-14 text-center">
              <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">No active fee schedules for {academicYear}</p>
              <p className="text-xs text-muted-foreground mt-1">Set up class fee schedules first to see the collection report</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-muted/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Class Breakdown — {academicYear}</p>
                <div className="flex items-center gap-2">
                  <button onClick={expandAll}   className="text-xs text-indigo-600 hover:underline">Expand all</button>
                  <span className="text-muted-foreground text-xs">/</span>
                  <button onClick={collapseAll} className="text-xs text-indigo-600 hover:underline">Collapse all</button>
                </div>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr_auto_28px] gap-0 border-b border-border/50 px-4 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <span>Class</span>
                <span className="text-right">Students</span>
                <span className="text-right">Expected</span>
                <span className="text-right">Billed</span>
                <span className="text-right">Collected</span>
                <span className="text-right">Rate</span>
                <span />
                <span />
              </div>

              <div className="divide-y divide-border/50">
                {data.byClass.map(cls => {
                  const isOpen = expanded.has(cls.classId);
                  return (
                    <div key={cls.classId}>
                      {/* Class row */}
                      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr_auto_28px] gap-0 px-4 py-3 text-sm hover:bg-muted/20 transition-colors items-center">
                        <button
                          onClick={() => toggleExpand(cls.classId)}
                          className="flex items-center gap-2 font-semibold text-left"
                        >
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                            {cls.gradeLevel}
                          </span>
                          {cls.className}
                        </button>
                        <span className="text-right text-muted-foreground tabular-nums">{cls.studentCount}</span>
                        <span className="text-right tabular-nums font-medium">৳{cls.expected.toLocaleString()}</span>
                        <span className="text-right tabular-nums text-blue-600">৳{cls.billed.toLocaleString()}</span>
                        <span className="text-right tabular-nums text-green-600 font-semibold">৳{cls.collected.toLocaleString()}</span>
                        <span className="flex items-center justify-end gap-1.5">
                          <div className="w-14 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className={cn("h-full rounded-full transition-all", rateBg(cls.collectionRate))}
                              style={{ width: `${Math.min(cls.collectionRate, 100)}%` }} />
                          </div>
                          <span className={cn("text-xs font-bold tabular-nums w-10 text-right", rateColor(cls.collectionRate))}>
                            {cls.collectionRate.toFixed(1)}%
                          </span>
                        </span>
                        <button
                          onClick={() => setDrillClass({ classId: cls.classId, className: cls.className, gradeLevel: cls.gradeLevel })}
                          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded transition-colors font-medium whitespace-nowrap"
                        >
                          <Users className="h-3 w-3" /> Students
                        </button>
                        <button onClick={() => toggleExpand(cls.classId)} className="flex justify-center">
                          <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                        </button>
                      </div>

                      {/* Fee type sub-rows */}
                      {isOpen && (
                        <div className="border-t border-border/30 bg-muted/10 divide-y divide-border/30">
                          {cls.byFeeType.map(ft => (
                            <div key={ft.feeTypeId}
                              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1.5fr_28px] gap-0 px-4 py-2.5 text-xs items-center">
                              <span className="flex items-center gap-2 pl-7 text-muted-foreground">
                                <Tag className="h-3 w-3 shrink-0" />
                                <span>{ft.feeTypeName}</span>
                                <span className="text-[10px] bg-muted rounded px-1">৳{ft.scheduleAmount.toLocaleString()}/student</span>
                              </span>
                              <span className="text-right tabular-nums text-muted-foreground">{ft.studentCount}</span>
                              <span className="text-right tabular-nums">৳{ft.expected.toLocaleString()}</span>
                              <span className="text-right tabular-nums text-blue-600">
                                ৳{ft.billed.toLocaleString()}
                                {ft.invoiceCount > 0 && <span className="text-muted-foreground ml-1">({ft.invoiceCount})</span>}
                              </span>
                              <span className="text-right tabular-nums text-green-600">৳{ft.collected.toLocaleString()}</span>
                              <span className={cn("text-right tabular-nums", ft.gap > 0 ? "text-red-500" : "text-green-500")}>
                                {ft.gap > 0 ? `-৳${ft.gap.toLocaleString()}` : "৳0"}
                              </span>
                              <span className="flex items-center justify-end gap-1.5">
                                <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                                  <div className={cn("h-full rounded-full", rateBg(ft.collectionRate))}
                                    style={{ width: `${Math.min(ft.collectionRate, 100)}%` }} />
                                </div>
                                <span className={cn("text-[10px] font-semibold tabular-nums w-10 text-right", rateColor(ft.collectionRate))}>
                                  {ft.collectionRate.toFixed(1)}%
                                </span>
                              </span>
                              <span />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Footer totals */}
              {k && (
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr_auto_28px] gap-0 border-t border-border bg-muted/30 px-4 py-3 text-sm font-semibold">
                  <span className="text-muted-foreground">Total ({k.classCount} classes)</span>
                  <span />
                  <span className="text-right tabular-nums">৳{k.totalExpected.toLocaleString()}</span>
                  <span className="text-right tabular-nums text-blue-700">৳{k.totalBilled.toLocaleString()}</span>
                  <span className="text-right tabular-nums text-green-700">৳{k.totalCollected.toLocaleString()}</span>
                  <span className={cn("text-right tabular-nums", rateColor(k.collectionRate))}>
                    {k.collectionRate.toFixed(1)}%
                  </span>
                  <span /><span />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {drillClass && (
        <ClassDetailModal
          classId={drillClass.classId}
          className={drillClass.className}
          gradeLevel={drillClass.gradeLevel}
          academicYear={academicYear}
          onClose={() => setDrillClass(null)}
        />
      )}
    </div>
  );
}

// ── Escalations Tab ─────────────────────────────────────────────────────────

type EscalationItem = {
  id: number;
  invoiceNumber: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  outstanding: number;
  daysOverdue: number;
  escalationLevel: "WARNING" | "CRITICAL";
  escalatedAt: string | null;
  escalationNote: string | null;
  studentId: number;
  studentName: string;
  studentCode: string;
  classId: number;
  className: string;
  feeTypeName: string;
};

type EscalationsData = {
  summary: { criticalCount: number; warningCount: number; totalAtRisk: number };
  items: EscalationItem[];
};

type RunResult = {
  scanned: number;
  escalatedToWarning: number;
  escalatedToCritical: number;
  alreadyEscalated: number;
};

type ThresholdSettings = { warningDays: number; criticalDays: number; updatedAt?: string };

// ── Health Analytics types ─────────────────────────────────────────────────

type MonthlyTrendPoint = {
  label: string; year: number; month: number;
  billed: number; collected: number; outstanding: number;
  collectionRate: number; invoiceCount: number;
};

type TopDebtor = {
  studentId: number; name: string;
  outstanding: number; overdueCount: number; pendingCount: number;
};

type FeeTypeBreakdownItem = {
  feeTypeId: number; name: string;
  billed: number; collected: number; outstanding: number;
  collectionRate: number; invoiceCount: number;
};

type AgingBucket = { bucket: string; count: number; outstanding: number };

type HealthSnapshot = {
  totalBilled: number; totalCollected: number; totalOutstanding: number;
  overallCollectionRate: number;
  overdueCount: number; pendingCount: number; paidCount: number; cancelledCount: number;
};

type HealthAnalyticsData = {
  monthlyTrend: MonthlyTrendPoint[];
  topDebtors: TopDebtor[];
  feeTypeBreakdown: FeeTypeBreakdownItem[];
  agingBuckets: AgingBucket[];
  snapshot: HealthSnapshot;
  generatedAt: string;
};

// ── COLORS ─────────────────────────────────────────────────────────────────
const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#f97316", "#8b5cf6", "#06b6d4"];

function HealthTab() {
  const { data, isLoading, refetch } = useQuery<HealthAnalyticsData>({
    queryKey: ["finance-health-analytics"],
    queryFn: () => authedFetch("/api/finance/health-analytics"),
    staleTime: 2 * 60 * 1000,
  });

  const fmt = (n: number) => `৳${Math.round(n).toLocaleString()}`;
  const pct = (n: number) => `${n.toFixed(1)}%`;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-white shadow-lg p-3 text-xs min-w-[150px]">
        <p className="font-semibold mb-2">{label}</p>
        {payload.map((p: any) => (
          <div key={p.name} className="flex justify-between gap-4 mb-0.5">
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="font-mono font-medium">
              {p.name === "Rate %" ? `${Number(p.value).toFixed(1)}%` : `৳${Number(p.value).toLocaleString()}`}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const AgingTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-white shadow-lg p-3 text-xs min-w-[170px]">
        <p className="font-semibold mb-2">{label}</p>
        {payload.map((p: any) => (
          <div key={p.name} className="flex justify-between gap-4 mb-0.5">
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="font-mono font-medium">
              {p.name === "Invoices" ? p.value : fmt(p.value)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  if (isLoading) return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-muted animate-pulse h-24" />
        ))}
      </div>
      <div className="rounded-lg border bg-muted animate-pulse h-64" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-muted animate-pulse h-64" />
        <div className="rounded-lg border bg-muted animate-pulse h-64" />
      </div>
    </div>
  );

  const snap = data?.snapshot;
  const trend = data?.monthlyTrend ?? [];
  const debtors = data?.topDebtors ?? [];
  const feeTypes = data?.feeTypeBreakdown ?? [];
  const aging = data?.agingBuckets ?? [];

  const rateColor = (r: number) =>
    r >= 90 ? "text-green-600" : r >= 70 ? "text-yellow-600" : "text-red-600";

  const agingColors: Record<string, string> = {
    "Not yet due": "#6366f1",
    "1-30 days":   "#f59e0b",
    "31-60 days":  "#f97316",
    "61-90 days":  "#ef4444",
    "90+ days":    "#991b1b",
  };

  const agingOutstandingTotal = aging.reduce((s, b) => s + b.outstanding, 0);

  return (
    <div className="space-y-5 mt-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Financial Health Dashboard</h2>
          {data?.generatedAt && (
            <span className="text-[10px] text-muted-foreground">
              Updated {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      {/* ── Snapshot KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Overall Collection Rate",
            value: pct(snap?.overallCollectionRate ?? 0),
            sub: `৳${Math.round(snap?.totalCollected ?? 0).toLocaleString()} of ৳${Math.round(snap?.totalBilled ?? 0).toLocaleString()}`,
            cls: rateColor(snap?.overallCollectionRate ?? 0),
            icon: TrendingUp,
          },
          {
            label: "Total Outstanding",
            value: fmt(snap?.totalOutstanding ?? 0),
            sub: `${snap?.overdueCount ?? 0} overdue · ${snap?.pendingCount ?? 0} pending`,
            cls: (snap?.totalOutstanding ?? 0) > 0 ? "text-red-600" : "text-green-600",
            icon: AlertCircle,
          },
          {
            label: "Invoices Paid",
            value: String(snap?.paidCount ?? 0),
            sub: `${snap?.cancelledCount ?? 0} cancelled`,
            cls: "text-green-600",
            icon: CheckCircle2,
          },
          {
            label: "Total Billed",
            value: fmt(snap?.totalBilled ?? 0),
            sub: `${(snap?.paidCount ?? 0) + (snap?.overdueCount ?? 0) + (snap?.pendingCount ?? 0)} active invoices`,
            cls: "text-indigo-600",
            icon: Receipt,
          },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</p>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className={cn("text-xl font-bold tabular-nums", s.cls)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{s.sub}</p>
            </div>
          );
        })}
      </div>

      {/* ── Monthly collection trend ── */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          12-Month Collection Trend
        </h3>
        {trend.every(m => m.billed === 0) ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <BarChart3 className="h-8 w-8 opacity-20 mb-2" />
            <p className="text-sm">No invoice data in the last 12 months</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={trend} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis
                yAxisId="amt"
                tickFormatter={v => `৳${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 10 }}
                axisLine={false} tickLine={false} width={55}
              />
              <YAxis
                yAxisId="rate"
                orientation="right"
                tickFormatter={v => `${v}%`}
                domain={[0, 100]}
                tick={{ fontSize: 10 }}
                axisLine={false} tickLine={false} width={40}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar yAxisId="amt" dataKey="billed"    name="Billed"    fill="#e0e7ff" radius={[3,3,0,0]} />
              <Bar yAxisId="amt" dataKey="collected" name="Collected" fill="#6366f1" radius={[3,3,0,0]} />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="collectionRate"
                name="Rate %"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ r: 3, fill: "#22c55e" }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Overdue aging buckets ── */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Overdue Aging Analysis
          </h3>

          {aging.every(b => b.count === 0) ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <CheckCircle2 className="h-7 w-7 opacity-20 mb-2 text-green-500" />
              <p className="text-sm">No outstanding invoices</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={aging} margin={{ top: 4, right: 4, bottom: 4, left: 4 }} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={v => `৳${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 9 }} axisLine={false} tickLine={false}
                  />
                  <YAxis
                    type="category" dataKey="bucket"
                    tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={72}
                  />
                  <Tooltip content={<AgingTooltip />} />
                  <Bar dataKey="outstanding" name="Outstanding" radius={[0,3,3,0]}>
                    {aging.map(b => (
                      <Cell key={b.bucket} fill={agingColors[b.bucket] ?? "#94a3b8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              <div className="space-y-1.5">
                {aging.filter(b => b.count > 0).map(b => {
                  const pctOfTotal = agingOutstandingTotal > 0
                    ? Math.round((b.outstanding / agingOutstandingTotal) * 100)
                    : 0;
                  return (
                    <div key={b.bucket} className="flex items-center gap-2 text-xs">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: agingColors[b.bucket] ?? "#94a3b8" }}
                      />
                      <span className="text-muted-foreground w-24 shrink-0">{b.bucket}</span>
                      <span className="font-medium tabular-nums">{fmt(b.outstanding)}</span>
                      <span className="text-muted-foreground ml-auto">{b.count} inv · {pctOfTotal}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Fee type breakdown ── */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Fee Type Breakdown
          </h3>

          {feeTypes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <BarChart3 className="h-7 w-7 opacity-20 mb-2" />
              <p className="text-sm">No fee type data</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={feeTypes}
                    dataKey="billed"
                    nameKey="name"
                    cx="50%" cy="50%"
                    outerRadius={70}
                    innerRadius={38}
                    strokeWidth={1}
                  >
                    {feeTypes.map((ft, i) => (
                      <Cell key={ft.feeTypeId} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number, name: string) => [`৳${Math.round(v).toLocaleString()}`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {feeTypes.map((ft, i) => (
                  <div key={ft.feeTypeId} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="text-muted-foreground flex-1 truncate" title={ft.name}>{ft.name}</span>
                    <span className="font-medium tabular-nums shrink-0">{fmt(ft.billed)}</span>
                    <span
                      className={cn("text-[10px] font-semibold shrink-0 w-10 text-right tabular-nums", rateColor(ft.collectionRate))}
                    >
                      {pct(ft.collectionRate)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Top debtors ── */}
      {debtors.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Top Debtors
            </h3>
            <span className="ml-auto text-[10px] text-muted-foreground">
              by outstanding balance
            </span>
          </div>

          {/* Bar chart */}
          <ResponsiveContainer width="100%" height={Math.min(debtors.length * 28 + 20, 300)}>
            <BarChart
              data={debtors.slice(0, 10)}
              layout="vertical"
              margin={{ top: 0, right: 60, bottom: 0, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={v => `৳${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 9 }} axisLine={false} tickLine={false}
              />
              <YAxis
                type="category" dataKey="name"
                tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={100}
              />
              <Tooltip formatter={(v: number) => [`৳${Math.round(v).toLocaleString()}`, "Outstanding"]} />
              <Bar dataKey="outstanding" name="Outstanding" fill="#ef4444" radius={[0,3,3,0]}>
                {debtors.slice(0, 10).map((_, i) => {
                  const maxOut = debtors[0]?.outstanding ?? 1;
                  const ratio  = debtors[i]!.outstanding / maxOut;
                  const r = Math.round(239 - (239 - 99)  * (1 - ratio));
                  const g = Math.round(68  + (131 - 68)  * (1 - ratio));
                  const b = Math.round(68  + (146 - 68)  * (1 - ratio));
                  return <Cell key={i} fill={`rgb(${r},${g},${b})`} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["#", "Student", "Outstanding", "Overdue", "Pending"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {debtors.map((d, i) => (
                  <tr key={d.studentId} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{d.name}</td>
                    <td className="px-3 py-2 font-bold tabular-nums text-red-600">{fmt(d.outstanding)}</td>
                    <td className="px-3 py-2">
                      {d.overdueCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[10px] font-semibold">
                          {d.overdueCount}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {d.pendingCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 text-yellow-700 px-2 py-0.5 text-[10px] font-semibold">
                          {d.pendingCount}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EscalationsTab() {
  const { toast } = useToast();
  const [levelFilter, setLevelFilter] = useState<"ALL" | "CRITICAL" | "WARNING">("ALL");
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState(false);
  const [acknowledging, setAcknowledging] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [draftWarning, setDraftWarning] = useState(7);
  const [draftCritical, setDraftCritical] = useState(30);
  const [savingSettings, setSavingSettings] = useState(false);

  const { data: settings, refetch: refetchSettings } = useQuery<ThresholdSettings>({
    queryKey: ["escalation-settings"],
    queryFn: () => authedFetch("/api/finance/escalation-settings"),
  });

  useEffect(() => {
    if (settings) {
      setDraftWarning(settings.warningDays);
      setDraftCritical(settings.criticalDays);
    }
  }, [settings]);

  const qkey = ["escalations", levelFilter];
  const { data, isLoading, refetch } = useQuery<EscalationsData>({
    queryKey: qkey,
    queryFn: async () => {
      const qs = levelFilter !== "ALL" ? `?level=${levelFilter}` : "";
      return authedFetch(`/api/finance/escalations${qs}`);
    },
  });

  const filteredItems = (data?.items ?? []).filter(i =>
    !search || i.studentName.toLowerCase().includes(search.toLowerCase()) || i.studentCode.toLowerCase().includes(search.toLowerCase()),
  );

  async function runEscalation() {
    setRunning(true);
    try {
      const result: RunResult = await authedFetch("/api/finance/escalations/run", { method: "POST" });
      toast({
        title: "Escalation check complete",
        description: `Scanned ${result.scanned} overdue invoices — ${result.escalatedToCritical} → CRITICAL, ${result.escalatedToWarning} → WARNING, ${result.alreadyEscalated} already escalated`,
      });
      refetch();
    } catch {
      toast({ title: "Run failed", description: "Could not complete escalation check", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  async function acknowledge(id: number) {
    setAcknowledging(id);
    try {
      await authedFetch(`/api/finance/escalations/${id}/acknowledge`, { method: "PATCH" });
      toast({ title: "Acknowledged", description: "Invoice escalation cleared" });
      refetch();
    } catch {
      toast({ title: "Failed", description: "Could not acknowledge escalation", variant: "destructive" });
    } finally {
      setAcknowledging(null);
    }
  }

  async function saveSettings() {
    if (draftWarning < 1 || draftCritical < 1 || draftWarning >= draftCritical) {
      toast({ title: "Invalid thresholds", description: "Warning days must be ≥ 1 and less than Critical days", variant: "destructive" });
      return;
    }
    setSavingSettings(true);
    try {
      await authedFetch("/api/finance/escalation-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warningDays: draftWarning, criticalDays: draftCritical }),
      });
      toast({ title: "Thresholds saved", description: `WARNING ≥ ${draftWarning}d · CRITICAL ≥ ${draftCritical}d — takes effect on next run` });
      refetchSettings();
      setShowSettings(false);
    } catch {
      toast({ title: "Save failed", description: "Could not update thresholds", variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  }

  const s = data?.summary;
  const wDays = settings?.warningDays ?? 7;
  const cDays = settings?.criticalDays ?? 30;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BellRing className="h-5 w-5 text-red-500" /> Overdue Escalations
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            WARNING ≥ {wDays}d overdue · CRITICAL ≥ {cDays}d overdue · auto-runs every 6 hours
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(v => !v)}
            className={cn("gap-1.5", showSettings && "bg-muted")}
          >
            <Settings className="h-3.5 w-3.5" />
            Thresholds
          </Button>
          <Button onClick={runEscalation} disabled={running} className="gap-2 bg-red-600 hover:bg-red-700 text-white">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Check
          </Button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Escalation Thresholds
            <span className="ml-auto text-xs text-muted-foreground font-normal">
              Changes take effect on the next escalation run
            </span>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Warning threshold (days overdue)</Label>
              <Input
                type="number"
                min={1}
                max={draftCritical - 1}
                value={draftWarning}
                onChange={e => setDraftWarning(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-9"
              />
              <p className="text-[11px] text-amber-600">Invoices overdue ≥ this many days → WARNING</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Critical threshold (days overdue)</Label>
              <Input
                type="number"
                min={draftWarning + 1}
                value={draftCritical}
                onChange={e => setDraftCritical(Math.max(draftWarning + 1, parseInt(e.target.value) || draftWarning + 1))}
                className="h-9"
              />
              <p className="text-[11px] text-red-600">Invoices overdue ≥ this many days → CRITICAL</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowSettings(false);
                if (settings) { setDraftWarning(settings.warningDays); setDraftCritical(settings.criticalDays); }
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={saveSettings} disabled={savingSettings} className="gap-1.5">
              {savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Save Thresholds
            </Button>
          </div>
        </div>
      )}

      {/* KPI strip */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : s && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex items-center gap-2 text-red-600 mb-1">
              <ShieldAlert className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Critical</span>
            </div>
            <p className="text-3xl font-bold text-red-700 tabular-nums">{s.criticalCount}</p>
            <p className="text-xs text-red-500 mt-1">{cDays}+ days overdue</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-amber-600 mb-1">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Warning</span>
            </div>
            <p className="text-3xl font-bold text-amber-700 tabular-nums">{s.warningCount}</p>
            <p className="text-xs text-amber-500 mt-1">7–30 days overdue</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Receipt className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Total at Risk</span>
            </div>
            <p className="text-3xl font-bold tabular-nums">৳{s.totalAtRisk.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.criticalCount + s.warningCount} escalated invoices</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Input
            placeholder="Search student name or ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-3 text-sm h-9"
          />
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          {(["ALL", "CRITICAL", "WARNING"] as const).map(lvl => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className={cn(
                "px-4 py-1.5 font-medium transition-colors",
                levelFilter === lvl
                  ? lvl === "CRITICAL" ? "bg-red-600 text-white"
                    : lvl === "WARNING" ? "bg-amber-500 text-white"
                    : "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {lvl}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 h-9">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-[1.5fr_1fr_1fr_90px_90px_90px_100px_auto] gap-0 border-b border-border/50 px-4 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/30">
          <span>Student / Invoice</span>
          <span>Class</span>
          <span>Fee Type</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Outstanding</span>
          <span className="text-right">Days Late</span>
          <span className="text-center">Level</span>
          <span className="text-center">Action</span>
        </div>

        {isLoading ? (
          <div className="divide-y divide-border/50">
            {[0, 1, 2, 4].map(i => (
              <div key={i} className="grid grid-cols-[1.5fr_1fr_1fr_90px_90px_90px_100px_auto] gap-0 px-4 py-3">
                {[1.5, 1, 1, 0.8, 0.8, 0.7, 0.9, 0.8].map((w, j) => (
                  <Skeleton key={j} className="h-4 rounded" style={{ width: `${w * 60}px` }} />
                ))}
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <ShieldCheck className="h-10 w-10 text-green-400" />
            <p className="font-medium text-green-700">No escalated invoices</p>
            <p className="text-sm">All overdue invoices are within threshold — or run a check to update escalation levels.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filteredItems.map(item => (
              <div
                key={item.id}
                className={cn(
                  "grid grid-cols-[1.5fr_1fr_1fr_90px_90px_90px_100px_auto] gap-0 px-4 py-3 items-center transition-colors hover:bg-muted/20",
                  item.escalationLevel === "CRITICAL" ? "bg-red-50/60" : "bg-amber-50/40",
                )}
              >
                {/* Student */}
                <div>
                  <p className="text-sm font-medium leading-tight">{item.studentName}</p>
                  <p className="text-[11px] text-muted-foreground">{item.studentCode} · {item.invoiceNumber}</p>
                </div>
                {/* Class */}
                <span className="text-sm text-muted-foreground">{item.className}</span>
                {/* Fee Type */}
                <span className="text-sm text-muted-foreground">{item.feeTypeName}</span>
                {/* Amount */}
                <span className="text-right text-sm tabular-nums">৳{item.totalAmount.toLocaleString()}</span>
                {/* Outstanding */}
                <span className={cn("text-right text-sm font-semibold tabular-nums",
                  item.escalationLevel === "CRITICAL" ? "text-red-700" : "text-amber-700"
                )}>
                  ৳{item.outstanding.toLocaleString()}
                </span>
                {/* Days late */}
                <span className={cn("text-right text-sm font-bold tabular-nums",
                  item.daysOverdue >= 30 ? "text-red-700" : "text-amber-700"
                )}>
                  {item.daysOverdue}d
                </span>
                {/* Level badge */}
                <div className="flex justify-center">
                  <span className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide",
                    item.escalationLevel === "CRITICAL"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700",
                  )}>
                    {item.escalationLevel === "CRITICAL"
                      ? <ShieldAlert className="h-2.5 w-2.5" />
                      : <AlertTriangle className="h-2.5 w-2.5" />}
                    {item.escalationLevel}
                  </span>
                </div>
                {/* Acknowledge */}
                <div className="flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-green-700 hover:bg-green-50"
                    onClick={() => acknowledge(item.id)}
                    disabled={acknowledging === item.id}
                    title="Acknowledge — reset escalation level"
                  >
                    {acknowledging === item.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CheckCheck className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        {!isLoading && filteredItems.length > 0 && (
          <div className="grid grid-cols-[1.5fr_1fr_1fr_90px_90px_90px_100px_auto] gap-0 border-t border-border bg-muted/30 px-4 py-3 text-sm font-semibold">
            <span className="text-muted-foreground">{filteredItems.length} invoice{filteredItems.length !== 1 ? "s" : ""}</span>
            <span /><span /><span />
            <span className="text-right tabular-nums text-red-700">
              ৳{filteredItems.reduce((s, i) => s + i.outstanding, 0).toLocaleString()}
            </span>
            <span /><span /><span />
          </div>
        )}
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

// ── Batch Payment Dialog ────────────────────────────────────────────────────

function BatchPaymentDialog({
  invoices, open, onClose,
}: { invoices: Invoice[]; open: boolean; onClose: (cleared: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [method, setMethod] = useState("CASH");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split("T")[0]!);
  const [transactionId, setTransactionId] = useState("");
  const [notes, setNotes] = useState("");

  const payable = invoices.filter(
    i => i.status !== "PAID" && i.status !== "CANCELLED" && (i.totalAmount - i.paidAmount) > 0,
  );
  const totalOutstanding = payable.reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0);

  const mutation = useMutation({
    mutationFn: () =>
      customFetch<{ processed: number; totalAmount: number }>("/api/transactions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceIds: payable.map(i => i.id),
          method,
          paidAt,
          transactionId: transactionId || undefined,
          notes: notes || undefined,
        }),
      }),
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      qc.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      toast({
        title: `${data.processed} payment${data.processed !== 1 ? "s" : ""} recorded`,
        description: `৳${data.totalAmount.toLocaleString()} via ${method.replace(/_/g, " ")}`,
      });
      onClose(true);
    },
    onError: () => toast({ title: "Batch payment failed", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={() => onClose(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" /> Batch Payment
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {payable.length} invoice{payable.length !== 1 ? "s" : ""} selected &mdash; total outstanding:{" "}
            <span className="font-semibold text-foreground">৳{totalOutstanding.toLocaleString()}</span>
          </p>
        </DialogHeader>

        <div className="max-h-44 overflow-auto rounded-lg border divide-y text-xs">
          {payable.length === 0 ? (
            <p className="px-3 py-4 text-center text-muted-foreground">No payable invoices in selection</p>
          ) : payable.map(inv => (
            <div key={inv.id} className="flex items-center justify-between px-3 py-2">
              <div className="min-w-0">
                <span className="font-mono font-medium">{inv.invoiceNumber}</span>
                <span className="text-muted-foreground ml-2 truncate">{inv.studentName}</span>
                {inv.month && <span className="text-muted-foreground ml-1">· {inv.month}</span>}
              </div>
              <span className="ml-3 tabular-nums font-semibold text-red-600 shrink-0">
                ৳{(inv.totalAmount - inv.paidAmount).toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Payment Method *</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["CASH", "BANK_TRANSFER", "MOBILE_BANKING", "CHEQUE"].map(m => (
                  <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Payment Date *</Label>
            <Input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Batch Reference ID</Label>
              <Input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={payable.length === 0 || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record {payable.length} Payment{payable.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchPayOpen, setBatchPayOpen] = useState(false);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<number | null>(null);
  const [emailingReceiptId, setEmailingReceiptId] = useState<number | null>(null);
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

  const downloadReceipt = async (txnId: number) => {
    setDownloadingReceiptId(txnId);
    try {
      const res = await fetch(`/api/finance/transactions/${txnId}/receipt`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-TXN-${txnId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Receipt downloaded", description: `TXN-${txnId}.pdf` });
    } catch {
      toast({ title: "Failed to download receipt", variant: "destructive" });
    } finally {
      setDownloadingReceiptId(null);
    }
  };

  const emailReceipt = async (txnId: number) => {
    setEmailingReceiptId(txnId);
    try {
      const res = await fetch(`/api/finance/transactions/${txnId}/receipt/email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
      });
      const data = await res.json() as { success?: boolean; message?: string; sentTo?: string; deliveryMode?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast({
        title: data.deliveryMode === "email" ? "Receipt emailed" : "Receipt logged",
        description: data.message,
      });
    } catch (e) {
      toast({
        title: "Failed to email receipt",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setEmailingReceiptId(null);
    }
  };

  const toggleSelect = (id: number) =>
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const toggleSelectAll = () => {
    const payable = (invoicesData?.invoices ?? []).filter(i => i.status !== "PAID" && i.status !== "CANCELLED");
    const allSelected = payable.length > 0 && payable.every(i => selectedIds.has(i.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) payable.forEach(i => next.delete(i.id));
      else payable.forEach(i => next.add(i.id));
      return next;
    });
  };

  const params = { status: statusFilter as any || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const { data: invoicesData, isLoading } = useListInvoices(params);
  const { data: transactionsData } = useListTransactions({ limit: 20 });

  const selectedInvoices = (invoicesData?.invoices ?? []).filter(i => selectedIds.has(i.id));

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
          <TabsTrigger value="fee-schedules" className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Fee Schedules
          </TabsTrigger>
          <TabsTrigger value="collection-report" className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Collection Report
          </TabsTrigger>
          <TabsTrigger value="escalations" className="flex items-center gap-1.5 data-[state=active]:text-red-600">
            <BellRing className="h-3.5 w-3.5" /> Escalations
          </TabsTrigger>
          <TabsTrigger value="health" className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Health
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
                  <th className="px-3 py-2.5 w-10">
                    {(() => {
                      const payable = (invoicesData?.invoices ?? []).filter(i => i.status !== "PAID" && i.status !== "CANCELLED");
                      const allChecked = payable.length > 0 && payable.every(i => selectedIds.has(i.id));
                      return (
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={toggleSelectAll}
                          className="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer"
                          title={allChecked ? "Deselect all" : "Select all unpaid"}
                        />
                      );
                    })()}
                  </th>
                  {["Invoice No.", "Student", "Fee Type", "Month", "Total", "Paid", "Due Date", "Status", "Action"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}</tr>
                  ))
                ) : invoicesData?.invoices.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-muted-foreground">No invoices found</td></tr>
                ) : invoicesData?.invoices.map(inv => (
                  <tr key={inv.id} className={cn("hover:bg-muted/20 transition-colors", selectedIds.has(inv.id) && "bg-primary/5")}>
                    <td className="px-3 py-3">
                      {inv.status !== "PAID" && inv.status !== "CANCELLED" ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(inv.id)}
                          onChange={() => toggleSelect(inv.id)}
                          className="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer"
                        />
                      ) : <span className="block w-3.5" />}
                    </td>
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

          {/* Batch pay floating bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-primary">
                  {selectedIds.size} invoice{selectedIds.size !== 1 ? "s" : ""} selected
                </span>
                <span className="text-xs text-muted-foreground">
                  ৳{selectedInvoices
                    .filter(i => i.status !== "PAID" && i.status !== "CANCELLED")
                    .reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0)
                    .toLocaleString()} outstanding
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </Button>
                <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => setBatchPayOpen(true)}>
                  <ListChecks className="h-3.5 w-3.5" /> Batch Pay
                </Button>
              </div>
            </div>
          )}

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
                  {["Student", "Invoice", "Amount", "Method", "Txn ID", "Date", "Receipt"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactionsData?.transactions.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">No transactions yet</td></tr>
                ) : transactionsData?.transactions.map(t => (
                  <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{t.studentName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{t.invoiceId}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-green-600">৳{t.amountPaid.toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted-foreground">{t.method.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 font-mono text-xs">{t.transactionId ?? "-"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(t.paidAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => downloadReceipt(t.id)}
                          disabled={downloadingReceiptId === t.id}
                          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:underline font-medium disabled:opacity-50 disabled:cursor-wait whitespace-nowrap"
                          title="Download PDF receipt"
                        >
                          {downloadingReceiptId === t.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <FileText className="h-3 w-3" />}
                          PDF
                        </button>
                        <button
                          onClick={() => emailReceipt(t.id)}
                          disabled={emailingReceiptId === t.id}
                          className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 hover:underline font-medium disabled:opacity-50 disabled:cursor-wait whitespace-nowrap"
                          title="Email receipt to parent"
                        >
                          {emailingReceiptId === t.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Mail className="h-3 w-3" />}
                          Email
                        </button>
                      </div>
                    </td>
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

        {/* ── Fee Schedules tab ── */}
        <TabsContent value="fee-schedules" className="mt-4">
          <FeeSchedulesTab />
        </TabsContent>

        {/* ── Collection Report tab ── */}
        <TabsContent value="collection-report" className="mt-4">
          <CollectionReportTab />
        </TabsContent>

        {/* ── Escalations tab ── */}
        <TabsContent value="escalations" className="mt-4">
          <EscalationsTab />
        </TabsContent>

        {/* ── Health tab ── */}
        <TabsContent value="health" className="mt-4">
          <HealthTab />
        </TabsContent>
      </Tabs>

      <CreateInvoiceDialog open={invoiceDialogOpen} onClose={() => setInvoiceDialogOpen(false)} />
      <RecordPaymentDialog invoice={paymentInvoice} open={!!paymentInvoice} onClose={() => setPaymentInvoice(null)} />
      <BatchPaymentDialog
        invoices={selectedInvoices}
        open={batchPayOpen}
        onClose={cleared => { setBatchPayOpen(false); if (cleared) setSelectedIds(new Set()); }}
      />
      <ExportPdfDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
      <BulkGenerateDialog open={bulkDialogOpen} onClose={() => setBulkDialogOpen(false)} />
    </div>
  );
}
