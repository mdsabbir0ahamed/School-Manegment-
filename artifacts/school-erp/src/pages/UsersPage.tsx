import { useState } from "react";
import {
  useListUsers, useCreateUser, useUpdateUser, useDeleteUser,
  useListStudents, getListUsersQueryKey, customFetch,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { User } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Plus, Pencil, Trash2, Loader2, Link2, Unlink, Users, Search,
  GraduationCap, UserCheck,
} from "lucide-react";

const ROLES = ["SUPER_ADMIN", "TEACHER", "ACCOUNTANT", "PARENT", "STUDENT"] as const;
const roleColors: Record<string, string> = {
  SUPER_ADMIN: "bg-purple-100 text-purple-700",
  TEACHER:     "bg-blue-100 text-blue-700",
  ACCOUNTANT:  "bg-green-100 text-green-700",
  PARENT:      "bg-yellow-100 text-yellow-700",
  STUDENT:     "bg-gray-100 text-gray-600",
};

interface ParentLink {
  linkId: number; relationship: string; linkedAt: string;
  id: number; studentId: string; firstName: string; lastName: string;
  className?: string | null; status: string;
}

interface LinkedStudent {
  id: number; studentId: string; firstName: string; lastName: string;
  status: string; className?: string | null;
}

const RELATIONSHIPS = ["PARENT", "GUARDIAN", "GRANDPARENT", "SIBLING", "OTHER"] as const;

// ── Linked Student Panel (STUDENT role — one-to-one) ────────────────────────

