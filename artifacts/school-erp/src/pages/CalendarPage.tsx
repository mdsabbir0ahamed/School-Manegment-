import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
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
import { Plus, Trash2, ChevronLeft, ChevronRight, CalendarDays, Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, parseISO, isWithinInterval } from "date-fns";

interface CalendarEvent {
  id: number; title: string; description: string | null;
  startDate: string; endDate: string;
  type: "HOLIDAY" | "EXAM" | "EVENT" | "MEETING" | "SPORTS" | "OTHER";
  isAllDay: boolean; createdAt: string;
}

const EVENT_COLORS: Record<string, string> = {
  HOLIDAY: "bg-red-500",
  EXAM: "bg-purple-500",
  EVENT: "bg-blue-500",
  MEETING: "bg-yellow-500",
  SPORTS: "bg-green-500",
  OTHER: "bg-gray-500",
};

const EVENT_BADGE: Record<string, string> = {
  HOLIDAY: "bg-red-100 text-red-700",
  EXAM: "bg-purple-100 text-purple-700",
  EVENT: "bg-blue-100 text-blue-700",
  MEETING: "bg-yellow-100 text-yellow-700",
  SPORTS: "bg-green-100 text-green-700",
  OTHER: "bg-gray-100 text-gray-600",
};

const EVENT_TYPES = ["HOLIDAY", "EXAM", "EVENT", "MEETING", "SPORTS", "OTHER"];

function useCalendarEvents(year: number, month: number) {
  return useQuery<{ events: CalendarEvent[]; total: number }>({
    queryKey: ["calendar", year, month],
    queryFn: () => customFetch(`/api/calendar?year=${year}&month=${month}`),
  });
}

