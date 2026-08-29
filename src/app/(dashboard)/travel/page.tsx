"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plane, Plus, Search, Clock, CheckCircle2, DollarSign, MapPin, Calendar, User, Building2, Car, Train, Building, Compass, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTravelStore, useEmployeeStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  pending: "status-pending",
  approved: "status-active",
  rejected: "status-rejected",
  completed: "status-active",
};

const TRAVEL_MODES = [
  { value: "Flight", label: "Flight / Air", icon: Plane },
  { value: "Train", label: "Train / Rail", icon: Train },
  { value: "Cab / Taxi", label: "Cab / Taxi", icon: Car },
  { value: "Hotel & Stay", label: "Hotel / Lodging", icon: Building },
];

const PURPOSE_CATEGORIES = [
  "Client Meeting / Sales Pitch",
  "Project Delivery & On-site Deployment",
  "Tech Conference / Summit",
  "Training & Workshop",
  "Partner / Vendor Visit",
  "Internal Team Offsite",
  "Other Business Need",
];

export default function TravelPage() {
  const store = useTravelStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const employees = empStore.items;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("requests");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form State
  const [selectedEmp, setSelectedEmp] = useState("");
  const [customEmpName, setCustomEmpName] = useState("");
  const [department, setDepartment] = useState("");
  const [travelMode, setTravelMode] = useState("Flight");
  const [origin, setOrigin] = useState("Hyderabad");
  const [destination, setDestination] = useState("");
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [cost, setCost] = useState(15000);
  const [purposeCategory, setPurposeCategory] = useState(PURPOSE_CATEGORIES[0]);
  const [purposeDetails, setPurposeDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.travel, store);
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empStore]);

  // When an employee is chosen from the store, auto-populate department
  const handleEmployeeSelect = (empValue: string) => {
    setSelectedEmp(empValue);
    if (empValue === "other") {
      setCustomEmpName("");
      setDepartment("");
      return;
    }
    const found = employees.find((e) => {
      const name = [e.firstName, e.lastName].filter(Boolean).join(" ");
      return name === empValue || e.employeeCode === empValue || e.id === empValue;
    });
    if (found) {
      setDepartment(found.department || "");
    }
  };

  const tripDurationDays = useMemo(() => {
    if (!fromDate || !toDate) return 0;
    const d1 = new Date(fromDate);
    const d2 = new Date(toDate);
    const diffTime = d2.getTime() - d1.getTime();
    if (diffTime < 0) return 0;
    return Math.round(diffTime / (1000 * 3600 * 24)) + 1;
  }, [fromDate, toDate]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          (t.employeeName || "").toLowerCase().includes(q) ||
          (t.destination || "").toLowerCase().includes(q) ||
          (t.department || "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter((t) => t.status === statusFilter);
    return result;
  }, [items, search, statusFilter]);

  const pending = items.filter((t) => t.status === "pending").length;
  const approved = items.filter((t) => t.status === "approved").length;
  const totalCost = items.reduce((s, t) => s + (t.estimatedCost || 0), 0);
  const approvedCost = items
    .filter((t) => t.status === "approved")
    .reduce((s, t) => s + (t.estimatedCost || 0), 0);

  const destBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((t) => {
      map[t.destination || "Other"] = (map[t.destination || "Other"] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const finalEmpName = (selectedEmp && selectedEmp !== "other" ? selectedEmp : customEmpName).trim();
    if (!finalEmpName) {
      toast.error("Please enter or select an employee name.");
      return;
    }
    if (!destination.trim()) {
      toast.error("Please enter destination city/location.");
      return;
    }

    setSubmitting(true);
    const combinedPurpose = [
      purposeCategory,
      origin ? `Routing: ${origin} → ${destination.trim()}` : "",
      travelMode ? `Mode: ${travelMode}` : "",
      purposeDetails.trim() ? `Notes: ${purposeDetails.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const data = {
      employeeName: finalEmpName,
      department: department.trim() || "General",
      destination: destination.trim(),
      fromDate,
      toDate,
      purpose: combinedPurpose,
      estimatedCost: Number(cost) || 0,
      status: "pending",
    };

    try {
      await genericService(COLLECTIONS.travel).create(data);
      toast.success("Travel request submitted successfully!");
      setDialogOpen(false);
      // Reset form
      setSelectedEmp("");
      setCustomEmpName("");
      setDestination("");
      setPurposeDetails("");
    } catch {
      toast.error("Failed to submit travel request");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !initialized)
    return (
      <div className="p-6">
        <DataLoadingSkeleton />
      </div>
    );

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Travel Requests</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} requests &middot; ₹{totalCost.toLocaleString("en-IN")} estimated
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          New Request
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Requests", value: items.length, icon: Plane, color: "from-violet-500 to-purple-600" },
          { label: "Pending", value: pending, icon: Clock, color: "from-amber-500 to-orange-500" },
          { label: "Approved", value: approved, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Approved Cost", value: `₹${approvedCost.toLocaleString("en-IN")}`, icon: DollarSign, color: "from-blue-500 to-cyan-500" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("p-3 rounded-xl bg-gradient-to-r text-white", kpi.color)}>
                <kpi.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search travel requests by employee, destination, or department..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.travel} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching requests found.</p>
          ) : (
            filtered.map((req) => (
              <Card key={req.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white")}>
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{req.employeeName} → {req.destination}</p>
                    <p className="text-xs text-muted-foreground">
                      {req.department} &middot; {req.fromDate} → {req.toDate} &middot; ₹{(req.estimatedCost || 0).toLocaleString("en-IN")}
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[req.status])}>{req.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Top Destinations</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {destBreakdown.map((d) => (
                    <div key={d.name} className="flex items-center gap-3">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm flex-1">{d.name}</span>
                      <span className="font-semibold">{d.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Status Summary</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Pending", count: pending, color: "bg-amber-500" },
                    { label: "Approved", count: approved, color: "bg-emerald-500" },
                    { label: "Completed", count: items.filter((t) => t.status === "completed").length, color: "bg-blue-500" },
                    { label: "Rejected", count: items.filter((t) => t.status === "rejected").length, color: "bg-red-500" },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center gap-3">
                      <div className={cn("h-3 w-3 rounded-full", s.color)} />
                      <span className="text-sm flex-1">{s.label}</span>
                      <span className="font-semibold">{s.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : (
            <DataEmptyState {...EMPTY_STATES.travel} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      {/* ENHANCED NEW TRAVEL REQUEST DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Plane className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">New Travel Request</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Submit a travel booking and expense pre-approval request for business trips.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            {/* Employee & Department */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-violet-500" />
                  Employee Name <span className="text-destructive">*</span>
                </Label>
                {employees && employees.length > 0 ? (
                  <div className="space-y-1.5">
                    <Select value={selectedEmp} onValueChange={handleEmployeeSelect}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Select employee..." />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map((emp) => {
                          const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || String(emp.id);
                          const sub = [emp.designation, emp.department].filter(Boolean).join(" · ");
                          return (
                            <SelectItem key={emp.id} value={name} className="text-xs">
                              <span className="font-medium">{name}</span>
                              {sub ? <span className="text-muted-foreground ml-2 text-[11px]">({sub})</span> : null}
                            </SelectItem>
                          );
                        })}
                        <SelectItem value="other" className="text-xs text-violet-600 font-medium">
                          + Enter other / manual name
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {selectedEmp === "other" && (
                      <Input
                        placeholder="Enter full name"
                        value={customEmpName}
                        onChange={(e) => setCustomEmpName(e.target.value)}
                        className="h-9 text-xs mt-1"
                        required
                      />
                    )}
                  </div>
                ) : (
                  <Input
                    name="name"
                    placeholder="e.g. Rahul Sharma"
                    value={customEmpName}
                    onChange={(e) => setCustomEmpName(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Department
                </Label>
                <Input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="e.g. Engineering, Sales"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Travel Mode Pills */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Travel Mode</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TRAVEL_MODES.map((m) => {
                  const Icon = m.icon;
                  const active = travelMode === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setTravelMode(m.value)}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-lg border text-xs font-medium transition-all text-left",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-violet-600" : "text-muted-foreground")} />
                      <span className="truncate">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Origin & Destination Routing */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Compass className="h-3.5 w-3.5 text-muted-foreground" />
                  From (Origin City)
                </Label>
                <Input
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="e.g. Hyderabad"
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-violet-500" />
                  To (Destination) <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Bengaluru / Client HQ"
                  className="h-9 text-xs"
                  required
                />
              </div>
            </div>

            {/* Travel Dates & Live Duration */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Departure Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Return Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>

              {/* Trip Duration Pill */}
              <div className="p-2 rounded-lg border bg-violet-50/50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800 text-center flex flex-col justify-center h-9">
                <span className="text-xs font-bold text-violet-700 dark:text-violet-300">
                  {tripDurationDays} {tripDurationDays === 1 ? "Day" : "Days"} Trip
                </span>
              </div>
            </div>

            {/* Purpose Category & Estimated Cost */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Trip Purpose Category</Label>
                <Select value={purposeCategory} onValueChange={setPurposeCategory}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PURPOSE_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat} className="text-xs">
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center justify-between">
                  <span>Estimated Cost (₹)</span>
                  <span className="font-bold text-violet-600">₹{Number(cost || 0).toLocaleString("en-IN")}</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">₹</span>
                  <Input
                    type="number"
                    min={0}
                    step={500}
                    value={cost || ""}
                    onChange={(e) => setCost(Number(e.target.value))}
                    placeholder="15000"
                    className="pl-7 h-9 text-xs font-medium"
                  />
                </div>
              </div>
            </div>

            {/* Purpose / Itinerary Details */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                Itinerary Details &amp; Notes
              </Label>
              <Textarea
                value={purposeDetails}
                onChange={(e) => setPurposeDetails(e.target.value)}
                placeholder="Flight timing preferences, hotel stay requirements, client agenda..."
                rows={2}
                className="text-xs resize-none"
              />
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                className="rounded-full text-xs h-9 px-4"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all"
              >
                {submitting ? "Submitting…" : "Submit Travel Request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
