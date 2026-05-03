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
import {
  Plus, Pencil, Trash2, Building2, Globe,
  Mail, ChevronDown, ChevronUp, CheckCircle2, AlertCircle,
  Send, Eye, EyeOff, Loader2,
} from "lucide-react";
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

interface SmtpSettings {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassSet: boolean;
  smtpFrom: string;
  smtpSecure: boolean;
}

const emptyForm = {
  name: "", subdomain: "", primaryColor: "#4F46E5", primaryColorDark: "#3730A3",
  logoUrl: "", contactEmail: "", contactPhone: "", address: "", plan: "FREE", isActive: true,
};

const emptySmtp = {
  smtpHost: "", smtpPort: 587, smtpUser: "", smtpPass: "", smtpFrom: "", smtpSecure: false,
};

export default function TenantsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; tenant: Tenant | null }>({ open: false, tenant: null });
  const [form, setForm] = useState(emptyForm);

  // SMTP panel state
  const [smtpOpen, setSmtpOpen] = useState(false);
  const [smtp, setSmtp] = useState(emptySmtp);
  const [showPass, setShowPass] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);

  const { data, isLoading } = useQuery<{ tenants: Tenant[] }>({
    queryKey: ["tenants"],
    queryFn: () => customFetch("/api/tenants"),
  });

  const { data: smtpData, isLoading: smtpLoading, refetch: refetchSmtp } = useQuery<SmtpSettings>({
    queryKey: ["smtp-settings"],
    queryFn: () => customFetch("/api/tenants/smtp-settings"),
    enabled: smtpOpen,
  });

  // Sync smtp form when data loads
  const handleOpenSmtp = () => {
    setSmtpOpen(true);
    if (smtpData) {
      setSmtp({
        smtpHost: smtpData.smtpHost,
        smtpPort: smtpData.smtpPort,
        smtpUser: smtpData.smtpUser,
        smtpPass: "",
        smtpFrom: smtpData.smtpFrom,
        smtpSecure: smtpData.smtpSecure,
      });
    }
  };

  // When smtpData arrives, populate form
  const smtpConfigured = !!(smtpData?.smtpHost && smtpData.smtpUser && smtpData.smtpPassSet);

  const saveTenant = useMutation({
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

  const deleteTenant = useMutation({
    mutationFn: (id: number) => customFetch(`/api/tenants/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenants"] });
      toast({ title: "Tenant deleted" });
    },
    onError: () => toast({ title: "Cannot delete this tenant", variant: "destructive" }),
  });

  const saveSmtp = useMutation({
    mutationFn: (payload: typeof emptySmtp) =>
      customFetch("/api/tenants/smtp-settings", { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: () => {
      refetchSmtp();
      qc.invalidateQueries({ queryKey: ["smtp-settings"] });
      toast({ title: "Email settings saved" });
    },
    onError: () => toast({ title: "Failed to save email settings", variant: "destructive" }),
  });

  const sendTestEmail = async () => {
    if (!testEmail.trim()) { toast({ title: "Enter a recipient email", variant: "destructive" }); return; }
    setTesting(true);
    try {
      const res = await customFetch("/api/tenants/smtp-settings/test", {
        method: "POST",
        body: JSON.stringify({ to: testEmail.trim() }),
      }) as { success?: boolean; message?: string; error?: string };
      toast({ title: "Test email sent!", description: res.message ?? `Delivered to ${testEmail}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "SMTP error";
      toast({ title: "Test failed", description: msg, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const openAdd = () => { setForm(emptyForm); setDialog({ open: true, tenant: null }); };
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
                        onClick={() => { if (confirm(`Delete tenant "${t.name}"?`)) deleteTenant.mutate(t.id); }}>
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

      {/* ── SMTP / Email Settings panel ───────────────────────────────────── */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <button
          onClick={() => (smtpOpen ? setSmtpOpen(false) : handleOpenSmtp())}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <Mail className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">Email Settings (SMTP)</p>
              <p className="text-xs text-muted-foreground">Configure outgoing email for payment receipts and notifications</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!smtpLoading && smtpOpen && (
              smtpConfigured
                ? <Badge className="bg-emerald-500/15 text-emerald-500 gap-1 text-xs"><CheckCircle2 className="h-3 w-3" />Configured</Badge>
                : <Badge className="bg-amber-500/15 text-amber-500 gap-1 text-xs"><AlertCircle className="h-3 w-3" />Not configured</Badge>
            )}
            {smtpOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </button>

        {smtpOpen && (
          <div className="border-t border-border px-5 py-5 space-y-6">
            {smtpLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading settings...
              </div>
            ) : (
              <>
                {/* Status banner */}
                {smtpConfigured ? (
                  <div className="flex items-start gap-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">
                      SMTP is configured. Payment receipts and system notifications will be delivered via email.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                    <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      SMTP is not configured. Email delivery is disabled — emails will be logged server-side only. Fill in the fields below and save to enable.
                    </p>
                  </div>
                )}

                {/* Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">SMTP Host</Label>
                    <Input
                      placeholder="smtp.gmail.com"
                      value={smtp.smtpHost}
                      onChange={e => setSmtp(p => ({ ...p, smtpHost: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Port</Label>
                    <Input
                      type="number"
                      placeholder="587"
                      value={smtp.smtpPort}
                      onChange={e => setSmtp(p => ({ ...p, smtpPort: parseInt(e.target.value) || 587 }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Username / Email</Label>
                    <Input
                      placeholder="you@gmail.com"
                      value={smtp.smtpUser}
                      onChange={e => setSmtp(p => ({ ...p, smtpUser: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      Password {smtpData?.smtpPassSet && <span className="text-muted-foreground font-normal">(leave blank to keep existing)</span>}
                    </Label>
                    <div className="relative">
                      <Input
                        type={showPass ? "text" : "password"}
                        placeholder={smtpData?.smtpPassSet ? "••••••••  (already set)" : "App password or SMTP password"}
                        value={smtp.smtpPass}
                        onChange={e => setSmtp(p => ({ ...p, smtpPass: e.target.value }))}
                        className="pr-9"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(p => !p)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label className="text-xs font-medium">From Address</Label>
                    <Input
                      placeholder='"Smart School ERP" <no-reply@yourschool.edu>'
                      value={smtp.smtpFrom}
                      onChange={e => setSmtp(p => ({ ...p, smtpFrom: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">Appears as the sender name in recipients' inboxes.</p>
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-3">
                    <Switch
                      checked={smtp.smtpSecure}
                      onCheckedChange={v => setSmtp(p => ({ ...p, smtpSecure: v }))}
                    />
                    <div>
                      <p className="text-sm font-medium">Use TLS / SSL</p>
                      <p className="text-xs text-muted-foreground">Enable for port 465. Leave off for port 587 (STARTTLS).</p>
                    </div>
                  </div>
                </div>

                {/* Provider hints */}
                <div className="rounded-lg bg-muted/40 p-3 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick Reference</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                    {[
                      { name: "Gmail", host: "smtp.gmail.com", port: "587", note: "Use App Password" },
                      { name: "Outlook / 365", host: "smtp.office365.com", port: "587", note: "Modern Auth" },
                      { name: "SendGrid", host: "smtp.sendgrid.net", port: "587", note: "API Key as password" },
                    ].map(p => (
                      <button
                        key={p.name}
                        onClick={() => setSmtp(prev => ({ ...prev, smtpHost: p.host, smtpPort: parseInt(p.port), smtpSecure: false }))}
                        className="text-left rounded-md border border-border p-2 hover:bg-muted/60 transition-colors"
                      >
                        <p className="text-xs font-semibold">{p.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{p.host}:{p.port}</p>
                        <p className="text-xs text-muted-foreground">{p.note}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Save */}
                <div className="flex justify-end">
                  <Button onClick={() => saveSmtp.mutate(smtp)} disabled={saveSmtp.isPending} className="gap-2">
                    {saveSmtp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    Save Email Settings
                  </Button>
                </div>

                {/* Test section */}
                <div className="border-t border-border pt-5 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">Send Test Email</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Verify your SMTP settings by sending a test message. Save first if you made changes.</p>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="recipient@example.com"
                      value={testEmail}
                      onChange={e => setTestEmail(e.target.value)}
                      className="max-w-sm"
                    />
                    <Button variant="outline" onClick={sendTestEmail} disabled={testing} className="gap-2 whitespace-nowrap">
                      {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Send Test
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Tenant create/edit dialog ─────────────────────────────────────── */}
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
            <Button onClick={() => saveTenant.mutate({ ...form, id: dialog.tenant?.id })}
              disabled={saveTenant.isPending || !form.name || !form.subdomain}>
              {saveTenant.isPending ? "Saving..." : dialog.tenant ? "Save Changes" : "Create Tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
