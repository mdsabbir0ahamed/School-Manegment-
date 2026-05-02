import { useState } from "react";
import {
  useListClasses, useCreateClass, useUpdateClass, useListUsers,
  getListClassesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Class } from "@workspace/api-client-react";
import { usePermissions, useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, GraduationCap, Users, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

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
            </div>
          ))
        )}
      </div>

      {perms.canManageClasses && (
        <ClassFormDialog cls={editClass} open={formOpen} onClose={() => setFormOpen(false)} />
      )}
    </div>
  );
}
