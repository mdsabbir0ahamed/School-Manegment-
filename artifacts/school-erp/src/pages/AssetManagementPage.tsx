import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Pencil, Trash2, Wrench, Monitor, Laptop, Printer,
  Camera, Router, Server, Tablet, Wifi, Cpu, AlertTriangle,
  CheckCircle2, XCircle, Package,
} from "lucide-react";
import { format } from "date-fns";

const ASSET_TYPES = [
  "COMPUTER", "LAPTOP", "TABLET", "PRINTER", "PROJECTOR",
  "IP_CAMERA", "ROUTER", "SWITCH", "SERVER", "SMART_BOARD", "UPS", "OTHER",
];

const ASSET_STATUS = ["ONLINE", "OFFLINE", "MAINTENANCE", "RETIRED", "STORAGE"];

const TYPE_ICONS: Record<string, React.ElementType> = {
  COMPUTER: Monitor, LAPTOP: Laptop, TABLET: Tablet, PRINTER: Printer,
  IP_CAMERA: Camera, ROUTER: Router, SWITCH: Wifi, SERVER: Server,
  PROJECTOR: Cpu, SMART_BOARD: Monitor, UPS: Package, OTHER: Cpu,
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  ONLINE: { label: "Online", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  OFFLINE: { label: "Offline", color: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle },
  MAINTENANCE: { label: "Maintenance", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: Wrench },
  RETIRED: { label: "Retired", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: XCircle },
  STORAGE: { label: "Storage", color: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: Package },
};

interface Asset {
  id: number;
  name: string;
  type: string;
  ipAddress: string | null;
  macAddress: string | null;
  serialNumber: string | null;
  location: string | null;
  status: string;
  manufacturer: string | null;
  model: string | null;
  purchaseDate: string | null;
  warrantyExpiry: string | null;
  purchaseCost: string | null;
  notes: string | null;
  createdAt: string;
}

interface MaintenanceLog {
  id: number;
  assetId: number;
  description: string;
  performedBy: string;
  performedAt: string;
  cost: string | null;
  nextMaintenanceDate: string | null;
  notes: string | null;
}

interface AssetWithLogs extends Asset {
  maintenanceLogs: MaintenanceLog[];
}

const emptyAsset = {
  name: "", type: "COMPUTER", ipAddress: "", macAddress: "", serialNumber: "",
  location: "", status: "ONLINE", manufacturer: "", model: "",
  purchaseDate: "", warrantyExpiry: "", purchaseCost: "", notes: "",
};

export default function AssetManagementPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [assetDialog, setAssetDialog] = useState<{ open: boolean; asset: Asset | null }>({ open: false, asset: null });
  const [form, setForm] = useState(emptyAsset);
  const [maintenanceSheet, setMaintenanceSheet] = useState<AssetWithLogs | null>(null);
  const [maintenanceForm, setMaintenanceForm] = useState({ description: "", performedBy: "", cost: "", nextMaintenanceDate: "", notes: "" });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const { data, isLoading } = useQuery<{ assets: Asset[] }>({
    queryKey: ["assets"],
    queryFn: () => customFetch("/api/assets"),
  });

  const assetDetailQuery = useQuery<AssetWithLogs>({
    queryKey: ["asset", maintenanceSheet?.id],
    queryFn: () => customFetch(`/api/assets/${maintenanceSheet!.id}`),
    enabled: !!maintenanceSheet,
  });

  const saveMutation = useMutation({
    mutationFn: (payload: typeof emptyAsset & { id?: number }) => {
      if (payload.id) {
        return customFetch(`/api/assets/${payload.id}`, { method: "PUT", body: JSON.stringify(payload) });
      }
      return customFetch("/api/assets", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      setAssetDialog({ open: false, asset: null });
      toast({ title: assetDialog.asset ? "Asset updated" : "Asset added" });
    },
    onError: () => toast({ title: "Error saving asset", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customFetch(`/api/assets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast({ title: "Asset deleted" });
    },
    onError: () => toast({ title: "Error deleting asset", variant: "destructive" }),
  });

  const maintenanceMutation = useMutation({
    mutationFn: (payload: typeof maintenanceForm & { assetId: number }) =>
      customFetch(`/api/assets/${payload.assetId}/maintenance`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset", maintenanceSheet?.id] });
      setMaintenanceForm({ description: "", performedBy: "", cost: "", nextMaintenanceDate: "", notes: "" });
      toast({ title: "Maintenance log added" });
    },
    onError: () => toast({ title: "Error adding log", variant: "destructive" }),
  });

  const openAdd = () => { setForm(emptyAsset); setAssetDialog({ open: true, asset: null }); };
  const openEdit = (a: Asset) => {
    setForm({
      name: a.name, type: a.type, ipAddress: a.ipAddress ?? "", macAddress: a.macAddress ?? "",
      serialNumber: a.serialNumber ?? "", location: a.location ?? "", status: a.status,
      manufacturer: a.manufacturer ?? "", model: a.model ?? "",
      purchaseDate: a.purchaseDate ?? "", warrantyExpiry: a.warrantyExpiry ?? "",
      purchaseCost: a.purchaseCost ?? "", notes: a.notes ?? "",
    });
    setAssetDialog({ open: true, asset: a });
  };

  const handleSave = () => {
    const payload = { ...form, id: assetDialog.asset?.id };
    saveMutation.mutate(payload as any);
  };

  const assets = data?.assets ?? [];
  const filtered = assets.filter(a => {
    const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.location ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (a.ipAddress ?? "").includes(search);
    const matchStatus = statusFilter === "ALL" || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statusCounts = ASSET_STATUS.reduce((acc, s) => {
    acc[s] = assets.filter(a => a.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  const isWarrantyExpiring = (date: string | null) => {
    if (!date) return false;
    const exp = new Date(date);
    const now = new Date();
    const diff = (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Asset Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track school hardware, devices, and maintenance</p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add Asset
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {ASSET_STATUS.map(s => {
          const cfg = STATUS_CONFIG[s]!;
          const Icon = cfg.icon;
          return (
            <button key={s}
              onClick={() => setStatusFilter(prev => prev === s ? "ALL" : s)}
              className={`rounded-lg border p-3 text-left transition-all ${statusFilter === s ? cfg.color + " border-current" : "bg-card border-border hover:bg-muted/50"}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">{cfg.label}</span>
              </div>
              <p className="text-xl font-bold">{statusCounts[s] ?? 0}</p>
            </button>
          );
        })}
      </div>

      <div className="flex gap-3">
        <Input placeholder="Search by name, location, IP..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {ASSET_STATUS.map(s => <SelectItem key={s} value={s}>{STATUS_CONFIG[s]!.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>IP / MAC</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Warranty</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Loading assets...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No assets found</TableCell></TableRow>
            ) : filtered.map(asset => {
              const TypeIcon = TYPE_ICONS[asset.type] ?? Cpu;
              const statusCfg = STATUS_CONFIG[asset.status] ?? STATUS_CONFIG.OFFLINE!;
              const StatusIcon = statusCfg.icon;
              const warrantyWarning = isWarrantyExpiring(asset.warrantyExpiry);
              return (
                <TableRow key={asset.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                        <TypeIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{asset.name}</p>
                        {asset.manufacturer && <p className="text-xs text-muted-foreground">{asset.manufacturer} {asset.model}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{asset.type.replace("_", " ")}</TableCell>
                  <TableCell>
                    {asset.ipAddress && <p className="text-xs font-mono">{asset.ipAddress}</p>}
                    {asset.macAddress && <p className="text-xs font-mono text-muted-foreground">{asset.macAddress}</p>}
                    {!asset.ipAddress && !asset.macAddress && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">{asset.location ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={`gap-1 text-xs border ${statusCfg.color}`}>
                      <StatusIcon className="h-3 w-3" />
                      {statusCfg.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {asset.warrantyExpiry ? (
                      <div className="flex items-center gap-1">
                        {warrantyWarning && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                        <span className={`text-xs ${warrantyWarning ? "text-amber-500 font-medium" : "text-muted-foreground"}`}>
                          {format(new Date(asset.warrantyExpiry), "MMM yyyy")}
                        </span>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => { setMaintenanceSheet(asset as AssetWithLogs); }}>
                        <Wrench className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(asset)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => { if (confirm("Delete this asset?")) deleteMutation.mutate(asset.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={assetDialog.open} onOpenChange={open => setAssetDialog(p => ({ ...p, open }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{assetDialog.asset ? "Edit Asset" : "Add Hardware Asset"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Asset Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. PC-Lab-01" />
            </div>
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ASSET_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ASSET_STATUS.map(s => <SelectItem key={s} value={s}>{STATUS_CONFIG[s]!.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Computer Lab B" />
            </div>
            <div className="space-y-1.5">
              <Label>IP Address</Label>
              <Input value={form.ipAddress} onChange={e => setForm(p => ({ ...p, ipAddress: e.target.value }))} placeholder="192.168.1.100" />
            </div>
            <div className="space-y-1.5">
              <Label>MAC Address</Label>
              <Input value={form.macAddress} onChange={e => setForm(p => ({ ...p, macAddress: e.target.value }))} placeholder="AA:BB:CC:DD:EE:FF" />
            </div>
            <div className="space-y-1.5">
              <Label>Manufacturer</Label>
              <Input value={form.manufacturer} onChange={e => setForm(p => ({ ...p, manufacturer: e.target.value }))} placeholder="Dell, HP, Lenovo..." />
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Input value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} placeholder="Model number" />
            </div>
            <div className="space-y-1.5">
              <Label>Serial Number</Label>
              <Input value={form.serialNumber} onChange={e => setForm(p => ({ ...p, serialNumber: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Purchase Cost</Label>
              <Input value={form.purchaseCost} onChange={e => setForm(p => ({ ...p, purchaseCost: e.target.value }))} placeholder="0.00" type="number" />
            </div>
            <div className="space-y-1.5">
              <Label>Purchase Date</Label>
              <Input type="date" value={form.purchaseDate} onChange={e => setForm(p => ({ ...p, purchaseDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Warranty Expiry</Label>
              <Input type="date" value={form.warrantyExpiry} onChange={e => setForm(p => ({ ...p, warrantyExpiry: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetDialog({ open: false, asset: null })}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending || !form.name || !form.type}>
              {saveMutation.isPending ? "Saving..." : assetDialog.asset ? "Save Changes" : "Add Asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!maintenanceSheet} onOpenChange={open => { if (!open) setMaintenanceSheet(null); }}>
        <SheetContent className="w-[480px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Maintenance — {maintenanceSheet?.name}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Log New Maintenance</h3>
              <div className="space-y-2">
                <Label>Description *</Label>
                <Textarea value={maintenanceForm.description}
                  onChange={e => setMaintenanceForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="What was done?" rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Performed By *</Label>
                  <Input value={maintenanceForm.performedBy}
                    onChange={e => setMaintenanceForm(p => ({ ...p, performedBy: e.target.value }))}
                    placeholder="Technician name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Cost</Label>
                  <Input type="number" value={maintenanceForm.cost}
                    onChange={e => setMaintenanceForm(p => ({ ...p, cost: e.target.value }))}
                    placeholder="0.00" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Next Maintenance Date</Label>
                <Input type="date" value={maintenanceForm.nextMaintenanceDate}
                  onChange={e => setMaintenanceForm(p => ({ ...p, nextMaintenanceDate: e.target.value }))} />
              </div>
              <Button size="sm" className="w-full"
                disabled={maintenanceMutation.isPending || !maintenanceForm.description || !maintenanceForm.performedBy}
                onClick={() => maintenanceMutation.mutate({ ...maintenanceForm, assetId: maintenanceSheet!.id })}>
                {maintenanceMutation.isPending ? "Saving..." : "Log Maintenance"}
              </Button>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Maintenance History</h3>
              {assetDetailQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : (assetDetailQuery.data?.maintenanceLogs ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No maintenance logs yet.</p>
              ) : (assetDetailQuery.data?.maintenanceLogs ?? []).map(log => (
                <div key={log.id} className="rounded-lg border bg-muted/30 p-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{log.description}</p>
                    {log.cost && <span className="text-xs text-muted-foreground shrink-0">৳{parseFloat(log.cost).toLocaleString()}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">By {log.performedBy} · {format(new Date(log.performedAt), "dd MMM yyyy")}</p>
                  {log.nextMaintenanceDate && (
                    <p className="text-xs text-blue-400">Next: {format(new Date(log.nextMaintenanceDate), "dd MMM yyyy")}</p>
                  )}
                  {log.notes && <p className="text-xs text-muted-foreground italic">{log.notes}</p>}
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
