import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Building2, Globe } from "lucide-react";
import { format } from "date-fns";

const PLANS = ["FREE", "BASIC", "PRO", "ENTERPRISE"];
const PLAN_COLORS: Record<string, string> = {
  FREE: "bg-gray-500/20 text-gray-400",
  BASIC: "bg-blue-500/20 text-blue-400",
  PRO: "bg-purple-500/20 text-purple-400",
  ENTERPRISE: "bg-amber-500/20 text-amber-400",
};

interface Tenant {
  id: number;
  name: string;
  subdomain: string;
  primaryColor: string;
  primaryColorDark: string;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  plan: string;
  isActive: boolean;
  createdAt: string;
}

const emptyForm = {
  name: "", subdomain: "", primaryColor: "#4F46E5", primaryColorDark: "#3730A3",
  logoUrl: "", contactEmail: "", contactPhone: "", address: "", plan: "FREE", isActive: true,
};

export default function TenantsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; tenant: Tenant | null }>({ open: false, tenant: null });
  const [form, setForm] = useState(emptyForm);

  const { data, isLoading } = useQuery<{ tenants: Tenant[] }>({
    queryKey: ["tenants"],
    queryFn: () => customFetch("/api/tenants"),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: typeof emptyForm & { id?: number }) => {
      if (payload.id) {
        return customFetch(`/api/tenants/${payload.id}`, { method: "PUT", body: JSON.stringify(payload) });
      }
      return customFetch("/api/tenants", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenants"] });
      setDialog({ open: false, tenant: null });
      toast({ title: dialog.tenant ? "Tenant updated" : "Tenant created" });
    },
    onError: () => toast({ title: "Error saving tenant", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customFetch(`/api/tenants/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenants"] });
      toast({ title: "Tenant deleted" });
    },
    onError: () => toast({ title: "Cannot delete this tenant", variant: "destructive" }),
  });

  const openAdd = () => {
    setForm(emptyForm);
    setDialog({ open: true, tenant: null });
  };

  const openEdit = (t: Tenant) => {
    setForm({
      name: t.name, subdomain: t.subdomain, primaryColor: t.primaryColor,
      primaryColorDark: t.primaryColorDark, logoUrl: t.logoUrl ?? "",
      contactEmail: t.contactEmail ?? "", contactPhone: t.contactPhone ?? "",
      address: t.address ?? "", plan: t.plan, isActive: t.isActive,
    });
    setDialog({ open: true, tenant: t });
  };

  const tenants = data?.tenants ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenants</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage schools registered on this ERP platform</p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add Tenant
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Tenants", value: tenants.length, color: "text-foreground" },
          { label: "Active", value: tenants.filter(t => t.isActive).length, color: "text-emerald-500" },
          { label: "Pro / Enterprise", value: tenants.filter(t => t.plan === "PRO" || t.plan === "ENTERPRISE").length, color: "text-purple-500" },
          { label: "Inactive", value: tenants.filter(t => !t.isActive).length, color: "text-red-500" },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>School</TableHead>
              <TableHead>Subdomain</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : tenants.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No tenants found</TableCell></TableRow>
            ) : tenants.map(t => (
              <TableRow key={t.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
                      style={{ backgroundColor: t.primaryColor + "33" }}>
                      <Building2 className="h-4 w-4" style={{ color: t.primaryColor }} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{t.name}</p>
                      {t.contactEmail && <p className="text-xs text-muted-foreground">{t.contactEmail}</p>}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                    <Globe className="h-3 w-3" />
                    {t.subdomain}.erp.school
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-full border" style={{ backgroundColor: t.primaryColor }} title={t.primaryColor} />
                    <span className="text-xs font-mono text-muted-foreground">{t.primaryColor}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className={`text-xs ${PLAN_COLORS[t.plan] ?? ""}`}>{t.plan}</Badge>
                </TableCell>
                <TableCell>
                  <Badge className={t.isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}>
                    {t.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {format(new Date(t.createdAt), "dd MMM yyyy")}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {t.id !== 1 && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => { if (confirm(`Delete tenant "${t.name}"?`)) deleteMutation.mutate(t.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialog.open} onOpenChange={open => setDialog(p => ({ ...p, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialog.tenant ? "Edit Tenant" : "Create New Tenant"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>School Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Greenfield Academy" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Subdomain *</Label>
              <div className="flex items-center gap-1">
                <Input value={form.subdomain} onChange={e => setForm(p => ({ ...p, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
                  placeholder="greenfield" className="flex-1" disabled={!!dialog.tenant} />
                <span className="text-sm text-muted-foreground">.erp.school</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Primary Color</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.primaryColor}
                  onChange={e => setForm(p => ({ ...p, primaryColor: e.target.value }))}
                  className="h-9 w-12 rounded cursor-pointer border" />
                <Input value={form.primaryColor} onChange={e => setForm(p => ({ ...p, primaryColor: e.target.value }))} className="font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Dark Variant</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.primaryColorDark}
                  onChange={e => setForm(p => ({ ...p, primaryColorDark: e.target.value }))}
                  className="h-9 w-12 rounded cursor-pointer border" />
                <Input value={form.primaryColorDark} onChange={e => setForm(p => ({ ...p, primaryColorDark: e.target.value }))} className="font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={form.plan} onValueChange={v => setForm(p => ({ ...p, plan: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PLANS.map(pl => <SelectItem key={pl} value={pl}>{pl}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-5">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(p => ({ ...p, isActive: v }))} />
              <Label>Active</Label>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Logo URL</Label>
              <Input value={form.logoUrl} onChange={e => setForm(p => ({ ...p, logoUrl: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Email</Label>
              <Input type="email" value={form.contactEmail} onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Phone</Label>
              <Input value={form.contactPhone} onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false, tenant: null })}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate({ ...form, id: dialog.tenant?.id })}
              disabled={saveMutation.isPending || !form.name || !form.subdomain}>
              {saveMutation.isPending ? "Saving..." : dialog.tenant ? "Save Changes" : "Create Tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
