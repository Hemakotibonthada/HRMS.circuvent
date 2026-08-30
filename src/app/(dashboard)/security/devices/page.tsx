"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  HardDrive, ShieldCheck, Laptop, Copy, Check, Download,
  RefreshCw, Plus, Terminal, Lock, Flame, Globe, AlertCircle, FileCode
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DataEmptyState } from "@/components/data-empty-state";

interface DevicePolicy {
  id: string;
  deviceHostname: string;
  deviceSerial?: string | null;
  employeeId?: string | null;
  employeeCode?: string | null;
  employeeEmail?: string | null;
  policyMode: string;
  usbBlocked: boolean;
  firewallActive: boolean;
  agentVersion?: string | null;
  osVersion?: string | null;
  lastHeartbeatAt?: string | null;
  createdAt: string;
}

export default function SecurityDevicesPage() {
  const [devices, setDevices] = useState<DevicePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCmd, setCopiedCmd] = useState(false);

  // Enroll modal
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [enrollHostname, setEnrollHostname] = useState("");
  const [enrollSerial, setEnrollSerial] = useState("");
  const [enrollEmail, setEnrollEmail] = useState("");
  const [enrollCode, setEnrollCode] = useState("");
  const [enrolling, setEnrolling] = useState(false);

  const fetchDevices = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/security/devices");
      if (!res.ok) throw new Error("Failed to load devices");
      const data = await res.json();
      setDevices(data.devices || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load device list");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  const handleEnrollDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollHostname.trim()) {
      toast.error("Device hostname is required");
      return;
    }
    try {
      setEnrolling(true);
      const res = await fetch("/api/security/devices/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceHostname: enrollHostname.trim().toUpperCase(),
          deviceSerial: enrollSerial.trim() || undefined,
          employeeEmail: enrollEmail.trim().toLowerCase() || undefined,
          employeeCode: enrollCode.trim().toUpperCase() || undefined,
          policyMode: "strict_block",
          usbBlocked: true,
          firewallActive: true,
        }),
      });

      if (!res.ok) throw new Error("Enrollment failed");
      toast.success(`Device ${enrollHostname.toUpperCase()} enrolled with strict security policy`);
      setEnrollModalOpen(false);
      setEnrollHostname("");
      setEnrollSerial("");
      setEnrollEmail("");
      setEnrollCode("");
      await fetchDevices();
    } catch (err: any) {
      toast.error(err.message || "Failed to enroll device");
    } finally {
      setEnrolling(false);
    }
  };

  const copyPowerShellCommand = () => {
    const cmd = `Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12; iex ((New-Object System.Net.WebClient).DownloadString('https://hrms.circuvent.com/security/Install-CircuventPolicy.ps1'))`;
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    toast.success("PowerShell deployment one-liner copied to clipboard!");
    setTimeout(() => setCopiedCmd(false), 3000);
  };

  const filteredDevices = devices.filter((d) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.deviceHostname.toLowerCase().includes(q) ||
      (d.employeeEmail || "").toLowerCase().includes(q) ||
      (d.employeeCode || "").toLowerCase().includes(q) ||
      (d.deviceSerial || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <HardDrive className="h-7 w-7 text-primary" />
              Device Guard &amp; Laptop Management
            </h1>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
              WINDOWS ENDPOINT POLICY
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Enforce hardware USB storage lockdown, Windows Firewall egress rules, and background watchdog health across company laptops.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchDevices}
            disabled={loading}
            className="border-border text-foreground hover:bg-muted"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setEnrollModalOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
          >
            <Plus className="h-4 w-4 mr-2" />
            Enroll Laptop
          </Button>
        </div>
      </div>

      {/* Deployment & Provisioning Toolkit Card */}
      <Card className="border-border bg-gradient-to-r from-card/80 to-muted/20 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Terminal className="h-5 w-5 text-emerald-400" />
            Laptop Provisioning &amp; IT Deployment Quick-Setup
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Run this command in an Administrator PowerShell prompt on newly assigned employee laptops to enforce USB storage blocking and register the device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 bg-background/80 p-2.5 rounded-lg border border-border font-mono text-xs text-muted-foreground overflow-x-auto">
            <span className="text-emerald-400 font-bold select-none">&gt;</span>
            <span className="flex-1 text-foreground select-all">
              powershell.exe -ExecutionPolicy Bypass -Command &quot;Invoke-RestMethod https://hrms.circuvent.com/security/windows/Install-CircuventPolicy.ps1 | Invoke-Expression&quot;
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={copyPowerShellCommand}
              className="h-7 px-2 text-xs hover:bg-muted"
            >
              {copiedCmd ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
            <span className="text-muted-foreground font-medium">Download Provisioning Files:</span>
            <a
              href="/security/windows/Install-CircuventPolicy.ps1"
              download="Install-CircuventPolicy.ps1"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <FileCode className="h-3.5 w-3.5" /> Install-CircuventPolicy.ps1
            </a>
            <span className="text-border">&bull;</span>
            <a
              href="/security/windows/CircuventGuard.ps1"
              download="CircuventGuard.ps1"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <FileCode className="h-3.5 w-3.5" /> CircuventGuard.ps1 (Watchdog)
            </a>
            <span className="text-border">&bull;</span>
            <a
              href="/security/windows/usb-storage-block.reg"
              download="usb-storage-block.reg"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <FileCode className="h-3.5 w-3.5" /> usb-storage-block.reg
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Devices Inventory Table */}
      <Card className="border-border bg-card/60 backdrop-blur-sm overflow-hidden">
        <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Enrolled Laptops &amp; Endpoints</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              {devices.length} corporate laptops actively enforcing security baselines
            </CardDescription>
          </div>
          <div className="w-72">
            <Input
              placeholder="Filter by hostname or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-xs bg-background/50 border-input"
            />
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b border-border text-xs uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3.5 px-4">Laptop Hostname</th>
                <th className="py-3.5 px-4">Assigned Employee</th>
                <th className="py-3.5 px-4">Hardware Serial</th>
                <th className="py-3.5 px-4">USB Storage Block</th>
                <th className="py-3.5 px-4">Firewall Egress</th>
                <th className="py-3.5 px-4">Agent Version</th>
                <th className="py-3.5 px-4">Last Check-In</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading enrolled laptops...
                  </td>
                </tr>
              ) : filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12">
                    <DataEmptyState
                      title="No laptops enrolled yet"
                      description="Deploy the installer script or click 'Enroll Laptop' to register your first Windows machine."
                    />
                  </td>
                </tr>
              ) : (
                filteredDevices.map((device) => (
                  <tr key={device.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 font-medium text-foreground text-xs flex items-center gap-2">
                      <Laptop className="h-4 w-4 text-primary" />
                      <div>
                        <div>{device.deviceHostname}</div>
                        <div className="text-[10px] text-muted-foreground">{device.osVersion || "Windows 11"}</div>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-foreground">
                        {device.employeeEmail || "Unassigned"}
                      </div>
                      {device.employeeCode && (
                        <div className="text-[10px] text-muted-foreground">{device.employeeCode}</div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-xs font-mono text-muted-foreground">
                      {device.deviceSerial || "N/A"}
                    </td>

                    <td className="py-3 px-4">
                      {device.usbBlocked ? (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[11px] font-semibold">
                          <Lock className="h-3 w-3 mr-1" /> STRICT BLOCK
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-rose-400 border-rose-500/20 text-[11px]">
                          DISABLED
                        </Badge>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {device.firewallActive ? (
                        <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-[11px] font-semibold">
                          <Flame className="h-3 w-3 mr-1" /> ACTIVE
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground text-[11px]">
                          OFF
                        </Badge>
                      )}
                    </td>

                    <td className="py-3 px-4 text-xs font-mono text-muted-foreground">
                      v{device.agentVersion || "2.4.0"}
                    </td>

                    <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                      {device.lastHeartbeatAt ? (
                        <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          {new Date(device.lastHeartbeatAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">Pending initial ping</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Manual Enroll Modal */}
      <Dialog open={enrollModalOpen} onOpenChange={setEnrollModalOpen}>
        <DialogContent className="sm:max-w-[480px] bg-card border-border text-foreground">
          <form onSubmit={handleEnrollDevice}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <Laptop className="h-5 w-5 text-primary" /> Enroll Windows Laptop
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Assign a company laptop to an employee and activate the hardware USB blocking policy.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4 text-xs">
              <div className="space-y-1">
                <Label htmlFor="hostname">Laptop Hostname *</Label>
                <Input
                  id="hostname"
                  placeholder="e.g. LAPTOP-CIRCUVENT-01"
                  value={enrollHostname}
                  onChange={(e) => setEnrollHostname(e.target.value)}
                  className="text-xs bg-background/50 border-input"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="serial">BIOS / Device Serial Number</Label>
                <Input
                  id="serial"
                  placeholder="e.g. CV-SN-9283719"
                  value={enrollSerial}
                  onChange={(e) => setEnrollSerial(e.target.value)}
                  className="text-xs bg-background/50 border-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="email">Employee Work Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@circuvent.com"
                    value={enrollEmail}
                    onChange={(e) => setEnrollEmail(e.target.value)}
                    className="text-xs bg-background/50 border-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="code">Employee Code</Label>
                  <Input
                    id="code"
                    placeholder="e.g. CV-001"
                    value={enrollCode}
                    onChange={(e) => setEnrollCode(e.target.value)}
                    className="text-xs bg-background/50 border-input"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEnrollModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={enrolling}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {enrolling ? "Enrolling..." : "Enroll Device"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
