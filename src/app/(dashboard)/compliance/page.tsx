"use client";

import { useState, useMemo, useCallback } from "react";
import { create } from "zustand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, Plus, CheckCircle2, AlertTriangle, XCircle, Clock,
  FileText, Scale, Search, Filter, Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { useNowMs } from "@/hooks/use-now";

// ═══════════════════════════════════════════════════════════════
// COMPLIANCE — Regulatory tracking, acknowledgments, due dates
// ═══════════════════════════════════════════════════════════════

const COMPLIANCE_TYPES = ["POSH", "GDPR", "PF", "ESI", "TDS", "Labor Law"];
const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  compliant: { label: "Compliant", icon: CheckCircle2, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  due: { label: "Due", icon: Clock, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  overdue: { label: "Overdue", icon: XCircle, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

interface ComplianceItem {
  id: string;
  title: string;
  type: string;
  status: "compliant" | "due" | "overdue";
  description: string;
  dueDate: string;
  owner: string;
  acknowledged: number;
  totalEmployees: number;
  lastUpdated: string;
}

interface ComplianceState {
  items: ComplianceItem[];
  addItem: (item: ComplianceItem) => void;
  updateItem: (id: string, updates: Partial<ComplianceItem>) => void;
  removeItem: (id: string) => void;
}

const useComplianceStore = create<ComplianceState>((set) => ({
  items: [
    { id: "1", title: "POSH Annual Training", type: "POSH", status: "compliant", description: "Prevention of Sexual Harassment mandatory training", dueDate: "2026-06-30", owner: "HR Team", acknowledged: 142, totalEmployees: 150, lastUpdated: "2026-03-01" },
    { id: "2", title: "GDPR Data Processing Agreement", type: "GDPR", status: "due", description: "Annual renewal of data processing agreements with vendors", dueDate: "2026-04-15", owner: "Legal", acknowledged: 45, totalEmployees: 150, lastUpdated: "2026-02-20" },
    { id: "3", title: "PF Monthly Filing", type: "PF", status: "compliant", description: "Monthly provident fund contribution filing", dueDate: "2026-04-15", owner: "Payroll", acknowledged: 150, totalEmployees: 150, lastUpdated: "2026-03-15" },
    { id: "4", title: "ESI Return Filing", type: "ESI", status: "overdue", description: "Half-yearly ESI return submission", dueDate: "2026-03-10", owner: "Payroll", acknowledged: 0, totalEmployees: 150, lastUpdated: "2026-01-15" },
    { id: "5", title: "TDS Quarterly Return", type: "TDS", status: "due", description: "Quarterly TDS return form 24Q", dueDate: "2026-04-30", owner: "Finance", acknowledged: 1, totalEmployees: 1, lastUpdated: "2026-03-20" },
    { id: "6", title: "Labor Law Compliance Audit", type: "Labor Law", status: "compliant", description: "Annual compliance audit under Shops & Establishments Act", dueDate: "2026-12-31", owner: "Legal", acknowledged: 5, totalEmployees: 5, lastUpdated: "2026-03-10" },
  ],
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...updates } : i)) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export default function CompliancePage() {
  const nowMs = useNowMs();
  const { items, addItem } = useComplianceStore();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: "", type: "POSH", description: "", dueDate: "", owner: "" });

  const compliantCount = useMemo(() => items.filter(i => i.status === "compliant").length, [items]);
  const dueCount = useMemo(() => items.filter(i => i.status === "due").length, [items]);
  const overdueCount = useMemo(() => items.filter(i => i.status === "overdue").length, [items]);
  const overallRate = useMemo(() => items.length > 0 ? Math.round((compliantCount / items.length) * 100) : 0, [items, compliantCount]);

  const types = useMemo(() => [...new Set(items.map(i => i.type))].sort(), [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (tab === "compliant") list = list.filter(i => i.status === "compliant");
    if (tab === "due") list = list.filter(i => i.status === "due");
    if (tab === "overdue") list = list.filter(i => i.status === "overdue");
    if (typeFilter !== "all") list = list.filter(i => i.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [items, tab, typeFilter, search]);

  const handleAdd = useCallback(() => {
    if (!form.title || !form.dueDate) { toast.error("Title and due date required"); return; }
    addItem({
      id: `c-${Date.now()}`,
      title: form.title, type: form.type, description: form.description,
      dueDate: form.dueDate, owner: form.owner || "Unassigned",
      status: "due", acknowledged: 0, totalEmployees: 150,
      lastUpdated: new Date().toISOString().slice(0, 10),
    });
    toast.success(`"${form.title}" added`);
    setAddOpen(false);
    setForm({ title: "", type: "POSH", description: "", dueDate: "", owner: "" });
  }, [form, addItem]);

  const daysUntilDue = (date: string) => {
    // Rendered text, so it must not be computed from the render-time clock.
    if (nowMs === null) return "";
    const diff = Math.ceil((new Date(date).getTime() - nowMs) / 86400000);
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return "Due today";
    return `${diff}d remaining`;
  };

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compliance</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{items.length} items · {overallRate}% compliant</p>
        </div>
        <Button className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add Item
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Items", value: items.length, icon: Shield, color: "from-violet-500 to-purple-600" },
          { label: "Compliant", value: compliantCount, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Due Soon", value: dueCount, icon: Clock, color: "from-amber-500 to-orange-500" },
          { label: "Overdue", value: overdueCount, icon: XCircle, color: "from-red-500 to-rose-600" },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.color)}>
                <kpi.icon className="h-5 w-5 text-white" />
              </div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-lg font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Overall Compliance Rate</p>
            <span className={cn("text-sm font-bold", overallRate >= 80 ? "text-emerald-600" : overallRate >= 50 ? "text-amber-600" : "text-red-600")}>{overallRate}%</span>
          </div>
          <Progress value={overallRate} className="h-2" />
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search compliance items…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]"><Filter className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All ({items.length})</TabsTrigger>
          <TabsTrigger value="compliant">Compliant ({compliantCount})</TabsTrigger>
          <TabsTrigger value="due">Due ({dueCount})</TabsTrigger>
          <TabsTrigger value="overdue">Overdue ({overdueCount})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab}>
          {filtered.length === 0 ? (
            <DataEmptyState icon={Shield} title="No compliance items" description="All items matching your filter will appear here." actionLabel="Add Item" onAction={() => setAddOpen(true)} />
          ) : (
            <div className="space-y-2">
              {filtered.map(item => {
                const cfg = STATUS_CONFIG[item.status];
                const ackRate = item.totalEmployees > 0 ? Math.round((item.acknowledged / item.totalEmployees) * 100) : 0;
                return (
                  <Card key={item.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", cfg.color)}>
                          <cfg.icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-sm truncate">{item.title}</h3>
                            <Badge variant="secondary" className="text-[10px] shrink-0">{item.type}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                        </div>
                        <Badge className={cn("text-xs shrink-0", cfg.color)}>{cfg.label}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Due: {item.dueDate}</span>
                        <span className={cn(item.status === "overdue" && "text-red-600 font-medium")}>{daysUntilDue(item.dueDate)}</span>
                        <span>Owner: {item.owner}</span>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">Acknowledgments</span>
                          <span className="text-xs font-medium">{item.acknowledged}/{item.totalEmployees} ({ackRate}%)</span>
                        </div>
                        <Progress value={ackRate} className="h-1.5" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Compliance Item</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Title</Label><Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Annual POSH Training" /></div>
            <div><Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{COMPLIANCE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Compliance details…" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Due Date</Label><Input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} /></div>
              <div><Label>Owner</Label><Input value={form.owner} onChange={e => setForm(p => ({ ...p, owner: e.target.value }))} placeholder="e.g. HR Team" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}