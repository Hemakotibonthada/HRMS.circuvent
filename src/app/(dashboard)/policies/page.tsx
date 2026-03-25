"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Plus, Search, FileText, CheckCircle2, BookOpen, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePolicyStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";

const STATUS_COLORS: Record<string, string> = {
  active: "status-active",
  draft: "status-inactive",
  archived: "status-rejected",
};

export default function PoliciesPage() {
  const store = usePolicyStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<(typeof items)[0] | null>(null);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.policies, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (p) =>
        (p.title || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const active = items.filter((p) => p.status === "active").length;
  const mandatory = items.filter((p) => p.mandatory).length;
  const categories = useMemo(
    () => [...new Set(items.map((p) => p.category).filter(Boolean))],
    [items]
  );
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
    const fd = new FormData(e.currentTarget);
    const data = {
      title: fd.get("title") as string,
      category: fd.get("category") as string,
      version: "1.0",
      status: "draft",
      mandatory: fd.get("mandatory") === "yes",
      content: fd.get("content") as string,
      lastUpdated: new Date().toISOString(),
      acknowledgedCount: 0,
    };
    try {
      await genericService(COLLECTIONS.policies).create(data);
      toast.success("Policy created!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to create policy");
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Company Policies</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} policies &middot; {mandatory} mandatory
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Policy
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Policies", value: items.length, icon: Shield, color: "from-violet-500 to-purple-600" },
          { label: "Active", value: active, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Mandatory", value: mandatory, icon: AlertTriangle, color: "from-red-500 to-rose-500" },
          { label: "Categories", value: categories.length, icon: BookOpen, color: "from-blue-500 to-cyan-500" },
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

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search policies..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Policies</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.policies} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching policies found.</p>
          ) : (
            filtered.map((policy) => (
              <Card
                key={policy.id}
                className="hover:shadow-sm transition-shadow cursor-pointer"
                onClick={() => setSelected(policy)}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm">{policy.title}</p>
                      {policy.mandatory && (
                        <Badge variant="destructive" className="text-xs">
                          Mandatory
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {policy.category} &middot; v{policy.version} &middot;{" "}
                      {policy.acknowledgedCount} acknowledged
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[policy.status])}>
                    {policy.status}
                  </Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">By Category</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {categoryBreakdown.map((c) => (
                    <div key={c.name} className="flex items-center gap-3">
                      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm flex-1">{c.name}</span>
                      <span className="font-semibold">{c.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Status Summary</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Active", count: active, color: "bg-emerald-500" },
                    { label: "Draft", count: items.filter((p) => p.status === "draft").length, color: "bg-gray-400" },
                    { label: "Archived", count: items.filter((p) => p.status === "archived").length, color: "bg-red-500" },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center gap-3">
                      <div className={cn("h-3 w-3 rounded-full", s.color)} />
                      <span className="text-sm flex-1">{s.label}</span>
                      <span className="font-semibold">{s.count}</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t text-xs text-muted-foreground">
                    Total Acknowledged: {totalAcknowledged}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <DataEmptyState {...EMPTY_STATES.policies} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{selected?.title}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>{selected?.content}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Badge variant="outline">{selected?.category}</Badge>
              <span>v{selected?.version}</span>
              {selected?.mandatory && (
                <Badge variant="destructive" className="text-xs">Mandatory</Badge>
              )}
              <Badge className={cn("text-xs", STATUS_COLORS[selected?.status || ""])}>
                {selected?.status}
              </Badge>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Policy</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label>Title</Label><Input name="title" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select name="category">
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HR">HR</SelectItem>
                    <SelectItem value="IT">IT</SelectItem>
                    <SelectItem value="Finance">Finance</SelectItem>
                    <SelectItem value="Compliance">Compliance</SelectItem>
                    <SelectItem value="Safety">Safety</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Mandatory</Label>
                <Select name="mandatory">
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Content</Label><Textarea name="content" rows={4} required /></div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
