import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, CalendarCheck, Banknote, AlertCircle, CheckCircle2, Clock, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LinkedStudent {
  linkId: number; relationship: string; linkedAt: string;
  id: number; studentId: string; firstName: string; lastName: string;
  dateOfBirth?: string | null; gender?: string | null;
  classId?: number | null; className?: string | null;
  status: string; admissionDate: string;
  parentName?: string | null; parentPhone?: string | null; parentEmail?: string | null;
}

interface AttendanceRecord { status: string; }
interface Invoice {
  id: number; invoiceNumber: string; totalAmount: number; paidAmount: number;
  dueDate: string; status: string; month: string | null; feeTypeName?: string;
}

function useLinkedStudents(parentUserId?: number) {
  return useQuery<{ links: LinkedStudent[]; total: number }>({
    queryKey: ["parent-students", parentUserId],
    queryFn: () => customFetch(`/api/parent-students?parentUserId=${parentUserId}`),
    enabled: !!parentUserId,
  });
}

function useStudentAttendance(studentId: number) {
  return useQuery<{ records: AttendanceRecord[] }>({
    queryKey: ["attendance-student", studentId],
    queryFn: () => customFetch(`/api/attendance?studentId=${studentId}&limit=200`),
  });
}

function useStudentInvoices(studentId: number) {
  return useQuery<{ invoices: Invoice[] }>({
    queryKey: ["invoices-student", studentId],
    queryFn: () => customFetch(`/api/invoices?studentId=${studentId}&limit=20`),
  });
}

const INVOICE_STATUS: Record<string, { label: string; class: string; icon: React.ComponentType<any> }> = {
  PAID:      { label: "Paid",      class: "bg-green-100 text-green-700",  icon: CheckCircle2 },
  PENDING:   { label: "Pending",   class: "bg-yellow-100 text-yellow-700", icon: Clock },
  OVERDUE:   { label: "Overdue",   class: "bg-red-100 text-red-700",      icon: AlertCircle },
  CANCELLED: { label: "Cancelled", class: "bg-gray-100 text-gray-600",    icon: Clock },
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  PARENT: "Parent",
  GUARDIAN: "Guardian",
  SIBLING: "Sibling",
  GRANDPARENT: "Grandparent",
  OTHER: "Other",
};

function StudentCard({ student }: { student: LinkedStudent }) {
  const { data: attData } = useStudentAttendance(student.id);
  const { data: invData } = useStudentInvoices(student.id);

  const att = attData?.records ?? [];
  const present = att.filter(r => r.status === "PRESENT").length;
  const absent  = att.filter(r => r.status === "ABSENT").length;
  const late    = att.filter(r => r.status === "LATE").length;
  const pct     = att.length > 0 ? Math.round((present / att.length) * 100) : null;

  const invoices = invData?.invoices ?? [];
  const pending  = invoices.filter(i => i.status === "PENDING" || i.status === "OVERDUE");
  const totalPaid = invoices.reduce((s, i) => s + i.paidAmount, 0);
  const totalDue  = pending.reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0);

  return (
    <div className="space-y-4">
      {/* Student info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" /> Student Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary shrink-0">
              {student.firstName[0]}{student.lastName[0]}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base">{student.firstName} {student.lastName}</h3>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{student.studentId}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge variant="outline" className="text-xs">{student.status}</Badge>
                {student.className && (
                  <Badge variant="outline" className="text-xs">{student.className}</Badge>
                )}
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

      {/* Attendance */}
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

      {/* Invoices */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Banknote className="h-4 w-4" /> Fee & Invoices
            </CardTitle>
            {invData && invoices.length > 0 && (
              <div className="text-right text-xs">
                <p className="text-muted-foreground">Total paid: <span className="font-semibold text-green-600">৳{totalPaid.toLocaleString()}</span></p>
                {totalDue > 0 && <p className="text-muted-foreground">Outstanding: <span className="font-semibold text-red-600">৳{totalDue.toLocaleString()}</span></p>}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!invData ? (
            <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          ) : !invoices.length ? (
            <p className="text-sm text-muted-foreground">No invoices found</p>
          ) : (
            <div className="space-y-2">
              {pending.length > 0 && (
                <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700 flex items-center gap-1.5 mb-3">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {pending.length} invoice{pending.length > 1 ? "s" : ""} require{pending.length === 1 ? "s" : ""} payment — total due: ৳{totalDue.toLocaleString()}
                </div>
              )}
              {pending.length === 0 && invoices.length > 0 && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 flex items-center gap-1.5 mb-3">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> All fees are cleared
                </div>
              )}
              {invoices.slice(0, 12).map(inv => {
                const s = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS.PENDING!;
                const Icon = s.icon;
                const due = inv.totalAmount - inv.paidAmount;
                return (
                  <div key={inv.id} className="flex items-center justify-between rounded-md border px-3 py-2.5 gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-mono font-medium">{inv.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">{inv.feeTypeName ?? "Fee"}{inv.month ? ` · ${inv.month}` : ""} · Due {inv.dueDate}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold">৳{inv.totalAmount.toLocaleString()}</p>
                      {due > 0 && inv.status !== "CANCELLED" && (
                        <p className="text-xs text-red-500">৳{due.toLocaleString()} remaining</p>
                      )}
                      <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium rounded px-1.5 py-0.5 mt-0.5", s.class)}>
                        <Icon className="h-2.5 w-2.5" />{s.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ParentPortalPage() {
  const { user } = useAuth();
  const { data, isLoading } = useLinkedStudents(user?.id);
  const links = data?.links ?? [];

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
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
