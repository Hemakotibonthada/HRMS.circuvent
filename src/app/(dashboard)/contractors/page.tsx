"use client";

import { useState, useMemo, useCallback } from "react";
import { create } from "zustand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Briefcase, Plus, Search, Users, Calendar, Clock,
  Mail, Phone, Building2, FileText, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { useNowMs } from "@/hooks/use-now";

const STATUS_CONF: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  expired: { label: "Expired", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  pending: { label: "Pending", className: "status-pending" },
  terminated: { label: "Terminated", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
};
const CONTRACT_TYPES = ["Full-Time Contractor", "Part-Time Contractor", "Consultant", "Freelancer", "Agency"];

interface Contractor {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  contractType: string;
  department: string;
  startDate: string;
  endDate: string;
  rate: number;
  rateUnit: string;
  status: string;
  skills: string;
}

interface ContractorStore {
  items: Contractor[];
  loading: boolean;
  add: (c: Contractor) => void;
  remove: (id: string) => void;
  update: (id: string, data: Partial<Contractor>) => void;
  setItems: (items: Contractor[]) => void;
}

const useContractorStore = create<ContractorStore>((set) => ({
  items: [],
  loading: false,
  add: (c) => set((s) => ({ items: [c, ...s.items] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  update: (id, data) => set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, ...data } : i) })),
  setItems: (items) => set({ items }),
}));

export default function ContractorsPage() {
  const nowMs = useNowMs();
  const store = useContractorStore();
  const { items, loading } = store;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState<Contractor | null>(null);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", company: "", contractType: "",
    department: "", startDate: "", endDate: "", rate: "", rateUnit: "hourly", skills: "",
  });

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) ||
        c.department.toLowerCase().includes(q) || c.skills?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter(c => c.status === statusFilter);
    return result;
  }, [items, search, statusFilter]);

  const deptData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(c => { counts[c.department || "Other"] = (counts[c.department || "Other"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  const resetForm = () => setForm({
    name: "", email: "", phone: "", company: "", contractType: "",
    department: "", startDate: "", endDate: "", rate: "", rateUnit: "hourly", skills: "",
  });

  const handleCreate = useCallback(async () => {
    if (!form.name || !form.contractType) {
      toast.error("Name and contract type are required"); return;
    }
    try {
      const id = await genericService(COLLECTIONS.employees).create({
        ...form, rate: Number(form.rate) || 0, status: "active",
        employmentType: "contractor", firstName: form.name.split(" ")[0],
        lastName: form.name.split(" ").slice(1).join(" "),
      });
      store.add({ id, ...form, rate: Number(form.rate) || 0, status: "active" });
      toast.success("Contractor added!");
      setCreateOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to add contractor");
    }
  }, [form, store]);

  if (items.length === 0 && !loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Contractors</h1>
            <p className="text-muted-foreground mt-1">Manage external contractors and consultants</p>
          </div>
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Contractor
          </Button>
        </div>
        <DataEmptyState icon={Briefcase} title="No contractors" description="Add your first contractor to manage external workforce." actionLabel="Add Contractor" onAction={() => setCreateOpen(true)} />
        <AddDialog open={createOpen} onOpenChange={setCreateOpen} form={form} setForm={setForm} onSubmit={handleCreate} />
      </div>
    );
  }

  const activeCount = items.filter(c => c.status === "active").length;
  const expiringCount = items.filter(c => {
    if (!c.endDate || nowMs === null) return false;
    const diff = new Date(c.endDate).getTime() - nowMs;
    return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
  }).length;
  const totalCost = items.filter(c => c.status === "active").reduce((s, c) => s + (c.rate || 0), 0);

  const kpis = [
    { label: "Total Contractors", value: items.length, icon: Users, gradient: "from-violet-500 to-purple-600" },
    { label: "Active", value: activeCount, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Expiring (30d)", value: expiringCount, icon: AlertTriangle, gradient: "from-amber-500 to-orange-500" },
    { label: "Monthly Cost", value: `₹${totalCost.toLocaleString()}`, icon: Briefcase, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Contractors</h1>
          <p className="text-muted-foreground mt-1">Manage external contractors and consultants</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Add Contractor
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{kpi.label}</p><p className="text-2xl font-bold mt-1">{kpi.value}</p></div><div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}><kpi.icon className="h-5 w-5 text-white" /></div></div></CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search contractors…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(STATUS_CONF).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-2">
          {filtered.map(c => (
            <Card key={c.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedContractor(c)}>
              <CardContent className="p-4 flex items-center gap-4">
                <Avatar className="h-10 w-10"><AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-sm">{c.name.charAt(0)}</AvatarFallback></Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.company} · {c.contractType}</p>
                </div>
                <Badge className={cn("text-xs", STATUS_CONF[c.status]?.className)}>{STATUS_CONF[c.status]?.label || c.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">By Department</CardTitle></CardHeader>
          <CardContent>
            {deptData.length === 0 ? <p className="text-sm text-muted-foreground">No data</p> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={deptData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={80} />
                  <RTooltip />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedContractor && (
        <Dialog open={!!selectedContractor} onOpenChange={() => setSelectedContractor(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{selectedContractor.name}</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="flex gap-2"><Mail className="h-4 w-4 text-muted-foreground" />{selectedContractor.email || "—"}</div>
              <div className="flex gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{selectedContractor.phone || "—"}</div>
              <div className="flex gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{selectedContractor.company}</div>
              <div className="flex gap-2"><Calendar className="h-4 w-4 text-muted-foreground" />{selectedContractor.startDate} → {selectedContractor.endDate || "Ongoing"}</div>
              <div className="flex gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{selectedContractor.skills || "No skills listed"}</div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Rate</span><span className="font-medium">₹{selectedContractor.rate}/{selectedContractor.rateUnit}</span></div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <AddDialog open={createOpen} onOpenChange={setCreateOpen} form={form} setForm={setForm} onSubmit={handleCreate} />
    </div>
  );
}

function AddDialog({ open, onOpenChange, form, setForm, onSubmit }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  form: { name: string; email: string; phone: string; company: string; contractType: string; department: string; startDate: string; endDate: string; rate: string; rateUnit: string; skills: string };
  setForm: (f: typeof form) => void; onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Contractor</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Full Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Email</Label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
          <div><Label>Company</Label><Input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} /></div>
          <div><Label>Type</Label>
            <Select value={form.contractType} onValueChange={v => setForm({ ...form, contractType: v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></div>
          <div><Label>End Date</Label><Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div>
          <div><Label>Rate (₹)</Label><Input type="number" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} /></div>
          <div><Label>Department</Label><Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></div>
          <div className="col-span-2"><Label>Skills</Label><Textarea value={form.skills} onChange={e => setForm({ ...form, skills: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={onSubmit}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
