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
  MessageSquare, Plus, Search, ThumbsUp, Clock, CheckCircle2,
  TrendingUp, Lightbulb, Shield, Heart, Zap, AlertTriangle,
  Building2, User, Eye, EyeOff, Tag, Filter, Sparkles, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFeedbackStore, useEmployeeStore, startSync, type FeedbackDoc } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  "in-review": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  planned: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  declined: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
  closed: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
};

const FEEDBACK_CATEGORIES = [
  { id: "Suggestion", label: "Idea & Suggestion", icon: Lightbulb, color: "text-amber-500", desc: "Product, technology, or creative ideas" },
  { id: "Process", label: "Process Improvement", icon: Zap, color: "text-blue-500", desc: "Streamlining workflows & productivity" },
  { id: "Culture", label: "Culture & Well-being", icon: Heart, color: "text-rose-500", desc: "Work-life balance, diversity, events" },
  { id: "Workplace", label: "Workplace & Facility", icon: Building2, color: "text-emerald-500", desc: "Office spaces, hardware, amenities" },
  { id: "Appreciation", label: "Kudos & Praise", icon: Sparkles, color: "text-purple-500", desc: "Recognizing a team or peer initiative" },
  { id: "Grievance", label: "Issue / Grievance", icon: AlertTriangle, color: "text-red-500", desc: "Concerns or operational roadblocks" },
];

const TARGET_DEPARTMENTS = [
  "General / All",
  "People Ops & HR",
  "Engineering & Technology",
  "Product & Design",
  "Facilities & Operations",
  "Finance & Payroll",
  "Executive Leadership",
];

const IMPACT_LEVELS = [
  { id: "Low", label: "Low Impact", desc: "Nice to have improvement" },
  { id: "Moderate", label: "Moderate", desc: "Team-wide benefit" },
  { id: "High", label: "High Priority", desc: "Significant efficiency gain" },
  { id: "Critical", label: "Critical Blocker", desc: "Immediate resolution needed" },
];

const PRESET_TAGS = [
  "#Culture", "#HybridWork", "#Tools", "#Policy",
  "#Ergonomics", "#Benefits", "#Process", "#Collaboration",
];

