"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell } from "recharts";
import { Briefcase, Search, Plus, Users, TrendingUp, ArrowRight, CheckCircle, UserPlus, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useJobStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { COLLECTIONS } from "@/lib/collection-service";

const COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#ef4444"];

// Pipeline stages are configurable per org (see pipelineStages in
// db/schema/ats.ts), not a fixed five-name list, so colour is assigned by
// position rather than looked up by a stage name that may not exist.
const STAGE_GRADIENTS = [
  "from-slate-500 to-gray-600",
  "from-blue-500 to-cyan-500",
  "from-amber-500 to-orange-500",
  "from-violet-500 to-purple-600",
  "from-emerald-500 to-green-600",
  "from-pink-500 to-rose-600",
];

interface FunnelStageRow {
  stageId: string;
  name: string;
  entered: number;
  conversionFromPrevious: number;
  conversionFromStart: number;
}

interface SourceRow {
  source: string;
  applications: number;
  hires: number;
  hireRate: number;
}

function CTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  return (<div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-xl text-xs"><p className="font-semibold mb-1">{label}</p>{payload.map((p, i) => (<p key={i} style={{ color: p.color }}>{p.name}: <span className="font-bold">{p.value}</span></p>))}</div>);
}

export default function ATSPage() {
  const store = useJobStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("pipeline");
  const [funnelStages, setFunnelStages] = useState<FunnelStageRow[]>([]);
  const [sourceReport, setSourceReport] = useState<SourceRow[]>([]);

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.recruitment, store); }, [initialized, store]);

  // Pipeline stage counts and conversion rates used to come from applying a
  // fixed 0.6^stage dropoff curve to the total applicant count, so the funnel
  // always drew the same shape regardless of how hiring was actually going.
  // Real per-stage counts are tracked in the application event log — a
  // candidate who reached interview and was later rejected still counts as
  // having reached it — so they are fetched from there instead.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ats/reports?report=funnel");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Could not load the pipeline funnel");
        setFunnelStages(data.stages ?? []);
      } catch {
        if (!cancelled) setFunnelStages([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Source Analytics used to split the applicant total across six invented
  // channels (LinkedIn, Referral, Naukri, Direct, Campus, Others) at fixed
  // percentages that never changed no matter where candidates actually came
  // from. Real source attribution is recorded per application, so it is
  // fetched from there instead.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ats/reports?report=sources");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Could not load source analytics");
        setSourceReport(data.sources ?? []);
      } catch {
        if (!cancelled) setSourceReport([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(j => j.title?.toLowerCase().includes(q) || j.department?.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") result = result.filter(j => j.status === statusFilter);
    return result;
  }, [items, search, statusFilter]);

  const totalJobs = items.length;
  const totalApplicants = items.reduce((s, j) => s + (j.applicants || 0), 0);
  const totalOpenings = items.reduce((s, j) => s + (j.openings || 0), 0);
  const activeJobs = items.filter(j => j.status === "open" || j.status === "active").length;

  const conversionPairs = useMemo(() => {
    return funnelStages.slice(1).map((stage, idx) => ({
      from: funnelStages[idx].name,
      to: stage.name,
      rate: stage.conversionFromPrevious,
    }));
  }, [funnelStages]);

  const deptData = useMemo(() => {
    const deptMap = new Map<string, { jobs: number; applicants: number }>();
    items.forEach(j => {
      const dept = j.department || "Other";
      const existing = deptMap.get(dept) || { jobs: 0, applicants: 0 };
      deptMap.set(dept, { jobs: existing.jobs + 1, applicants: existing.applicants + (j.applicants || 0) });
    });
    return Array.from(deptMap.entries()).map(([name, data]) => ({ name: name.substring(0, 12), ...data }));
  }, [items]);

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Applicant Tracking System</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{totalJobs} positions &middot; {totalApplicants} applicants</p>
        </div>
        <Button onClick={() => toast.info("Use the Recruitment module to post new jobs")} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"><Plus className="h-4 w-4" />Post Job</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Jobs", value: totalJobs, icon: Briefcase, color: "from-violet-500 to-purple-600" },
          { label: "Total Applicants", value: totalApplicants, icon: Users, color: "from-blue-500 to-cyan-500" },
          { label: "Open Positions", value: totalOpenings, icon: UserPlus, color: "from-emerald-500 to-green-600" },
          { label: "Active Jobs", value: activeJobs, icon: TrendingUp, color: "from-amber-500 to-orange-500" },
        ].map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-md">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white", kpi.color)}><kpi.icon className="h-5 w-5" /></div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-xl font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="pipeline">Pipeline</TabsTrigger><TabsTrigger value="jobs">Jobs</TabsTrigger><TabsTrigger value="analytics">Analytics</TabsTrigger></TabsList>

        <TabsContent value="pipeline" className="mt-4 space-y-4">
          {funnelStages.every(s => s.entered === 0) ? (
            <Card className="border-0 shadow-md">
              <CardContent className="p-6">
                <DataEmptyState
                  title="Not available yet"
                  description="No applications have moved through the hiring pipeline yet, so there is nothing to draw a funnel from. This fills in as candidates are advanced through stages."
                />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Pipeline Stages */}
              <div className="flex items-center gap-0 overflow-x-auto pb-2">
                {funnelStages.map((stage, idx) => (
                  <div key={stage.stageId} className="flex items-center">
                    <Card className={cn("border-0 shadow-md min-w-[140px]")}>
                      <CardContent className="p-4 text-center">
                        <div className={cn("h-12 w-12 rounded-xl bg-gradient-to-br mx-auto flex items-center justify-center text-white font-bold text-lg mb-2", STAGE_GRADIENTS[idx % STAGE_GRADIENTS.length])}>
                          {stage.entered}
                        </div>
                        <p className="text-sm font-semibold">{stage.name}</p>
                        <p className="text-[10px] text-muted-foreground">{stage.conversionFromStart}% of total</p>
                      </CardContent>
                    </Card>
                    {idx < funnelStages.length - 1 && (
                      <div className="flex flex-col items-center mx-1 flex-shrink-0">
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">{conversionPairs[idx]?.rate}%</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Conversion Rates */}
              <Card className="border-0 shadow-md">
                <CardHeader><CardTitle className="text-lg">Stage Conversion Rates</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {conversionPairs.map(cr => (
                    <div key={`${cr.from}-${cr.to}`}>
                      <div className="flex justify-between text-xs mb-1">
                        <span>{cr.from} → {cr.to}</span>
                        <span className="font-bold">{cr.rate}%</span>
                      </div>
                      <Progress value={cr.rate} className="h-1.5" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="jobs" className="mt-4 space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search jobs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="open">Open</SelectItem><SelectItem value="closed">Closed</SelectItem><SelectItem value="on_hold">On Hold</SelectItem></SelectContent>
            </Select>
          </div>
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.recruitment} />
          ) : (
            <div className="space-y-3">
              {filtered.map(job => (
                <Card key={job.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white"><Briefcase className="h-5 w-5" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{job.title}</p>
                      <p className="text-xs text-muted-foreground">{job.department} &middot; {job.location} &middot; {job.openings} openings</p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-bold">{job.applicants || 0} applicants</p>
                      <p className="text-muted-foreground">{job.experienceMin}-{job.experienceMax} yrs</p>
                    </div>
                    <Badge variant={job.status === "open" ? "default" : "secondary"} className="text-xs">{job.status}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-0 shadow-md">
              <CardHeader><CardTitle className="text-lg">Source Analytics</CardTitle></CardHeader>
              <CardContent>
                {sourceReport.length === 0 ? (
                  <DataEmptyState compact title="Not available yet" description="No application is tagged with a source yet, so there is no real channel split to show." />
                ) : (
                  <>
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart><Pie data={sourceReport} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="applications" nameKey="source">{sourceReport.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><RTooltip content={<CTooltip />} /></PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center mt-2">{sourceReport.map((s, i) => <Badge key={s.source} variant="outline" className="text-xs" style={{ borderColor: COLORS[i % COLORS.length] }}>{s.source}: {s.applications} ({s.hireRate}% hired)</Badge>)}</div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card className="border-0 shadow-md">
              <CardHeader><CardTitle className="text-lg">Department Hiring</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deptData}><CartesianGrid strokeDasharray="3 3" className="stroke-muted" /><XAxis dataKey="name" className="text-xs" /><YAxis className="text-xs" /><RTooltip content={<CTooltip />} /><Bar dataKey="jobs" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Jobs" /><Bar dataKey="applicants" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Applicants" /></BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
