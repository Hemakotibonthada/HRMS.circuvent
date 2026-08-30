"use client";

import { useState } from "react";
import { Check, Copy, Download, Laptop, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { DeviceInstallLinks } from "@/lib/device-install";

interface EnrollTokenResponse {
  token: string;
  expiresAt: string;
  employeeEmail: string;
  employeeCode?: string | null;
  install: DeviceInstallLinks;
}

export function DeviceInstallPanel({
  employeeId,
  employeeEmail,
  employeeLabel,
  assetTag,
  className,
}: {
  employeeId?: string;
  employeeEmail?: string;
  employeeLabel?: string;
  assetTag?: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<EnrollTokenResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch("/api/security/devices/enroll-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(employeeId ? { employeeId } : {}),
          ...(employeeEmail ? { employeeEmail } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate installer");
      setPayload(data);
      toast.success("Installer ready — valid for 60 minutes");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate installer");
    } finally {
      setLoading(false);
    }
  }

  function copy(key: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground">
        {employeeLabel
          ? `Generate a one-time installer for ${employeeLabel}.`
          : "Generate a one-time installer for an employee."}
        {assetTag ? ` Asset tag ${assetTag} will link on first agent check-in.` : ""}
      </p>

      {!payload ? (
        <Button
          type="button"
          size="sm"
          className="mt-3 gap-2"
          onClick={() => void generate()}
          disabled={loading || (!employeeId && !employeeEmail)}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Laptop className="h-4 w-4" />}
          Generate installer
        </Button>
      ) : (
        <div className="mt-4 space-y-4 rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">
            Token for <strong className="text-foreground">{payload.employeeEmail}</strong>
            {payload.employeeCode ? ` (${payload.employeeCode})` : ""} — expires{" "}
            {new Date(payload.expiresAt).toLocaleString()}.
          </p>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Windows (recommended)
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="default" className="gap-2 text-xs" asChild>
                <a href={payload.install.windowsLauncherUrl} download="CircuventInstall.cmd">
                  <Download className="h-3.5 w-3.5" />
                  Download CircuventInstall.cmd
                </a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 text-xs"
                onClick={() => copy("win", payload.install.windowsPowerShell)}
              >
                {copied === "win" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                Copy PowerShell steps
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-md bg-background/80 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {payload.install.windowsPowerShell}
            </pre>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">macOS</p>
            <Button
              size="sm"
              variant="outline"
              className="gap-2 text-xs"
              onClick={() => copy("mac", payload.install.macOsCommand)}
            >
              {copied === "mac" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              Copy install command
            </Button>
          </div>

          <Button type="button" size="sm" variant="ghost" className="text-xs" onClick={() => void generate()}>
            Generate a new token
          </Button>
        </div>
      )}
    </div>
  );
}
