import { useState } from "react";
import {
  useListInvoices, useCreateInvoice, useListFeeTypes,
  useListTransactions, useCreateTransaction, useListStudents,
  getListInvoicesQueryKey, getListTransactionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Plus, Loader2, CreditCard, ChevronLeft, ChevronRight, Bell, CheckCircle2, Download } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

const PAGE_SIZE = 15;

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-600",
};

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
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "PDF exported", description: `${exportType} report downloaded successfully.` });
      onClose();
    } catch {
      toast({ title: "Export failed", description: "Could not generate PDF. Try again.", variant: "destructive" });
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

          <p className="text-xs text-muted-foreground">
            Leave dates empty to export all records. The report will be downloaded as a PDF.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleExport} disabled={loading}>
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</> : <><Download className="mr-2 h-4 w-4" /> Export PDF</>}
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

// ── Main Page ──────────────────────────────────────────────────────────────

export default function FinancePage() {
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
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

  const params = {
    status: statusFilter as any || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

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
        </TabsList>

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
                              title="Send payment reminder notification"
                            >
                              {remindingId === inv.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Bell className="h-3 w-3" />}
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
      </Tabs>

      <CreateInvoiceDialog open={invoiceDialogOpen} onClose={() => setInvoiceDialogOpen(false)} />
      <RecordPaymentDialog invoice={paymentInvoice} open={!!paymentInvoice} onClose={() => setPaymentInvoice(null)} />
      <ExportPdfDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
    </div>
  );
}
