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
import { Calendar, Search, Plus, Users, Star, Video, Phone, CheckCircle, Clock, TrendingUp, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { create } from "zustand";
import { useJobStore, startSync, type BaseRecord } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

// ─── Inline Interview Store ──────────────────────────────────
interface InterviewDoc extends BaseRecord {
  candidateName: string; candidateEmail: string; jobId: string;
  jobTitle: string; panelMembers: string; scheduledDate: string;
  scheduledTime: string; type: string; stage: string;
  status: string; score: number; notes: string;
  competencies: Record<string, number>;
}

interface InterviewStore {
  items: InterviewDoc[]; loading: boolean; initialized: boolean; error: string | null;
  setItems: (items: InterviewDoc[]) => void; setLoading: (v: boolean) => void;
  setInitialized: (v: boolean) => void; setError: (e: string | null) => void;
  addItem: (item: InterviewDoc) => void; updateItem: (id: string, updates: Partial<InterviewDoc>) => void;
  removeItem: (id: string) => void;
}

const useInterviewStore = create<InterviewStore>((set) => ({
  items: [], loading: false, initialized: false, error: null,
  setItems: (items) => set({ items, loading: false, initialized: true }),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setError: (error) => set({ error }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) => set((s) => ({ items: s.items.map(i => i.id === id ? { ...i, ...updates } : i) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
}));

const COLLECTION_INTERVIEWS = "interviews";
const INTERVIEW_TYPES = ["In-Person", "Video Call", "Phone Screen", "Panel", "Technical", "HR Round"];
const INTERVIEW_STAGES = ["Screening", "Technical Round 1", "Technical Round 2", "Managerial", "HR", "Final"];
const STATUSES = ["Scheduled", "Completed", "Cancelled", "No-Show", "Rescheduled"];
const COMPETENCIES = ["Technical Skills", "Problem Solving", "Communication", "Culture Fit", "Leadership"];

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button" onClick={() => onChange?.(i)} className="focus:outline-none">
          <Star className={cn("h-4 w-4", i <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
        </button>
      ))}
    </div>
  );
}

export default function InterviewsPage() {
  const store = useInterviewStore();
  const jobStore = useJobStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [scorecardOpen, setScorecardOpen] = useState(false);
  const [selectedInterview, setSelectedInterview] = useState<InterviewDoc | null>(null);
  const [competencyScores, setCompetencyScores] = useState<Record<string, number>>({});
  const [tab, setTab] = useState("list");

  useEffect(() => {
    if (!initialized) startSync(COLLECTION_INTERVIEWS, store as unknown as Parameters<typeof startSync>[1]);
    if (!jobStore.initialized) startSync(COLLECTIONS.recruitment, jobStore);
  }, [initialized, store, jobStore]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(i => i.candidateName?.toLowerCase().includes(q) || i.jobTitle?.toLowerCase().includes(q) || i.panelMembers?.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") result = result.filter(i => i.status === statusFilter);
    return result;
  }, [items, search, statusFilter]);

  const upcoming = items.filter(i => i.status === "Scheduled").length;
  const completed = items.filter(i => i.status === "Completed").length;
  const avgScore = items.filter(i => i.score > 0).length > 0 ? (items.filter(i => i.score > 0).reduce((s, i) => s + i.score, 0) / items.filter(i => i.score > 0).length).toFixed(1) : "0";
  const hireRate = completed > 0 ? `${Math.round((items.filter(i => i.score >= 4).length / completed) * 100)}%` : "0%";

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      candidateName: fd.get("candidateName") as string,
      candidateEmail: fd.get("candidateEmail") as string,
      jobId: fd.get("jobId") as string,
      jobTitle: jobStore.items.find(j => j.id === fd.get("jobId"))?.title || "",
      panelMembers: fd.get("panelMembers") as string,
      scheduledDate: fd.get("scheduledDate") as string,
      scheduledTime: fd.get("scheduledTime") as string,
      type: fd.get("type") as string,
      stage: fd.get("stage") as string,
      status: "Scheduled",
      score: 0,
      notes: "",
      competencies: {},
    };
    try {
      await genericService(COLLECTION_INTERVIEWS).create(data);
      toast.success("Interview scheduled!");
      setCreateOpen(false);
    } catch { toast.error("Failed to schedule interview"); }
  };

  const openScorecard = (interview: InterviewDoc) => {
    setSelectedInterview(interview);
    setCompetencyScores(interview.competencies || {});
    setScorecardOpen(true);
  };

  const handleSubmitScorecard = async () => {
    if (!selectedInterview) return;
    const totalScores = Object.values(competencyScores);
    const avg = totalScores.length > 0 ? totalScores.reduce((a, b) => a + b, 0) / totalScores.length : 0;
    try {
      await genericService(COLLECTION_INTERVIEWS).update(selectedInterview.id, {
        competencies: competencyScores, score: Math.round(avg * 10) / 10, status: "Completed",
      });
      toast.success("Scorecard submitted!");
      setScorecardOpen(false);
    } catch { toast.error("Failed to submit scorecard"); }
  };

  const getTypeIcon = (type: string) => {
    if (type === "Video Call") return Video;
    if (type === "Phone Screen") return Phone;
    return Users;
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Interview Scheduler</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{items.length} interviews &middot; {upcoming} upcoming</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"><Plus className="h-4 w-4" />Schedule Interview</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Upcoming", value: upcoming, icon: Clock, color: "from-blue-500 to-cyan-500" },
          { label: "Completed", value: completed, icon: CheckCircle, color: "from-emerald-500 to-green-600" },
          { label: "Avg Score", value: avgScore, icon: Star, color: "from-amber-500 to-orange-500" },
          { label: "Hire Rate", value: hireRate, icon: TrendingUp, color: "from-violet-500 to-purple-600" },
        ].map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-md">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white", kpi.color)}><kpi.icon className="h-5 w-5" /></div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-xl font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search interviews..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Status</SelectItem>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <DataEmptyState icon={Calendar} title="No interviews scheduled" description="Schedule interviews for candidates applying to your open positions." actionLabel="Schedule Interview" onAction={() => setCreateOpen(true)} />
      ) : (
        <div className="space-y-3">
          {filtered.map(interview => {
            const TypeIcon = getTypeIcon(interview.type);
            return (
              <Card key={interview.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white"><TypeIcon className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{interview.candidateName}</p>
                    <p className="text-xs text-muted-foreground">{interview.jobTitle} &middot; {interview.stage} &middot; {interview.type}</p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>{interview.scheduledDate}</p>
                    <p>{interview.scheduledTime}</p>
                  </div>
                  {interview.score > 0 && <StarRating value={Math.round(interview.score)} />}
                  <Badge variant={interview.status === "Completed" ? "default" : interview.status === "Scheduled" ? "secondary" : "destructive"} className="text-xs">{interview.status}</Badge>
                  {interview.status === "Scheduled" && <Button variant="outline" size="sm" onClick={() => openScorecard(interview)}>Scorecard</Button>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Schedule Interview</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Candidate Name</Label><Input name="candidateName" required /></div>
              <div><Label>Candidate Email</Label><Input name="candidateEmail" type="email" required /></div>
            </div>
            <div><Label>Job Position</Label>
              <Select name="jobId"><SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger><SelectContent>{jobStore.items.map(j => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label>Panel Members</Label><Input name="panelMembers" placeholder="John, Jane, Bob" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input name="scheduledDate" type="date" required /></div>
              <div><Label>Time</Label><Input name="scheduledTime" type="time" required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Type</Label><Select name="type"><SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger><SelectContent>{INTERVIEW_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Stage</Label><Select name="stage"><SelectTrigger><SelectValue placeholder="Stage" /></SelectTrigger><SelectContent>{INTERVIEW_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <DialogFooter><Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2"><Plus className="h-4 w-4" />Schedule</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Scorecard Dialog */}
      <Dialog open={scorecardOpen} onOpenChange={setScorecardOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Scorecard — {selectedInterview?.candidateName}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{selectedInterview?.jobTitle} &middot; {selectedInterview?.stage}</p>
            {COMPETENCIES.map(comp => (
              <div key={comp} className="flex items-center justify-between">
                <span className="text-sm">{comp}</span>
                <StarRating value={competencyScores[comp] || 0} onChange={v => setCompetencyScores(prev => ({ ...prev, [comp]: v }))} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScorecardOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmitScorecard} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">Submit Scorecard</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
