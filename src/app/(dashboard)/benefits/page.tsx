"use client";

import { useState, useMemo, useCallback } from "react";
import { create } from "zustand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Heart, Plus, Search, Shield, DollarSign, Users,
  CheckCircle2, Eye, Activity, Briefcase, Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  Tooltip as RTooltip,
} from "recharts";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const BENEFIT_CATEGORIES = ["Health", "Insurance", "Retirement", "Wellness", "Education", "Transportation", "Meals", "Other"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  inactive: { label: "Inactive", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  upcoming: { label: "Upcoming", className: "status-pending" },
};

interface BenefitPlan {
  id: string;
  name: string;
  category: string;
  description: string;
  coverage: string;
  monthlyCost: number;
  employerContribution: number;
  enrolled: number;
  maxEnrollment: number;
  status: string;
  features: string[];
}

interface BenefitStore {
  items: BenefitPlan[];
  loading: boolean;
  add: (b: BenefitPlan) => void;
  remove: (id: string) => void;
  update: (id: string, data: Partial<BenefitPlan>) => void;
  setItems: (items: BenefitPlan[]) => void;
}

const useBenefitStore = create<BenefitStore>((set) => ({
  items: [],
  loading: false,
  add: (b) => set((s) => ({ items: [b, ...s.items] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  update: (id, data) => set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, ...data } : i) })),
  setItems: (items) => set({ items }),
}));

