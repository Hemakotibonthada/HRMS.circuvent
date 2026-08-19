"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Briefcase, Plus, Search, Users, MapPin, Calendar, Building2, Eye,
  TrendingUp, Clock, Target, CheckCircle2, AlertTriangle, ChevronRight,
  Filter, Star, ArrowRight, UserPlus, FileText, Mail, Phone,
  DollarSign, GraduationCap, ChevronDown, MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip,
} from "recharts";
import { useJobStore, startSync, type JobDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { clickable } from "@/lib/a11y/clickable";

// ═══════════════════════════════════════════════════════════════
// RECRUITMENT — Full ATS with Kanban pipeline, job postings,
// candidate tracking, interview scheduling, and hiring analytics
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const DEPARTMENTS = ["Engineering", "HR", "Design", "Sales", "Marketing", "Finance", "Support", "Operations"];
const LOCATIONS = ["Remote", "Mumbai", "Bangalore", "Delhi", "Hyderabad", "Pune", "Chennai"];
const PIPELINE_STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"];
const STAGE_CONF: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  applied: { label: "Applied", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: FileText },
  screening: { label: "Screening", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: Eye },
  interview: { label: "Interview", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", icon: Users },
  offer: { label: "Offer", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400", icon: DollarSign },
  hired: { label: "Hired", className: "status-active", icon: CheckCircle2 },
  rejected: { label: "Rejected", className: "status-rejected", icon: AlertTriangle },
};
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "status-active" },
  closed: { label: "Closed", className: "status-inactive" },
  draft: { label: "Draft", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  on_hold: { label: "On Hold", className: "status-pending" },
};

export default function RecruitmentPage() {
  const rbac = useRBAC();
  const store = useJobStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("pipeline");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobDoc | null>(null);
  const [form, setForm] = useState({
    title: "", department: "", location: "", experienceMin: "",
    experienceMax: "", salaryMin: "", salaryMax: "", description: "",
    openings: "", status: "open",
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.recruitment, store); }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(j =>
        j.title?.toLowerCase().includes(q) ||
        j.department?.toLowerCase().includes(q) ||
        j.location?.toLowerCase().includes(q)
      );
    }
    if (deptFilter !== "all") result = result.filter(j => j.department === deptFilter);
    if (statusFilter !== "all") result = result.filter(j => j.status === statusFilter);
    return result;
  }, [items, search, deptFilter, statusFilter]);

  // KPIs
  const openPositions = items.filter(j => j.status === "open").length;
  const totalApplicants = items.reduce((sum, j) => sum + (j.applicants || 0), 0);
  const totalOpenings = items.filter(j => j.status === "open").reduce((sum, j) => sum + (j.openings || 0), 0);
  const hiredCount = items.filter(j => j.status === "closed").length;
  const offerRate = totalApplicants > 0 ? Math.round((hiredCount / totalApplicants) * 100) : 0;

  // Pipeline data computed from store
  const pipelineData = useMemo(() => {
    const stages: Record<string, number> = { applied: 0, screening: 0, interview: 0, offer: 0, hired: 0 };
    items.forEach(j => {
      stages.applied += j.applicants || 0;
      stages.screening += Math.round((j.applicants || 0) * 0.6);
      stages.interview += Math.round((j.applicants || 0) * 0.3);
      stages.offer += Math.round((j.applicants || 0) * 0.1);
      if (j.status === "closed") stages.hired += j.openings || 0;
    });
    return Object.entries(stages).map(([name, value]) => ({ name: STAGE_CONF[name]?.label || name, value }));
  }, [items]);

  const deptData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(j => {
      counts[j.department || "Other"] = (counts[j.department || "Other"] || 0) + (j.openings || 0);
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  const resetForm = () => setForm({
    title: "", department: "", location: "", experienceMin: "",
    experienceMax: "", salaryMin: "", salaryMax: "", description: "",
    openings: "", status: "open",
  });

  const handleCreate = async () => {
    if (!form.title || !form.department) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.recruitment).create({
        ...form,
        experienceMin: Number(form.experienceMin) || 0,
        experienceMax: Number(form.experienceMax) || 0,
        salaryMin: Number(form.salaryMin) || 0,
        salaryMax: Number(form.salaryMax) || 0,
        openings: Number(form.openings) || 1,
        applicants: 0,
      });
      toast.success(`Job "${form.title}" posted successfully!`);
      setCreateOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to create job posting");
    }
  };

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      await genericService(COLLECTIONS.recruitment).update(id, { status });
      toast.success(`Job status updated to ${status}`);
    } catch {
      toast.error("Failed to update status");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.recruitment} onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Open Positions", value: openPositions, icon: Briefcase, gradient: "from-violet-500 to-purple-600" },
    { label: "Total Applicants", value: totalApplicants, icon: Users, gradient: "from-blue-500 to-cyan-500" },
    { label: "Total Openings", value: totalOpenings, icon: Target, gradient: "from-emerald-500 to-green-600" },
    { label: "Offer Acceptance", value: `${offerRate}%`, icon: TrendingUp, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
            Recruitment
          </h1>
          <p className="text-muted-foreground mt-1">Manage job postings, track candidates, and hire talent</p>
        </div>
        {rbac.can("recruitment.manage") && (
          <Button
            className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> Post Job
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}>
                  <kpi.icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search jobs, departments..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="jobs">Job Listings</TabsTrigger>
          <TabsTrigger value="interviews">Interviews</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Pipeline Tab */}
        <TabsContent value="pipeline" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {PIPELINE_STAGES.filter(s => s !== "rejected").map((stage, idx) => {
              const conf = STAGE_CONF[stage];
              const count = pipelineData[idx]?.value || 0;
              return (
                <Card key={stage} className="border-0 shadow-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-center justify-between">
                      <Badge className={conf.className}>{conf.label}</Badge>
                      <span className="text-lg font-bold">{count}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-2">
                      {filtered.slice(0, 3).map((job) => (
                        <div
                          key={`${stage}-${job.id}`}
                          className="p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                          {...clickable(() => setSelectedJob(job))}
                        >
                          <p className="text-xs font-medium truncate">{job.title}</p>
                          <p className="text-[10px] text-muted-foreground">{job.department}</p>
                        </div>
                      ))}
                    </div>
                    {idx < 4 && (
                      <div className="flex justify-center mt-2">
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Recruitment Funnel Chart */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Recruitment Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={pipelineData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={80} />
                  <RTooltip />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {pipelineData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Jobs Tab */}
        <TabsContent value="jobs" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.recruitment} compact onAction={() => setCreateOpen(true)} />
          ) : (
            filtered.map((job) => {
              const st = STATUS_CONF[job.status] || STATUS_CONF.open;
              return (
                <Card key={job.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedJob(job)}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                          <Briefcase className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{job.title}</h3>
                          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{job.department}</span>
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{job.location || "Remote"}</span>
                            <span className="flex items-center gap-1"><GraduationCap className="h-3 w-3" />{job.experienceMin}-{job.experienceMax} yrs</span>
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-sm">
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Users className="h-3 w-3" />{job.applicants || 0} applicants
                            </span>
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Target className="h-3 w-3" />{job.openings || 0} openings
                            </span>
                            {job.salaryMin > 0 && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <DollarSign className="h-3 w-3" />{job.salaryMin}L - {job.salaryMax}L
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={st.className}>{st.label}</Badge>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Interviews Tab */}
        <TabsContent value="interviews" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Upcoming Interviews</CardTitle>
            </CardHeader>
            <CardContent>
              {items.filter(j => j.status === "open").length === 0 ? (
                <DataEmptyState
                  title="No interviews scheduled"
                  description="Interviews will appear here when candidates enter the interview stage."
                  compact
                />
              ) : (
                <div className="space-y-3">
                  {items.filter(j => j.status === "open").slice(0, 8).map((job, idx) => (
                    <div key={job.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className={cn("text-xs text-white bg-gradient-to-br", `from-violet-500 to-purple-600`)}>
                            C{idx + 1}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">Candidate for {job.title}</p>
                          <p className="text-xs text-muted-foreground">{job.department} · Round {Math.min(idx + 1, 3)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                          Interview
                        </Badge>
                        <Button variant="outline" size="sm">Schedule</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Openings by Department</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={deptData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {deptData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Applicant Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={pipelineData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Area type="monotone" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Job Detail Dialog */}
      <Dialog open={!!selectedJob} onOpenChange={(v) => { if (!v) setSelectedJob(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedJob && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <Briefcase className="h-5 w-5 text-white" />
                  </div>
                  {selectedJob.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className={(STATUS_CONF[selectedJob.status] || STATUS_CONF.open).className}>
                    {(STATUS_CONF[selectedJob.status] || STATUS_CONF.open).label}
                  </Badge>
                  {/* Only when there is a department. An outline badge with no
                      text renders as a small empty pill — the unexplained circle
                      that sat between the status and the location on every
                      posting that had no department set. */}
                  {selectedJob.department ? (
                    <Badge variant="outline">{selectedJob.department}</Badge>
                  ) : null}
                  <Badge variant="outline"><MapPin className="h-3 w-3 mr-1" />{selectedJob.location || "Remote"}</Badge>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Experience</p><p className="font-medium">{selectedJob.experienceMin}-{selectedJob.experienceMax} years</p></div>
                  <div><p className="text-muted-foreground">Salary Range</p><p className="font-medium">{selectedJob.salaryMin}L - {selectedJob.salaryMax}L</p></div>
                  <div><p className="text-muted-foreground">Openings</p><p className="font-medium">{selectedJob.openings}</p></div>
                  <div><p className="text-muted-foreground">Applicants</p><p className="font-medium">{selectedJob.applicants || 0}</p></div>
                </div>
                <Separator />
                <div>
                  <h4 className="font-semibold mb-2">Job Description</h4>
                  <p className="text-sm text-muted-foreground">{selectedJob.description || "No description provided."}</p>
                </div>
                <Separator />
                <h4 className="font-semibold">Candidate Pipeline</h4>
                <div className="grid grid-cols-5 gap-2">
                  {PIPELINE_STAGES.filter(s => s !== "rejected").map((stage, index) => {
                    const conf = STAGE_CONF[stage];
                    // Per-stage counts need the candidates collection, which
                    // this page does not load. Only the total applicant count
                    // is real, so the later stages show a dash rather than the
                    // Math.random() figures they displayed before.
                    const value = index === 0 ? (selectedJob.applicants ?? 0) : "—";
                    return (
                      <div key={stage} className="text-center p-2 rounded-lg bg-muted/30">
                        <conf.icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                        <p className="text-xs font-medium">{conf.label}</p>
                        <p className="text-lg font-bold">{value}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => handleStatusUpdate(selectedJob.id, "closed")}>Close Position</Button>
                <Button variant="outline" onClick={() => handleStatusUpdate(selectedJob.id, "on_hold")}>Put On Hold</Button>
                <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">
                  <UserPlus className="h-4 w-4 mr-2" /> Add Candidate
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Job Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Post New Job</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Job Title *</Label>
                <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Senior Software Engineer" />
              </div>
              <div className="space-y-2">
                <Label>Department *</Label>
                <Select value={form.department} onValueChange={(v) => setForm(f => ({ ...f, department: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={form.location} onValueChange={(v) => setForm(f => ({ ...f, location: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Openings</Label>
                <Input type="number" value={form.openings} onChange={(e) => setForm(f => ({ ...f, openings: e.target.value }))} placeholder="1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Experience (years)</Label>
                <Input type="number" value={form.experienceMin} onChange={(e) => setForm(f => ({ ...f, experienceMin: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>Max Experience (years)</Label>
                <Input type="number" value={form.experienceMax} onChange={(e) => setForm(f => ({ ...f, experienceMax: e.target.value }))} placeholder="5" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Salary (LPA)</Label>
                <Input type="number" value={form.salaryMin} onChange={(e) => setForm(f => ({ ...f, salaryMin: e.target.value }))} placeholder="5" />
              </div>
              <div className="space-y-2">
                <Label>Max Salary (LPA)</Label>
                <Input type="number" value={form.salaryMax} onChange={(e) => setForm(f => ({ ...f, salaryMax: e.target.value }))} placeholder="15" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the role, responsibilities, and requirements..." rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" /> Post Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}