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
import { MessageSquare, Plus, Search, ThumbsUp, Clock, CheckCircle2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFeedbackStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  open: "status-pending",
  "in-review": "status-pending",
  resolved: "status-active",
  closed: "status-inactive",
};

export default function FeedbackPage() {
  const store = useFeedbackStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<(typeof items)[0] | null>(null);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.feedback, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (f) =>
        (f.title || "").toLowerCase().includes(q) ||
        (f.category || "").toLowerCase().includes(q) ||
        (f.submittedBy || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const open = items.filter((f) => f.status === "open").length;
  const resolved = items.filter((f) => f.status === "resolved").length;
  const totalUpvotes = items.reduce((s, f) => s + (f.upvotes || 0), 0);
  const avgUpvotes =
    items.length > 0 ? Math.round(totalUpvotes / items.length) : 0;

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((f) => {
      map[f.category || "Other"] = (map[f.category || "Other"] || 0) + 1;
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
      description: fd.get("description") as string,
      submittedBy: fd.get("submittedBy") as string,
      status: "open",
      upvotes: 0,
      createdAt: new Date().toISOString(),
    };
    try {
      await genericService(COLLECTIONS.feedback).create(data);
      toast.success("Feedback submitted!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to submit feedback");
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
          <h1 className="text-2xl font-bold tracking-tight">Employee Feedback</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} submissions &middot; {totalUpvotes} upvotes
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Submit Feedback
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Feedback", value: items.length, icon: MessageSquare, color: "from-violet-500 to-purple-600" },
          { label: "Open", value: open, icon: Clock, color: "from-amber-500 to-orange-500" },
          { label: "Resolved", value: resolved, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Avg Upvotes", value: avgUpvotes, icon: ThumbsUp, color: "from-blue-500 to-cyan-500" },
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
        <Input placeholder="Search feedback..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Feedback</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.feedback} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching feedback found.</p>
          ) : (
            filtered.map((fb) => (
              <Card key={fb.id} className="hover:shadow-sm transition-shadow cursor-pointer" onClick={() => setSelected(fb)}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm">{fb.title}</p>
                      <Badge variant="outline" className="text-xs">{fb.category}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{fb.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      By {fb.submittedBy} &middot; <ThumbsUp className="inline h-3 w-3" /> {fb.upvotes}
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[fb.status])}>{fb.status}</Badge>
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
                    { label: "Open", count: open, color: "bg-amber-500" },
                    { label: "In Review", count: items.filter((f) => f.status === "in-review").length, color: "bg-blue-500" },
                    { label: "Resolved", count: resolved, color: "bg-emerald-500" },
                    { label: "Closed", count: items.filter((f) => f.status === "closed").length, color: "bg-gray-400" },
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
            <DataEmptyState {...EMPTY_STATES.feedback} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{selected?.title}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>{selected?.description}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Badge variant="outline">{selected?.category}</Badge>
              <span>By {selected?.submittedBy}</span>
              <span><ThumbsUp className="inline h-3 w-3" /> {selected?.upvotes}</span>
              <Badge className={cn("text-xs", STATUS_COLORS[selected?.status || ""])}>{selected?.status}</Badge>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submit Feedback</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label>Title</Label><Input name="title" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select name="category">
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Suggestion">Suggestion</SelectItem>
                    <SelectItem value="Complaint">Complaint</SelectItem>
                    <SelectItem value="Appreciation">Appreciation</SelectItem>
                    <SelectItem value="Process">Process Improvement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Submitted By</Label><Input name="submittedBy" required /></div>
            </div>
            <div><Label>Description</Label><Textarea name="description" rows={3} required /></div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">Submit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