export default function BenefitsPage() {
  const store = useBenefitStore();
  const { items, loading } = store;
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailPlan, setDetailPlan] = useState<BenefitPlan | null>(null);
  const [form, setForm] = useState({
    name: "", category: "", description: "", coverage: "",
    monthlyCost: "", employerContribution: "", maxEnrollment: "",
  });

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(b => b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q));
    }
    if (categoryFilter !== "all") result = result.filter(b => b.category === categoryFilter);
    return result;
  }, [items, search, categoryFilter]);

  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(b => { counts[b.category] = (counts[b.category] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  const resetForm = () => setForm({
    name: "", category: "", description: "", coverage: "",
    monthlyCost: "", employerContribution: "", maxEnrollment: "",
  });

  const handleCreate = useCallback(async () => {
    if (!form.name || !form.category) {
      toast.error("Name and category are required"); return;
    }
    try {
      const id = await genericService(COLLECTIONS.policies).create({
        ...form, type: "benefit",
        monthlyCost: Number(form.monthlyCost) || 0,
        employerContribution: Number(form.employerContribution) || 0,
        maxEnrollment: Number(form.maxEnrollment) || 0,
        enrolled: 0, status: "active", features: [],
      });
      store.add({
        id, ...form,
        monthlyCost: Number(form.monthlyCost) || 0,
        employerContribution: Number(form.employerContribution) || 0,
        maxEnrollment: Number(form.maxEnrollment) || 0,
        enrolled: 0, status: "active", features: [],
      });
      toast.success("Benefit plan created!");
      setCreateOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to create benefit plan");
    }
  }, [form, store]);

  const handleToggleEnrollment = useCallback(async (plan: BenefitPlan) => {
    const isEnrolled = plan.enrolled > 0;
    const newEnrolled = isEnrolled ? plan.enrolled - 1 : plan.enrolled + 1;
    try {
      await genericService(COLLECTIONS.policies).update(plan.id, { enrolled: newEnrolled });
      store.update(plan.id, { enrolled: newEnrolled });
      toast.success(isEnrolled ? "Unenrolled from plan" : "Enrolled in plan");
    } catch {
      toast.error("Failed to update enrollment");
    }
  }, [store]);

  if (items.length === 0 && !loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Benefits</h1>
            <p className="text-muted-foreground mt-1">Manage employee benefit plans and enrollment</p>
          </div>
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Plan
          </Button>
        </div>
        <DataEmptyState icon={Heart} title="No benefit plans" description="Create your first benefit plan for employees." actionLabel="Add Plan" onAction={() => setCreateOpen(true)} />
        <CreateDialog open={createOpen} onOpenChange={setCreateOpen} form={form} setForm={setForm} onSubmit={handleCreate} />
      </div>
    );
  }

  const activePlans = items.filter(b => b.status === "active").length;
  const totalEnrolled = items.reduce((s, b) => s + (b.enrolled || 0), 0);
  const totalCost = items.reduce((s, b) => s + (b.monthlyCost || 0), 0);

  const kpis = [
    { label: "Total Plans", value: items.length, icon: Heart, gradient: "from-violet-500 to-purple-600" },
    { label: "Active Plans", value: activePlans, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Total Enrolled", value: totalEnrolled, icon: Users, gradient: "from-blue-500 to-cyan-500" },
    { label: "Monthly Cost", value: `₹${totalCost.toLocaleString()}`, icon: DollarSign, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Benefits</h1>
          <p className="text-muted-foreground mt-1">Manage employee benefit plans and enrollment</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Add Plan
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{kpi.label}</p><p className="text-2xl font-bold mt-1">{kpi.value}</p></div><div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}><kpi.icon className="h-5 w-5 text-white" /></div></div></CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Plans by Category</CardTitle></CardHeader>
          <CardContent>
            {categoryData.length === 0 ? <DataEmptyState compact icon={Heart} title="No data" description="" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name" label>
                    {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Legend />
                  <RTooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search plans…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {BENEFIT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map(plan => (
              <Card key={plan.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <Shield className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{plan.name}</p>
                        <Badge variant="secondary" className="text-xs">{plan.category}</Badge>
                      </div>
                    </div>
                    <Badge className={cn("text-xs", STATUS_CONF[plan.status]?.className)}>
                      {STATUS_CONF[plan.status]?.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{plan.description || "No description"}</p>
                  <Separator />
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Monthly: </span><span className="font-medium">₹{plan.monthlyCost.toLocaleString()}</span></div>
                    <div><span className="text-muted-foreground">Employer: </span><span className="font-medium">₹{plan.employerContribution.toLocaleString()}</span></div>
                    <div><span className="text-muted-foreground">Enrolled: </span><span className="font-medium">{plan.enrolled}/{plan.maxEnrollment || "∞"}</span></div>
                    <div><span className="text-muted-foreground">Coverage: </span><span className="font-medium">{plan.coverage || "Standard"}</span></div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => setDetailPlan(plan)}>
                      <Eye className="h-3.5 w-3.5" /> Details
                    </Button>
                    <Button size="sm" className="flex-1 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-1" onClick={() => handleToggleEnrollment(plan)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> {plan.enrolled > 0 ? "Enrolled" : "Enroll"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {detailPlan && (
        <Dialog open={!!detailPlan} onOpenChange={() => setDetailPlan(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{detailPlan.name}</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Category</span><Badge variant="secondary">{detailPlan.category}</Badge></div>
              <Separator />
              <p>{detailPlan.description || "No description provided."}</p>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">Monthly Cost</span><p className="font-medium">₹{detailPlan.monthlyCost.toLocaleString()}</p></div>
                <div><span className="text-muted-foreground">Employer Contribution</span><p className="font-medium">₹{detailPlan.employerContribution.toLocaleString()}</p></div>
                <div><span className="text-muted-foreground">Coverage</span><p className="font-medium">{detailPlan.coverage || "Standard"}</p></div>
                <div><span className="text-muted-foreground">Enrollment</span><p className="font-medium">{detailPlan.enrolled}/{detailPlan.maxEnrollment || "Unlimited"}</p></div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} form={form} setForm={setForm} onSubmit={handleCreate} />
    </div>
  );
}

function CreateDialog({ open, onOpenChange, form, setForm, onSubmit }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  form: { name: string; category: string; description: string; coverage: string; monthlyCost: string; employerContribution: string; maxEnrollment: string };
  setForm: (f: typeof form) => void; onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Benefit Plan</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Plan Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>{BENEFIT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          <div><Label>Coverage</Label><Input value={form.coverage} onChange={e => setForm({ ...form, coverage: e.target.value })} placeholder="e.g. Family, Individual" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Monthly Cost (₹)</Label><Input type="number" value={form.monthlyCost} onChange={e => setForm({ ...form, monthlyCost: e.target.value })} /></div>
            <div><Label>Employer Share (₹)</Label><Input type="number" value={form.employerContribution} onChange={e => setForm({ ...form, employerContribution: e.target.value })} /></div>
          </div>
          <div><Label>Max Enrollment</Label><Input type="number" value={form.maxEnrollment} onChange={e => setForm({ ...form, maxEnrollment: e.target.value })} placeholder="Leave empty for unlimited" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={onSubmit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
