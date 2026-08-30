"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  ShieldAlert, HardDrive, ShieldCheck, AlertTriangle,
  Search, RefreshCw, Eye, CheckCircle2, Lock, Terminal,
  Laptop, Mail, Clock, Filter, ArrowUpRight, Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DataEmptyState } from "@/components/data-empty-state";

interface SecurityIncident {
  id: string;
  orgId: string;
  employeeId?: string | null;
  employeeCode?: string | null;
  employeeEmail?: string | null;
  deviceHostname: string;
  deviceSerial?: string | null;
  deviceUsername?: string | null;
  incidentType: string;
  severity: "critical" | "high" | "medium" | "low";
  actionTaken: string;
  osVersion?: string | null;
  metadata: Record<string, any>;
  status: "open" | "investigating" | "resolved" | "dismissed";
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  emailAlertSent: boolean;
  createdAt: string;
}

export default function SecurityIncidentsPage() {
  const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const [selectedIncident, setSelectedIncident] = useState<SecurityIncident | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Simulation test state
  const [simulating, setSimulating] = useState(false);

  const fetchIncidents = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/security/incidents");
      if (!res.ok) throw new Error("Failed to load incidents");
      const data = await res.json();
      setIncidents(data.incidents || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, []);

  const stats = useMemo(() => {
    const total = incidents.length;
    const critical = incidents.filter((i) => i.severity === "critical").length;
    const open = incidents.filter((i) => i.status === "open").length;
    const usbBlocks = incidents.filter((i) => i.incidentType.includes("usb") || i.incidentType.includes("storage")).length;
    return { total, critical, open, usbBlocks };
  }, [incidents]);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (selectedSeverity !== "all" && inc.severity !== selectedSeverity) return false;
      if (selectedStatus !== "all" && inc.status !== selectedStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const host = inc.deviceHostname.toLowerCase();
        const email = (inc.employeeEmail || "").toLowerCase();
        const code = (inc.employeeCode || "").toLowerCase();
        const type = inc.incidentType.toLowerCase();
        const vendor = (inc.metadata?.vendor || "").toLowerCase();
        return host.includes(q) || email.includes(q) || code.includes(q) || type.includes(q) || vendor.includes(q);
      }
      return true;
    });
  }, [incidents, selectedSeverity, selectedStatus, searchQuery]);

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedIncident) return;
    try {
      setUpdatingStatus(true);
      const res = await fetch("/api/security/incidents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedIncident.id,
          status: newStatus,
          resolutionNotes,
        }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      const data = await res.json();
      toast.success(`Incident status updated to ${newStatus}`);
      setIncidents((prev) =>
        prev.map((i) => (i.id === selectedIncident.id ? { ...i, status: newStatus as any, resolutionNotes } : i))
      );
      setSelectedIncident((prev) => (prev ? { ...prev, status: newStatus as any, resolutionNotes } : null));
      setDetailModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update incident");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSimulateIncident = async () => {
    try {
      setSimulating(true);
      const res = await fetch("/api/security/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceHostname: "LAPTOP-CIRCUVENT-04",
          deviceSerial: "CV-SN-8924192",
          deviceUsername: "vema",
          employeeEmail: "vema@circuvent.com",
          employeeCode: "CV-001",
          incidentType: "unauthorized_usb_drive",
          severity: "critical",
          actionTaken: "blocked_and_ejected",
          osVersion: "Windows 11 Pro 64-bit",
          metadata: {
            driveLetter: "E:",
            volumeName: "SANDISK_ULTRA",
            volumeSerial: "904A-F112",
            sizeGB: 64,
            vendor: "SanDisk Corp.",
            model: "Ultra USB 3.0 Flash Drive",
            pnpDeviceID: "USB\\VID_0781&PID_5581\\4C530001290807119283",
          },
        }),
      });

      if (!res.ok) throw new Error("Simulation failed");
      toast.success("Simulated USB drive block recorded! Alert email triggered.");
      await fetchIncidents();
    } catch (err: any) {
      toast.error(err.message || "Failed to simulate incident");
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <ShieldAlert className="h-7 w-7 text-rose-500" />
              Security &amp; DLP Console
            </h1>
            <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-xs font-semibold">
              REAL-TIME MONITORING
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Live hardware protection, USB removable storage blocking, and automated DLP violation alerts for Windows laptops.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchIncidents}
            disabled={loading}
            className="border-border text-foreground hover:bg-muted"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleSimulateIncident}
            disabled={simulating}
            className="bg-rose-600 hover:bg-rose-700 text-white font-medium shadow-sm"
          >
            <Zap className="h-4 w-4 mr-2" />
            {simulating ? "Simulating..." : "Test USB Block Incident"}
          </Button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border bg-card/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Total Violations
            </CardTitle>
            <ShieldAlert className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">Captured across enrolled laptops</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              USB Storage Neutralized
            </CardTitle>
            <HardDrive className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">{stats.usbBlocks}</div>
            <p className="text-xs text-muted-foreground mt-1">Drives dismounted &amp; locked</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Critical Severity
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-400">{stats.critical}</div>
            <p className="text-xs text-muted-foreground mt-1">High-risk exfiltration alerts</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Active / Open Cases
            </CardTitle>
            <Lock className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-400">{stats.open}</div>
            <p className="text-xs text-muted-foreground mt-1">Pending investigation or sign-off</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="border-border bg-card/40">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by laptop hostname, employee email, USB vendor, or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-background/50 border-input"
              />
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto">
              <Select value={selectedSeverity} onValueChange={setSelectedSeverity}>
                <SelectTrigger className="w-[140px] bg-background/50 border-input">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="w-[150px] bg-background/50 border-input">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="dismissed">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Incidents Table */}
      <Card className="border-border bg-card/60 backdrop-blur-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b border-border text-xs uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3.5 px-4">Severity &amp; Type</th>
                <th className="py-3.5 px-4">Employee / Host</th>
                <th className="py-3.5 px-4">Detected Hardware</th>
                <th className="py-3.5 px-4">Action Taken</th>
                <th className="py-3.5 px-4">Alert Status</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Timestamp</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading security incidents...
                  </td>
                </tr>
              ) : filteredIncidents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12">
                    <DataEmptyState
                      title="No security incidents logged"
                      description="No policy violations or unauthorized USB storage connections have been recorded yet."
                    />
                  </td>
                </tr>
              ) : (
                filteredIncidents.map((incident) => {
                  const meta = incident.metadata || {};
                  return (
                    <tr
                      key={incident.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => {
                        setSelectedIncident(incident);
                        setResolutionNotes(incident.resolutionNotes || "");
                        setDetailModalOpen(true);
                      }}
                    >
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              className={cn(
                                "text-[10px] uppercase font-bold px-1.5 py-0.5",
                                incident.severity === "critical"
                                  ? "bg-rose-500 text-white"
                                  : incident.severity === "high"
                                  ? "bg-amber-500 text-white"
                                  : "bg-blue-500 text-white"
                              )}
                            >
                              {incident.severity}
                            </Badge>
                          </div>
                          <span className="font-medium text-foreground text-xs">
                            {incident.incidentType === "unauthorized_usb_drive"
                              ? "USB Drive Connection"
                              : incident.incidentType.replace(/_/g, " ")}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground text-xs flex items-center gap-1">
                            <Laptop className="h-3.5 w-3.5 text-muted-foreground" />
                            {incident.deviceHostname}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {incident.employeeEmail || incident.employeeCode || "Unassigned"}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-col text-xs">
                          {meta.vendor || meta.model ? (
                            <>
                              <span className="font-medium text-foreground">
                                {meta.vendor} {meta.model}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                Drive {meta.driveLetter || "?"} &bull; {meta.sizeGB || "?"} GB
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground italic">Hardware details omitted</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[11px]">
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          {incident.actionTaken.toUpperCase()}
                        </Badge>
                      </td>

                      <td className="py-3 px-4">
                        {incident.emailAlertSent ? (
                          <span className="text-emerald-400 text-xs flex items-center gap-1 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Sent
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" /> Pending
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-xs font-semibold capitalize",
                            incident.status === "open" && "bg-rose-500/20 text-rose-300",
                            incident.status === "investigating" && "bg-amber-500/20 text-amber-300",
                            incident.status === "resolved" && "bg-emerald-500/20 text-emerald-300",
                            incident.status === "dismissed" && "bg-slate-500/20 text-slate-300"
                          )}
                        >
                          {incident.status}
                        </Badge>
                      </td>

                      <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(incident.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedIncident(incident);
                            setResolutionNotes(incident.resolutionNotes || "");
                            setDetailModalOpen(true);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" /> View
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Incident Detail & Forensics Modal */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="sm:max-w-[650px] bg-card border-border text-foreground">
          {selectedIncident && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Badge
                    className={cn(
                      "text-[11px] uppercase font-bold",
                      selectedIncident.severity === "critical"
                        ? "bg-rose-600 text-white"
                        : "bg-amber-600 text-white"
                    )}
                  >
                    {selectedIncident.severity}
                  </Badge>
                  <DialogTitle className="text-lg font-bold">
                    Incident Forensics &amp; Audit Trail
                  </DialogTitle>
                </div>
                <DialogDescription className="text-xs text-muted-foreground">
                  Event ID: {selectedIncident.id} &bull; Recorded on{" "}
                  {new Date(selectedIncident.createdAt).toUTCString()}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2 text-xs">
                {/* Employee and Laptop Summary */}
                <div className="grid grid-cols-2 gap-3 p-3 bg-muted/40 rounded-lg border border-border">
                  <div>
                    <span className="text-muted-foreground block">Employee Identity</span>
                    <span className="font-semibold text-foreground text-sm">
                      {selectedIncident.employeeEmail || "Unassigned"}
                    </span>
                    <span className="text-[11px] text-muted-foreground block">
                      Code: {selectedIncident.employeeCode || "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Device Information</span>
                    <span className="font-semibold text-foreground text-sm">
                      {selectedIncident.deviceHostname}
                    </span>
                    <span className="text-[11px] text-muted-foreground block">
                      Serial: {selectedIncident.deviceSerial || "N/A"} &bull; {selectedIncident.osVersion || "Windows"}
                    </span>
                  </div>
                </div>

                {/* Device Hardware Metadata */}
                <div>
                  <h4 className="font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                    <HardDrive className="h-4 w-4 text-amber-500" />
                    Detected External Storage Hardware
                  </h4>
                  <div className="bg-background/80 p-3 rounded-lg border border-border space-y-1.5 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Vendor / Manufacturer:</span>
                      <span className="text-foreground font-semibold">
                        {selectedIncident.metadata?.vendor || "Unknown"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Model / Product:</span>
                      <span className="text-foreground">{selectedIncident.metadata?.model || "Generic Removable Media"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Assigned Drive Letter:</span>
                      <span className="text-rose-400 font-bold">{selectedIncident.metadata?.driveLetter || "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Capacity:</span>
                      <span className="text-foreground">{selectedIncident.metadata?.sizeGB ? `${selectedIncident.metadata.sizeGB} GB` : "Unknown"}</span>
                    </div>
                    {selectedIncident.metadata?.pnpDeviceID && (
                      <div className="pt-1 border-t border-border/50">
                        <span className="text-muted-foreground block mb-0.5">Plug-and-Play Device PNP ID:</span>
                        <span className="text-[10px] text-muted-foreground break-all">
                          {selectedIncident.metadata.pnpDeviceID}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Resolution & Investigation */}
                <div className="space-y-2">
                  <Label htmlFor="resolutionNotes" className="text-xs font-medium">
                    Investigation &amp; Resolution Notes
                  </Label>
                  <Textarea
                    id="resolutionNotes"
                    placeholder="Enter notes on employee counseling, device verification, or compliance follow-up..."
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    rows={3}
                    className="text-xs bg-background/50 border-input"
                  />
                </div>
              </div>

              <DialogFooter className="flex items-center justify-between sm:justify-between w-full">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDetailModalOpen(false)}
                >
                  Close
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateStatus("investigating")}
                    className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  >
                    Mark Investigating
                  </Button>
                  <Button
                    size="sm"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateStatus("resolved")}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    Resolve &amp; Close Case
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
