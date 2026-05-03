import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Users, CalendarCheck, Banknote, AlertCircle, CheckCircle2,
  Clock, Link2, FileText, Download, Loader2, ChevronDown,
  ChevronUp, CreditCard, TrendingUp, Send, XCircle, HelpCircle, RefreshCw, History,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

interface LinkedStudent {
  linkId: number; relationship: string; linkedAt: string;
  id: number; studentId: string; firstName: string; lastName: string;
  dateOfBirth?: string | null; gender?: string | null;
  classId?: number | null; className?: string | null;
  status: string; admissionDate: string;
  parentName?: string | null; parentPhone?: string | null; parentEmail?: string | null;
}

interface AttendanceRecord { status: string; }

interface Transaction {
  id: number; amountPaid: number; method: string;
  transactionId: string | null; paidAt: string; notes: string | null;
}

interface FeeInvoice {
  id: number; invoiceNumber: string; feeTypeId: number; feeTypeName: string;
  month: string | null; totalAmount: number; paidAmount: number;
  dueDate: string; status: string; createdAt: string;
  transactions: Transaction[];
}

interface FeeSummary {
  totalInvoiced: number; totalPaid: number;
  totalOutstanding: number; overdueCount: number; invoiceCount: number;
}

interface FeeStatement {
  student: {
    id: number; studentId: string; firstName: string; lastName: string;
    className: string | null; admissionDate: string;
    parentName: string | null; parentEmail: string | null;
  };
  summary: FeeSummary;
  invoices: FeeInvoice[];
  generatedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function authedFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("erp_token") ?? "";
  return fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options?.headers },
  }).then(async r => {
    const ct = r.headers.get("content-type") ?? "";
    if (!r.ok) {
      const err = ct.includes("json") ? await r.json().catch(() => ({})) : {};
      throw new Error((err as any)?.error ?? "Request failed");
    }
    if (ct.includes("json")) return r.json() as Promise<T>;
    return r as unknown as T;
  });
}

const STATUS_STYLE: Record<string, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  PAID:      { label: "Paid",      cls: "bg-green-100 text-green-700",  icon: CheckCircle2 },
  PENDING:   { label: "Pending",   cls: "bg-yellow-100 text-yellow-700", icon: Clock },
  OVERDUE:   { label: "Overdue",   cls: "bg-red-100 text-red-700",      icon: AlertCircle },
  CANCELLED: { label: "Cancelled", cls: "bg-gray-100 text-gray-500",    icon: Clock },
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  PARENT: "Parent", GUARDIAN: "Guardian", SIBLING: "Sibling",
  GRANDPARENT: "Grandparent", OTHER: "Other",
};

// ── Submit Payment Dialog ──────────────────────────────────────────────────

const PAYMENT_METHODS = [
  { value: "BKASH",         label: "bKash" },
  { value: "NAGAD",         label: "Nagad" },
  { value: "ROCKET",        label: "Rocket" },
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "CASH",          label: "Cash" },
  { value: "CHEQUE",        label: "Cheque" },
  { value: "OTHER",         label: "Other" },
];

