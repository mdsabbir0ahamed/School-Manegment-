import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  useListStudents, useCreateStudent, useUpdateStudent, useDeleteStudent,
  useListClasses, getListStudentsQueryKey,
} from "@workspace/api-client-react";
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
import {
  Search, Plus, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight,
  Eye, Lock, Upload, CheckCircle2, XCircle, AlertCircle,
  ChevronDown, ChevronUp, Clock, FileText, CreditCard, Download,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

// ── Fee Ledger types ────────────────────────────────────────────────────────
interface LedgerTransaction { id: number; amountPaid: number; method: string; transactionId: string | null; paidAt: string; }
interface LedgerInvoice {
  id: number; invoiceNumber: string; feeTypeName: string;
  month: string | null; totalAmount: number; paidAmount: number;
  dueDate: string; status: string; escalationLevel: string;
  transactions: LedgerTransaction[];
}
interface FeeLedger {
  student: { id: number; studentId: string; firstName: string; lastName: string; className: string | null; };
  summary: { totalInvoiced: number; totalPaid: number; totalOutstanding: number; overdueCount: number; invoiceCount: number; };
  invoices: LedgerInvoice[];
}

const LEDGER_STATUS: Record<string, { label: string; cls: string }> = {
  PAID:      { label: "Paid",      cls: "bg-green-100 text-green-700" },
  PENDING:   { label: "Pending",   cls: "bg-yellow-100 text-yellow-700" },
  OVERDUE:   { label: "Overdue",   cls: "bg-red-100 text-red-700" },
  CANCELLED: { label: "Cancelled", cls: "bg-gray-100 text-gray-500" },
};

function LedgerInvoiceRow({ inv, canPay, onPay }: { inv: LedgerInvoice; canPay: boolean; onPay: (inv: LedgerInvoice) => void }) {
  const [expanded, setExpanded] = useState(false);
  const s = LEDGER_STATUS[inv.status] ?? LEDGER_STATUS["PENDING"]!;
  const due = Math.max(0, inv.totalAmount - inv.paidAmount);
  const hasTx = inv.transactions.length > 0;
  const showPayBtn = canPay && due > 0 && inv.status !== "CANCELLED" && inv.status !== "PAID";

  return (
    <>
      <tr
        className={cn("border-b border-border transition-colors", hasTx ? "cursor-pointer hover:bg-muted/20" : "")}
        onClick={() => hasTx && setExpanded(v => !v)}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs font-medium">{inv.invoiceNumber}</span>
            {hasTx && (expanded
              ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
              : <ChevronDown className="h-3 w-3 text-muted-foreground" />)}
          </div>
        </td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground">{inv.feeTypeName}</td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground">{inv.month ?? "—"}</td>
        <td className="px-3 py-2.5 text-xs tabular-nums">৳{inv.totalAmount.toLocaleString()}</td>
        <td className="px-3 py-2.5 text-xs tabular-nums text-green-600 font-medium">৳{inv.paidAmount.toLocaleString()}</td>
        <td className="px-3 py-2.5 text-xs tabular-nums">
          {due > 0 && inv.status !== "CANCELLED"
            ? <span className="text-red-600 font-medium">৳{due.toLocaleString()}</span>
            : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground">{inv.dueDate}</td>
        <td className="px-3 py-2.5">
          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", s.cls)}>
            {s.label}
          </span>
        </td>
        <td className="px-3 py-2.5">
          {showPayBtn && (
            <button
              onClick={e => { e.stopPropagation(); onPay(inv); }}
              className="flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20 transition-colors whitespace-nowrap"
            >
              <CreditCard className="h-2.5 w-2.5" /> Pay
            </button>
          )}
        </td>
      </tr>
      {expanded && hasTx && (
        <tr>
          <td colSpan={9} className="bg-indigo-50/40 px-3 pb-3 pt-0">
            <div className="ml-6 border border-indigo-100 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-indigo-100/60 text-indigo-700">
                    <th className="px-3 py-1.5 text-left font-semibold">Date</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Amount</th>
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

// ── Record Payment Dialog (inline from ledger) ──────────────────────────────

function RecordPaymentDialog({
  inv, open, onClose, studentId,
}: { inv: LedgerInvoice | null; open: boolean; onClose: () => void; studentId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [transactionId, setTransactionId] = useState("");
  const [notes, setNotes] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split("T")[0]!);

  useEffect(() => {
    if (inv) {
      setAmount(String(Math.max(0, inv.totalAmount - inv.paidAmount)));
      setMethod("CASH");
      setTransactionId("");
      setNotes("");
      setPaidAt(new Date().toISOString().split("T")[0]!);
    }
  }, [inv?.id]);

  const outstanding = inv ? Math.max(0, inv.totalAmount - inv.paidAmount) : 0;
  const amtNum = parseFloat(amount);
  const amountValid = !isNaN(amtNum) && amtNum > 0 && amtNum <= outstanding + 0.001;

  const mutation = useMutation({
    mutationFn: () =>
      customFetch<{ id: number }>("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: inv!.id,
          amountPaid: amtNum,
          method,
          transactionId: transactionId || undefined,
          notes: notes || undefined,
          paidAt,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["student-fee-ledger", studentId] });
      toast({ title: "Payment recorded successfully" });
      onClose();
    },
    onError: () => toast({ title: "Failed to record payment", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Record Payment
          </DialogTitle>
          {inv && (
            <p className="text-sm text-muted-foreground">
              {inv.invoiceNumber} · {inv.feeTypeName}{inv.month ? ` · ${inv.month}` : ""}
              <br />
              Outstanding: <span className="font-semibold text-red-600">৳{outstanding.toLocaleString()}</span>
            </p>
          )}
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label>Amount Paid *</Label>
            <Input
              type="number" step="0.01" min="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={`Max ৳${outstanding.toLocaleString()}`}
            />
            {!isNaN(amtNum) && amtNum > outstanding + 0.001 && (
              <p className="text-xs text-destructive">Exceeds outstanding ৳{outstanding.toLocaleString()}</p>
            )}
          </div>
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
          <div className="space-y-1">
            <Label>Transaction / Reference ID</Label>
            <Input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!amountValid || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FeeLedgerTab({ studentId, studentCode }: { studentId: number; studentCode: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canPay = user?.role === "SUPER_ADMIN" || user?.role === "ACCOUNTANT";
  const [yearFilter, setYearFilter] = useState("all");
  const [payInv, setPayInv] = useState<LedgerInvoice | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { data, isLoading, isError } = useQuery<FeeLedger>({
    queryKey: ["student-fee-ledger", studentId],
    queryFn: () => customFetch(`/api/students/${studentId}/fee-ledger`),
    staleTime: 60_000,
  });

  const downloadStatement = async () => {
    setDownloading(true);
    try {
      const token = localStorage.getItem("erp_token") ?? "";
      const res = await fetch(`/api/parent/fee-statement/${studentId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fee-statement-${studentCode}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Fee statement downloaded" });
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) return (
    <div className="space-y-2 pt-2">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
  if (isError || !data) return (
    <p className="text-sm text-muted-foreground text-center pt-8">Could not load fee ledger.</p>
  );

  const { summary, invoices } = data;
  const years = [...new Set(invoices.map(i => i.dueDate.slice(0, 4)))].sort().reverse();
  const filtered = yearFilter === "all" ? invoices : invoices.filter(i => i.dueDate.startsWith(yearFilter));

  return (
    <div className="space-y-4 pt-2">
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Total Invoiced", value: `৳${summary.totalInvoiced.toLocaleString()}`, sub: `${summary.invoiceCount} invoice${summary.invoiceCount !== 1 ? "s" : ""}`, cls: "text-foreground" },
          { label: "Total Paid",     value: `৳${summary.totalPaid.toLocaleString()}`,     sub: "across all payments",                                                      cls: "text-green-600" },
          { label: "Outstanding",    value: `৳${summary.totalOutstanding.toLocaleString()}`, sub: summary.overdueCount > 0 ? `${summary.overdueCount} overdue` : "all current", cls: summary.totalOutstanding > 0 ? "text-red-600" : "text-green-600" },
          { label: "Invoices",       value: String(summary.invoiceCount),                  sub: "total records",                                                             cls: "text-indigo-600" },
        ].map(s => (
          <div key={s.label} className="rounded-lg border bg-card p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{s.label}</p>
            <p className={cn("text-base font-bold mt-0.5 tabular-nums", s.cls)}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Overdue alert */}
      {summary.overdueCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {summary.overdueCount} overdue invoice{summary.overdueCount > 1 ? "s" : ""} — requires follow-up
        </div>
      )}

      {/* Year filter + table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-muted-foreground font-medium">{filtered.length} invoice{filtered.length !== 1 ? "s" : ""} shown</p>
          <div className="flex items-center gap-2">
            {years.length > 0 && (
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue placeholder="All years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All years</SelectItem>
                  {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {canPay && (
              <button
                onClick={downloadStatement}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Download fee statement PDF"
              >
                {downloading
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Download className="h-3 w-3" />}
                Statement PDF
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Clock className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No invoices for this period</p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-auto max-h-72">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr>
                  {[...["Invoice #", "Fee Type", "Month", "Billed", "Paid", "Due", "Due Date", "Status"], ...(canPay ? ["Action"] : [])].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => (
                  <LedgerInvoiceRow key={inv.id} inv={inv} canPay={canPay} onPay={setPayInv} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RecordPaymentDialog
        inv={payInv}
        open={!!payInv}
        onClose={() => setPayInv(null)}
        studentId={studentId}
      />
    </div>
  );
}

type StatementLogEntry = {
  id: number;
  action: "PDF_DOWNLOAD" | "EMAIL_SENT";
  sentTo: string | null;
  deliveryMode: string | null;
  createdAt: string;
  triggeredBy: string;
  triggeredByRole: string | null;
};

function StatementHistoryTab({ studentId }: { studentId: number }) {
  const { data, isLoading, isError } = useQuery<{ logs: StatementLogEntry[] }>({
    queryKey: ["statement-history", studentId],
    queryFn: () => customFetch(`/api/parent/fee-statement/${studentId}/logs`),
    staleTime: 30_000,
  });

  if (isLoading) return (
    <div className="space-y-2 pt-3">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
  if (isError) return (
    <p className="text-sm text-muted-foreground text-center pt-8">Could not load statement history.</p>
  );
  if (!data?.logs.length) return (
    <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground gap-2">
      <Clock className="h-8 w-8 opacity-30" />
      <p className="text-sm">No statements have been downloaded or emailed yet.</p>
    </div>
  );

  return (
    <div className="pt-2 space-y-1 max-h-72 overflow-y-auto pr-1">
      {data.logs.map(log => {
        const isPdf = log.action === "PDF_DOWNLOAD";
        return (
          <div
            key={log.id}
            className="flex items-start gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm"
          >
            <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${isPdf ? "bg-indigo-100 text-indigo-600" : "bg-green-100 text-green-600"}`}>
              {isPdf
                ? <Download className="h-3 w-3" />
                : <FileText className="h-3 w-3" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{isPdf ? "PDF Downloaded" : "Emailed to Parent"}</span>
                {log.deliveryMode && !isPdf && (
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${log.deliveryMode === "email" ? "border-green-300 text-green-700 bg-green-50" : "border-amber-300 text-amber-700 bg-amber-50"}`}>
                    {log.deliveryMode === "email" ? "Delivered" : "Log only"}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                <span>by {log.triggeredBy}{log.triggeredByRole ? ` (${log.triggeredByRole.replace("_", " ")})` : ""}</span>
                {log.sentTo && !isPdf && <span>→ {log.sentTo}</span>}
                <span>·</span>
                <span>{new Date(log.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ViewDialog({ student, open, onClose }: { student: Student | null; open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const canFinance = user?.role === "SUPER_ADMIN" || user?.role === "ACCOUNTANT";

  if (!student) return null;

  const profileFields = [
    ["Student ID", student.studentId],
    ["Full Name", `${student.firstName} ${student.lastName}`],
    ["Date of Birth", student.dateOfBirth ?? "-"],
    ["Gender", student.gender ?? "-"],
    ["Class", student.className ?? "-"],
    ["Status", student.status],
    ["Admission Date", student.admissionDate],
    ["Parent Name", student.parentName ?? "-"],
    ["Parent Phone", student.parentPhone ?? "-"],
    ["Parent Email", student.parentEmail ?? "-"],
  ];

  const downloadStatement = async () => {
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
      toast({ title: "Fee statement downloaded" });
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    } finally { setDownloading(false); }
  };

  const emailStatement = async () => {
    setEmailing(true);
    try {
      const token = localStorage.getItem("erp_token") ?? "";
      const res = await fetch(`/api/parent/fee-statement/${student.id}/email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error ?? "Email failed");
      toast({
        title: "Statement emailed",
        description: `Sent to ${(data as any).sentTo}`,
      });
    } catch (e: any) {
      toast({ title: "Email failed", description: e.message, variant: "destructive" });
    } finally { setEmailing(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <DialogTitle className="flex items-center gap-2">
              {student.firstName} {student.lastName}
              <Badge variant="outline" className="text-xs font-normal">{student.studentId}</Badge>
            </DialogTitle>
            {canFinance && (
              <div className="flex items-center gap-2">
                <button
                  onClick={downloadStatement}
                  disabled={downloading}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50"
                >
                  {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  Statement PDF
                </button>
                <button
                  onClick={emailStatement}
                  disabled={emailing || (!student.parentEmail)}
                  title={!student.parentEmail ? "No parent email on file" : "Email statement to parent"}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-green-200 bg-green-50 text-green-700 text-xs font-medium hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {emailing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                  Email to Parent
                </button>
              </div>
            )}
          </div>
        </DialogHeader>
        <Tabs defaultValue="profile">
          <TabsList className="mb-2">
            <TabsTrigger value="profile" className="gap-1.5 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5" /> Profile
            </TabsTrigger>
            <TabsTrigger value="ledger" className="gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" /> Fee Ledger
            </TabsTrigger>
            {canFinance && (
              <TabsTrigger value="statement-history" className="gap-1.5 text-xs">
                <Clock className="h-3.5 w-3.5" /> Statement History
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="profile">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm pt-2">
              {profileFields.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground uppercase tracking-wider">{label}</dt>
                  <dd className="font-medium mt-0.5">{value}</dd>
                </div>
              ))}
            </dl>
          </TabsContent>

          <TabsContent value="ledger">
            <FeeLedgerTab studentId={student.id} studentCode={student.studentId} />
          </TabsContent>

          {canFinance && (
            <TabsContent value="statement-history">
              <StatementHistoryTab studentId={student.id} />
            </TabsContent>
          )}
        </Tabs>
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
