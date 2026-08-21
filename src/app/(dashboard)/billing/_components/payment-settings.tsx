"use client";

// ═══════════════════════════════════════════════════════════════
// Payment gateway settings
// ═══════════════════════════════════════════════════════════════
//
// Where the Razorpay keys are entered. It exists because the alternative was
// a Vercel environment variable and a redeploy, which put "start taking money"
// and "rotate a leaked key" in the hands of whoever holds the hosting account
// rather than whoever runs the company.
//
// Two rules shape the whole form:
//
//   1. A stored secret is never sent back to the browser, so the fields for
//      them always start empty and empty means unchanged. The alternative —
//      rendering the key so the field looks populated — puts a live merchant
//      credential in the DOM of every admin session.
//
//   2. Nothing claims to work until Razorpay says it does. "Test connection"
//      calls the real API, because a form that reports "saved" tells you the
//      database write succeeded and nothing whatsoever about whether the keys
//      are right.

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface Status {
  configured: boolean;
  enabled: boolean;
  mode: "test" | "live" | null;
  keyId: string | null;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  source: "database" | "environment" | "none";
  updatedAt: string | null;
}

export function PaymentSettingsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  /** Non-null when the caller is not allowed to see this at all. */
  const [forbidden, setForbidden] = useState(false);

  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [mode, setMode] = useState<"test" | "live">("test");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const apply = useCallback((s: Status) => {
    setStatus(s);
    setKeyId(s.keyId ?? "");
    // Null when nothing is configured; the form has to start somewhere and
    // test is the only safe direction to default in.
    setMode(s.mode ?? "test");
    setEnabled(s.enabled);
    // Deliberately not repopulated — the server does not send them, and a
    // placeholder that looks like a value invites somebody to "keep" a secret
    // they cannot see.
    setKeySecret("");
    setWebhookSecret("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/settings", { credentials: "include" });
        if (res.status === 403) {
          if (!cancelled) setForbidden(true);
          return;
        }
        if (!res.ok) return;
        const body = (await res.json()) as { razorpay: Status };
        if (!cancelled) apply(body.razorpay);
      } catch {
        // Leaves the card in its loading-failed state rather than claiming
        // payments are unconfigured, which would be a different fact.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // Hidden entirely for anyone who cannot use it. An HR manager has no reason
  // to know the deployment's merchant key exists.
  if (forbidden) return null;

  const save = async (verify: boolean) => {
    if (!keyId.trim()) {
      toast.error("A Key ID is required.");
      return;
    }
    /*
     * Switching payments on with no secret anywhere would produce a deployment
     * that offers an upgrade button and fails at the last step, which is the
     * worst moment to discover it.
     */
    if (enabled && !keySecret.trim() && !status?.hasKeySecret) {
      toast.error("Add the Key Secret before switching payments on.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/billing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          keyId: keyId.trim(),
          keySecret: keySecret.trim() || undefined,
          webhookSecret: webhookSecret.trim() || undefined,
          mode,
          enabled,
          verify,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; razorpay?: Status };
      if (!res.ok) {
        toast.error(body.error ?? "Could not save the settings.");
        return;
      }
      if (body.razorpay) apply(body.razorpay);
      toast.success(verify ? "Verified with Razorpay and saved." : "Payment settings saved.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/billing/settings", { method: "POST", credentials: "include" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; mode?: string };
      if (body.ok) {
        toast.success(`Razorpay responded. Keys are valid (${body.mode} mode).`);
      } else {
        toast.error(body.error ?? "Razorpay rejected the stored keys.");
      }
    } catch {
      toast.error("Could not reach Razorpay.");
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    // Confirmed, because it stops the deployment taking money and there is no
    // undo without the keys to hand.
    if (
      !window.confirm(
        "Remove the stored Razorpay credentials? Customers will not be able to upgrade until new keys are added."
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      const res = await fetch("/api/billing/settings", { method: "DELETE", credentials: "include" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; razorpay?: Status };
      if (!res.ok) {
        toast.error(body.error ?? "Could not remove the credentials.");
        return;
      }
      if (body.razorpay) apply(body.razorpay);
      toast.success("Credentials removed. Payments are switched off.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Card className="animate-slide-up" style={{ animationDelay: "240ms" }}>      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> Payment gateway
            </CardTitle>
            <CardDescription>
              Razorpay credentials for this deployment. Secrets are encrypted and never shown again
              once saved.
            </CardDescription>
          </div>
          {!loading && status && (
            <div className="flex flex-col items-end gap-1 shrink-0">
              {status.configured ? (
                <Badge
                  className={
                    status.enabled
                      ? "bg-emerald-100 text-emerald-700 border-0"
                      : "bg-amber-100 text-amber-700 border-0"
                  }
                >
                  {status.enabled ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Live
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3 w-3 mr-1" /> Configured, switched off
                    </>
                  )}
                </Badge>
              ) : (
                <Badge variant="secondary">Not configured</Badge>
              )}
              <Badge variant="outline" className="capitalize text-[10px]">
                {status.mode ?? mode} mode
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {/*
              Worth stating plainly. A deployment reading its keys from the
              environment works, but nothing on this screen can change them,
              and somebody trying to rotate a key needs to know that before
              they type into a field that will not take effect.
            */}
            {status?.source === "environment" && (
              <p className="text-xs rounded-md bg-amber-50 text-amber-900 border border-amber-200 p-2.5">
                These keys currently come from environment variables. Saving here stores them in the
                database instead, which takes precedence from then on.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rzp-key-id">Key ID</Label>
                <Input
                  id="rzp-key-id"
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder="rzp_test_XXXXXXXXXXXX"
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rzp-mode">Mode</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as "test" | "live")}>
                  <SelectTrigger id="rzp-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">Test — no real money moves</SelectItem>
                    <SelectItem value="live">Live — real cards are charged</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rzp-key-secret">
                  Key Secret{" "}
                  {status?.hasKeySecret && (
                    <span className="text-xs text-muted-foreground font-normal">
                      · saved, leave blank to keep
                    </span>
                  )}
                </Label>
                <Input
                  id="rzp-key-secret"
                  type="password"
                  value={keySecret}
                  onChange={(e) => setKeySecret(e.target.value)}
                  placeholder={status?.hasKeySecret ? "••••••••••••" : "Paste the key secret"}
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rzp-webhook-secret">
                  Webhook Secret{" "}
                  {status?.hasWebhookSecret && (
                    <span className="text-xs text-muted-foreground font-normal">
                      · saved, leave blank to keep
                    </span>
                  )}
                </Label>
                <Input
                  id="rzp-webhook-secret"
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={status?.hasWebhookSecret ? "••••••••••••" : "From the Razorpay dashboard"}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Accept payments</p>
                <p className="text-xs text-muted-foreground">
                  When off, the upgrade button explains that payments are unavailable rather than
                  failing.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Accept payments" />
            </div>

            {mode === "live" && enabled && (
              <p className="text-xs rounded-md bg-red-50 text-red-900 border border-red-200 p-2.5">
                Live mode is on. Anyone upgrading from this deployment will be charged for real.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => save(true)} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Verify &amp; save
              </Button>
              <Button variant="outline" onClick={() => save(false)} disabled={saving}>
                Save without verifying
              </Button>
              <Button
                variant="ghost"
                onClick={test}
                disabled={testing || !status?.configured}
                title={status?.configured ? undefined : "Save credentials first"}
              >
                {testing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Test connection
              </Button>
              {status?.source === "database" && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={remove}
                  disabled={removing}
                >
                  {removing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Remove credentials
                </Button>
              )}
            </div>

            {status?.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Last changed {new Date(status.updatedAt).toLocaleString("en-IN")}
              </p>
            )}

            <p className="text-xs text-muted-foreground border-t pt-3">
              Point the Razorpay webhook at <code className="text-[11px]">/api/billing/webhook</code>{" "}
              and subscribe to <code className="text-[11px]">payment.captured</code>. Without it, a
              payment that completes after the customer closes the tab is never applied.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
