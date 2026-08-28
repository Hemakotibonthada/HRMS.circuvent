"use client";

// ═══════════════════════════════════════════════════════════════
// INTEGRATIONS PANEL
// ═══════════════════════════════════════════════════════════════
// What replaced the fabricated list. Everything on this screen is read from
// /api/integrations: if nothing has been added, it says so, and it says so
// because the list came back empty rather than because a fixture said
// "disconnected".
//
// "Last delivery" is a real timestamp from a real request. The panel this
// replaces printed "Last sync: 2 min ago" beside services that had never been
// contacted, which is the sort of detail that makes the rest of a screen
// believable.

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Plus, Send, Trash2, Webhook } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Integration {
  id: string;
  kind: string;
  displayName: string;
  endpointUrl: string;
  hasSecret: boolean;
  events: string[];
  isEnabled: boolean;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

const KIND_LABELS: Record<string, string> = {
  slack_webhook: "Slack",
  teams_webhook: "Microsoft Teams",
  generic_webhook: "Webhook",
};

export function IntegrationsPanel() {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/integrations", { credentials: "same-origin" });
      const body = await response.json().catch(() => null);

      if (response.status === 503 && body?.code === "not_provisioned") {
        // A specific, actionable state rather than a generic failure.
        setUnavailable(body.error);
        setItems([]);
        return;
      }
      if (!response.ok) throw new Error(body?.error || `Could not load integrations (${response.status})`);

      setUnavailable(null);
      setItems(body.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const secret = (data.get("secret") as string)?.trim();

    setSaving(true);
    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: data.get("kind"),
          displayName: (data.get("displayName") as string).trim(),
          endpointUrl: (data.get("endpointUrl") as string).trim(),
          ...(secret ? { secret } : {}),
        }),
      });

      const body = await response.json().catch(() => null);
      // The server explains exactly why a URL was refused — that it resolves
      // somewhere private, say. Replacing that with "Failed to add" would
      // leave an administrator retyping a URL that can never be accepted.
      if (!response.ok) throw new Error(body?.error || `Could not add it (${response.status})`);

      toast.success("Integration added. Send a test to check it works.");
      form.reset();
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add it");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async (id: string) => {
    setTesting(id);
    try {
      const response = await fetch(`/api/integrations/${id}/test`, {
        method: "POST",
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "The test could not be run");

      if (body.ok) toast.success("Delivered.");
      else toast.error(body.error || "The endpoint did not accept it.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The test could not be run");
    } finally {
      setTesting(null);
    }
  };

  const setEnabled = async (id: string, isEnabled: boolean) => {
    try {
      const response = await fetch(`/api/integrations/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isEnabled }),
      });
      if (!response.ok) throw new Error("Could not change it");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change it");
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Remove "${name}"? Nothing further will be sent to it.`)) return;
    try {
      const response = await fetch(`/api/integrations/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Could not remove it");
      toast.success("Removed.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove it");
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <Webhook className="h-4 w-4 text-teal-500" />
            Outbound webhooks
          </CardTitle>
          {!unavailable && (
            <Button size="sm" className="text-xs gap-1" onClick={() => setDialogOpen(true)}>
              <Plus className="h-3 w-3" />
              Add
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-3">
          {unavailable ? (
            <div className="rounded-lg border border-dashed p-4 flex gap-3 items-start">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold">Not set up on this deployment</p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{unavailable}</p>
              </div>
            </div>
          ) : loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4">
              <p className="text-xs font-semibold">Nothing is connected yet</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                Add a webhook URL from Slack, Teams, or your own service, and HRMS will post
                events to it. Nothing is sent until you add one.
              </p>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold truncate">{item.displayName}</p>
                      <Badge variant="outline" className="text-[8px]">
                        {KIND_LABELS[item.kind] ?? item.kind}
                      </Badge>
                      {item.hasSecret && (
                        <Badge variant="outline" className="text-[8px]">
                          signed
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate break-all">
                      {item.endpointUrl}
                    </p>
                  </div>
                  <Switch
                    checked={item.isEnabled}
                    onCheckedChange={(checked) => setEnabled(item.id, checked)}
                    aria-label={`${item.isEnabled ? "Disable" : "Enable"} ${item.displayName}`}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <p className="text-[10px] text-muted-foreground flex-1">
                    {item.lastDeliveryAt ? (
                      <>
                        Last delivery{" "}
                        <span
                          className={cn(
                            "font-medium",
                            item.lastStatus === "ok" ? "text-emerald-600" : "text-red-600"
                          )}
                        >
                          {item.lastStatus === "ok" ? "succeeded" : "failed"}
                        </span>{" "}
                        {new Date(item.lastDeliveryAt).toLocaleString()}
                        {item.lastError ? ` — ${item.lastError}` : ""}
                      </>
                    ) : (
                      "Never delivered to."
                    )}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1"
                    disabled={testing === item.id}
                    onClick={() => sendTest(item.id)}
                  >
                    <Send className="h-3 w-3" />
                    {testing === item.id ? "Sending…" : "Send test"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => remove(item.id, item.displayName)}
                    aria-label={`Remove ${item.displayName}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}

          <p className="text-[10px] text-muted-foreground">
            {/* Said plainly rather than shown as buttons that cannot work. */}
            SSO, payment providers and accounting export need a registered application with each
            provider, which this deployment does not have. They are not listed here until they do.
          </p>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a webhook</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label htmlFor="int-kind">Type</Label>
              <Select name="kind" defaultValue="slack_webhook">
                <SelectTrigger id="int-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack_webhook">Slack</SelectItem>
                  <SelectItem value="teams_webhook">Microsoft Teams</SelectItem>
                  <SelectItem value="generic_webhook">Other / custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="int-name">Name</Label>
              <Input id="int-name" name="displayName" required minLength={2} maxLength={80} placeholder="People team channel" />
            </div>
            <div>
              <Label htmlFor="int-url">Webhook URL</Label>
              <Input
                id="int-url"
                name="endpointUrl"
                type="url"
                required
                maxLength={2048}
                placeholder="https://hooks.slack.com/services/…"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Must be https, and must be reachable from the public internet.
              </p>
            </div>
            <div>
              <Label htmlFor="int-secret">
                Signing secret <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input id="int-secret" name="secret" minLength={8} maxLength={200} autoComplete="off" />
              <p className="text-[10px] text-muted-foreground mt-1">
                If set, each message carries an HMAC in <code>x-circuvent-signature</code> so the
                receiver can tell ours from anyone else&apos;s who has learned the URL. Stored
                encrypted and never shown again.
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? "Adding…" : "Add webhook"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
