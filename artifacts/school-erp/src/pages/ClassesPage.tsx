import { useState } from "react";
import {
  useListClasses, useCreateClass, useUpdateClass, useListUsers,
  getListClassesQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Class } from "@workspace/api-client-react";
import { usePermissions, useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, GraduationCap, Users, Loader2, Lock, Megaphone, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Announcement Types ───────────────────────────────────────────────────────
interface ClassAnnouncement {
  id: number; classId: number; authorName: string; title: string; body: string; createdAt: string;
}

function authedFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("erp_token") ?? "";
  return fetch(path, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options?.headers ?? {}) } }).then(r => r.json() as Promise<T>);
}

// ── Announcements Dialog ────────────────────────────────────────────────────
function AnnouncementsDialog({ cls, open, onClose }: { cls: Class; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const { data, isLoading } = useQuery<{ announcements: ClassAnnouncement[] }>({
    queryKey: ["class-announcements", cls.id],
    queryFn: () => authedFetch(`/api/class-announcements?classId=${cls.id}`),
    enabled: open,
  });

  const postMut = useMutation({
    mutationFn: () => authedFetch("/api/class-announcements", {
      method: "POST",
      body: JSON.stringify({ classId: cls.id, title: title.trim(), body: body.trim() }),
    }),
    onSuccess: () => {
      toast({ title: "Announcement posted", description: "Students and parents can now see it." });
      setTitle(""); setBody("");
      qc.invalidateQueries({ queryKey: ["class-announcements", cls.id] });
    },
    onError: () => toast({ title: "Failed to post", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/class-announcements/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` },
    }),
    onSuccess: () => {
      toast({ title: "Announcement deleted" });
      qc.invalidateQueries({ queryKey: ["class-announcements", cls.id] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-indigo-500" /> Announcements — {cls.name}
            {cls.section && <Badge variant="outline" className="text-xs">{cls.section}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {/* Post form */}
        <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Announcement</p>
          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Exam schedule change" className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Message</Label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Write your announcement here…" rows={3} className="text-sm resize-none" />
          </div>
          <Button
            size="sm" className="w-full"
            disabled={!title.trim() || !body.trim() || postMut.isPending}
            onClick={() => postMut.mutate()}
          >
            {postMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Megaphone className="h-3.5 w-3.5 mr-1.5" />}
            Post Announcement
          </Button>
        </div>

        {/* Existing announcements */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Posted Announcements</p>
          {isLoading ? (
            <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : !data?.announcements.length ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No announcements yet. Post one above.</p>
          ) : (
            <div className="space-y-2">
              {data.announcements.map(a => (
                <div key={a.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{a.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {a.authorName} · {new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1.5 whitespace-pre-wrap leading-relaxed">{a.body}</p>
                    </div>
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5"
                      onClick={() => deleteMut.mutate(a.id)}
                      disabled={deleteMut.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Homework Types ───────────────────────────────────────────────────────────
interface HomeworkItem {
  id: number; classId: number; subjectId: number | null; subjectName: string | null;
  authorName: string; title: string; description: string; dueDate: string | null;
  status: string; createdAt: string;
}

// ── Homework Dialog ──────────────────────────────────────────────────────────
function HomeworkDialog({ cls, open, onClose }: { cls: Class; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle]       = useState("");
  const [description, setDesc]  = useState("");
  const [dueDate, setDueDate]   = useState("");
  const [subjectId, setSubjectId] = useState<string>("");

  // Fetch subjects for this class
  const token = localStorage.getItem("erp_token") ?? "";
  const { data: subjectsData } = useQuery<{ subjects: { id: number; name: string; code: string }[] }>({
    queryKey: ["subjects-for-class", cls.id],
    queryFn: () => fetch(`/api/subjects?classId=${cls.id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: open,
  });

  const { data, isLoading } = useQuery<{ homework: HomeworkItem[] }>({
    queryKey: ["homework", cls.id],
    queryFn: () => authedFetch(`/api/homework?classId=${cls.id}`),
    enabled: open,
  });

  const postMut = useMutation({
    mutationFn: () => authedFetch<{ homework: HomeworkItem }>("/api/homework", {
      method: "POST",
      body: JSON.stringify({
        classId: cls.id, title: title.trim(), description: description.trim(),
        dueDate: dueDate || null,
        subjectId: subjectId && subjectId !== "none" ? parseInt(subjectId, 10) : null,
      }),
    }),
    onSuccess: () => {
      toast({ title: "Homework posted", description: "Students and parents have been notified." });
      setTitle(""); setDesc(""); setDueDate(""); setSubjectId("");
      qc.invalidateQueries({ queryKey: ["homework", cls.id] });
    },
    onError: () => toast({ title: "Failed to post", variant: "destructive" }),
  });

  const closeMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => authedFetch(`/api/homework/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
    onSuccess: () => {
      toast({ title: "Homework updated" });
      qc.invalidateQueries({ queryKey: ["homework", cls.id] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/homework/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    }),
    onSuccess: () => {
      toast({ title: "Homework deleted" });
      qc.invalidateQueries({ queryKey: ["homework", cls.id] });
    },
  });

  const subjects = subjectsData?.subjects ?? [];

  function dueBadge(dueDate: string | null) {
    if (!dueDate) return null;
    const today = new Date().toISOString().split("T")[0]!;
    const diff = Math.ceil((new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000);
    if (diff < 0)   return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">Overdue</span>;
    if (diff === 0)  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">Due today</span>;
    if (diff <= 3)   return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Due in {diff}d</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">Due in {diff}d</span>;
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-amber-500" /> Homework — {cls.name}
            {cls.section && <Badge variant="outline" className="text-xs">{cls.section}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {/* Post form */}
        <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assign New Homework</p>

          {subjects.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Subject (optional)</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger className="text-sm h-8"><SelectValue placeholder="Select subject…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No subject —</SelectItem>
                  {subjects.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Chapter 5 exercises" className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Instructions</Label>
            <Textarea value={description} onChange={e => setDesc(e.target.value)} placeholder="Describe the assignment…" rows={3} className="text-sm resize-none" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Due Date (optional)</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="text-sm" />
          </div>
          <Button size="sm" className="w-full"
            disabled={!title.trim() || !description.trim() || postMut.isPending}
            onClick={() => postMut.mutate()}>
            {postMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Megaphone className="h-3.5 w-3.5 mr-1.5" />}
            Assign Homework
          </Button>
        </div>

        {/* Existing homework */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Posted Homework</p>
          {isLoading ? (
            <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : !data?.homework.length ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No homework yet. Assign one above.</p>
          ) : (
            <div className="space-y-2">
              {data.homework.map(h => (
                <div key={h.id} className={`rounded-lg border border-border bg-card p-3 ${h.status === "CLOSED" ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-medium text-sm">{h.title}</p>
                        {h.status === "CLOSED" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">Closed</span>}
                        {dueBadge(h.dueDate)}
                      </div>
                      {h.subjectName && <p className="text-[10px] text-primary font-medium mt-0.5">{h.subjectName}</p>}
                      <p className="text-[10px] text-muted-foreground mt-0.5">{h.authorName} · {new Date(h.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{h.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        className="text-[11px] text-muted-foreground hover:text-foreground border rounded px-1.5 py-0.5 transition-colors"
                        onClick={() => closeMut.mutate({ id: h.id, status: h.status === "ACTIVE" ? "CLOSED" : "ACTIVE" })}
                        title={h.status === "ACTIVE" ? "Close assignment" : "Reopen assignment"}
                      >
                        {h.status === "ACTIVE" ? "Close" : "Reopen"}
                      </button>
                      <button className="text-muted-foreground hover:text-destructive transition-colors" onClick={() => deleteMut.mutate(h.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const classSchema = z.object({
  name: z.string().min(1, "Required"),
  section: z.string().optional(),
  gradeLevel: z.number().min(1).max(20),
  teacherId: z.number().optional(),
});
type ClassForm = z.infer<typeof classSchema>;

function ClassFormDialog({ cls, open, onClose }: { cls?: Class; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createMutation = useCreateClass();
  const updateMutation = useUpdateClass();
  const { data: usersData } = useListUsers({ role: "TEACHER" as any, limit: 50 });

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<ClassForm>({
    resolver: zodResolver(classSchema),
    defaultValues: cls ? {
      name: cls.name, section: cls.section ?? "", gradeLevel: cls.gradeLevel,
      teacherId: cls.teacherId ?? undefined,
    } : { gradeLevel: 1 },
  });

  const onSubmit = (data: ClassForm) => {
    if (cls) {
      updateMutation.mutate({ id: cls.id, data }, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListClassesQueryKey() }); toast({ title: "Class updated" }); onClose(); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      });
    } else {
      createMutation.mutate({ data }, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListClassesQueryKey() }); toast({ title: "Class created" }); onClose(); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{cls ? "Edit Class" : "Create Class"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Class Name *</Label>
              <Input {...register("name")} placeholder="e.g. Grade 5" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Section</Label>
              <Input {...register("section")} placeholder="e.g. A, B" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Grade Level *</Label>
            <Input type="number" min="1" max="20" {...register("gradeLevel", { valueAsNumber: true })} />
            {errors.gradeLevel && <p className="text-xs text-destructive">{errors.gradeLevel.message}</p>}
          </div>
          <div className="space-y-1">
            <Label>Class Teacher</Label>
            <Select onValueChange={v => setValue("teacherId", parseInt(v))} defaultValue={cls?.teacherId?.toString()}>
              <SelectTrigger><SelectValue placeholder="Select teacher" /></SelectTrigger>
              <SelectContent>
                {usersData?.users.map(u => (
                  <SelectItem key={u.id} value={u.id.toString()}>{u.firstName} {u.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {cls ? "Save" : "Create Class"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ClassesPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editClass, setEditClass] = useState<Class | undefined>();
  const [announceClass, setAnnounceClass] = useState<Class | null>(null);
  const [homeworkClass, setHomeworkClass] = useState<Class | null>(null);
  const { data, isLoading } = useListClasses();
  const perms = usePermissions();
  const { user } = useAuth();

  const isTeacher = user?.role === "TEACHER";
  const myClasses = isTeacher
    ? data?.classes.filter(c => c.teacherId === user?.id) ?? []
    : data?.classes ?? [];

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Classes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isTeacher
              ? `${myClasses.length} assigned class${myClasses.length !== 1 ? "es" : ""}`
              : `${data?.classes.length ?? 0} classes configured`}
          </p>
        </div>
        {perms.canManageClasses && (
          <Button onClick={() => { setEditClass(undefined); setFormOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Create Class
          </Button>
        )}
      </div>

      {isTeacher && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          You can view your assigned classes. Contact an administrator to create or modify classes.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4">
              <Skeleton className="h-16 w-full" />
            </div>
          ))
        ) : (isTeacher ? myClasses : data?.classes ?? []).length === 0 ? (
          <div className="col-span-3 flex items-center justify-center h-40 rounded-lg border border-dashed border-border text-muted-foreground text-sm">
            {isTeacher ? "No classes assigned to you yet." : "No classes yet. Create your first class."}
          </div>
        ) : (
          (isTeacher ? myClasses : data?.classes ?? []).map(cls => (
            <div key={cls.id} className={cn("relative rounded-lg border border-border bg-card p-4 transition-colors", perms.canManageClasses && "hover:border-primary/40")}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <GraduationCap className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{cls.name}</h3>
                    {cls.section && <p className="text-xs text-muted-foreground">Section {cls.section}</p>}
                  </div>
                </div>
                {perms.canManageClasses && (
                  <button
                    onClick={() => { setEditClass(cls); setFormOpen(true); }}
                    className="text-muted-foreground hover:text-foreground p-1 rounded"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />{cls.studentCount} students
                </span>
                <span>Grade {cls.gradeLevel}</span>
                {cls.teacherName && <span>{cls.teacherName}</span>}
              </div>
              <div className="mt-3 pt-3 border-t border-border flex gap-3">
                <button
                  onClick={() => setAnnounceClass(cls)}
                  className="flex items-center gap-1.5 text-[11px] text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
                >
                  <Megaphone className="h-3 w-3" /> Announcements
                </button>
                <button
                  onClick={() => setHomeworkClass(cls)}
                  className="flex items-center gap-1.5 text-[11px] text-amber-600 hover:text-amber-700 font-medium transition-colors"
                >
                  <Megaphone className="h-3 w-3" /> Homework
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {perms.canManageClasses && (
        <ClassFormDialog cls={editClass} open={formOpen} onClose={() => setFormOpen(false)} />
      )}

      {announceClass && (
        <AnnouncementsDialog cls={announceClass} open={!!announceClass} onClose={() => setAnnounceClass(null)} />
      )}

      {homeworkClass && (
        <HomeworkDialog cls={homeworkClass} open={!!homeworkClass} onClose={() => setHomeworkClass(null)} />
      )}
    </div>
  );
}
