import { useState } from "react";
import { useGetMe, customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { User, Shield, Mail, Phone, KeyRound, Eye, EyeOff, Check, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const roleColors: Record<string, string> = {
  SUPER_ADMIN: "bg-purple-100 text-purple-700",
  TEACHER: "bg-blue-100 text-blue-700",
  ACCOUNTANT: "bg-green-100 text-green-700",
  PARENT: "bg-yellow-100 text-yellow-700",
  STUDENT: "bg-gray-100 text-gray-600",
};

// ── Password strength helpers ───────────────────────────────────────────────

function getStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak", color: "bg-red-500" };
  if (score === 2) return { score, label: "Fair", color: "bg-yellow-500" };
  if (score === 3) return { score, label: "Good", color: "bg-blue-500" };
  return { score, label: "Strong", color: "bg-green-500" };
}

// ── Password input with reveal toggle ─────────────────────────────────────

function PasswordInput({ id, value, onChange, placeholder, disabled }: {
  id: string; value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="pr-9"
        autoComplete="new-password"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        tabIndex={-1}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ── Change Password Card ────────────────────────────────────────────────────

function ChangePasswordCard() {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const strength = getStrength(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = current.length > 0 && next.length >= 6 && next === confirm && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    setSuccess(false);
    try {
      await customFetch("/api/auth/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setSuccess(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
    } catch (err: any) {
      const msg = err?.data?.message ?? err?.message ?? "Failed to update password";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Change Password
        </CardTitle>
        <p className="text-xs text-muted-foreground">Keep your account secure with a strong password</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">

          {/* Current password */}
          <div className="space-y-1.5">
            <Label htmlFor="current-pw" className="text-xs">Current Password</Label>
            <PasswordInput
              id="current-pw"
              value={current}
              onChange={v => { setCurrent(v); setError(""); setSuccess(false); }}
              placeholder="Enter current password"
              disabled={loading}
            />
          </div>

          {/* New password */}
          <div className="space-y-1.5">
            <Label htmlFor="new-pw" className="text-xs">New Password</Label>
            <PasswordInput
              id="new-pw"
              value={next}
              onChange={v => { setNext(v); setError(""); setSuccess(false); }}
              placeholder="Minimum 6 characters"
              disabled={loading}
            />
            {/* Strength meter */}
            {next.length > 0 && (
              <div className="space-y-1">
                <div className="flex gap-1 h-1">
                  {[1, 2, 3, 4].map(i => (
                    <div
                      key={i}
                      className={cn(
                        "flex-1 rounded-full transition-colors duration-200",
                        i <= strength.score ? strength.color : "bg-muted"
                      )}
                    />
                  ))}
                </div>
                <p className={cn("text-[10px] font-medium", {
                  "text-red-500": strength.score <= 1,
                  "text-yellow-600": strength.score === 2,
                  "text-blue-600": strength.score === 3,
                  "text-green-600": strength.score === 4,
                })}>
                  {strength.label}
                  {strength.score < 3 && " — add uppercase, numbers, or symbols"}
                </p>
              </div>
            )}
          </div>

          {/* Confirm new password */}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pw" className="text-xs">Confirm New Password</Label>
            <PasswordInput
              id="confirm-pw"
              value={confirm}
              onChange={v => { setConfirm(v); setError(""); setSuccess(false); }}
              placeholder="Repeat new password"
              disabled={loading}
            />
            {mismatch && (
              <p className="text-[11px] text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> Passwords do not match
              </p>
            )}
          </div>

          {/* Error / success feedback */}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
              <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
              <p className="text-xs text-green-700 font-medium">Password updated successfully</p>
            </div>
          )}

          <Button type="submit" size="sm" disabled={!canSubmit} className="w-full sm:w-auto">
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Updating…
              </>
            ) : "Update Password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Settings Page ──────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: me, isLoading } = useGetMe();
  const { logout } = useAuth();

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Account profile and security</p>
      </div>

      {/* Profile card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <User className="h-4 w-4" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : me ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                  {me.firstName[0]}{me.lastName[0]}
                </div>
                <div>
                  <h2 className="font-semibold text-base">{me.firstName} {me.lastName}</h2>
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium mt-1", roleColors[me.role] ?? "")}>
                    {me.role.replace("_", " ")}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2">
                {[
                  { label: "Email", value: me.email, icon: Mail },
                  { label: "Phone", value: me.phoneNumber ?? "Not set", icon: Phone },
                  { label: "Role", value: me.role.replace("_", " "), icon: Shield },
                  { label: "Status", value: me.isActive ? "Active" : "Inactive", icon: User },
                  { label: "Member since", value: new Date(me.createdAt).toLocaleDateString(), icon: User },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Icon className="h-3 w-3" />{label}
                    </p>
                    <p className="text-sm font-medium">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Change Password card */}
      <ChangePasswordCard />

      {/* System info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">System Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {[
            ["System", "Smart School/Madrasa ERP"],
            ["Version", "1.0.0"],
            ["Stack", "React + TypeScript + Express + PostgreSQL"],
            ["Environment", import.meta.env.MODE],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 border-b border-border last:border-0">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="pt-2">
        <button
          onClick={logout}
          className="text-sm text-destructive hover:underline font-medium"
        >
          Sign out of your account
        </button>
      </div>
    </div>
  );
}
