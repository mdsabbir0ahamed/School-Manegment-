import { useState, useEffect, useRef } from "react";
import { useListStudents, useListClasses } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Download, QrCode, Search, Printer } from "lucide-react";
import QRCode from "qrcode";
import type { Student } from "@workspace/api-client-react";

function useQRCode(data: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) { setDataUrl(null); return; }
    QRCode.toDataURL(data, {
      width: 256,
      margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then(setDataUrl).catch(() => setDataUrl(null));
  }, [data]);
  return dataUrl;
}

function StudentQRCard({ student }: { student: Student }) {
  const qrData = JSON.stringify({
    id: student.id,
    studentId: student.studentId,
    name: `${student.firstName} ${student.lastName}`,
  });
  const qrUrl = useQRCode(qrData);

  const download = () => {
    if (!qrUrl) return;
    const a = document.createElement("a");
    a.href = qrUrl;
    a.download = `qr-${student.studentId}.png`;
    a.click();
  };

  return (
    <Card className="text-center">
      <CardContent className="pt-4 pb-4 flex flex-col items-center gap-2">
        {qrUrl ? (
          <img src={qrUrl} alt={`QR for ${student.firstName}`} className="w-32 h-32 rounded-md border" />
        ) : (
          <div className="w-32 h-32 rounded-md border bg-muted animate-pulse flex items-center justify-center">
            <QrCode className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-sm font-semibold leading-tight">{student.firstName} {student.lastName}</p>
          <p className="text-[11px] font-mono text-muted-foreground">{student.studentId}</p>
          {student.className && (
            <Badge variant="outline" className="text-[10px]">{student.className}</Badge>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-6 text-xs px-2 mt-1" onClick={download} disabled={!qrUrl}>
          <Download className="h-3 w-3 mr-1" /> PNG
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AttendanceQRPage() {
  const [classFilter, setClassFilter] = useState("");
  const [search, setSearch] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

  const { data: classesData } = useListClasses();
  const { data: studentsData, isLoading } = useListStudents({
    limit: 200, offset: 0,
    ...(classFilter ? { classId: parseInt(classFilter) } : {}),
    ...(search ? { search } : {}),
  });

  const students = studentsData?.students ?? [];

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <QrCode className="h-5 w-5" /> Attendance QR Codes
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Scan student QR codes for faster attendance marking
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handlePrint}>
          <Printer className="h-3.5 w-3.5 mr-1.5" /> Print All
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Class</Label>
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All classes</SelectItem>
                  {(classesData?.classes ?? []).map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}{c.section ? ` - ${c.section}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Search by name or ID…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground ml-auto">
              {students.length} student{students.length !== 1 ? "s" : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* QR Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : !students.length ? (
        <div className="flex flex-col items-center py-20 text-muted-foreground">
          <QrCode className="h-12 w-12 mb-3 opacity-20" />
          <p className="text-sm">No students found</p>
        </div>
      ) : (
        <div ref={printRef} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 print:grid-cols-4">
          {students.map(s => (
            <StudentQRCard key={s.id} student={s} />
          ))}
        </div>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print\\:grid-cols-4, .print\\:grid-cols-4 * { visibility: visible; }
          .print\\:grid-cols-4 { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
}