function LinkedStudentPanel({ studentUser }: { studentUser: User }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [linkOpen, setLinkOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ student: LinkedStudent | null }>({
    queryKey: ["user-linked-student", studentUser.id],
    queryFn: () => customFetch(`/api/users/${studentUser.id}/linked-student`),
  });

  const { data: studentsData } = useListStudents({ limit: 300, offset: 0 });

  const alreadyLinkedId = data?.student?.id;
  const availableStudents = (studentsData?.students ?? []).filter(s =>
    s.id !== alreadyLinkedId &&
    (`${s.firstName} ${s.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
     s.studentId.toLowerCase().includes(search.toLowerCase()))
  );

  const handleLink = async () => {
    if (!selectedStudentId) return;
    setSaving(true);
    try {
      await customFetch(`/api/users/${studentUser.id}/linked-student`, {
        method: "PUT",
        body: JSON.stringify({ studentId: parseInt(selectedStudentId) }),
      });
      toast({ title: "Student record linked successfully" });
      refetch();
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      setLinkOpen(false);
      setSelectedStudentId("");
      setSearch("");
    } catch (err: any) {
      toast({ title: err?.data?.error ?? err?.data?.message ?? "Failed to link student", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm(`Remove the student record link for ${studentUser.firstName} ${studentUser.lastName}? They will lose access to their portal data.`)) return;
    setUnlinking(true);
    try {
      await customFetch(`/api/users/${studentUser.id}/linked-student`, {
        method: "PUT",
        body: JSON.stringify({ studentId: null }),
      });
      toast({ title: "Student record unlinked" });
      refetch();
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    } catch {
      toast({ title: "Failed to unlink", variant: "destructive" });
    } finally {
      setUnlinking(false);
    }
  };

  const linked = data?.student;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <GraduationCap className="h-3.5 w-3.5" /> Linked Student Record
        </p>
        {!linked && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLinkOpen(true)}>
            <Link2 className="h-3 w-3 mr-1" /> Link Record
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-14" />
      ) : !linked ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
          <GraduationCap className="h-6 w-6 mx-auto mb-1.5 opacity-30" />
          <p>No student record linked</p>
          <p className="mt-0.5 opacity-70">This user won't see data in their Student Portal until linked.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
              {linked.firstName[0]}{linked.lastName[0]}
            </div>
            <div>
              <p className="text-xs font-medium">{linked.firstName} {linked.lastName}</p>
              <p className="text-[10px] text-muted-foreground font-mono">
                {linked.studentId} · {linked.className ?? "No class"} ·{" "}
                <span className={cn(
                  "font-sans",
                  linked.status === "ACTIVE" ? "text-green-600" : "text-gray-400"
                )}>{linked.status}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLinkOpen(true)}>
              <Pencil className="h-3 w-3 mr-1" /> Change
            </Button>
            <button
              onClick={handleUnlink}
              disabled={unlinking}
              className="p-1 text-muted-foreground hover:text-destructive rounded disabled:opacity-50"
              title="Remove link"
            >
              {unlinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Linking a student record lets <strong>{studentUser.firstName} {studentUser.lastName}</strong> view their attendance, exam results, and timetable in the Student Portal.
      </p>

      {/* Link / Change dialog */}
      <Dialog open={linkOpen} onOpenChange={open => { setLinkOpen(open); if (!open) { setSearch(""); setSelectedStudentId(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{linked ? "Change Linked Student" : "Link Student Record"}</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Choose the student record for <strong>{studentUser.firstName} {studentUser.lastName}</strong>.
            </p>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Search Students</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Name or student ID…"
                  className="pl-8 text-xs h-8"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Select Student Record *</Label>
              <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Choose student…" />
                </SelectTrigger>
                <SelectContent>
                  {availableStudents.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {search ? "No matches found" : "No students available"}
                    </div>
                  ) : availableStudents.slice(0, 50).map(s => (
                    <SelectItem key={s.id} value={String(s.id)} className="text-xs">
                      {s.firstName} {s.lastName} — {s.studentId}
                      {s.className ? ` (${s.className})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleLink} disabled={!selectedStudentId || saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> {linked ? "Change Link" : "Link Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Linked Students Panel (PARENT role — one-to-many) ───────────────────────

function LinkedStudentsPanel({ parentUser }: { parentUser: User }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [selectedRel, setSelectedRel] = useState<string>("PARENT");
  const [addLoading, setAddLoading] = useState(false);
  const [removeLoadingId, setRemoveLoadingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { data: linksData, isLoading: linksLoading, refetch } = useQuery<{ links: ParentLink[] }>({
    queryKey: ["parent-students", parentUser.id],
    queryFn: () => customFetch(`/api/parent-students?parentUserId=${parentUser.id}`),
  });

  const { data: studentsData } = useListStudents({ limit: 300, offset: 0 });

  const linkedIds = new Set(linksData?.links.map(l => l.id) ?? []);
  const availableStudents = (studentsData?.students ?? []).filter(s =>
    !linkedIds.has(s.id) &&
    (`${s.firstName} ${s.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
     s.studentId.toLowerCase().includes(search.toLowerCase()))
  );

  const handleAdd = async () => {
    if (!selectedStudentId) return;
    setAddLoading(true);
    try {
      await customFetch("/api/parent-students", {
        method: "POST",
        body: JSON.stringify({
          parentUserId: parentUser.id,
          studentId: parseInt(selectedStudentId),
          relationship: selectedRel,
        }),
      });
      toast({ title: "Student linked successfully" });
      refetch();
      setAddOpen(false);
      setSelectedStudentId("");
    } catch (err: any) {
      toast({ title: err?.data?.error ?? "Failed to link student", variant: "destructive" });
    } finally {
      setAddLoading(false);
    }
  };

  const handleRemove = async (linkId: number, name: string) => {
    if (!confirm(`Remove link to ${name}?`)) return;
    setRemoveLoadingId(linkId);
    try {
      await customFetch(`/api/parent-students/${linkId}`, { method: "DELETE" });
      toast({ title: "Link removed" });
      refetch();
    } catch {
      toast({ title: "Failed to remove link", variant: "destructive" });
    } finally {
      setRemoveLoadingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5" /> Linked Students
        </p>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddOpen(true)}>
          <Plus className="h-3 w-3 mr-1" /> Link Student
        </Button>
      </div>

      {linksLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : !linksData?.links.length ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
          <GraduationCap className="h-6 w-6 mx-auto mb-1.5 opacity-30" />
          No students linked yet
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y">
          {linksData.links.map(link => (
            <div key={link.linkId} className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                  {link.firstName[0]}{link.lastName[0]}
                </div>
                <div>
                  <p className="text-xs font-medium">{link.firstName} {link.lastName}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{link.studentId} · {link.className ?? "No class"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                  {link.relationship}
                </Badge>
                <button
                  onClick={() => handleRemove(link.linkId, `${link.firstName} ${link.lastName}`)}
                  disabled={removeLoadingId === link.linkId}
                  className="p-1 text-muted-foreground hover:text-destructive rounded disabled:opacity-50"
                  title="Remove link"
                >
                  {removeLoadingId === link.linkId
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Unlink className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add student dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Link a Student</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Linking a student allows <strong>{parentUser.firstName} {parentUser.lastName}</strong> to see their data in the Parent Portal.
            </p>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Search Students</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Name or student ID…"
                  className="pl-8 text-xs h-8"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Select Student *</Label>
              <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Choose student…" />
                </SelectTrigger>
                <SelectContent>
                  {availableStudents.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {search ? "No matches" : "All students already linked"}
                    </div>
                  ) : availableStudents.slice(0, 50).map(s => (
                    <SelectItem key={s.id} value={String(s.id)} className="text-xs">
                      {s.firstName} {s.lastName} — {s.studentId}
                      {s.className ? ` (${s.className})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Relationship</Label>
              <Select value={selectedRel} onValueChange={setSelectedRel}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIPS.map(r => (
                    <SelectItem key={r} value={r} className="text-xs capitalize">{r.charAt(0) + r.slice(1).toLowerCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={!selectedStudentId || addLoading}>
              {addLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> Link Student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── User Form Dialog ────────────────────────────────────────────────────────

const userSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Min 6 chars").optional().or(z.literal("")),
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  phoneNumber: z.string().optional(),
  role: z.enum(ROLES),
  isActive: z.boolean().optional(),
});
type UserForm = z.infer<typeof userSchema>;

function UserFormDialog({ user, open, onClose }: { user?: User; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const [currentRole, setCurrentRole] = useState<string>(user?.role ?? "TEACHER");

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<UserForm>({
    resolver: zodResolver(userSchema),
    defaultValues: user ? {
      email: user.email, firstName: user.firstName, lastName: user.lastName,
      phoneNumber: user.phoneNumber ?? "", role: user.role as any, isActive: user.isActive,
    } : { role: "TEACHER", isActive: true },
  });

  const watchedRole = watch("role");

  const onSubmit = (data: UserForm) => {
    if (user) {
      const { password, email, ...rest } = data;
      updateMutation.mutate({ id: user.id, data: rest }, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); toast({ title: "User updated" }); onClose(); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      });
    } else {
      if (!data.password) { toast({ title: "Password required", variant: "destructive" }); return; }
      createMutation.mutate(data as any, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); toast({ title: "User created" }); onClose(); },
        onError: () => toast({ title: "Failed (email may be taken)", variant: "destructive" }),
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const showLinkedStudents = user && (watchedRole === "PARENT" || currentRole === "PARENT");
  const showLinkedStudentRecord = user && (watchedRole === "STUDENT" || currentRole === "STUDENT");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {user ? "Edit User" : "Create User"}
            {(watchedRole === "PARENT" || currentRole === "PARENT") && (
              <Badge variant="outline" className="text-xs font-normal">Parent Account</Badge>
            )}
            {(watchedRole === "STUDENT" || currentRole === "STUDENT") && (
              <Badge variant="outline" className="text-xs font-normal bg-indigo-50 text-indigo-600 border-indigo-200">Student Account</Badge>
            )}
          </DialogTitle>
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
            </div>
          </div>
          <div className="space-y-1">
            <Label>Email *</Label>
            <Input type="email" {...register("email")} disabled={!!user} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          {!user && (
            <div className="space-y-1">
              <Label>Password *</Label>
              <Input type="password" {...register("password")} />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Role *</Label>
              <Select onValueChange={v => { setValue("role", v as any); setCurrentRole(v); }} defaultValue={user?.role ?? "TEACHER"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input {...register("phoneNumber")} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {user ? "Save" : "Create User"}
            </Button>
          </DialogFooter>
        </form>

        {/* Linked Students section — only for existing PARENT users */}
        {showLinkedStudents && (
          <div className="border-t pt-4 mt-2">
            <LinkedStudentsPanel parentUser={user!} />
          </div>
        )}

        {/* Linked Student Record section — only for existing STUDENT users */}
        {showLinkedStudentRecord && (
          <div className="border-t pt-4 mt-2">
            <LinkedStudentPanel studentUser={user!} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Users Page ──────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | undefined>();

  const qc = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteUser();

  const { data, isLoading } = useListUsers({ role: roleFilter as any || undefined, limit: 50 });

  const handleDelete = (u: User) => {
    if (!confirm(`Delete ${u.firstName} ${u.lastName}?`)) return;
    deleteMutation.mutate({ id: u.id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); toast({ title: "User deleted" }); },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    });
  };

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Staff & Users</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{data?.total ?? 0} users</p>
        </div>
        <Button onClick={() => { setEditUser(undefined); setFormOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Create User
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={roleFilter} onValueChange={v => setRoleFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All roles" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ROLES.map(r => <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        {roleFilter === "PARENT" && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Link2 className="h-3.5 w-3.5" /> Click edit on any parent to manage their linked students
          </span>
        )}
        {roleFilter === "STUDENT" && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <GraduationCap className="h-3.5 w-3.5" /> Click the cap icon to link a student record to their portal
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Name", "Email", "Role", "Phone", "Status", "Actions"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 6 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                ))}</tr>
              ))
            ) : data?.users.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No users found</td></tr>
            ) : data?.users.map(u => (
              <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                      {u.firstName[0]}{u.lastName[0]}
                    </div>
                    <span className="font-medium">{u.firstName} {u.lastName}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", roleColors[u.role] ?? "bg-gray-100 text-gray-600")}>
                    {u.role.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{u.phoneNumber ?? "-"}</td>
                <td className="px-4 py-3">
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", u.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditUser(u); setFormOpen(true); }} className="p-1 text-muted-foreground hover:text-foreground rounded" title={u.role === "PARENT" ? "Edit & manage linked students" : u.role === "STUDENT" ? "Edit & link student record" : "Edit user"}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {u.role === "PARENT" && (
                      <button onClick={() => { setEditUser(u); setFormOpen(true); }} className="p-1 text-muted-foreground hover:text-primary rounded" title="Manage linked students">
                        <Users className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {u.role === "STUDENT" && (
                      <button onClick={() => { setEditUser(u); setFormOpen(true); }} className="p-1 text-muted-foreground hover:text-indigo-600 rounded" title="Link student record">
                        <UserCheck className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => handleDelete(u)} className="p-1 text-muted-foreground hover:text-destructive rounded">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UserFormDialog user={editUser} open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
