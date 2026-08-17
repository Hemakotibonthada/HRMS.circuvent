"use client";

// ═══════════════════════════════════════════════════════════════
// TWO-STEP VERIFICATION — enrolment
// ═══════════════════════════════════════════════════════════════
// The user-facing half of /api/auth/mfa. Without it the API is unreachable and
// MFA stays exactly as switched-off as it was before the routes existed.
//
// Three states, matching the server's: off, pending (a secret exists but has
// never been proved) and active. The pending state is visible here rather than
// hidden, because someone who starts enrolling and navigates away should come
// back to "you started this, finish or cancel" instead of a fresh QR code and
// no idea which of the two entries in their authenticator app is real.

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Status {
  enabled: boolean;
  pending: boolean;
  enabledAt: string | null;
}

async function readJson(response: Response): Promise<{ error?: string } & Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as { error?: string };
}

export function TwoFactorSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [uri, setUri] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/mfa", { credentials: "include" });
      if (!response.ok) throw new Error();
      setStatus((await response.json()) as Status);
    } catch {
      toast.error("Could not read your two-step verification status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The QR image is rendered from the URI rather than sent by the server, so
  // the secret is never written into an <img src> the browser might cache or
  // log. Imported on demand — this page is the only place that needs it.
  useEffect(() => {
    if (!uri) {
      setQr(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const { toDataURL } = await import("qrcode");
        const rendered = await toDataURL(uri, { margin: 1, width: 220 });
        if (!cancelled) setQr(rendered);
      } catch {
        // The manual key below is a complete fallback, so a failure here
        // degrades rather than blocks.
        if (!cancelled) setQr(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uri]);

  const begin = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/mfa", { method: "POST", credentials: "include" });
      const body = await readJson(response);
      if (!response.ok) {
        toast.error(body.error || "Could not start enrolment.");
        return;
      }
      setUri(body.uri as string);
      setManualKey(body.manualEntryKey as string);
      setCode("");
      await refresh();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/mfa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        toast.error(body.error || "That code was not accepted.");
        setCode("");
        return;
      }

      setBackupCodes(body.backupCodes as string[]);
      setUri(null);
      setManualKey(null);
      setCode("");
      await refresh();
      toast.success("Two-step verification is on.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/mfa", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: disablePassword, code: disableCode.trim() }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        toast.error(body.error || "Could not turn it off.");
        return;
      }

      setDisablePassword("");
      setDisableCode("");
      setConfirmingDisable(false);
      setBackupCodes(null);
      await refresh();
      toast.success("Two-step verification is off.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const copyBackupCodes = async () => {
    if (!backupCodes) return;
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the codes and copy them manually.");
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading two-step verification…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              Two-step verification
              {status?.enabled ? (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  On
                </Badge>
              ) : status?.pending ? (
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  Not finished
                </Badge>
              ) : (
                <Badge variant="secondary">Off</Badge>
              )}
            </CardTitle>
            <CardDescription>
              A code from your authenticator app, on top of your password. It protects your salary,
              bank and identity details if your password is ever leaked.
            </CardDescription>
          </div>
          {status?.enabled ? (
            <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-600" />
          ) : (
            <ShieldOff className="h-6 w-6 shrink-0 text-muted-foreground" />
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── Recovery codes, shown once ── */}
        {backupCodes && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="mb-2 flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
              <TriangleAlert className="h-4 w-4" />
              Save these recovery codes now
            </div>
            <p className="mb-3 text-sm text-amber-900/80 dark:text-amber-200/80">
              Each one signs you in once if you lose your phone. They are stored hashed, so this is
              the only time they can be shown — if you lose them and your device, an administrator
              has to intervene.
            </p>
            <ul className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
              {backupCodes.map((backupCode) => (
                <li key={backupCode}>{backupCode}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={copyBackupCodes}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy all"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setBackupCodes(null)}>
                I have saved them
              </Button>
            </div>
          </div>
        )}

        {/* ── Enrolment in progress ── */}
        {uri && manualKey && (
          <div className="space-y-4 rounded-lg border p-4">
            <div>
              <p className="font-medium">1. Scan this with your authenticator app</p>
              <p className="text-sm text-muted-foreground">
                Google Authenticator, Authy, 1Password — any of them.
              </p>
            </div>

            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              {qr ? (
                // Decorative: the manual key beside it carries the same
                // information as text, so a screen reader is not left with an
                // unreadable image.
                <img src={qr} alt="" className="rounded-lg border bg-white p-2" width={220} height={220} />
              ) : (
                <div className="flex h-[220px] w-[220px] items-center justify-center rounded-lg border text-sm text-muted-foreground">
                  Use the key below
                </div>
              )}

              <div className="space-y-1">
                <p className="text-sm font-medium">Or type this key in</p>
                <code className="block rounded bg-muted px-2 py-1 font-mono text-sm">{manualKey}</code>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mfa-confirm">2. Enter the six-digit code it shows</Label>
              <div className="flex gap-2">
                <Input
                  id="mfa-confirm"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="max-w-[160px]"
                />
                <Button type="button" onClick={confirm} disabled={busy || code.trim().length === 0}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Turn on
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Nothing changes about how you sign in until this code is accepted.
              </p>
            </div>
          </div>
        )}

        {/* ── Off, or a pending enrolment that was abandoned ── */}
        {!uri && !status?.enabled && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={begin} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {status?.pending ? "Start again" : "Set up two-step verification"}
            </Button>
            {status?.pending && (
              <p className="text-sm text-muted-foreground">
                You started this but never finished, so it is not protecting your account yet.
              </p>
            )}
          </div>
        )}

        {/* ── On ── */}
        {!uri && status?.enabled && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              On since{" "}
              {status.enabledAt
                ? new Date(status.enabledAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "recently"}
              .
            </p>

            {confirmingDisable ? (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm">
                  Confirm with your password and a current code. Both are required — otherwise
                  anyone who picked up your signed-in laptop could switch this off.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="mfa-off-password">Password</Label>
                    <Input
                      id="mfa-off-password"
                      type="password"
                      autoComplete="current-password"
                      value={disablePassword}
                      onChange={(event) => setDisablePassword(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mfa-off-code">Authenticator code</Label>
                    <Input
                      id="mfa-off-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={disableCode}
                      onChange={(event) => setDisableCode(event.target.value)}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={disable}
                    disabled={busy || !disablePassword || !disableCode.trim()}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Turn off
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setConfirmingDisable(false);
                      setDisablePassword("");
                      setDisableCode("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => setConfirmingDisable(true)}>
                Turn off two-step verification
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
