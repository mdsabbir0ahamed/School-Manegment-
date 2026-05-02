import { useState } from "react";
import { useListClasses, customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Clock, BookOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const DAYS = ["SATURDAY", "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;
type Day = typeof DAYS[number];

const DAY_LABELS: Record<Day, string> = {
  SATURDAY: "Sat", SUNDAY: "Sun", MONDAY: "Mon", TUESDAY: "Tue",
  WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri",
};

const DAY_COLORS: Record<Day, string> = {
  SATURDAY: "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800/50",
  SUNDAY: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50",
  MONDAY: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/50",
  TUESDAY: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50",
  WEDNESDAY: "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800/50",
  THURSDAY: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800/50",
  FRIDAY: "bg-pink-50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-800/50",
};

interface Slot {
  id: number; classId: number; className: string;
  subjectId: number; subjectName: string; subjectCode: string;
  teacherId: number | null; teacherName: string | null;
  dayOfWeek: Day; startTime: string; endTime: string; room: string | null;
}

interface Subject { id: number; name: string; code: string; classId: number | null; }

function useSubjects(classId?: number) {
  return useQuery<{ subjects: Subject[] }>({
    queryKey: ["subjects", classId],
    queryFn: () => customFetch(`/api/subjects${classId ? `?classId=${classId}` : ""}`),
    enabled: true,
  });
}

function useTimetable(classId?: number) {
  return useQuery<{ slots: Slot[]; total: number }>({
    queryKey: ["timetable", classId],
    queryFn: () => customFetch(`/api/timetable${classId ? `?classId=${classId}` : ""}`),
    enabled: !!classId,
  });
}

function AddSlotDialog({ classId, onClose }: { classId: number; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: subjectsData } = useSubjects(classId);
  const [day, setDay] = useState<Day>("SATURDAY");
  const [subjectId, setSubjectId] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [room, setRoom] = useState("");

  const mutation = useMutation({
    mutationFn: (body: object) => customFetch("/api/timetable", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timetable", classId] });
      toast({ title: "Slot added" });
      onClose();
    },
    onError: () => toast({ title: "Failed to add slot", variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectId) return;
    mutation.mutate({ classId, subjectId: parseInt(subjectId), dayOfWeek: day, startTime, endTime, room: room || null });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Schedule Slot</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Day</Label>
            <Select value={day} onValueChange={v => setDay(v as Day)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Subject</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
              <SelectContent>
                {(subjectsData?.subjects ?? []).map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Start Time</Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End Time</Label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Room (optional)</Label>
            <Input value={room} onChange={e => setRoom(e.target.value)} placeholder="e.g. Room 101" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!subjectId || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Add Slot
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TimetablePage() {
  const { data: classesData } = useListClasses();
  const perms = usePermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedClass, setSelectedClass] = useState<number | undefined>();
  const [showAdd, setShowAdd] = useState(false);
  const { data: timetableData, isLoading } = useTimetable(selectedClass);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customFetch(`/api/timetable/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["timetable", selectedClass] }); toast({ title: "Slot removed" }); },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const slotsByDay = DAYS.reduce((acc, day) => {
    acc[day] = (timetableData?.slots ?? []).filter(s => s.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
    return acc;
  }, {} as Record<Day, Slot[]>);

  const filledDays = DAYS.filter(d => slotsByDay[d].length > 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Timetable / Schedule</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Class schedule per grade</p>
        </div>
        {perms.canManageClasses && selectedClass && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Slot
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <Label className="text-xs whitespace-nowrap">Select Class</Label>
            <Select value={selectedClass ? String(selectedClass) : ""} onValueChange={v => setSelectedClass(parseInt(v))}>
              <SelectTrigger className="max-w-xs">
                <SelectValue placeholder="Choose a class to view schedule" />
              </SelectTrigger>
              <SelectContent>
                {(classesData?.classes ?? []).map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}{c.section ? ` - ${c.section}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!selectedClass && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <BookOpen className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">Select a class to view its timetable</p>
        </div>
      )}

      {selectedClass && isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {DAYS.slice(0, 6).map(d => (
            <div key={d} className="h-32 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {selectedClass && !isLoading && timetableData && (
        <>
          {filledDays.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
              <Clock className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No schedule slots yet for this class</p>
              {perms.canManageClasses && (
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowAdd(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add First Slot
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {DAYS.map(day => {
                const slots = slotsByDay[day];
                if (!slots.length) return null;
                return (
                  <Card key={day} className={cn("border", DAY_COLORS[day])}>
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm font-semibold">{day}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3 space-y-2">
                      {slots.map(slot => (
                        <div key={slot.id} className="flex items-start justify-between gap-2 rounded-md border bg-card px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{slot.subjectName}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] font-mono text-muted-foreground">{slot.startTime} – {slot.endTime}</span>
                              {slot.room && <Badge variant="outline" className="text-[10px] px-1 py-0">{slot.room}</Badge>}
                            </div>
                            {slot.teacherName && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">{slot.teacherName}</p>
                            )}
                          </div>
                          {perms.canManageClasses && (
                            <button
                              onClick={() => deleteMutation.mutate(slot.id)}
                              className="shrink-0 text-muted-foreground hover:text-destructive transition-colors mt-0.5"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground text-right">
            {timetableData.total} slot{timetableData.total !== 1 ? "s" : ""} scheduled
          </p>
        </>
      )}

      {showAdd && selectedClass && (
        <AddSlotDialog classId={selectedClass} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}