export default function FeedbackPage() {
  const store = useFeedbackStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const { items: employees, initialized: empInit } = empStore;

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<FeedbackDoc | null>(null);

  // Form State
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(FEEDBACK_CATEGORIES[0].id);
  const [targetDept, setTargetDept] = useState(TARGET_DEPARTMENTS[0]);
  const [impact, setImpact] = useState(IMPACT_LEVELS[1].id);
  const [description, setDescription] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submittedBy, setSubmittedBy] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.feedback, store);
    if (!empInit) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empInit, empStore]);

  const filtered = useMemo(() => {
    let result = items;
    if (catFilter !== "all") result = result.filter(f => f.category === catFilter);
    if (statusFilter !== "all") result = result.filter(f => f.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) =>
          (f.title || "").toLowerCase().includes(q) ||
          (f.category || "").toLowerCase().includes(q) ||
          (f.submittedBy || "").toLowerCase().includes(q) ||
          (f.description || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, search, catFilter, statusFilter]);

  const openCount = items.filter((f) => f.status === "open").length;
  const inReviewCount = items.filter((f) => f.status === "in-review" || f.status === "planned").length;
  const resolvedCount = items.filter((f) => f.status === "resolved").length;
  const totalUpvotes = items.reduce((s, f) => s + (f.upvotes || 0), 0);

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((f) => {
      map[f.category || "Other"] = (map[f.category || "Other"] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast.error("Please provide a title and detailed description.");
      return;
    }

    setSubmitting(true);
    const authorName = isAnonymous ? "Anonymous Contributor" : (submittedBy.trim() || "Anonymous Contributor");
    const tagSuffix = selectedTags.length > 0 ? `\n\nTags: ${selectedTags.join(" ")}` : "";
    const deptInfo = ` [Target: ${targetDept} | Impact: ${impact}]`;

    const data: Omit<FeedbackDoc, "id"> = {
      title: title.trim(),
      category,
      description: `${description.trim()}${deptInfo}${tagSuffix}`,
      submittedBy: authorName,
      status: "open",
      upvotes: 0,
      createdAt: new Date().toISOString(),
    };

    try {
      const id = await genericService(COLLECTIONS.feedback).create(data as unknown as Record<string, unknown>);
      store.addItem({ ...data, id } as FeedbackDoc);
      toast.success("Feedback submitted successfully! Thank you for contributing.");
      setDialogOpen(false);
      setTitle("");
      setDescription("");
      setSelectedTags([]);
      setIsAnonymous(false);
    } catch {
      toast.error("Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpvote = async (id: string, currentVotes: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await genericService(COLLECTIONS.feedback).update(id, { upvotes: (currentVotes || 0) + 1 });
      store.updateItem(id, { upvotes: (currentVotes || 0) + 1 });
      if (selected && selected.id === id) {
        setSelected({ ...selected, upvotes: (currentVotes || 0) + 1 });
      }
      toast.success("Upvoted! Your vote has been recorded.");
    } catch {
      toast.error("Failed to register upvote");
    }
  };

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      await genericService(COLLECTIONS.feedback).update(id, { status: newStatus });
      store.updateItem(id, { status: newStatus });
      if (selected && selected.id === id) {
        setSelected({ ...selected, status: newStatus });
      }
      toast.success(`Feedback status marked as ${newStatus}`);
    } catch {
      toast.error("Failed to update status");
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
          <h1 className="text-2xl font-bold tracking-tight">Voice &amp; Feedback Hub</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Transparent employee ideas, continuous improvement suggestions, and open feedback
          </p>
        </div>
        <Button
          onClick={() => {
            if (employees.length > 0 && !submittedBy) {
              setSubmittedBy([employees[0].firstName, employees[0].lastName].filter(Boolean).join(" "));
            }
            setDialogOpen(true);
          }}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          Share Feedback
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Submissions", value: items.length, icon: MessageSquare, color: "from-violet-500 to-purple-600", sub: "All time ideas" },
          { label: "Open Feedback", value: openCount, icon: Clock, color: "from-amber-500 to-orange-500", sub: "Awaiting triage" },
          { label: "In Review / Planned", value: inReviewCount, icon: TrendingUp, color: "from-blue-500 to-cyan-500", sub: "Under evaluation" },
          { label: "Resolved & Implemented", value: resolvedCount, icon: CheckCircle2, color: "from-emerald-500 to-green-600", sub: "Actioned suggestions" },
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

      {/* Search & Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search feedback by summary, category, author, or tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-xs h-9"
          />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Categories</SelectItem>
            {FEEDBACK_CATEGORIES.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 h-9 text-xs"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Status</SelectItem>
            <SelectItem value="open" className="text-xs">Open</SelectItem>
            <SelectItem value="in-review" className="text-xs">In Review</SelectItem>
            <SelectItem value="planned" className="text-xs">Planned</SelectItem>
            <SelectItem value="resolved" className="text-xs">Resolved</SelectItem>
            <SelectItem value="declined" className="text-xs">Declined</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">All Ideas &amp; Feedback</TabsTrigger>
          <TabsTrigger value="analytics">Category Breakdown</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.feedback} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-xs">No matching feedback found.</p>
          ) : (
            filtered.map((fb) => (
              <Card key={fb.id} className="hover:shadow-sm transition-all cursor-pointer border" onClick={() => setSelected(fb)}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-semibold text-sm text-foreground">{fb.title}</p>
                      <Badge variant="outline" className="text-[11px] font-medium">{fb.category}</Badge>
                      <Badge className={cn("text-[10px] uppercase font-semibold", STATUS_COLORS[fb.status] || "bg-muted")}>{fb.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{fb.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        {fb.submittedBy?.includes("Anonymous") ? <EyeOff className="h-3 w-3 text-muted-foreground" /> : <User className="h-3 w-3 text-violet-500" />}
                        {fb.submittedBy}
                      </span>
                      <span>&middot;</span>
                      <span>{fb.createdAt ? new Date(fb.createdAt).toLocaleDateString() : "Recent"}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => handleUpvote(fb.id, fb.upvotes || 0, e)}
                      className="rounded-full text-xs h-8 px-3 gap-1.5 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:border-violet-300"
                    >
                      <ThumbsUp className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                      <span className="font-bold text-violet-700 dark:text-violet-300">{fb.upvotes || 0}</span>
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-full text-xs h-8 px-2.5">
                      <Eye className="h-3.5 w-3.5 mr-1" /> View
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Submissions by Category</CardTitle></CardHeader>
                <CardContent className="space-y-2.5">
                  {categoryBreakdown.map((c) => (
                    <div key={c.name} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                      <span className="text-xs font-semibold text-foreground">{c.name}</span>
                      <Badge variant="outline" className="text-xs">{c.count} tickets</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Lifecycle Status</CardTitle></CardHeader>
                <CardContent className="space-y-2.5">
                  {[
                    { label: "Open Triage", count: openCount, color: "bg-amber-500" },
                    { label: "Under Review / Planned", count: inReviewCount, color: "bg-blue-500" },
                    { label: "Resolved / Implemented", count: resolvedCount, color: "bg-emerald-500" },
                    { label: "Declined / Closed", count: items.filter((f) => f.status === "declined" || f.status === "closed").length, color: "bg-gray-400" },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                      <div className="flex items-center gap-2">
                        <div className={cn("h-2.5 w-2.5 rounded-full", s.color)} />
                        <span className="text-xs font-semibold text-foreground">{s.label}</span>
                      </div>
                      <span className="text-xs font-bold">{s.count}</span>
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

      {/* ENHANCED CREATE / SUBMIT FEEDBACK DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Share Employee Feedback &amp; Ideas</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Propose innovations, request process improvements, or voice workplace feedback.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Feedback Title / Proposal <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Introduce weekly no-meeting focus blocks on Thursdays"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="h-9 text-xs"
                required
              />
            </div>

            {/* Category Cards */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Feedback Category</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {FEEDBACK_CATEGORIES.map(cat => {
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
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className={cn("h-3.5 w-3.5", active ? "text-violet-600" : cat.color)} />
                        <span className="font-bold text-xs truncate">{cat.label}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">{cat.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Target Department & Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Route to Department / Team
                </Label>
                <Select value={targetDept} onValueChange={setTargetDept}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TARGET_DEPARTMENTS.map(d => <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  Estimated Impact Level
                </Label>
                <Select value={impact} onValueChange={setImpact}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IMPACT_LEVELS.map(i => <SelectItem key={i.id} value={i.id} className="text-xs">{i.label} ({i.desc})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Detailed Suggestion &amp; Expected Benefits <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="Explain the background, proposed solution, and how it improves our work environment..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="text-xs resize-none"
                required
              />
            </div>

            {/* Tag Selection Chips */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                Select Related Topics / Tags
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_TAGS.map(tag => {
                  const active = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleTagToggle(tag)}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer",
                        active
                          ? "bg-violet-600 text-white border-violet-600 shadow-xs"
                          : "bg-background text-muted-foreground border-border hover:bg-muted"
                      )}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Anonymity & Author Selector */}
            <div className="p-3 rounded-xl border bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    {isAnonymous ? <EyeOff className="h-3.5 w-3.5 text-amber-500" /> : <Eye className="h-3.5 w-3.5 text-violet-500" />}
                    Submit Anonymously
                  </p>
                  <p className="text-[11px] text-muted-foreground">Keep your name and email private from the public feed</p>
                </div>
                <Switch checked={isAnonymous} onCheckedChange={setIsAnonymous} />
              </div>

              {!isAnonymous && (
                <div className="space-y-1 pt-1 border-t border-border">
                  <Label className="text-xs font-semibold">Your Name / Designation</Label>
                  {employees && employees.length > 0 ? (
                    <Select value={submittedBy} onValueChange={setSubmittedBy}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select contributor..." /></SelectTrigger>
                      <SelectContent>
                        {employees.map(emp => {
                          const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || String(emp.id);
                          const sub = [emp.designation, emp.department].filter(Boolean).join(" · ");
                          return (
                            <SelectItem key={emp.id} value={name} className="text-xs">
                              <span className="font-medium">{name}</span>
                              {sub ? <span className="text-muted-foreground ml-2 text-[11px]">({sub})</span> : null}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={submittedBy}
                      onChange={e => setSubmittedBy(e.target.value)}
                      placeholder="e.g. Priya Sharma (Tech Lead)"
                      className="h-8 text-xs"
                    />
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button type="button" variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setDialogOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all gap-1.5">
                <Send className="h-4 w-4" /> {submitting ? "Submitting…" : "Post Feedback"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ENHANCED VIEW FEEDBACK DETAIL DIALOG */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-bold truncate">{selected?.title}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Submitted by {selected?.submittedBy} &middot; {selected?.createdAt ? new Date(selected.createdAt).toLocaleDateString() : "Recent"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Badge variant="outline" className="text-xs font-semibold">{selected.category}</Badge>
                <Badge className={cn("text-xs font-semibold uppercase", STATUS_COLORS[selected.status || "open"])}>{selected.status}</Badge>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUpvote(selected.id, selected.upvotes || 0)}
                    className="rounded-full text-xs h-8 px-3 gap-1.5 hover:bg-violet-50 dark:hover:bg-violet-950/40"
                  >
                    <ThumbsUp className="h-3.5 w-3.5 text-violet-600" />
                    <span className="font-bold">{selected.upvotes || 0} Upvotes</span>
                  </Button>
                </div>
              </div>

              <div className="p-4 rounded-xl border bg-muted/20">
                <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{selected.description}</p>
              </div>

              {/* Status Update Actions for HR / Managers */}
              <div className="p-3 rounded-lg border bg-background space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Update Lifecycle Status:</p>
                <div className="flex gap-1.5 flex-wrap">
                  {["open", "in-review", "planned", "resolved", "declined"].map(st => (
                    <Button
                      key={st}
                      variant="outline"
                      size="sm"
                      onClick={() => handleStatusUpdate(selected.id, st)}
                      className={cn("rounded-full text-[11px] h-7 px-3 capitalize", selected.status === st ? "bg-violet-600 text-white border-violet-600" : "")}
                    >
                      {st.replace("-", " ")}
                    </Button>
                  ))}
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
