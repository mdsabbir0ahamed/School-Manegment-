import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bell,
  BellOff,
  CheckCheck,
  Trash2,
  Send,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

interface Notification {
  id: number;
  title: string;
  message: string;
  type: "INFO" | "SUCCESS" | "WARNING" | "DANGER";
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

interface ClassItem {
  id: number;
  name: string;
  section: string | null;
}

const TYPE_STYLES: Record<string, { dot: string; badge: string }> = {
  INFO: { dot: "bg-blue-500", badge: "bg-blue-100 text-blue-700" },
  SUCCESS: { dot: "bg-green-500", badge: "bg-green-100 text-green-700" },
  WARNING: { dot: "bg-yellow-500", badge: "bg-yellow-100 text-yellow-700" },
  DANGER: { dot: "bg-red-500", badge: "bg-red-100 text-red-700" },
};

const NOTIFICATION_TYPES = [
  { value: "INFO", label: "Info" },
  { value: "SUCCESS", label: "Success" },
  { value: "WARNING", label: "Warning" },
  { value: "DANGER", label: "Danger" },
];

function BulkNotificationDialog({ classes }: { classes: ClassItem[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<string>("INFO");
  const [classId, setClassId] = useState<string>("all");

  const bulkSend = useMutation({
    mutationFn: () =>
      customFetch("/api/notifications/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          message,
          type,
          classId: classId === "all" ? "all" : parseInt(classId, 10),
        }),
      }),
    onSuccess: (data: { sent: number; message: string }) => {
      toast({
        title: "Notification sent",
        description: data.message,
      });
      setOpen(false);
      setTitle("");
      setMessage("");
      setType("INFO");
      setClassId("all");
    },
    onError: () => {
      toast({
        title: "Failed to send",
        description: "Could not send notifications. Please try again.",
        variant: "destructive",
      });
    },
  });

  const canSend = title.trim().length > 0 && message.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Send className="h-3.5 w-3.5" />
          Send to Parents
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Bulk Parent Notification
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-class">Send to</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger id="bulk-class">
                <SelectValue placeholder="Select audience" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Parents</SelectItem>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                    {c.section ? ` – ${c.section}` : ""} (parents only)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="bulk-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTIFICATION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-title">Title</Label>
            <Input
              id="bulk-title"
              placeholder="e.g. Parent-Teacher Meeting"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-message">Message</Label>
            <Textarea
              id="bulk-message"
              placeholder="Write your message to parents…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => bulkSend.mutate()}
            disabled={!canSend || bulkSend.isPending}
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            {bulkSend.isPending ? "Sending…" : "Send Notification"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function NotificationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{
    notifications: Notification[];
    total: number;
    unreadCount: number;
  }>({
    queryKey: ["notifications"],
    queryFn: () => customFetch("/api/notifications?limit=100"),
    refetchInterval: 30_000,
  });

  const { data: classesData } = useQuery<{ classes: ClassItem[] }>({
    queryKey: ["classes-list"],
    queryFn: () => customFetch("/api/classes"),
  });

  const markRead = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/notifications/${id}/read`, { method: "PUT" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAll = useMutation({
    mutationFn: () =>
      customFetch("/api/notifications/read-all", { method: "PUT" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "All marked as read" });
    },
  });

  const deleteN = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/notifications/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const notifications = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;
  const classes = classesData?.classes ?? [];

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bell className="h-5 w-5" /> Notifications
            {unread > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                {unread}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            System alerts and updates
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {unread > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markAll.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1.5" /> Mark all read
            </Button>
          )}
          <BulkNotificationDialog classes={classes} />
        </div>
      </div>

      {/* Bulk send summary card */}
      <Card className="border-dashed bg-muted/30">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 shrink-0">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">Send to Parents</p>
            <p className="text-xs text-muted-foreground">
              Click "Send to Parents" to broadcast a message to all parents or
              specific class parents instantly.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : !notifications.length ? (
            <div className="flex flex-col items-center py-20 text-muted-foreground">
              <BellOff className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => {
                const styles = TYPE_STYLES[n.type] ?? TYPE_STYLES.INFO;
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors",
                      !n.isRead && "bg-primary/[0.03]",
                    )}
                  >
                    <div className="mt-1.5 shrink-0">
                      <span
                        className={cn(
                          "inline-block h-2 w-2 rounded-full",
                          n.isRead ? "bg-muted-foreground/30" : styles.dot,
                        )}
                      />
                    </div>
                    <div
                      className="flex-1 min-w-0"
                      onClick={() => !n.isRead && markRead.mutate(n.id)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-start gap-2">
                        <p
                          className={cn(
                            "text-sm leading-snug",
                            !n.isRead && "font-semibold",
                          )}
                        >
                          {n.title}
                        </p>
                        <span
                          className={cn(
                            "shrink-0 text-[10px] font-medium rounded px-1.5 py-0.5 mt-0.5",
                            styles.badge,
                          )}
                        >
                          {n.type}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {n.message}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteN.mutate(n.id)}
                      className="shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors mt-0.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
