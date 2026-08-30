"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HardDrive, ShieldCheck, Laptop, Copy, Check, Download,
  RefreshCw, Plus, Terminal, Lock, Unlock, Flame, Globe, AlertCircle, FileCode,
  Eye, MoreVertical, AlertTriangle, CheckCircle2, XCircle, Clock,
  Cpu, Layers, Zap, ShieldAlert, Activity, AppWindow, RotateCw
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
  osFamily: "windows" | "macos" | "linux";
  osBuild?: string | null;
  encryptionStatus: "encrypted" | "unencrypted" | "encrypting" | "unknown";
  encryptionType: "bitlocker" | "filevault" | "luks" | "none";
  missingPatchesCount: number;
  pendingUpdates?: Array<{ title: string; kbArticle?: string; isSecurity?: boolean }> | null;
  complianceScore: number;
  complianceStatus: "compliant" | "warning" | "critical_risk";
  hardwareSpecs?: {
    processor?: string;
    ramGb?: number;
    diskGb?: number;
    macAddress?: string;
    manufacturer?: string;
    model?: string;
  } | null;
  lastPatchScanAt?: string | null;
  lastSoftwareScanAt?: string | null;
  lastHeartbeatAt?: string | null;
  createdAt: string;
}

interface InstalledSoftwareItem {
  id: string;
  name: string;
  version?: string | null;
  publisher?: string | null;
  isBlacklisted: boolean;
  category: string;
  riskLevel: string;
}

interface DeviceCommandItem {
  id: string;
  deviceHostname: string;
  commandType: string;
  status: string;
  issuedByEmail?: string | null;
  issuedAt: string;
  executedAt?: string | null;
  resultOutput?: string | null;
  errorMessage?: string | null;
}

