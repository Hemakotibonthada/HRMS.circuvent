"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Package, Plus, Search, CheckCircle2, Clock, DollarSign,
  Monitor, Laptop, Server, HardDrive, AlertTriangle,
  Wrench, ShieldCheck, Calendar, Eye, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { useAssetStore, startSync, type AssetDoc } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// ASSETS — Full asset management with lifecycle tracking
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const ASSET_TYPES = ["Laptop", "Desktop", "Monitor", "Phone", "Tablet", "Server", "Network", "Furniture", "Vehicle", "Other"];
const ASSET_STATUSES = ["Available", "Assigned", "Maintenance", "Retired"];
const TYPE_ICONS: Record<string, typeof Package> = {
  Laptop: Laptop, Desktop: Monitor, Monitor: Monitor, Server: Server,
  Phone: HardDrive, Network: Server,
};
const STATUS_MAP: Record<string, { label: string; className: string }> = {
  Available: { label: "Available", className: "status-active" },
  Assigned: { label: "Assigned", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  Maintenance: { label: "Maintenance", className: "status-pending" },
  Retired: { label: "Retired", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
};
const LIFECYCLE_STAGES = ["Purchase", "Assign", "Maintain", "Retire"];

export default function AssetsPage() {
  const rbac = useRBAC();
  const store = useAssetStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("inventory");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<AssetDoc | null>(null);
  const [form, setForm] = useState({
    name: "", type: "", brand: "", serialNumber: "",
    cost: "", purchaseDate: "", condition: "New",
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.assets, store); }, [initialized, store]);

  // KPIs
  const totalAssets = items.length;
  const assigned = items.filter(a => a.status === "Assigned").length;
  const available = items.filter(a => a.status === "Available").length;
  const maintenance = items.filter(a => a.status === "Maintenance").length;

  // Type breakdown
  const typeData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(a => { counts[a.type || "Other"] = (counts[a.type || "Other"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Cost by type
  const costByType = useMemo(() => {
    const costs: Record<string, number> = {};
    items.forEach(a => {
      costs[a.type || "Other"] = (costs[a.type || "Other"] || 0) + (a.cost || 0);
    });
    return Object.entries(costs).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Warranty alerts (approximation: 2 years from purchase)
  const warrantyAlerts = useMemo(() => {
    const now = Date.now();
    const twoYears = 2 * 365.25 * 86400000;
    return items.filter(a => {
      if (!a.purchaseDate) return false;
      const purchase = new Date(a.purchaseDate).getTime();
      const warrantyEnd = purchase + twoYears;
      const threeMonths = 90 * 86400000;
      return warrantyEnd - now < threeMonths && warrantyEnd > now;
    });
  }, [items]);

  // Assignment tracking
  const assignedAssets = useMemo(() => items.filter(a => a.status === "Assigned" && a.assignedTo), [items]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.name?.toLowerCase().includes(q) ||
        a.serialNumber?.toLowerCase().includes(q) ||
        a.assignedTo?.toLowerCase().includes(q) ||
        a.brand?.toLowerCase().includes(q)
      );
    }
    if (typeFilter !== "all") result = result.filter(a => a.type === typeFilter);
    if (statusFilter !== "all") result = result.filter(a => a.status === statusFilter);
    return result;
  }, [items, search, typeFilter, statusFilter]);

  const handleCreate = async () => {
    if (!form.name || !form.type || !form.serialNumber) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.assets).create({
        ...form, cost: Number(form.cost),
        status: "Available", assignedTo: "",
      });
      toast.success("Asset added!");
      setCreateOpen(false);
      setForm({ name: "", type: "", brand: "", serialNumber: "", cost: "", purchaseDate: "", condition: "New" });
    } catch { toast.error("Failed to add asset"); }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await genericService(COLLECTIONS.assets).update(id, { status });
      toast.success(`Asset marked as ${status}`);
    } catch { toast.error("Failed to update asset"); }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.assets} onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Total Assets", value: totalAssets, icon: Package, gradient: "from-violet-500 to-purple-600" },
    { label: "Assigned", value: assigned, icon: CheckCircle2, gradient: "from-blue-500 to-cyan-500" },
    { label: "Available", value: available, icon: ShieldCheck, gradient: "from-emerald-500 to-green-600" },
    { label: "Maintenance", value: maintenance, icon: Wrench, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Assets</h1>
          <p className="text-muted-foreground mt-1">Asset inventory, lifecycle &amp; warranty management</p>
        </div>
        {rbac.can("assets.manage") && (
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Asset
          </Button>
        )}
      </div>

      {/* KPIs */}
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

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {ASSET_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {ASSET_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Inventory */}
        <TabsContent value="inventory" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.assets} compact onAction={() => setCreateOpen(true)} />
          ) : filtered.map(asset => {
            const st = STATUS_MAP[asset.status] || STATUS_MAP.Available;
            const TypeIcon = TYPE_ICONS[asset.type] || Package;
            return (
              <Card key={asset.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setDetailItem(asset)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <TypeIcon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{asset.name}</h3>
                          <Badge variant="outline" className="text-xs">{asset.type}</Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{asset.brand}</span>
                          <span>SN: {asset.serialNumber}</span>
                          {asset.assignedTo && <span>→ {asset.assignedTo}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {asset.cost > 0 && <span className="font-semibold text-sm">₹{asset.cost.toLocaleString()}</span>}
                      <Badge className={st.className}>{st.label}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Lifecycle */}
        <TabsContent value="lifecycle" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Asset Lifecycle Stages</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-6">
                {LIFECYCLE_STAGES.map((stage, i) => (
                  <div key={stage} className="flex flex-col items-center gap-2 flex-1">
                    <div className={cn("h-12 w-12 rounded-full flex items-center justify-center text-sm font-bold",
                      "bg-gradient-to-br from-violet-500 to-purple-600 text-white")}>
                      {i + 1}
                    </div>
                    <p className="text-sm font-medium">{stage}</p>
                    <p className="text-xs text-muted-foreground">
                      {stage === "Purchase" ? `${items.length} total` :
                       stage === "Assign" ? `${assigned} assigned` :
                       stage === "Maintain" ? `${maintenance} in maintenance` :
                       `${items.filter(a => a.status === "Retired").length} retired`}
                    </p>
                  </div>
                ))}
              </div>
              {/* Warranty Alerts */}
              {warrantyAlerts.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-1 text-amber-600"><AlertTriangle className="h-4 w-4" /> Warranty Expiring Soon</h4>
                  {warrantyAlerts.map(a => (
                    <div key={a.id} className="flex items-center justify-between p-2 rounded-lg bg-amber-50 dark:bg-amber-900/10">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-amber-500" />
                        <span className="text-sm font-medium">{a.name}</span>
                        <span className="text-xs text-muted-foreground">{a.serialNumber}</span>
                      </div>
                      <Badge className="status-pending text-xs">Expiring</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          {/* Assignment Tracking */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Who Has What</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {assignedAssets.slice(0, 8).map(a => (
                <div key={a.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-cyan-500 text-white text-xs">
                        {a.assignedTo?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{a.assignedTo}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{a.name}</span>
                    <Badge variant="outline" className="text-xs">{a.type}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Assets by Type</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {typeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Cost Analysis by Type</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={costByType}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" name="Cost (₹)" fill="#8b5cf6" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!detailItem} onOpenChange={v => { if (!v) setDetailItem(null); }}>
        <DialogContent>
          {detailItem && (
            <>
              <DialogHeader><DialogTitle>{detailItem.name}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <Badge className={(STATUS_MAP[detailItem.status] || STATUS_MAP.Available).className}>{detailItem.status}</Badge>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Type</p><p className="font-medium">{detailItem.type}</p></div>
                  <div><p className="text-muted-foreground">Brand</p><p className="font-medium">{detailItem.brand}</p></div>
                  <div><p className="text-muted-foreground">Serial</p><p className="font-medium">{detailItem.serialNumber}</p></div>
                  <div><p className="text-muted-foreground">Cost</p><p className="font-medium">₹{(detailItem.cost || 0).toLocaleString()}</p></div>
                  <div><p className="text-muted-foreground">Purchased</p><p className="font-medium">{detailItem.purchaseDate}</p></div>
                  <div><p className="text-muted-foreground">Condition</p><p className="font-medium">{detailItem.condition}</p></div>
                  <div><p className="text-muted-foreground">Assigned To</p><p className="font-medium">{detailItem.assignedTo || "Unassigned"}</p></div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                {detailItem.status === "Available" && (
                  <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0" onClick={() => { handleStatusChange(detailItem.id, "Assigned"); setDetailItem(null); }}>Assign</Button>
                )}
                {detailItem.status === "Assigned" && (
                  <Button variant="outline" onClick={() => { handleStatusChange(detailItem.id, "Maintenance"); setDetailItem(null); }}>Send to Maintenance</Button>
                )}
                <Button variant="outline" onClick={() => setDetailItem(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Asset Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add New Asset</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Asset Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. MacBook Pro 16" />
              </div>
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Brand</Label>
                <Input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="Apple, Dell..." />
              </div>
              <div className="space-y-2">
                <Label>Serial Number *</Label>
                <Input value={form.serialNumber} onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))} placeholder="SN-XXX" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cost (₹)</Label>
                <Input type="number" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>Purchase Date</Label>
                <Input type="date" value={form.purchaseDate} onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" /> Add Asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
