"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ClipboardList, Plus, Search, BarChart3, Users, CheckCircle2, Clock, Calendar, Sparkles, MessageSquare, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSurveyStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  active: "status-active",
  draft: "status-inactive",
  closed: "status-rejected",
};

const SURVEY_TYPES = [
  { id: "Engagement", label: "Employee Engagement", desc: "Culture & Satisfaction index", defaultQ: 12 },
  { id: "Pulse", label: "Quick Pulse Survey", desc: "Weekly / bi-weekly sentiment", defaultQ: 5 },
  { id: "Onboarding", label: "New Hire Onboarding", desc: "First 30/60/90 days feedback", defaultQ: 8 },
  { id: "Manager", label: "Manager & Leadership", desc: "360 degree feedback loop", defaultQ: 10 },
  { id: "Exit", label: "Exit & Separation", desc: "Offboarding feedback & insights", defaultQ: 15 },
];

export default function SurveysPage() {
  const store = useSurveyStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<(typeof items)[0] | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [type, setType] = useState(SURVEY_TYPES[0].id);
  const [questions, setQuestions] = useState(10);
  const [deadline, setDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [submitting, setSubmitting] = useState(false);

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

  const typeBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((s) => {
      map[s.type || "Other"] = (map[s.type || "Other"] || 0) + 1;
    });
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter a survey title.");
      return;
    }

    setSubmitting(true);
    const data = {
      title: title.trim(),
      type,
      status: "active",
      questions: Number(questions) || 5,
      responses: 0,
      deadline,
    };
    try {
      await genericService(COLLECTIONS.surveys).create(data);
      toast.success("Survey published and distributed successfully!");
      setDialogOpen(false);
      setTitle("");
    } catch {
      toast.error("Failed to create survey");
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
          <h1 className="text-2xl font-bold tracking-tight">Pulse &amp; Employee Surveys</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} surveys &middot; {totalResponses} total responses captured
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          Create Survey
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Surveys", value: items.length, icon: ClipboardList, color: "from-violet-500 to-purple-600" },
          { label: "Active Surveys", value: active, icon: Clock, color: "from-blue-500 to-cyan-500" },
          { label: "Responses Collected", value: totalResponses, icon: MessageSquare, color: "from-emerald-500 to-green-600" },
          { label: "Questions Pool", value: totalQuestions, icon: Users, color: "from-amber-500 to-orange-500" },
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
          <Input placeholder="Search surveys by title or type..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 text-xs h-9" />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">All Surveys</TabsTrigger>
          <TabsTrigger value="types">Survey Distribution</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.surveys} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching surveys found.</p>
          ) : (
            filtered.map((survey) => (
              <Card key={survey.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white shrink-0">
                      <ClipboardList className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{survey.title}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span>{survey.type}</span>
                        <span>&middot;</span>
                        <span>{survey.questions} questions</span>
                        <span>&middot;</span>
                        <span className="text-violet-600 dark:text-violet-400 font-medium">{survey.responses} responses</span>
                        <span>&middot;</span>
                        <span>Due {survey.deadline}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={cn("text-xs", STATUS_COLORS[survey.status] || "bg-muted text-muted-foreground")}>{survey.status}</Badge>
                    <Button variant="outline" size="sm" className="rounded-full text-xs h-8 px-3" onClick={() => setSelected(survey)}>
                      <Eye className="h-3.5 w-3.5 mr-1" /> View
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="types" className="mt-4">
          {items.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Surveys by Category</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {typeBreakdown.map((t) => (
                  <div key={t.name} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                    <span className="text-xs font-semibold text-foreground">{t.name}</span>
                    <Badge variant="outline" className="text-xs">{t.count} surveys</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <DataEmptyState {...EMPTY_STATES.surveys} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      {/* ENHANCED CREATE SURVEY DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Create &amp; Distribute Survey</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Gather actionable workforce feedback with automated response tracking.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Survey Title <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Q3 Workplace Culture &amp; Well-being Pulse"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="h-9 text-xs"
                required
              />
            </div>

            {/* Survey Category Cards */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Survey Category</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SURVEY_TYPES.map(st => {
                  const active = type === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        setType(st.id);
                        setQuestions(st.defaultQ);
                      }}
                      className={cn(
                        "p-2.5 rounded-lg border text-left transition-all",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <p className="font-semibold text-xs text-foreground">{st.label}</p>
                      <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{st.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Number of Questions</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={questions}
                  onChange={e => setQuestions(Number(e.target.value))}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Response Deadline <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={deadline}
                  onChange={e => setDeadline(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>
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
                {submitting ? "Publishing…" : "Publish Survey"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* VIEW SURVEY DIALOG */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">{selected?.title}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Survey status and responses overview.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selected && (
            <div className="space-y-3 mt-2 text-xs">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Category</p>
                  <p className="font-semibold text-foreground mt-0.5">{selected.type}</p>
                </div>
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Status</p>
                  <Badge className={cn("mt-1 text-[11px]", STATUS_COLORS[selected.status || ""])}>{selected.status}</Badge>
                </div>
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Total Questions</p>
                  <p className="font-semibold text-foreground mt-0.5">{selected.questions} questions</p>
                </div>
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Responses</p>
                  <p className="font-semibold text-violet-600 dark:text-violet-400 mt-0.5">{selected.responses} responses</p>
                </div>
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