export default function SecurityDevicesPage() {
  const [devices, setDevices] = useState<DevicePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [osFilter, setOsFilter] = useState("all");
  const [complianceFilter, setComplianceFilter] = useState("all");
  const [copiedOs, setCopiedOs] = useState<string | null>(null);

  // Modals
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [enrollHostname, setEnrollHostname] = useState("");
  const [enrollSerial, setEnrollSerial] = useState("");
  const [enrollEmail, setEnrollEmail] = useState("");
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollOs, setEnrollOs] = useState<"windows" | "macos" | "linux">("windows");
  const [enrolling, setEnrolling] = useState(false);

  // Detail Modal
  const [detailDevice, setDetailDevice] = useState<DevicePolicy | null>(null);
  const [deviceSoftware, setDeviceSoftware] = useState<InstalledSoftwareItem[]>([]);
  const [loadingSoftware, setLoadingSoftware] = useState(false);

  // Command History Modal
  const [commandsModalOpen, setCommandsModalOpen] = useState(false);
  const [commandsList, setCommandsList] = useState<DeviceCommandItem[]>([]);
  const [loadingCommands, setLoadingCommands] = useState(false);

  // Kill Process Modal
  const [killProcessModalOpen, setKillProcessModalOpen] = useState(false);
  const [killTargetDevice, setKillTargetDevice] = useState<DevicePolicy | null>(null);
  const [processNameToKill, setProcessNameToKill] = useState("AnyDesk.exe");

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

  const fetchCommandsHistory = async () => {
    try {
      setLoadingCommands(true);
      const res = await fetch("/api/security/devices/commands?limit=50");
      if (res.ok) {
        const data = await res.json();
        setCommandsList(data.commands || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingCommands(false);
    }
  };

  const loadDeviceSoftware = async (hostname: string) => {
    try {
      setLoadingSoftware(true);
      const res = await fetch(`/api/security/devices/software?deviceHostname=${encodeURIComponent(hostname)}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setDeviceSoftware(data.software || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSoftware(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    if (detailDevice) {
      loadDeviceSoftware(detailDevice.deviceHostname);
    }
  }, [detailDevice]);

  // Dispatch Remote Command
  const handleDispatchCommand = async (
    deviceHostname: string,
    commandType: string,
    payload: any = {}
  ) => {
    try {
      const res = await fetch("/api/security/devices/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceHostname,
          commandType,
          payload,
          issuedByEmail: "admin@circuvent.com",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Command dispatch failed");
      }

      toast.success(
        `Command '${commandType.replace(/_/g, " ")}' queued for ${deviceHostname}. Agent will execute on next heartbeat.`
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to queue command");
    }
  };

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
          osFamily: enrollOs,
          osVersion: enrollOs === "macos" ? "macOS 15.0" : enrollOs === "linux" ? "Ubuntu 24.04 LTS" : "Windows 11 Enterprise",
          encryptionStatus: "unknown",
          policyMode: "strict_block",
          usbBlocked: true,
          firewallActive: true,
        }),
      });

      if (!res.ok) throw new Error("Enrollment failed");
      toast.success(`Device ${enrollHostname.toUpperCase()} enrolled successfully`);
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

  const copyCommand = (os: string, cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedOs(os);
    toast.success(`${os} deployment one-liner copied to clipboard!`);
    setTimeout(() => setCopiedOs(null), 3000);
  };

  // KPI Calculations
  const stats = useMemo(() => {
    const total = devices.length;
    if (total === 0) {
      return { total: 0, compliantPct: 100, encryptedPct: 100, pendingPatches: 0, blacklistedCount: 0 };
    }
    const compliantCount = devices.filter((d) => d.complianceStatus === "compliant").length;
    const encryptedCount = devices.filter((d) => d.encryptionStatus === "encrypted").length;
    const totalPatches = devices.reduce((sum, d) => sum + (d.missingPatchesCount || 0), 0);
    const criticalRisks = devices.filter((d) => d.complianceStatus === "critical_risk").length;

    return {
      total,
      compliantPct: Math.round((compliantCount / total) * 100),
      encryptedPct: Math.round((encryptedCount / total) * 100),
      pendingPatches: totalPatches,
      criticalRisks,
    };
  }, [devices]);

  const filteredDevices = useMemo(() => {
    return devices.filter((d) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          d.deviceHostname.toLowerCase().includes(q) ||
          (d.employeeEmail || "").toLowerCase().includes(q) ||
          (d.employeeCode || "").toLowerCase().includes(q) ||
          (d.deviceSerial || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      if (osFilter !== "all" && d.osFamily !== osFilter) return false;
      if (complianceFilter !== "all" && d.complianceStatus !== complianceFilter) return false;
      return true;
    });
  }, [devices, searchQuery, osFilter, complianceFilter]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <HardDrive className="h-7 w-7 text-primary" />
              Enterprise Endpoint Security &amp; Fleet Guard
            </h1>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
              MULTI-OS FLEET
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Zero-trust USB lockdown, BitLocker/FileVault/LUKS compliance, patch vulnerability scoring, and remote remediation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchCommandsHistory();
              setCommandsModalOpen(true);
            }}
            className="border-border text-foreground hover:bg-muted text-xs gap-1.5"
          >
            <Activity className="h-4 w-4 text-blue-400" />
            Command Log
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchDevices}
            disabled={loading}
            className="border-border text-foreground hover:bg-muted text-xs"
          >
            <RefreshCw className={cn("h-4 w-4 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setEnrollModalOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Enroll Workstation
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border border-border bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Enrolled Fleet</p>
              <p className="text-2xl font-bold mt-1 text-foreground">{stats.total}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Windows, Mac &amp; Linux</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Laptop className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fleet Compliance</p>
              <p className={cn("text-2xl font-bold mt-1", stats.compliantPct >= 80 ? "text-emerald-400" : "text-amber-400")}>
                {stats.compliantPct}%
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{stats.criticalRisks} critical risk endpoints</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Disk Encryption</p>
              <p className={cn("text-2xl font-bold mt-1", stats.encryptedPct >= 80 ? "text-blue-400" : "text-rose-400")}>
                {stats.encryptedPct}%
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">BitLocker / FileVault / LUKS</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
              <Lock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Patch Vulnerabilities</p>
              <p className={cn("text-2xl font-bold mt-1", stats.pendingPatches === 0 ? "text-emerald-400" : "text-amber-400")}>
                {stats.pendingPatches}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Pending security updates</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400">
              <RotateCw className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Multi-OS Provisioning Terminal */}
      <Card className="border-border bg-gradient-to-r from-card/80 to-muted/20 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Terminal className="h-5 w-5 text-emerald-400" />
            Multi-OS Endpoint Provisioning &amp; Agent Deployment
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Execute the respective 1-line provisioning command on newly assigned company workstations to enforce USB lockdown, encryption audit, and watchdog monitoring.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="windows" className="w-full">
            <TabsList className="bg-background/80 p-1 mb-3">
              <TabsTrigger value="windows" className="text-xs gap-1.5">
                <Laptop className="h-3.5 w-3.5" /> Windows (PowerShell)
              </TabsTrigger>
              <TabsTrigger value="macos" className="text-xs gap-1.5">
                <AppWindow className="h-3.5 w-3.5" /> macOS (Apple Silicon &amp; Intel)
              </TabsTrigger>
              <TabsTrigger value="linux" className="text-xs gap-1.5">
                <Terminal className="h-3.5 w-3.5" /> Linux (Ubuntu / RHEL / Debian)
              </TabsTrigger>
            </TabsList>

            {/* Windows Tab */}
            <TabsContent value="windows" className="space-y-2 mt-0">
              <div className="flex items-center gap-2 bg-background/90 p-2.5 rounded-lg border border-border font-mono text-xs text-muted-foreground overflow-x-auto">
                <span className="text-emerald-400 font-bold select-none">PS&gt;</span>
                <span className="flex-1 text-foreground select-all">
                  powershell.exe -ExecutionPolicy Bypass -Command &quot;Invoke-RestMethod https://hrms.circuvent.com/security/windows/Install-CircuventPolicy.ps1 | Invoke-Expression&quot;
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    copyCommand(
                      "Windows",
                      `powershell.exe -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://hrms.circuvent.com/security/windows/Install-CircuventPolicy.ps1 | Invoke-Expression"`
                    )
                  }
                  className="h-7 px-2 text-xs hover:bg-muted"
                >
                  {copiedOs === "Windows" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
                <span>Download Assets:</span>
                <a href="/security/windows/Install-CircuventPolicy.ps1" download className="text-primary hover:underline flex items-center gap-1">
                  <FileCode className="h-3.5 w-3.5" /> Install-CircuventPolicy.ps1
                </a>
                <span>&bull;</span>
                <a href="/security/windows/CircuventGuard.ps1" download className="text-primary hover:underline flex items-center gap-1">
                  <FileCode className="h-3.5 w-3.5" /> CircuventGuard.ps1
                </a>
              </div>
            </TabsContent>

            {/* macOS Tab */}
            <TabsContent value="macos" className="space-y-2 mt-0">
              <div className="flex items-center gap-2 bg-background/90 p-2.5 rounded-lg border border-border font-mono text-xs text-muted-foreground overflow-x-auto">
                <span className="text-blue-400 font-bold select-none">sh$</span>
                <span className="flex-1 text-foreground select-all">
                  curl -sSL https://hrms.circuvent.com/security/macos/Install-CircuventPolicy.sh | sudo bash
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    copyCommand(
                      "macOS",
                      "curl -sSL https://hrms.circuvent.com/security/macos/Install-CircuventPolicy.sh | sudo bash"
                    )
                  }
                  className="h-7 px-2 text-xs hover:bg-muted"
                >
                  {copiedOs === "macOS" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
                <span>Download Assets:</span>
                <a href="/security/macos/Install-CircuventPolicy.sh" download className="text-primary hover:underline flex items-center gap-1">
                  <FileCode className="h-3.5 w-3.5" /> Install-CircuventPolicy.sh
                </a>
                <span>&bull;</span>
                <a href="/security/macos/CircuventGuard.sh" download className="text-primary hover:underline flex items-center gap-1">
                  <FileCode className="h-3.5 w-3.5" /> CircuventGuard.sh
                </a>
              </div>
            </TabsContent>

            {/* Linux Tab */}
            <TabsContent value="linux" className="space-y-2 mt-0">
              <div className="flex items-center gap-2 bg-background/90 p-2.5 rounded-lg border border-border font-mono text-xs text-muted-foreground overflow-x-auto">
                <span className="text-amber-400 font-bold select-none">#</span>
                <span className="flex-1 text-foreground select-all">
                  curl -sSL https://hrms.circuvent.com/security/linux/Install-CircuventPolicy.sh | sudo bash
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    copyCommand(
                      "Linux",
                      "curl -sSL https://hrms.circuvent.com/security/linux/Install-CircuventPolicy.sh | sudo bash"
                    )
                  }
                  className="h-7 px-2 text-xs hover:bg-muted"
                >
                  {copiedOs === "Linux" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
                <span>Download Assets:</span>
                <a href="/security/linux/Install-CircuventPolicy.sh" download className="text-primary hover:underline flex items-center gap-1">
                  <FileCode className="h-3.5 w-3.5" /> Install-CircuventPolicy.sh
                </a>
                <span>&bull;</span>
                <a href="/security/linux/99-circuvent-usb-block.rules" download className="text-primary hover:underline flex items-center gap-1">
                  <FileCode className="h-3.5 w-3.5" /> 99-circuvent-usb-block.rules
                </a>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Devices Inventory Table */}
      <Card className="border-border bg-card/60 backdrop-blur-sm overflow-hidden">
        <CardHeader className="p-4 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold">Enrolled Workstations &amp; Telemetry Matrix</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              {filteredDevices.length} devices reporting real-time encryption, patch compliance, and USB enforcement
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={osFilter}
              onChange={(e) => setOsFilter(e.target.value)}
              className="h-8 text-xs bg-background/50 border border-input rounded-md px-2 text-foreground"
            >
              <option value="all">All OS Platforms</option>
              <option value="windows">Windows</option>
              <option value="macos">macOS</option>
              <option value="linux">Linux</option>
            </select>

            <select
              value={complianceFilter}
              onChange={(e) => setComplianceFilter(e.target.value)}
              className="h-8 text-xs bg-background/50 border border-input rounded-md px-2 text-foreground"
            >
              <option value="all">All Compliance Statuses</option>
              <option value="compliant">Compliant</option>
              <option value="warning">Warning</option>
              <option value="critical_risk">Critical Risk</option>
            </select>

            <Input
              placeholder="Filter hostname, email, serial..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-xs w-60 bg-background/50 border-input"
            />
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b border-border text-xs uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3.5 px-4">Endpoint Hostname</th>
                <th className="py-3.5 px-4">Assigned User</th>
                <th className="py-3.5 px-4">Disk Encryption</th>
                <th className="py-3.5 px-4">Patch Status</th>
                <th className="py-3.5 px-4">USB Lockdown</th>
                <th className="py-3.5 px-4">Compliance</th>
                <th className="py-3.5 px-4">Last Check-In</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading enrolled endpoints...
                  </td>
                </tr>
              ) : filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12">
                    <DataEmptyState
                      title="No endpoints matching filter"
                      description="Deploy the multi-OS provisioning script or clear search filters to inspect workstations."
                    />
                  </td>
                </tr>
              ) : (
                filteredDevices.map((device) => (
                  <tr key={device.id} className="hover:bg-muted/30 transition-colors">
                    {/* Hostname & OS */}
                    <td className="py-3 px-4 font-medium text-foreground text-xs">
                      <div className="flex items-center gap-2">
                        {device.osFamily === "macos" ? (
                          <AppWindow className="h-4 w-4 text-blue-400 shrink-0" />
                        ) : device.osFamily === "linux" ? (
                          <Terminal className="h-4 w-4 text-amber-400 shrink-0" />
                        ) : (
                          <Laptop className="h-4 w-4 text-primary shrink-0" />
                        )}
                        <div>
                          <div className="font-bold">{device.deviceHostname}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {device.osVersion || "Windows 11"} &bull; v{device.agentVersion || "2.5.0"}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Employee */}
                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-foreground">
                        {device.employeeEmail || "Unassigned"}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {device.employeeCode ? `${device.employeeCode} • ` : ""}SN: {device.deviceSerial || "N/A"}
                      </div>
                    </td>

                    {/* Encryption */}
                    <td className="py-3 px-4 text-xs">
                      {device.encryptionStatus === "encrypted" ? (
                        <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-[11px] font-semibold flex items-center gap-1 w-fit">
                          <Lock className="h-3 w-3" />
                          {device.encryptionType === "filevault"
                            ? "FileVault 2"
                            : device.encryptionType === "luks"
                            ? "LUKS Encrypted"
                            : "BitLocker"}
                        </Badge>
                      ) : device.encryptionStatus === "encrypting" ? (
                        <Badge variant="outline" className="text-amber-400 border-amber-500/20 text-[11px] flex items-center gap-1 w-fit">
                          <RotateCw className="h-3 w-3 animate-spin" /> Encrypting...
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-[11px] font-semibold flex items-center gap-1 w-fit">
                          <Unlock className="h-3 w-3" /> Unencrypted
                        </Badge>
                      )}
                    </td>

                    {/* Patch Status */}
                    <td className="py-3 px-4 text-xs">
                      {device.missingPatchesCount === 0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Up to Date
                        </span>
                      ) : (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[11px] font-medium">
                          {device.missingPatchesCount} Updates Pending
                        </Badge>
                      )}
                    </td>

                    {/* USB Lockdown */}
                    <td className="py-3 px-4">
                      {device.usbBlocked ? (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[11px] font-semibold">
                          STRICT BLOCK
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-rose-400 border-rose-500/20 text-[11px]">
                          DISABLED
                        </Badge>
                      )}
                    </td>

                    {/* Compliance Score */}
                    <td className="py-3 px-4 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-[11px] font-bold border",
                            device.complianceScore >= 90
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              : device.complianceScore >= 60
                              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                              : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                          )}
                        >
                          {device.complianceScore ?? 100}/100
                        </span>
                      </div>
                    </td>

                    {/* Last Heartbeat */}
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

                    {/* Remote Remediation Actions */}
                    <td className="py-3 px-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 text-xs bg-card border-border">
                          <DropdownMenuLabel>Remediation Actions</DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => setDetailDevice(device)}
                            className="cursor-pointer gap-2"
                          >
                            <Eye className="h-3.5 w-3.5 text-blue-400" /> Device Telemetry &amp; Apps
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={() => handleDispatchCommand(device.deviceHostname, "lock_device")}
                            className="cursor-pointer gap-2 text-rose-400 focus:text-rose-400"
                          >
                            <Lock className="h-3.5 w-3.5" /> Remote Lock Screen
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => handleDispatchCommand(device.deviceHostname, "policy_refresh")}
                            className="cursor-pointer gap-2"
                          >
                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Force Policy Refresh
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => handleDispatchCommand(device.deviceHostname, "trigger_scan")}
                            className="cursor-pointer gap-2"
                          >
                            <RotateCw className="h-3.5 w-3.5 text-amber-400" /> Run Compliance Rescan
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => {
                              setKillTargetDevice(device);
                              setKillProcessModalOpen(true);
                            }}
                            className="cursor-pointer gap-2 text-rose-400 focus:text-rose-400"
                          >
                            <Zap className="h-3.5 w-3.5" /> Kill Rogue Process...
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => handleDispatchCommand(device.deviceHostname, "wipe_cache")}
                            className="cursor-pointer gap-2 text-muted-foreground"
                          >
                            <HardDrive className="h-3.5 w-3.5" /> Wipe Local Cache
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: DEVICE TELEMETRY, SOFTWARE & PATCHES                     */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={!!detailDevice} onOpenChange={(open) => !open && setDetailDevice(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Laptop className="h-5 w-5 text-primary" /> {detailDevice?.deviceHostname} — Endpoint Profile
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Hardware specifications, disk encryption, OS updates, and installed software catalog.
            </DialogDescription>
          </DialogHeader>

          {detailDevice && (
            <Tabs defaultValue="specs" className="w-full mt-2">
              <TabsList className="grid grid-cols-3 w-full bg-background/80">
                <TabsTrigger value="specs" className="text-xs">Hardware &amp; Security</TabsTrigger>
                <TabsTrigger value="software" className="text-xs">Installed Software ({deviceSoftware.length})</TabsTrigger>
                <TabsTrigger value="patches" className="text-xs">Updates ({detailDevice.missingPatchesCount})</TabsTrigger>
              </TabsList>

              {/* Hardware & Security Specs */}
              <TabsContent value="specs" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-muted/40 p-3 rounded-lg border border-border">
                    <span className="text-muted-foreground block">OS Platform</span>
                    <span className="font-semibold text-foreground capitalize">{detailDevice.osFamily} ({detailDevice.osVersion || "N/A"})</span>
                  </div>

                  <div className="bg-muted/40 p-3 rounded-lg border border-border">
                    <span className="text-muted-foreground block">Disk Encryption</span>
                    <span className={cn("font-semibold capitalize", detailDevice.encryptionStatus === "encrypted" ? "text-blue-400" : "text-rose-400")}>
                      {detailDevice.encryptionStatus} ({detailDevice.encryptionType})
                    </span>
                  </div>

                  <div className="bg-muted/40 p-3 rounded-lg border border-border">
                    <span className="text-muted-foreground block">Compliance Score</span>
                    <span className="font-semibold text-emerald-400">{detailDevice.complianceScore}/100</span>
                  </div>

                  <div className="bg-muted/40 p-3 rounded-lg border border-border">
                    <span className="text-muted-foreground block">Processor / CPU</span>
                    <span className="font-semibold text-foreground">{detailDevice.hardwareSpecs?.processor || "N/A"}</span>
                  </div>

                  <div className="bg-muted/40 p-3 rounded-lg border border-border">
                    <span className="text-muted-foreground block">Memory (RAM)</span>
                    <span className="font-semibold text-foreground">{detailDevice.hardwareSpecs?.ramGb ? `${detailDevice.hardwareSpecs.ramGb} GB` : "16 GB"}</span>
                  </div>

                  <div className="bg-muted/40 p-3 rounded-lg border border-border">
                    <span className="text-muted-foreground block">Storage Capacity</span>
                    <span className="font-semibold text-foreground">{detailDevice.hardwareSpecs?.diskGb ? `${detailDevice.hardwareSpecs.diskGb} GB` : "512 GB"}</span>
                  </div>
                </div>

                <div className="bg-muted/30 p-3 rounded-lg border border-border text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Serial Number:</span>
                    <span className="font-mono text-foreground">{detailDevice.deviceSerial || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Assigned User:</span>
                    <span className="text-foreground">{detailDevice.employeeEmail || "Unassigned"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Agent Version:</span>
                    <span className="text-foreground">CircuventGuard v{detailDevice.agentVersion || "2.5.0"}</span>
                  </div>
                </div>
              </TabsContent>

              {/* Installed Software Tab */}
              <TabsContent value="software" className="mt-4">
                {loadingSoftware ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" /> Loading software inventory...
                  </div>
                ) : deviceSoftware.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No software inventory uploaded yet. Trigger a scan via Remote Actions.
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto border border-border rounded-lg">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted/60 text-muted-foreground font-semibold sticky top-0">
                        <tr>
                          <th className="p-2.5">Application Name</th>
                          <th className="p-2.5">Version</th>
                          <th className="p-2.5">Category</th>
                          <th className="p-2.5">Risk Level</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {deviceSoftware.map((app) => (
                          <tr key={app.id} className="hover:bg-muted/20">
                            <td className="p-2.5 font-medium text-foreground flex items-center gap-1.5">
                              {app.isBlacklisted && <ShieldAlert className="h-3.5 w-3.5 text-rose-400 shrink-0" />}
                              {app.name}
                            </td>
                            <td className="p-2.5 text-muted-foreground font-mono">{app.version || "1.0.0"}</td>
                            <td className="p-2.5 capitalize text-muted-foreground">{app.category.replace(/_/g, " ")}</td>
                            <td className="p-2.5">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] uppercase font-bold",
                                  app.riskLevel === "critical"
                                    ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                    : app.riskLevel === "high"
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                )}
                              >
                                {app.riskLevel}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>

              {/* Missing Patches Tab */}
              <TabsContent value="patches" className="mt-4">
                {detailDevice.missingPatchesCount === 0 ? (
                  <div className="py-8 text-center text-xs text-emerald-400 flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-8 w-8" />
                    <span>This workstation is fully patched and up to date.</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">The following updates were reported as pending installation:</p>
                    <div className="max-h-60 overflow-y-auto space-y-1.5 border border-border p-2 rounded-lg bg-muted/20">
                      {detailDevice.pendingUpdates && detailDevice.pendingUpdates.length > 0 ? (
                        detailDevice.pendingUpdates.map((u, i) => (
                          <div key={i} className="p-2 rounded bg-card border border-border flex items-center justify-between text-xs">
                            <span className="font-medium text-foreground">{u.title}</span>
                            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/20">
                              {u.kbArticle || "Security Patch"}
                            </Badge>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-muted-foreground p-2">
                          {detailDevice.missingPatchesCount} pending updates detected on endpoint.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setDetailDevice(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: REMOTE COMMAND AUDIT LOG                                 */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={commandsModalOpen} onOpenChange={setCommandsModalOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-400" /> Remote Command Activity Log
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Audit trail of all remote locks, policy refreshes, process kills, and scans dispatched to endpoints.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            {loadingCommands ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" /> Loading command logs...
              </div>
            ) : commandsList.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No remote commands issued yet.
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/60 text-muted-foreground font-semibold">
                    <tr>
                      <th className="p-2.5">Hostname</th>
                      <th className="p-2.5">Command</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Issued At</th>
                      <th className="p-2.5">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {commandsList.map((cmd) => (
                      <tr key={cmd.id} className="hover:bg-muted/20">
                        <td className="p-2.5 font-bold text-foreground">{cmd.deviceHostname}</td>
                        <td className="p-2.5 font-mono text-primary capitalize">{cmd.commandType.replace(/_/g, " ")}</td>
                        <td className="p-2.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] uppercase font-bold",
                              cmd.status === "completed"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : cmd.status === "failed"
                                ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            )}
                          >
                            {cmd.status}
                          </Badge>
                        </td>
                        <td className="p-2.5 text-muted-foreground">
                          {new Date(cmd.issuedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="p-2.5 text-muted-foreground truncate max-w-[200px]" title={cmd.resultOutput || cmd.errorMessage || ""}>
                          {cmd.resultOutput || cmd.errorMessage || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setCommandsModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: KILL ROGUE PROCESS                                      */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={killProcessModalOpen} onOpenChange={setKillProcessModalOpen}>
        <DialogContent className="sm:max-w-[420px] bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-rose-400">
              <Zap className="h-5 w-5" /> Terminate Rogue Process
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Dispatch an immediate process termination instruction to {killTargetDevice?.deviceHostname}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3 text-xs">
            <div className="space-y-1">
              <Label htmlFor="procName">Executable / Process Name</Label>
              <Input
                id="procName"
                placeholder="e.g. AnyDesk.exe, uTorrent.exe, wireshark"
                value={processNameToKill}
                onChange={(e) => setProcessNameToKill(e.target.value)}
                className="text-xs bg-background/50 border-input"
              />
            </div>
          </div>

          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setKillProcessModalOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs"
              onClick={() => {
                if (killTargetDevice && processNameToKill.trim()) {
                  handleDispatchCommand(killTargetDevice.deviceHostname, "kill_process", {
                    processName: processNameToKill.trim(),
                  });
                  setKillProcessModalOpen(false);
                }
              }}
            >
              Dispatch Kill Command
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: MANUAL ENROLL WORKSTATION                               */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={enrollModalOpen} onOpenChange={setEnrollModalOpen}>
        <DialogContent className="sm:max-w-[480px] bg-card border-border text-foreground">
          <form onSubmit={handleEnrollDevice}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <Laptop className="h-5 w-5 text-primary" /> Enroll Workstation
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Register a company laptop or desktop and activate endpoint compliance tracking.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4 text-xs">
              <div className="space-y-1">
                <Label>OS Platform</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant={enrollOs === "windows" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setEnrollOs("windows")}
                    className="text-xs"
                  >
                    Windows
                  </Button>
                  <Button
                    type="button"
                    variant={enrollOs === "macos" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setEnrollOs("macos")}
                    className="text-xs"
                  >
                    macOS
                  </Button>
                  <Button
                    type="button"
                    variant={enrollOs === "linux" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setEnrollOs("linux")}
                    className="text-xs"
                  >
                    Linux
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="hostname">Workstation Hostname *</Label>
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
                <Label htmlFor="serial">Serial Number</Label>
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
                  <Label htmlFor="email">Employee Email</Label>
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
              <Button type="button" variant="outline" size="sm" onClick={() => setEnrollModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={enrolling} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                {enrolling ? "Enrolling..." : "Enroll Workstation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
