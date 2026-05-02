import { useState } from "react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, AlertCircle, CheckCircle2, ArrowLeft, KeyRound, Loader2, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

function PasswordInput({ id, value, onChange, placeholder, disabled }: {
  id: string; value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id} type={show ? "text" : "password"} value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        className="pr-9" autoComplete="new-password"
      />
      <button type="button" onClick={() => setShow(s => !s)} tabIndex={-1}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

type Step = "request" | "reset" | "done";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generatedToken, setGeneratedToken] = useState("");
  const [copied, setCopied] = useState(false);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await customFetch<{ token?: string; expiresAt?: string; message: string }>(
        "/api/auth/forgot-password",
        { method: "POST", body: JSON.stringify({ email }) }
      );
      if (res.token) setGeneratedToken(res.token);
      setStep("reset");
    } catch (err: any) {
      setError(err?.data?.message ?? "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    if (newPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    setError("");
    try {
      await customFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: token || generatedToken, newPassword }),
      });
      setStep("done");
    } catch (err: any) {
      setError(err?.data?.message ?? "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(generatedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center space-y-1.5">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold">Reset Password</h1>
          <p className="text-sm text-muted-foreground">
            {step === "request" && "Enter your email to get a reset token"}
            {step === "reset" && "Enter the token and your new password"}
            {step === "done" && "Your password has been reset"}
          </p>
        </div>

        <Card>
          <CardContent className="pt-5">
            {/* ── Step 1: Request ── */}
            {step === "request" && (
              <form onSubmit={handleRequest} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs">Email Address</Label>
                  <Input
                    id="email" type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="admin@school.edu" required disabled={loading}
                  />
                </div>
                {error && (
                  <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                    <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    <p className="text-xs text-destructive">{error}</p>
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={!email || loading}>
                  {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Generate Reset Token
                </Button>
              </form>
            )}

            {/* ── Step 2: Reset ── */}
            {step === "reset" && (
              <form onSubmit={handleReset} className="space-y-4">
                {generatedToken && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-blue-800">Your Reset Token</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[10px] break-all font-mono text-blue-700 bg-blue-100 rounded px-2 py-1">
                        {generatedToken}
                      </code>
                      <button type="button" onClick={copyToken} className="shrink-0 text-blue-600 hover:text-blue-800">
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-blue-600">
                      In production, this would be emailed to you. Token expires in 1 hour.
                    </p>
                  </div>
                )}
                {!generatedToken && (
                  <div className="space-y-1.5">
                    <Label htmlFor="token" className="text-xs">Reset Token</Label>
                    <Input
                      id="token" value={token} onChange={e => setToken(e.target.value)}
                      placeholder="Paste your reset token" required disabled={loading}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="new-pw" className="text-xs">New Password</Label>
                  <PasswordInput
                    id="new-pw" value={newPassword} onChange={setNewPassword}
                    placeholder="Minimum 6 characters" disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pw" className="text-xs">Confirm Password</Label>
                  <PasswordInput
                    id="confirm-pw" value={confirmPassword} onChange={setConfirmPassword}
                    placeholder="Repeat new password" disabled={loading}
                  />
                  {confirmPassword && confirmPassword !== newPassword && (
                    <p className="text-xs text-destructive">Passwords do not match</p>
                  )}
                </div>
                {error && (
                  <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                    <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    <p className="text-xs text-destructive">{error}</p>
                  </div>
                )}
                <Button type="submit" className="w-full"
                  disabled={!newPassword || newPassword !== confirmPassword || loading}>
                  {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Set New Password
                </Button>
              </form>
            )}

            {/* ── Step 3: Done ── */}
            {step === "done" && (
              <div className="space-y-4 text-center py-2">
                <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Your password has been reset successfully.
                </p>
                <Link href="/login">
                  <Button className="w-full">Back to Login</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {step !== "done" && (
          <div className="text-center">
            <Link href="/login">
              <button className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to login
              </button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