function EventDialog({ event, onClose, defaultDate }: { event?: CalendarEvent; onClose: () => void; defaultDate?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startDate, setStartDate] = useState(event?.startDate ?? defaultDate ?? "");
  const [endDate, setEndDate] = useState(event?.endDate ?? defaultDate ?? "");
  const [type, setType] = useState<"HOLIDAY" | "EXAM" | "EVENT" | "MEETING" | "SPORTS" | "OTHER">(event?.type ?? "EVENT");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (event) {
        await customFetch(`/api/calendar/${event.id}`, {
          method: "PUT",
          body: JSON.stringify({ title, description: description || null, startDate, endDate: endDate || startDate, type }),
        });
        toast({ title: "Event updated" });
      } else {
        await customFetch("/api/calendar", {
          method: "POST",
          body: JSON.stringify({ title, description: description || null, startDate, endDate: endDate || startDate, type }),
        });
        toast({ title: "Event added" });
      }
      qc.invalidateQueries({ queryKey: ["calendar"] });
      onClose();
    } catch (err: any) {
      toast({ title: err?.data?.message ?? "Failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{event ? "Edit Event" : "Add Calendar Event"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={v => setType(v as typeof type)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Start Date *</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End Date</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!title || !startDate || loading}>
              {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {event ? "Update" : "Add Event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CalendarPage() {
  const perms = usePermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [clickedDate, setClickedDate] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const { data } = useCalendarEvents(year, month);
  const events = data?.events ?? [];

  const prevMonth = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentDate),
    end: endOfMonth(currentDate),
  });
  const startDay = getDay(startOfMonth(currentDate));
  // Sunday=0 → shift; make Mon=0
  const offset = startDay === 0 ? 6 : startDay - 1;

  const getEventsForDay = (day: Date) =>
    events.filter(e => {
      try {
        const start = parseISO(e.startDate);
        const end = parseISO(e.endDate);
        return isWithinInterval(day, { start, end });
      } catch { return false; }
    });

  const selectedDayEvents = selectedDay ? getEventsForDay(selectedDay) : [];

  const deleteEvent = async (id: number) => {
    try {
      await customFetch(`/api/calendar/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      toast({ title: "Event deleted" });
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  };

  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Annual Calendar</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Holidays, exams, events and school schedule</p>
        </div>
        {perms.canManageClasses && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Event
          </Button>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {EVENT_TYPES.map(t => (
          <span key={t} className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium", EVENT_BADGE[t])}>
            <span className={cn("h-2 w-2 rounded-full", EVENT_COLORS[t])} />{t}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Calendar grid */}
        <div className="xl:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  {format(currentDate, "MMMM yyyy")}
                </CardTitle>
                <div className="flex gap-1">
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={prevMonth}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={nextMonth}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-px">
                {WEEKDAYS.map(d => (
                  <div key={d} className="py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase">
                    {d}
                  </div>
                ))}
                {Array.from({ length: offset }).map((_, i) => <div key={`empty-${i}`} />)}
                {daysInMonth.map(day => {
                  const dayEvents = getEventsForDay(day);
                  const isSelected = selectedDay && isSameDay(day, selectedDay);
                  const isToday = isSameDay(day, new Date());
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => {
                        setSelectedDay(isSameDay(day, selectedDay ?? new Date(-1)) ? null : day);
                        setClickedDate(format(day, "yyyy-MM-dd"));
                      }}
                      className={cn(
                        "relative min-h-[52px] p-1 text-left rounded-md transition-colors border border-transparent",
                        isSelected && "border-primary bg-primary/5",
                        isToday && !isSelected && "border-primary/30 bg-primary/[0.02]",
                        !isSelected && !isToday && "hover:bg-muted/40",
                      )}
                    >
                      <span className={cn(
                        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium",
                        isToday && "bg-primary text-white",
                        !isToday && "text-foreground",
                      )}>
                        {format(day, "d")}
                      </span>
                      <div className="mt-0.5 space-y-0.5">
                        {dayEvents.slice(0, 2).map(e => (
                          <div key={e.id} className={cn("h-1.5 w-full rounded-full", EVENT_COLORS[e.type])} />
                        ))}
                        {dayEvents.length > 2 && (
                          <span className="text-[9px] text-muted-foreground">+{dayEvents.length - 2}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {selectedDay ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  {format(selectedDay, "EEEE, dd MMMM")}
                  {perms.canManageClasses && (
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                      onClick={() => { setShowAdd(true); }}>
                      <Plus className="h-3 w-3 mr-1" />Add
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedDayEvents.length ? (
                  <p className="text-xs text-muted-foreground">No events on this day</p>
                ) : (
                  <div className="space-y-2">
                    {selectedDayEvents.map(e => (
                      <div key={e.id} className="rounded-md border p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{e.title}</p>
                            <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5", EVENT_BADGE[e.type])}>
                              {e.type}
                            </span>
                            {e.description && <p className="text-xs text-muted-foreground mt-1">{e.description}</p>}
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {e.startDate}{e.endDate !== e.startDate ? ` → ${e.endDate}` : ""}
                            </p>
                          </div>
                          {perms.canManageClasses && (
                            <div className="flex gap-1 shrink-0">
                              <button onClick={() => setEditEvent(e)} className="text-muted-foreground hover:text-foreground">
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button onClick={() => deleteEvent(e.id)} className="text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground text-sm">
                <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>Click a date to see events</p>
              </CardContent>
            </Card>
          )}

          {/* Upcoming events */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                All Events This Month ({events.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 max-h-64 overflow-y-auto">
              {!events.length && <p className="text-xs text-muted-foreground">No events this month</p>}
              {events.map(e => (
                <div key={e.id} className="flex items-start gap-2 py-1.5 border-b last:border-0">
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", EVENT_COLORS[e.type])} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{e.title}</p>
                    <p className="text-[10px] text-muted-foreground">{e.startDate}</p>
                  </div>
                  {perms.canManageClasses && (
                    <button onClick={() => deleteEvent(e.id)} className="text-muted-foreground/40 hover:text-destructive shrink-0">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {showAdd && (
        <EventDialog
          defaultDate={clickedDate ?? format(currentDate, "yyyy-MM-dd")}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editEvent && <EventDialog event={editEvent} onClose={() => setEditEvent(null)} />}
    </div>
  );
}