function SubmitPaymentDialog({
  inv, open, onClose,
}: { inv: FeeInvoice | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [method, setMethod] = useState("BKASH");
  const [amount, setAmount] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]!);
  const [note, setNote] = useState("");

  const outstanding = inv ? Math.max(0, inv.totalAmount - inv.paidAmount) : 0;

  const submitMutation = useMutation({
    mutationFn: (body: object) => {
      const token = localStorage.getItem("erp_token") ?? "";
      return fetch("/api/parent/payment-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }).then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d as any)?.error ?? "Submission failed");
        return d;
      });
    },
    onSuccess: () => {
      toast({
        title: "Payment submitted for review",
        description: "Finance staff will verify and approve your payment shortly.",
      });
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
      qc.invalidateQueries({ queryKey: ["fee-statement"] });
      onClose();
      setAmount(""); setTransactionRef(""); setNote("");
    },
    onError: (e: Error) => toast({ title: "Submission failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    const amtNum = parseFloat(amount);
    if (!amount || isNaN(amtNum) || amtNum <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" }); return;
    }
    if (!paymentDate) {
      toast({ title: "Payment date is required", variant: "destructive" }); return;
    }
    submitMutation.mutate({
      invoiceId: inv!.id, amount: amtNum, method, transactionRef: transactionRef || undefined,
      paymentDate, note: note || undefined,
    });
  };

  if (!inv) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Submit Payment for Review
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {inv.invoiceNumber} · {inv.feeTypeName}{inv.month ? ` · ${inv.month}` : ""}
            <br />Outstanding: <span className="font-semibold text-red-600">৳{outstanding.toLocaleString()}</span>
          </p>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700 flex gap-2">
            <HelpCircle className="h-4 w-4 shrink-0 mt-0.5" />
            After you submit, the school finance team will verify your payment and update your invoice within 1–2 working days.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount Paid (৳) *</Label>
              <Input
                type="number" step="0.01" min="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={outstanding.toString()}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Date *</Label>
              <Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Payment Method *</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Transaction ID / Reference</Label>
            <Input
              value={transactionRef} onChange={e => setTransactionRef(e.target.value)}
              placeholder="e.g. TXN123456, bKash ref, cheque no."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Any additional details…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitMutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitMutation.isPending}>
            {submitMutation.isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
              : <><Send className="mr-2 h-4 w-4" /> Submit Payment</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────────

function useLinkedStudents(parentUserId?: number) {
  return useQuery<{ links: LinkedStudent[]; total: number }>({
    queryKey: ["parent-students", parentUserId],
    queryFn: () => authedFetch(`/api/parent-students?parentUserId=${parentUserId}`),
    enabled: !!parentUserId,
  });
}

function useStudentAttendance(studentId: number) {
  return useQuery<{ records: AttendanceRecord[] }>({
    queryKey: ["attendance-student", studentId],
    queryFn: () => authedFetch(`/api/attendance?studentId=${studentId}&limit=500`),
  });
}

function useFeeStatement(studentId: number) {
  return useQuery<FeeStatement>({
    queryKey: ["fee-statement", studentId],
    queryFn: () => authedFetch(`/api/parent/fee-statement/${studentId}`),
  });
}

interface MyPaymentRequest {
  id: number; invoiceId: number; invoiceNumber: string;
  amount: number; method: string; transactionRef: string | null;
  paymentDate: string; note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null; reviewedAt: string | null; reviewedBy: string | null;
  createdAt: string;
}

function useMyPaymentRequests(studentId: number) {
  return useQuery<{ requests: MyPaymentRequest[]; total: number }>({
    queryKey: ["my-payment-requests", studentId],
    queryFn: () => authedFetch(`/api/parent/payment-requests?studentId=${studentId}`),
  });
}

// ── My Payment Requests Card ───────────────────────────────────────────────

const PR_STATUS_STYLE: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  PENDING:  { label: "Pending Review", cls: "bg-yellow-50 text-yellow-700 border-yellow-200",  icon: Clock },
  APPROVED: { label: "Approved",       cls: "bg-green-50 text-green-700 border-green-200",     icon: CheckCircle2 },
  REJECTED: { label: "Rejected",       cls: "bg-red-50 text-red-600 border-red-200",           icon: XCircle },
};

const METHOD_LABELS: Record<string, string> = {
  BKASH: "bKash", NAGAD: "Nagad", ROCKET: "Rocket",
  BANK_TRANSFER: "Bank Transfer", CASH: "Cash", CHEQUE: "Cheque", OTHER: "Other",
};

function MyPaymentRequestsCard({ studentId }: { studentId: number }) {
  const { data, isLoading, refetch } = useMyPaymentRequests(studentId);
  const requests = data?.requests ?? [];

  const pending  = requests.filter(r => r.status === "PENDING").length;
  const approved = requests.filter(r => r.status === "APPROVED").length;
  const rejected = requests.filter(r => r.status === "REJECTED").length;

  if (isLoading) return (
    <div className="space-y-2 mt-4">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
    </div>
  );

  return (
    <div className="space-y-4 mt-4">
      {/* Summary row */}
      {requests.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Pending",  value: pending,  cls: "text-yellow-700" },
            { label: "Approved", value: approved, cls: "text-green-600" },
            { label: "Rejected", value: rejected, cls: "text-red-600" },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-3 text-center">
              <p className={cn("text-xl font-bold tabular-nums", s.cls)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {pending > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2.5 text-xs text-yellow-800">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {pending} request{pending > 1 ? "s are" : " is"} awaiting review by the finance team — usually processed within 1–2 working days.
        </div>
      )}

      {requests.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-muted-foreground">
          <Send className="h-8 w-8 opacity-30" />
          <p className="text-sm font-medium">No payment requests yet</p>
          <p className="text-xs text-center max-w-xs">
            When you submit payment evidence from the Fee Statement tab, your requests will appear here with their review status.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(pr => {
            const s = PR_STATUS_STYLE[pr.status] ?? PR_STATUS_STYLE["PENDING"]!;
            const Icon = s.icon;
            return (
              <div key={pr.id} className={cn("rounded-lg border p-4 space-y-2.5", s.cls.includes("bg-") ? "" : "border-border bg-card")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{pr.invoiceNumber}</span>
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", s.cls)}>
                        <Icon className="h-2.5 w-2.5" /> {s.label}
                      </span>
                    </div>
                    <p className="font-semibold text-sm tabular-nums mt-1">৳{pr.amount.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {METHOD_LABELS[pr.method] ?? pr.method}
                      {pr.transactionRef && <span className="ml-1.5 font-mono">· {pr.transactionRef}</span>}
                      <span className="ml-1.5">· Paid {pr.paymentDate}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-muted-foreground">Submitted</p>
                    <p className="text-xs font-medium">{new Date(pr.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                  </div>
                </div>

                {pr.status === "REJECTED" && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex gap-2">
                    <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Rejected{pr.reviewedBy ? ` by ${pr.reviewedBy}` : ""}</p>
                      <p className="mt-0.5">{pr.rejectionReason ?? "No reason provided. Please contact the school finance office."}</p>
                    </div>
                  </div>
                )}

                {pr.status === "APPROVED" && (
                  <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 flex gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <p>
                      Payment verified and recorded
                      {pr.reviewedBy ? ` by ${pr.reviewedBy}` : ""}
                      {pr.reviewedAt ? ` on ${new Date(pr.reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}.
                    </p>
                  </div>
                )}

                {pr.note && (
                  <p className="text-[10px] text-muted-foreground italic">Note: {pr.note}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={() => refetch()}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <RefreshCw className="h-3 w-3" /> Refresh
      </button>
    </div>
  );
}

// ── Invoice row with expandable transactions ───────────────────────────────

function InvoiceRow({ inv, onSubmitPayment }: { inv: FeeInvoice; onSubmitPayment: (inv: FeeInvoice) => void }) {
  const [expanded, setExpanded] = useState(false);
  const s = STATUS_STYLE[inv.status] ?? STATUS_STYLE["PENDING"]!;
  const Icon = s.icon;
  const due = Math.max(0, inv.totalAmount - inv.paidAmount);

  return (
    <>
      <tr
        className={cn(
          "border-b border-border transition-colors cursor-pointer select-none",
          expanded ? "bg-indigo-50/60" : "hover:bg-muted/20",
        )}
        onClick={() => inv.transactions.length > 0 && setExpanded(v => !v)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-medium">{inv.invoiceNumber}</span>
            {inv.transactions.length > 0 && (
              expanded
                ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
                : <ChevronDown className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">{inv.feeTypeName}</td>
        <td className="px-4 py-3 text-xs text-muted-foreground">{inv.month ?? "—"}</td>
        <td className="px-4 py-3 text-sm tabular-nums">৳{inv.totalAmount.toLocaleString()}</td>
        <td className="px-4 py-3 text-sm tabular-nums text-green-600 font-medium">৳{inv.paidAmount.toLocaleString()}</td>
        <td className="px-4 py-3 text-sm tabular-nums">
          {due > 0 && inv.status !== "CANCELLED"
            ? <span className="text-red-600 font-medium">৳{due.toLocaleString()}</span>
            : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">{inv.dueDate}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", s.cls)}>
              <Icon className="h-2.5 w-2.5" />{s.label}
            </span>
            {(inv.status === "PENDING" || inv.status === "OVERDUE") && (
              <button
                onClick={e => { e.stopPropagation(); onSubmitPayment(inv); }}
                className="flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20 transition-colors"
              >
                <Send className="h-2.5 w-2.5" /> Pay
              </button>
            )}
          </div>
        </td>
      </tr>

      {expanded && inv.transactions.length > 0 && (
        <tr>
          <td colSpan={8} className="bg-indigo-50/40 px-4 pb-3 pt-0">
            <div className="ml-8 border border-indigo-100 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-indigo-100/60 text-indigo-700">
                    <th className="px-3 py-1.5 text-left font-semibold">Date</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Amount Paid</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Method</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.transactions.map(tx => (
                    <tr key={tx.id} className="border-t border-indigo-100 bg-white">
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {new Date(tx.paidAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
                      </td>
                      <td className="px-3 py-1.5 font-semibold text-green-700 tabular-nums">
                        ৳{tx.amountPaid.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{tx.method.replace(/_/g, " ")}</td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">{tx.transactionId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Fee Statement Card ─────────────────────────────────────────────────────

function FeeStatementCard({ student }: { student: LinkedStudent }) {
  const { data: stmt, isLoading: stmtLoading } = useFeeStatement(student.id);
  const [downloading, setDownloading] = useState(false);
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [submitInv, setSubmitInv] = useState<FeeInvoice | null>(null);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const token = localStorage.getItem("erp_token") ?? "";
      const res = await fetch(`/api/parent/fee-statement/${student.id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fee-statement-${student.studentId}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setDownloading(false);
    }
  };

  if (stmtLoading) return (
    <div className="space-y-2 mt-4">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );

  if (!stmt) return (
    <p className="text-sm text-muted-foreground mt-4">Could not load fee statement.</p>
  );

  const { summary, invoices } = stmt;

  // Year options from invoice dates
  const years = [...new Set(invoices.map(i => i.dueDate.slice(0, 4)))].sort().reverse();
  const filtered = yearFilter === "all" ? invoices : invoices.filter(i => i.dueDate.startsWith(yearFilter));

  return (
    <div className="space-y-4 mt-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Invoiced", value: `৳${summary.totalInvoiced.toLocaleString()}`, sub: `${summary.invoiceCount} invoice${summary.invoiceCount !== 1 ? "s" : ""}`, cls: "text-foreground" },
          { label: "Total Paid",     value: `৳${summary.totalPaid.toLocaleString()}`,     sub: "across all payments",       cls: "text-green-600" },
          { label: "Outstanding",    value: `৳${summary.totalOutstanding.toLocaleString()}`, sub: summary.overdueCount > 0 ? `${summary.overdueCount} overdue` : "all current", cls: summary.totalOutstanding > 0 ? "text-red-600" : "text-green-600" },
          { label: "Invoices Total",  value: `${summary.invoiceCount} invoice${summary.invoiceCount !== 1 ? "s" : ""}`, sub: "all time",             cls: "text-indigo-600" },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{s.label}</p>
            <p className={cn("text-lg font-bold mt-0.5 tabular-nums", s.cls)}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {summary.overdueCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {summary.overdueCount} overdue invoice{summary.overdueCount > 1 ? "s" : ""} — please contact the school to arrange payment
        </div>
      )}

      {summary.totalOutstanding === 0 && invoices.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> All fees are fully cleared
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
          Filter by year:
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setYearFilter("all")}
            className={cn("rounded-full px-3 py-1 text-xs font-medium border transition-colors",
              yearFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50")}
          >All</button>
          {years.map(yr => (
            <button key={yr}
              onClick={() => setYearFilter(yr)}
              className={cn("rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                yearFilter === yr ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50")}
            >{yr}</button>
          ))}
        </div>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={downloadPdf} disabled={downloading}>
            {downloading
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Generating…</>
              : <><Download className="mr-1.5 h-3.5 w-3.5" /> Download PDF</>}
          </Button>
        </div>
      </div>

      {/* Invoice table */}
      {filtered.length === 0 ? (
        <p className="text-sm text-center text-muted-foreground py-8">No invoices for the selected period</p>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Invoice History{yearFilter !== "all" ? ` · ${yearFilter}` : ""}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {["Invoice No.", "Fee Type", "Month", "Total", "Paid", "Remaining", "Due Date", "Status"].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => <InvoiceRow key={inv.id} inv={inv} onSubmitPayment={setSubmitInv} />)}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground px-4 py-2 border-t border-border">
            Click any row with payments to expand transaction details.
          </p>
        </div>
      )}

      <SubmitPaymentDialog inv={submitInv} open={!!submitInv} onClose={() => setSubmitInv(null)} />
    </div>
  );
}

// ── Attendance Card ────────────────────────────────────────────────────────

function AttendanceSummaryCard({ studentId }: { studentId: number }) {
  const { data: attData } = useStudentAttendance(studentId);
  const att = attData?.records ?? [];
  const present = att.filter(r => r.status === "PRESENT").length;
  const absent  = att.filter(r => r.status === "ABSENT").length;
  const late    = att.filter(r => r.status === "LATE").length;
  const pct     = att.length > 0 ? Math.round((present / att.length) * 100) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <CalendarCheck className="h-4 w-4" /> Attendance Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!attData ? (
          <div className="space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : att.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attendance data recorded yet</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Present", value: present, cls: "text-green-600" },
                { label: "Absent",  value: absent,  cls: "text-red-600" },
                { label: "Late",    value: late,    cls: "text-yellow-600" },
                { label: "Total",   value: att.length, cls: "" },
              ].map(({ label, value, cls }) => (
                <div key={label} className="text-center rounded-lg bg-muted/40 py-2">
                  <p className={cn("text-2xl font-bold", cls)}>{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            {pct !== null && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Attendance rate</span>
                  <span className={cn("font-semibold", pct >= 75 ? "text-green-600" : "text-red-600")}>{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", pct >= 75 ? "bg-green-500" : "bg-red-500")} style={{ width: `${pct}%` }} />
                </div>
                {pct < 75 && (
                  <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    <p className="text-xs text-red-600">Attendance below 75% — please contact the school</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Student Card ───────────────────────────────────────────────────────────

function StudentCard({ student }: { student: LinkedStudent }) {
  const [tab, setTab] = useState<"overview" | "fees" | "payments">("overview");

  return (
    <div className="space-y-4">
      {/* Student info */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary shrink-0">
              {student.firstName[0]}{student.lastName[0]}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base">{student.firstName} {student.lastName}</h3>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{student.studentId}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge variant="outline" className="text-xs">{student.status}</Badge>
                {student.className && <Badge variant="outline" className="text-xs">{student.className}</Badge>}
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  <Link2 className="h-2.5 w-2.5" />
                  {RELATIONSHIP_LABELS[student.relationship] ?? student.relationship}
                </span>
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mt-4 pt-4 border-t">
            {[
              { label: "Date of Birth", value: student.dateOfBirth ?? "—" },
              { label: "Gender",        value: student.gender ?? "—" },
              { label: "Admission",     value: student.admissionDate },
              { label: "Linked Since",  value: new Date(student.linkedAt).toLocaleDateString() },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt className="text-muted-foreground uppercase tracking-wider font-medium">{label}</dt>
                <dd className="font-medium mt-0.5">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
        <button
          onClick={() => setTab("overview")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all",
            tab === "overview" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <TrendingUp className="h-3.5 w-3.5" /> Overview
        </button>
        <button
          onClick={() => setTab("fees")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all",
            tab === "fees" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Banknote className="h-3.5 w-3.5" /> Fee Statement
        </button>
        <button
          onClick={() => setTab("payments")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all",
            tab === "payments" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <History className="h-3.5 w-3.5" /> My Payments
        </button>
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <AttendanceSummaryCard studentId={student.id} />
      )}

      {tab === "fees" && (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> Fee Statement
              <span className="ml-auto text-xs font-normal text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Full invoice &amp; payment history
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FeeStatementCard student={student} />
          </CardContent>
        </Card>
      )}

      {tab === "payments" && (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <History className="h-4 w-4" /> My Payment Submissions
              <span className="ml-auto text-xs font-normal text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Track approval status
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MyPaymentRequestsCard studentId={student.id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function ParentPortalPage() {
  const { user } = useAuth();
  const { data, isLoading } = useLinkedStudents(user?.id);
  const links = data?.links ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Parent Portal</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Viewing information for your linked student{links.length !== 1 ? "s" : ""}
          {links.length > 0 && <span className="ml-1 text-primary font-medium">({links.length})</span>}
        </p>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-36" />
          <Skeleton className="h-48" />
          <Skeleton className="h-40" />
        </div>
      )}

      {!isLoading && !links.length && (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
            <AlertCircle className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No linked students</p>
            <p className="text-xs mt-1 text-center max-w-xs">
              Your account has no students linked yet. Please contact the school administrator to have your children added.
            </p>
          </CardContent>
        </Card>
      )}

      {links.map((link, idx) => (
        <div key={link.linkId}>
          {links.length > 1 && (
            <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide flex items-center gap-1.5">
              <span className="h-4 w-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center font-bold">{idx + 1}</span>
              {link.firstName} {link.lastName}
            </h2>
          )}
          <StudentCard student={link} />
        </div>
      ))}
    </div>
  );
}
