"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Package, Plus, Search, Monitor, Laptop, Smartphone,
  Headphones, CheckCircle2, Clock, AlertTriangle, Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  Tooltip as RTooltip,
} from "recharts";
import { useAssetStore, startSync } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const ASSET_TYPES = ["Laptop", "Monitor", "Keyboard", "Phone", "Headset", "License", "Access Card", "Other"];
const STATUS_CONF: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  available: { label: "Available", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle2 },
  assigned: { label: "Assigned", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: Monitor },
  maintenance: { label: "Maintenance", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: Clock },
  retired: { label: "Retired", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400", icon: AlertTriangle },
};

export default function ProvisioningPage() {
  const store = useAssetStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [requestOpen, setRequestOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "", brand: "", assignedTo: "", notes: "" });

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.assets, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.name?.toLowerCase().includes(q) || a.brand?.toLowerCase().includes(q) ||
        a.assignedTo?.toLowerCase().includes(q) || a.serialNumber?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter(a => a.status === statusFilter);
    return result;
  }, [items, search, statusFilter]);

  const typeData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(a => { counts[a.type || "Other"] = (counts[a.type || "Other"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  const resetForm = () => setForm({ name: "", type: "", brand: "", assignedTo: "", notes: "" });

  const handleRequest = useCallback(async () => {
    if (!form.name || !form.type) {
      toast.error("Name and type are required"); return;
    }
    try {
      await genericService(COLLECTIONS.assets).create({
        ...form, status: "available", condition: "new",
        purchaseDate: new Date().toISOString().split("T")[0], cost: 0,
        serialNumber: `SN-${Date.now().toString(36).toUpperCase()}`,
      });
      toast.success("Asset request submitted!");
      setRequestOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to submit request");
    }
  }, [form]);

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">IT Provisioning</h1>
            <p className="text-muted-foreground mt-1">Manage IT assets and provisioning requests</p>
          </div>
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setRequestOpen(true)}>
            <Plus className="h-4 w-4" /> New Request
          </Button>
        </div>
        <DataEmptyState {...EMPTY_STATES.assets} onAction={() => setRequestOpen(true)} />
        <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} form={form} setForm={setForm} onSubmit={handleRequest} />
      </div>
    );
  }

  const available = items.filter(a => a.status === "available").length;
  const assigned = items.filter(a => a.status === "assigned").length;
  const maintenance = items.filter(a => a.status === "maintenance").length;
  const totalValue = items.reduce((s, a) => s + (a.cost || 0), 0);

  const kpis = [
    { label: "Total Assets", value: items.length, icon: Package, gradient: "from-violet-500 to-purple-600" },
    { label: "Available", value: available, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Assigned", value: assigned, icon: Monitor, gradient: "from-blue-500 to-cyan-500" },
    { label: "Total Value", value: `₹${totalValue.toLocaleString()}`, icon: Truck, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">IT Provisioning</h1>
          <p className="text-muted-foreground mt-1">Manage IT assets and provisioning requests</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setRequestOpen(true)}>
          <Plus className="h-4 w-4" /> New Request
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}>
                  <kpi.icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Asset Types</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={typeData} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name" label>
                  {typeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend />
                <RTooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search assets…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {Object.entries(STATUS_CONF).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            {filtered.map(asset => (
              <Card key={asset.id} className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <Package className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{asset.name}</p>
                    <p className="text-xs text-muted-foreground">{asset.brand} · {asset.serialNumber}</p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_CONF[asset.status]?.className)}>{STATUS_CONF[asset.status]?.label || asset.status}</Badge>
                  <span className="text-sm text-muted-foreground">{asset.assignedTo || "Unassigned"}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} form={form} setForm={setForm} onSubmit={handleRequest} />
    </div>
  );
}

function RequestDialog({ open, onOpenChange, form, setForm, onSubmit }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  form: { name: string; type: string; brand: string; assignedTo: string; notes: string };
  setForm: (f: typeof form) => void; onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Asset Request</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Asset Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Type</Label>
            <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>{ASSET_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Brand</Label><Input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} /></div>
          <div><Label>Assign To</Label><Input value={form.assignedTo} onChange={e => setForm({ ...form, assignedTo: e.target.value })} /></div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={onSubmit}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
