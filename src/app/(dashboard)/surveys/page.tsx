"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ClipboardList, Plus, Search, BarChart3, Users, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSurveyStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";

const STATUS_COLORS: Record<string, string> = {
  active: "status-active",
  draft: "status-inactive",
  closed: "status-rejected",
};

export default function SurveysPage() {
  const store = useSurveyStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<(typeof items)[0] | null>(null);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.surveys, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (s) =>
        (s.title || "").toLowerCase().includes(q) ||
        (s.type || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const active = items.filter((s) => s.status === "active").length;
  const totalResponses = items.reduce((s, i) => s + (i.responses || 0), 0);
  const totalQuestions = items.reduce((s, i) => s + (i.questions || 0), 0);
  const avgResponseRate =
    items.length > 0
      ? Math.round(totalResponses / items.length)
      : 0;

  const typeBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((s) => {
      map[s.type || "Other"] = (map[s.type || "Other"] || 0) + 1;
    });
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      title: fd.get("title") as string,
      type: fd.get("type") as string,
      status: "draft",
      questions: Number(fd.get("questions")) || 0,
      responses: 0,
      deadline: fd.get("deadline") as string,
    };
    try {
      await genericService(COLLECTIONS.surveys).create(data);
      toast.success("Survey created!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to create survey");
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
          <h1 className="text-2xl font-bold tracking-tight">Surveys</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} surveys &middot; {totalResponses} responses
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Survey
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Surveys", value: items.length, icon: ClipboardList, color: "from-violet-500 to-purple-600" },
          { label: "Active", value: active, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Responses", value: totalResponses, icon: Users, color: "from-blue-500 to-cyan-500" },
          { label: "Avg Responses", value: avgResponseRate, icon: BarChart3, color: "from-amber-500 to-orange-500" },
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
        <Input placeholder="Search surveys..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Surveys</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.surveys} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching surveys found.</p>
          ) : (
            filtered.map((survey) => (
              <Card key={survey.id} className="hover:shadow-sm transition-shadow cursor-pointer" onClick={() => setSelected(survey)}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white")}>
                    <ClipboardList className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{survey.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {survey.type} &middot; {survey.questions} questions &middot; {survey.responses} responses &middot; Deadline: {survey.deadline}
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[survey.status])}>{survey.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">By Type</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {typeBreakdown.map((t) => (
                    <div key={t.name} className="flex items-center gap-3">
                      <span className="text-sm flex-1">{t.name}</span>
                      <span className="font-semibold">{t.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Status Summary</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Active", count: active, color: "bg-emerald-500" },
                    { label: "Draft", count: items.filter((s) => s.status === "draft").length, color: "bg-gray-400" },
                    { label: "Closed", count: items.filter((s) => s.status === "closed").length, color: "bg-red-500" },
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
            <DataEmptyState {...EMPTY_STATES.surveys} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{selected?.title}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Type: {selected?.type}</span>
              <span>Questions: {selected?.questions}</span>
              <span>Responses: {selected?.responses}</span>
              <span>Deadline: {selected?.deadline}</span>
            </div>
            <Badge className={cn("text-xs", STATUS_COLORS[selected?.status || ""])}>{selected?.status}</Badge>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Survey</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label>Title</Label><Input name="title" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select name="type">
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Engagement">Engagement</SelectItem>
                    <SelectItem value="Pulse">Pulse</SelectItem>
                    <SelectItem value="Exit">Exit</SelectItem>
                    <SelectItem value="Onboarding">Onboarding</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Questions</Label><Input name="questions" type="number" defaultValue={10} min={1} /></div>
            </div>
            <div><Label>Deadline</Label><Input name="deadline" type="date" required /></div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
