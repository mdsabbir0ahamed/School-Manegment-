import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  BookOpen, Plus, Search, Trash2, Loader2, BookMarked, RotateCcw,
  Users, AlertTriangle, CheckCircle2, Clock, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function authedFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem("erp_token");
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts?.headers ?? {}) },
  }).then(r => r.json() as Promise<T>);
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Book {
  id: number; title: string; author: string; isbn: string | null; subject: string | null;
  publisher: string | null; publishedYear: number | null; totalCopies: number; availableCopies: number;
  location: string | null; description: string | null; activeLoans: number;
}
interface Loan {
  id: number; bookId: number; studentId: number; studentFirstName: string; studentLastName: string; studentCode: string;
  issuedByName: string; borrowDate: string; dueDate: string; returnDate: string | null;
  status: "ACTIVE" | "RETURNED" | "OVERDUE"; notes: string | null;
  bookTitle?: string; bookAuthor?: string;
}
interface Student { id: number; firstName: string; lastName: string; studentId: string; className: string | null; }

// ── Add Book Dialog ───────────────────────────────────────────────────────────
function AddBookDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(""); const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState(""); const [subject, setSubject] = useState("");
  const [publisher, setPublisher] = useState(""); const [year, setYear] = useState("");
  const [copies, setCopies] = useState("1"); const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  function reset() { setTitle(""); setAuthor(""); setIsbn(""); setSubject(""); setPublisher(""); setYear(""); setCopies("1"); setLocation(""); setDescription(""); }

  const mut = useMutation({
    mutationFn: () => authedFetch("/api/library/books", { method: "POST", body: JSON.stringify({ title, author, isbn: isbn || null, subject: subject || null, publisher: publisher || null, publishedYear: year ? parseInt(year, 10) : null, totalCopies: parseInt(copies, 10) || 1, location: location || null, description: description || null }) }),
    onSuccess: () => { toast({ title: "Book added to library" }); reset(); qc.invalidateQueries({ queryKey: ["library-books"] }); onClose(); },
    onError: () => toast({ title: "Failed to add book", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" /> Add New Book</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Title *</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Book title" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Author *</Label>
              <Input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ISBN</Label>
              <Input value={isbn} onChange={e => setIsbn(e.target.value)} placeholder="978-..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Subject / Category</Label>
              <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Mathematics" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Publisher</Label>
              <Input value={publisher} onChange={e => setPublisher(e.target.value)} placeholder="Publisher name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Published Year</Label>
              <Input type="number" value={year} onChange={e => setYear(e.target.value)} placeholder="e.g. 2022" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Total Copies</Label>
              <Input type="number" min="1" value={copies} onChange={e => setCopies(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Shelf / Location</Label>
              <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Shelf A-3" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="resize-none text-sm" placeholder="Brief description (optional)" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!title.trim() || !author.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />} Add Book
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Issue Book Dialog ─────────────────────────────────────────────────────────
function IssueBookDialog({ book, open, onClose }: { book: Book; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [studentId, setStudentId] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 14);
    return d.toISOString().split("T")[0]!;
  });
  const [notes, setNotes] = useState("");

  const { data: studentsData } = useQuery<{ students: Student[] }>({
    queryKey: ["students-list-for-issue"],
    queryFn: () => authedFetch("/api/students?limit=500"),
    enabled: open,
  });

  const mut = useMutation({
    mutationFn: () => authedFetch(`/api/library/books/${book.id}/issue`, { method: "POST", body: JSON.stringify({ studentId: parseInt(studentId, 10), dueDate, notes: notes || null }) }),
    onSuccess: () => {
      toast({ title: "Book issued successfully" });
      setStudentId(""); setNotes("");
      qc.invalidateQueries({ queryKey: ["library-books"] });
      qc.invalidateQueries({ queryKey: ["library-loans"] });
      onClose();
    },
    onError: () => toast({ title: "Failed to issue book", variant: "destructive" }),
  });

  const students = studentsData?.students ?? [];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="h-4 w-4 text-primary" /> Issue Book
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">"{book.title}" by {book.author}</p>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Student *</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger><SelectValue placeholder="Select student…" /></SelectTrigger>
              <SelectContent className="max-h-60">
                {students.map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.firstName} {s.lastName} ({s.studentId}){s.className ? ` — ${s.className}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Due Date *</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!studentId || !dueDate || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <BookMarked className="h-3.5 w-3.5 mr-1.5" />} Issue Book
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Book Card ────────────────────────────────────────────────────────────────
function BookCard({ book, canManage, onIssue, onDelete }: { book: Book; canManage: boolean; onIssue: (b: Book) => void; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { data: loansData, refetch } = useQuery<{ loans: Loan[] }>({
    queryKey: ["book-loans", book.id],
    queryFn: () => authedFetch(`/api/library/books/${book.id}/loans`),
    enabled: expanded,
  });
  const qc = useQueryClient();
  const { toast } = useToast();

  const returnMut = useMutation({
    mutationFn: (loanId: number) => authedFetch(`/api/library/loans/${loanId}/return`, { method: "PATCH" }),
    onSuccess: () => { toast({ title: "Book returned" }); refetch(); qc.invalidateQueries({ queryKey: ["library-books"] }); qc.invalidateQueries({ queryKey: ["library-loans"] }); },
  });

  const availPct = book.totalCopies > 0 ? (book.availableCopies / book.totalCopies) * 100 : 0;
  const statusColor = book.availableCopies === 0 ? "text-red-600 bg-red-50" : book.availableCopies < book.totalCopies ? "text-amber-600 bg-amber-50" : "text-green-600 bg-green-50";

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="h-10 w-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
              <BookOpen className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm leading-tight truncate">{book.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{book.author}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {book.subject && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{book.subject}</Badge>}
                {book.isbn && <span className="text-[10px] text-muted-foreground font-mono">{book.isbn}</span>}
                {book.publishedYear && <span className="text-[10px] text-muted-foreground">{book.publishedYear}</span>}
                {book.location && <span className="text-[10px] text-muted-foreground">📍 {book.location}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor}`}>
              {book.availableCopies}/{book.totalCopies} available
            </span>
            <div className="flex gap-1">
              {canManage && book.availableCopies > 0 && (
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onIssue(book)}>
                  <BookMarked className="h-2.5 w-2.5 mr-1" /> Issue
                </Button>
              )}
              {canManage && (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => onDelete(book.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Availability bar */}
        <div className="mt-3 h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${availPct}%`, backgroundColor: book.availableCopies === 0 ? "#ef4444" : book.availableCopies < book.totalCopies ? "#f59e0b" : "#22c55e" }} />
        </div>

        {/* Expand for active loans */}
        {book.activeLoans > 0 && (
          <button className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded(!expanded)}>
            <Users className="h-3 w-3" />
            {book.activeLoans} active loan{book.activeLoans !== 1 ? "s" : ""}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}

        {expanded && (
          <div className="mt-3 space-y-2 border-t pt-3">
            {loansData?.loans.filter(l => l.status !== "RETURNED").map(loan => {
              const diff = Math.ceil((new Date(loan.dueDate).getTime() - new Date().getTime()) / 86400000);
              const isOverdue = diff < 0;
              return (
                <div key={loan.id} className={`flex items-center justify-between gap-2 rounded-lg p-2 text-xs ${isOverdue ? "bg-red-50 border border-red-200" : "bg-muted/50"}`}>
                  <div>
                    <p className="font-medium">{loan.studentFirstName} {loan.studentLastName} <span className="font-mono text-muted-foreground">({loan.studentCode})</span></p>
                    <p className={`text-[10px] mt-0.5 ${isOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                      {isOverdue ? `Overdue by ${Math.abs(diff)}d` : `Due in ${diff}d`} · {new Date(loan.dueDate).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  {canManage && (
                    <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 shrink-0" disabled={returnMut.isPending} onClick={() => returnMut.mutate(loan.id)}>
                      <RotateCcw className="h-2.5 w-2.5 mr-1" /> Return
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Loans Management Tab ──────────────────────────────────────────────────────
function LoansTab({ canManage }: { canManage: boolean }) {
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ loans: Loan[] }>({
    queryKey: ["library-loans", statusFilter],
    queryFn: () => authedFetch(`/api/library/loans?status=${statusFilter}`),
  });

  const returnMut = useMutation({
    mutationFn: (id: number) => authedFetch(`/api/library/loans/${id}/return`, { method: "PATCH" }),
    onSuccess: () => { toast({ title: "Book returned successfully" }); qc.invalidateQueries({ queryKey: ["library-loans"] }); qc.invalidateQueries({ queryKey: ["library-books"] }); },
    onError: () => toast({ title: "Failed to return book", variant: "destructive" }),
  });

  const loans = data?.loans ?? [];

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {[["ACTIVE", "Active"], ["OVERDUE", "Overdue"], ["RETURNED", "Returned"]].map(([v, l]) => (
          <button key={v} onClick={() => setStatusFilter(v!)}
            className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${statusFilter === v ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {l}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : !loans.length ? (
        <div className="text-center py-10 text-sm text-muted-foreground">No {statusFilter.toLowerCase()} loans</div>
      ) : (
        <div className="space-y-2">
          {loans.map(loan => {
            const diff = Math.ceil((new Date(loan.dueDate).getTime() - new Date().getTime()) / 86400000);
            const isOverdue = loan.status === "OVERDUE";
            return (
              <div key={loan.id} className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${isOverdue ? "border-red-200 bg-red-50" : "bg-card"}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isOverdue && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />}
                    {loan.status === "RETURNED" && <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />}
                    {loan.status === "ACTIVE" && <Clock className="h-3 w-3 text-blue-500 shrink-0" />}
                    <p className="font-medium text-sm truncate">{loan.bookTitle}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{loan.studentFirstName} {loan.studentLastName} <span className="font-mono">({loan.studentCode})</span></p>
                  <p className={`text-[10px] mt-0.5 ${isOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                    Due: {new Date(loan.dueDate).toLocaleDateString("en-GB")}
                    {loan.status === "ACTIVE" && ` · In ${diff}d`}
                    {isOverdue && ` · Overdue by ${Math.abs(diff)}d`}
                    {loan.returnDate && ` · Returned: ${new Date(loan.returnDate).toLocaleDateString("en-GB")}`}
                  </p>
                </div>
                {canManage && loan.status !== "RETURNED" && (
                  <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs" disabled={returnMut.isPending} onClick={() => returnMut.mutate(loan.id)}>
                    <RotateCcw className="h-3 w-3 mr-1" /> Return
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Library Page ─────────────────────────────────────────────────────────
export default function LibraryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = user?.role === "SUPER_ADMIN" || user?.role === "TEACHER" || user?.role === "ACCOUNTANT";
  const canDelete = user?.role === "SUPER_ADMIN";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [issueBook, setIssueBook] = useState<Book | null>(null);
  const [activeTab, setActiveTab] = useState<"books" | "loans">("books");

  const { data, isLoading } = useQuery<{ books: Book[] }>({
    queryKey: ["library-books", debouncedSearch],
    queryFn: () => authedFetch(`/api/library/books${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ""}`),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(`${BASE}/api/library/books/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` } }),
    onSuccess: () => { toast({ title: "Book deleted" }); qc.invalidateQueries({ queryKey: ["library-books"] }); },
    onError: () => toast({ title: "Failed to delete book", variant: "destructive" }),
  });

  function handleSearchChange(v: string) {
    setSearch(v);
    clearTimeout((handleSearchChange as { _t?: ReturnType<typeof setTimeout> })._t);
    (handleSearchChange as { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(() => setDebouncedSearch(v), 350);
  }

  const books = data?.books ?? [];
  const totalBooks = books.reduce((s, b) => s + b.totalCopies, 0);
  const totalAvail = books.reduce((s, b) => s + b.availableCopies, 0);
  const totalIssued = books.reduce((s, b) => s + b.activeLoans, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" /> Library
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage books, issue and return records</p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> Add Book
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Books", value: totalBooks, color: "text-primary" },
          { label: "Available", value: totalAvail, color: "text-green-600" },
          { label: "Issued", value: totalIssued, color: "text-amber-600" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="py-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit">
        {[["books", "Book Catalog"], ["loans", "Loan Records"]] .map(([v, l]) => (
          <button key={v} onClick={() => setActiveTab(v as "books" | "loans")}
            className={cn("text-sm font-medium px-4 py-1.5 rounded-md transition-all", activeTab === v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {l}
          </button>
        ))}
      </div>

      {activeTab === "books" && (
        <>
          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => handleSearchChange(e.target.value)} placeholder="Search title, author, ISBN, subject…" className="pl-9 text-sm" />
          </div>

          {/* Book list */}
          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
            </div>
          ) : !books.length ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
              <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-25" />
              <p className="font-medium">{debouncedSearch ? "No books matched your search" : "No books in the library yet"}</p>
              {canManage && !debouncedSearch && <p className="text-xs mt-1 opacity-70">Click "Add Book" to get started</p>}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {books.map(book => (
                <BookCard key={book.id} book={book} canManage={canManage} onIssue={b => setIssueBook(b)} onDelete={id => canDelete && deleteMut.mutate(id)} />
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === "loans" && <LoansTab canManage={canManage} />}

      {/* Dialogs */}
      <AddBookDialog open={addOpen} onClose={() => setAddOpen(false)} />
      {issueBook && <IssueBookDialog book={issueBook} open={!!issueBook} onClose={() => setIssueBook(null)} />}
    </div>
  );
}
