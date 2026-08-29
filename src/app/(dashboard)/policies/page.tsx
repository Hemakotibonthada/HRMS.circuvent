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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Shield, Plus, Search, FileText, CheckCircle2, BookOpen, AlertTriangle,
  Lock, DollarSign, HardHat, Sparkles, Eye, Send, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePolicyStore, startSync, type PolicyDoc } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  active: "status-active",
  draft: "status-inactive",
  archived: "status-rejected",
};

const POLICY_CATEGORIES = [
  { id: "HR", label: "HR & Workplace Conduct", icon: BookOpen, desc: "Leaves, anti-harassment, code of conduct" },
  { id: "IT", label: "IT & Cybersecurity", icon: Lock, desc: "Access control, password security, VPN" },
  { id: "Finance", label: "Finance & Expense", icon: DollarSign, desc: "Travel expense, reimbursement, corporate cards" },
  { id: "Compliance", label: "Legal & Regulatory", icon: Shield, desc: "Statutory labor compliance & privacy" },
  { id: "Safety", label: "Occupational Safety", icon: HardHat, desc: "Fire safety, emergency & health protocols" },
];

export default function PoliciesPage() {
  const store = usePolicyStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<PolicyDoc | null>(null);

  // Form State
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(POLICY_CATEGORIES[0].id);
  const [version, setVersion] = useState("1.0");
  const [mandatory, setMandatory] = useState(false);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.policies, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (catFilter !== "all") result = result.filter(p => p.category === catFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          (p.title || "").toLowerCase().includes(q) ||
          (p.category || "").toLowerCase().includes(q) ||
          (p.content || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, search, catFilter]);

  const active = items.filter((p) => p.status === "active").length;
  const mandatoryCount = items.filter((p) => p.mandatory).length;
  const totalAcknowledged = items.reduce(
    (s, p) => s + (p.acknowledgedCount || 0),
    0
  );

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((p) => {
      map[p.category || "Other"] = (map[p.category || "Other"] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      toast.error("Please provide a title and policy content.");
      return;
    }

    setSubmitting(true);
    const data: Omit<PolicyDoc, "id"> = {
      title: title.trim(),
      category,
      version: version.trim() || "1.0",
      status: "active",
      mandatory,
      content: content.trim(),
      lastUpdated: new Date().toISOString(),
      acknowledgedCount: 0,
    };

    try {
      const id = await genericService(COLLECTIONS.policies).create(data as unknown as Record<string, unknown>);
      store.addItem({ ...data, id } as PolicyDoc);
      toast.success("Policy established and published!");
      setDialogOpen(false);
      setTitle("");
      setContent("");
      setMandatory(false);
    } catch {
      toast.error("Failed to create policy");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !initialized)
    return (
      <div className="p-6">
        <DataLoadingSkeleton rows={6} />
      </div>
    );

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Corporate Policy Handbook</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} official company policies &middot; {totalAcknowledged} employee sign-offs
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          Create Policy
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Policies", value: items.length, icon: FileText, color: "from-violet-500 to-purple-600", sub: "Approved handbooks" },
          { label: "Active & Enforced", value: active, icon: CheckCircle2, color: "from-emerald-500 to-green-600", sub: "Currently active" },
          { label: "Mandatory Compliance", value: mandatoryCount, icon: AlertTriangle, color: "from-amber-500 to-orange-500", sub: "Requires sign-off" },
          { label: "Total Sign-offs", value: totalAcknowledged, icon: Shield, color: "from-blue-500 to-cyan-500", sub: "Staff acknowledged" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("p-3 rounded-xl bg-gradient-to-r text-white", kpi.color)}>
                <kpi.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search policies by title, category, or content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-xs h-9"
          />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Categories</SelectItem>
            {POLICY_CATEGORIES.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">All Policies</TabsTrigger>
          <TabsTrigger value="categories">Categories &amp; Governance</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.policies} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-xs">No matching policies found.</p>
          ) : (
            filtered.map((policy) => (
              <Card key={policy.id} className="hover:shadow-sm transition-shadow cursor-pointer" onClick={() => setSelected(policy)}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white shrink-0">
                      <BookOpen className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="font-semibold text-sm truncate">{policy.title}</p>
                        {policy.mandatory && (
                          <Badge variant="destructive" className="text-[10px] uppercase font-bold">Mandatory</Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">v{policy.version || "1.0"}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{policy.content}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Category: {policy.category} &middot; {policy.acknowledgedCount || 0} acknowledgments
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={cn("text-xs font-medium", STATUS_COLORS[policy.status || "active"])}>
                      {policy.status || "active"}
                    </Badge>
                    <Button variant="ghost" size="sm" className="rounded-full text-xs h-8 px-2.5">
                      <Eye className="h-3.5 w-3.5 mr-1" /> View
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Policies by Category</CardTitle></CardHeader>
                <CardContent className="space-y-2.5">
                  {categoryBreakdown.map((c) => (
                    <div key={c.name} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                      <span className="text-xs font-semibold text-foreground">{c.name}</span>
                      <Badge variant="outline" className="text-xs">{c.count} documents</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Governance Overview</CardTitle></CardHeader>
                <CardContent className="space-y-2.5 text-xs">
                  <div className="p-3 rounded-lg border bg-muted/20 flex items-center justify-between">
                    <span className="text-muted-foreground">Mandatory Compliance Handbooks</span>
                    <span className="font-bold text-foreground">{mandatoryCount}</span>
                  </div>
                  <div className="p-3 rounded-lg border bg-muted/20 flex items-center justify-between">
                    <span className="text-muted-foreground">General Guidance Policies</span>
                    <span className="font-bold text-foreground">{items.length - mandatoryCount}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <DataEmptyState {...EMPTY_STATES.policies} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      {/* ENHANCED CREATE POLICY DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Establish Corporate Policy</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Draft organizational rules, conduct standards, and compliance guidelines.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Policy Title <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Remote Work &amp; Information Security Policy"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="h-9 text-xs"
                required
              />
            </div>

            {/* Category Selection Cards */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Policy Category</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {POLICY_CATEGORIES.map(cat => {
                  const Icon = cat.icon;
                  const active = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id)}
                      className={cn(
                        "p-2.5 rounded-lg border text-left transition-all cursor-pointer",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Icon className={cn("h-3.5 w-3.5", active ? "text-violet-600" : "text-muted-foreground")} />
                        <span className="font-bold text-xs">{cat.label}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">{cat.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Version Number</Label>
                <Input
                  placeholder="e.g. 1.0, 2.1"
                  value={version}
                  onChange={e => setVersion(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="p-2.5 rounded-lg border bg-muted/20 flex items-center justify-between mt-4 sm:mt-0">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Mandatory Sign-off
                  </p>
                  <p className="text-[10px] text-muted-foreground">Requires employee acknowledgment</p>
                </div>
                <Switch checked={mandatory} onCheckedChange={setMandatory} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Policy Handbook Content &amp; Rules <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="Detail the complete policy guidelines, applicability, procedures, and enforcement terms..."
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={4}
                className="text-xs resize-none"
                required
              />
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button type="button" variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setDialogOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all gap-1.5">
                <Send className="h-4 w-4" /> {submitting ? "Publishing…" : "Enforce Policy"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ENHANCED VIEW POLICY DETAIL DIALOG */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-bold truncate">{selected?.title}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {selected?.category} &middot; Version {selected?.version || "1.0"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Badge variant="outline" className="text-xs font-semibold">{selected.category}</Badge>
                {selected.mandatory && <Badge variant="destructive" className="text-[10px] uppercase font-bold">Mandatory Sign-off</Badge>}
                <Badge className={cn("text-xs font-semibold uppercase", STATUS_COLORS[selected.status || "active"])}>{selected.status || "active"}</Badge>
                <span className="ml-auto text-[11px] text-muted-foreground">{selected.acknowledgedCount || 0} Total Sign-offs</span>
              </div>

              <div className="p-4 rounded-xl border bg-muted/20 max-h-[300px] overflow-y-auto">
                <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{selected.content}</p>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setSelected(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
