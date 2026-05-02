import { useState } from "react";
import { useListStudents, customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Plus, Trash2, FileText, Download, ExternalLink, Loader2, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Document {
  id: number; studentId: number; type: string; title: string;
  fileUrl: string; fileSize: number | null; mimeType: string | null;
  uploadedAt: string;
}

const DOC_TYPES = [
  "PROFILE_PHOTO", "ADMIT_CARD", "BIRTH_CERTIFICATE",
  "NATIONAL_ID", "TRANSFER_CERTIFICATE", "OTHER",
];

const DOC_TYPE_LABELS: Record<string, string> = {
  PROFILE_PHOTO: "Profile Photo",
  ADMIT_CARD: "Admit Card",
  BIRTH_CERTIFICATE: "Birth Certificate",
  NATIONAL_ID: "National ID",
  TRANSFER_CERTIFICATE: "Transfer Certificate",
  OTHER: "Other",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  PROFILE_PHOTO: "bg-pink-100 text-pink-700",
  ADMIT_CARD: "bg-blue-100 text-blue-700",
  BIRTH_CERTIFICATE: "bg-green-100 text-green-700",
  NATIONAL_ID: "bg-orange-100 text-orange-700",
  TRANSFER_CERTIFICATE: "bg-purple-100 text-purple-700",
  OTHER: "bg-gray-100 text-gray-600",
};

function useDocuments(studentId?: number) {
  return useQuery<{ documents: Document[]; total: number }>({
    queryKey: ["student-documents", studentId],
    queryFn: () => customFetch(`/api/students/${studentId}/documents`),
    enabled: !!studentId,
  });
}

function UploadDialog({ studentId, onClose }: { studentId: number; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [type, setType] = useState("OTHER");
  const [title, setTitle] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !fileUrl.trim()) return;
    setLoading(true);
    try {
      await customFetch(`/api/students/${studentId}/documents`, {
        method: "POST",
        body: JSON.stringify({ type, title: title.trim(), fileUrl: fileUrl.trim() }),
      });
      toast({ title: "Document added" });
      qc.invalidateQueries({ queryKey: ["student-documents", studentId] });
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
        <DialogHeader><DialogTitle>Add Document</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Document Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Title / Description *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Birth Certificate 2020" required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">File URL / Link *</Label>
            <Input
              value={fileUrl}
              onChange={e => setFileUrl(e.target.value)}
              placeholder="https://drive.google.com/... or cloud URL"
              type="url"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Upload the file to Google Drive, Dropbox, or similar and paste the link here.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!title || !fileUrl || loading}>
              {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Add Document
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function StudentDocumentsPage() {
  const perms = usePermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: studentsData } = useListStudents({ limit: 200, offset: 0 });
  const [selectedStudent, setSelectedStudent] = useState<number | undefined>();
  const [showUpload, setShowUpload] = useState(false);
  const { data, isLoading } = useDocuments(selectedStudent);

  const deleteDoc = async (docId: number) => {
    try {
      await customFetch(`/api/students/${selectedStudent}/documents/${docId}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["student-documents", selectedStudent] });
      toast({ title: "Document removed" });
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  };

  const grouped = DOC_TYPES.reduce((acc, t) => {
    acc[t] = (data?.documents ?? []).filter(d => d.type === t);
    return acc;
  }, {} as Record<string, Document[]>);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Student Documents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Profile photos, admit cards, certificates and more</p>
        </div>
        {perms.canManageStudents && selectedStudent && (
          <Button size="sm" onClick={() => setShowUpload(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Document
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <Label className="text-xs whitespace-nowrap">Select Student</Label>
            <Select value={selectedStudent ? String(selectedStudent) : ""} onValueChange={v => setSelectedStudent(parseInt(v))}>
              <SelectTrigger className="max-w-xs">
                <SelectValue placeholder="Choose a student" />
              </SelectTrigger>
              <SelectContent>
                {(studentsData?.students ?? []).map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.firstName} {s.lastName} — {s.studentId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!selectedStudent && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <FolderOpen className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">Select a student to view their documents</p>
        </div>
      )}

      {selectedStudent && isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      )}

      {selectedStudent && !isLoading && data && (
        <>
          {data.total === 0 ? (
            <div className="flex flex-col items-center py-16 border-2 border-dashed rounded-lg text-muted-foreground">
              <FileText className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No documents uploaded yet for this student</p>
              {perms.canManageStudents && (
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowUpload(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add First Document
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {DOC_TYPES.filter(t => grouped[t].length > 0).map(type => (
                <div key={type}>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <span className={cn("inline-block rounded px-2 py-0.5 text-xs", DOC_TYPE_COLORS[type])}>
                      {DOC_TYPE_LABELS[type]}
                    </span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {grouped[type].map(doc => (
                      <Card key={doc.id} className="group relative">
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{doc.title}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {format(new Date(doc.uploadedAt), "dd MMM yyyy")}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-2 pt-2 border-t">
                            <a
                              href={doc.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" /> Open
                            </a>
                            {perms.canManageStudents && (
                              <button onClick={() => deleteDoc(doc.id)} className="text-muted-foreground/40 hover:text-destructive transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground text-right">{data.total} document{data.total !== 1 ? "s" : ""} total</p>
        </>
      )}

      {showUpload && selectedStudent && (
        <UploadDialog studentId={selectedStudent} onClose={() => setShowUpload(false)} />
      )}
    </div>
  );
}
