"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Users, Search, Briefcase, Building2, TrendingUp,
  BarChart3, UserCheck, UserMinus, Target, GaugeCircle,
  Layers, AlertTriangle, Zap, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, Tooltip as RTooltip,
} from "recharts";
import { useEmployeeStore, useJobStore, useTeamStore, startSync } from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// RESOURCE PLANNER — Resource allocation & capacity planning
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];

export default function ResourcePlannerPage() {
  const empStore = useEmployeeStore();
  const jobStore = useJobStore();
  const teamStore = useTeamStore();
  const { items: employees, loading, initialized } = empStore;
  const { items: jobs } = jobStore;
  const { items: teams } = teamStore;
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [tab, setTab] = useState("utilization");
  const [detailEmp, setDetailEmp] = useState<typeof employees[0] | null>(null);

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!jobStore.initialized) startSync(COLLECTIONS.recruitment, jobStore);
    if (!teamStore.initialized) startSync(COLLECTIONS.teams, teamStore);
  }, [empStore, jobStore, teamStore]);

  const departments = useMemo(() => [...new Set(employees.map(e => e.department).filter(Boolean))], [employees]);

  // Active employees
  const activeEmployees = useMemo(() => employees.filter(e => e.status === "active"), [employees]);

  // Allocated = employees assigned to teams
  const allocatedEmps = useMemo(() => {
    const teamEmpIds = new Set<string>();
    teams.forEach(t => {
      // Approximate: use team member count to mark first N employees from dept as allocated
      const deptEmps = activeEmployees.filter(e => e.department === t.department);
      deptEmps.slice(0, t.memberCount || 0).forEach(e => teamEmpIds.add(e.id));
    });
    return teamEmpIds.size;
  }, [activeEmployees, teams]);

  const benchCount = activeEmployees.length - allocatedEmps;
  const utilizationRate = activeEmployees.length > 0
    ? Math.round((allocatedEmps / activeEmployees.length) * 100) : 0;

  // Employee utilization by department
  const deptUtilization = useMemo(() => {
    return departments.map(dept => {
      const deptEmps = activeEmployees.filter(e => e.department === dept);
      const deptTeams = teams.filter(t => t.department === dept);
      const allocated = deptTeams.reduce((s, t) => s + (t.memberCount || 0), 0);
      const utilization = deptEmps.length > 0 ? Math.min(100, Math.round((allocated / deptEmps.length) * 100)) : 0;
      return { name: dept, total: deptEmps.length, allocated: Math.min(allocated, deptEmps.length), bench: Math.max(0, deptEmps.length - allocated), utilization };
    });
  }, [departments, activeEmployees, teams]);

  // Skill gap analysis
  const skillAnalysis = useMemo(() => {
    const allSkills: Record<string, number> = {};
    activeEmployees.forEach(e => {
      (e.skills || []).forEach(s => { allSkills[s] = (allSkills[s] || 0) + 1; });
    });
    // Job requirements (approximate from job titles)
    const jobSkillDemand: Record<string, number> = {};
    jobs.filter(j => j.status === "open").forEach(j => {
      const key = j.department || "General";
      jobSkillDemand[key] = (jobSkillDemand[key] || 0) + (j.openings || 1);
    });
    return Object.entries(allSkills)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([skill, count]) => ({ skill, available: count, demand: Math.max(1, Math.floor(count * 0.7)) }));
  }, [activeEmployees, jobs]);

  // Allocation by department chart
  const allocationChart = useMemo(() => {
    return deptUtilization.map(d => ({
      name: d.name.slice(0, 12), allocated: d.allocated, bench: d.bench,
    }));
  }, [deptUtilization]);

  // Capacity planning
  const openPositions = jobs.filter(j => j.status === "open").reduce((s, j) => s + (j.openings || 0), 0);

  const filtered = useMemo(() => {
    let result = activeEmployees;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        e.department?.toLowerCase().includes(q) ||
        e.designation?.toLowerCase().includes(q)
      );
    }
    if (deptFilter !== "all") result = result.filter(e => e.department === deptFilter);
    return result;
  }, [activeEmployees, search, deptFilter]);

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && employees.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.employees} />;
  }

  const kpis = [
    { label: "Total Resources", value: activeEmployees.length, icon: Users, gradient: "from-violet-500 to-purple-600" },
    { label: "Allocated", value: allocatedEmps, icon: UserCheck, gradient: "from-emerald-500 to-green-600" },
    { label: "On Bench", value: benchCount, icon: UserMinus, gradient: "from-amber-500 to-orange-500" },
    { label: "Utilization", value: `${utilizationRate}%`, icon: GaugeCircle, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Resource Planner</h1>
        <p className="text-muted-foreground mt-1">Resource allocation, bench management &amp; capacity planning</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
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
          <Input placeholder="Search resources..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="utilization">Utilization</TabsTrigger>
          <TabsTrigger value="bench">Bench</TabsTrigger>
          <TabsTrigger value="skills">Skill Gap</TabsTrigger>
          <TabsTrigger value="capacity">Capacity</TabsTrigger>
        </TabsList>

        {/* Utilization */}
        <TabsContent value="utilization" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Allocation by Department</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={allocationChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis />
                    <RTooltip />
                    <Legend />
                    <Bar dataKey="allocated" name="Allocated" stackId="a" fill="#10b981" />
                    <Bar dataKey="bench" name="Bench" stackId="a" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Department Utilization</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {deptUtilization.map(d => (
                  <div key={d.name} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{d.name}</span>
                      <span className="text-muted-foreground">{d.allocated}/{d.total} ({d.utilization}%)</span>
                    </div>
                    <Progress value={d.utilization} className={cn("h-2",
                      d.utilization < 50 ? "[&>div]:bg-red-500" : d.utilization < 75 ? "[&>div]:bg-amber-500" : "")} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
          {/* Employees */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Resource List</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {filtered.slice(0, 10).map(emp => (
                <div key={emp.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50" onClick={() => setDetailEmp(emp)}>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs">
                        {emp.firstName?.[0]}{emp.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm">{emp.firstName} {emp.lastName}</p>
                      <p className="text-xs text-muted-foreground">{emp.designation} &middot; {emp.department}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {emp.skills?.slice(0, 2).map(s => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}
                    <Badge variant="outline">{emp.employmentType}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Bench */}
        <TabsContent value="bench" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Bench Overview</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/10 text-center">
                  <UserMinus className="h-8 w-8 mx-auto text-amber-500 mb-2" />
                  <p className="text-2xl font-bold">{benchCount}</p>
                  <p className="text-sm text-muted-foreground">On Bench</p>
                </div>
                <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/10 text-center">
                  <Briefcase className="h-8 w-8 mx-auto text-blue-500 mb-2" />
                  <p className="text-2xl font-bold">{openPositions}</p>
                  <p className="text-sm text-muted-foreground">Open Positions</p>
                </div>
                <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 text-center">
                  <TrendingUp className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
                  <p className="text-2xl font-bold">{utilizationRate}%</p>
                  <p className="text-sm text-muted-foreground">Utilization Rate</p>
                </div>
              </div>
              {benchCount === 0 ? (
                <DataEmptyState icon={CheckCircle2} title="Full utilization" description="No employees currently on bench." compact />
              ) : (
                <div className="space-y-2">
                  {deptUtilization.filter(d => d.bench > 0).map(d => (
                    <div key={d.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-3">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium text-sm">{d.name}</span>
                      </div>
                      <Badge variant="outline">{d.bench} on bench</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Skill Gap */}
        <TabsContent value="skills" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Skill Gap Analysis</CardTitle></CardHeader>
            <CardContent>
              {skillAnalysis.length === 0 ? (
                <DataEmptyState icon={Zap} title="No skill data" description="Employee skills will be analyzed here." compact />
              ) : (
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={skillAnalysis} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="skill" type="category" width={120} tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Legend />
                    <Bar dataKey="available" name="Available" fill="#10b981" />
                    <Bar dataKey="demand" name="Demand" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Capacity */}
        <TabsContent value="capacity" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Capacity Planning</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm">Current Capacity</h4>
                  <div className="space-y-3">
                    {[
                      { label: "Active Resources", value: activeEmployees.length },
                      { label: "Allocated", value: allocatedEmps },
                      { label: "Available", value: benchCount },
                      { label: "Open Positions", value: openPositions },
                      { label: "Total Needed", value: activeEmployees.length + openPositions },
                    ].map(item => (
                      <div key={item.label} className="flex justify-between text-sm p-2 rounded-lg bg-muted/30">
                        <span>{item.label}</span>
                        <span className="font-bold">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm">Utilization Gauge</h4>
                  <div className="text-center">
                    <div className="relative inline-block">
                      <svg className="h-36 w-36 -rotate-90" viewBox="0 0 36 36">
                        <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                          fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="3" />
                        <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                          fill="none" stroke={utilizationRate >= 75 ? "#10b981" : utilizationRate >= 50 ? "#f59e0b" : "#ef4444"}
                          strokeWidth="3" strokeDasharray={`${utilizationRate}, 100`} strokeLinecap="round" />
                      </svg>
                      <span className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold">{utilizationRate}%</span>
                        <span className="text-xs text-muted-foreground">utilization</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Employee Detail */}
      <Dialog open={!!detailEmp} onOpenChange={v => { if (!v) setDetailEmp(null); }}>
        <DialogContent>
          {detailEmp && (
            <>
              <DialogHeader><DialogTitle>{detailEmp.firstName} {detailEmp.lastName}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                      {detailEmp.firstName?.[0]}{detailEmp.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{detailEmp.firstName} {detailEmp.lastName}</p>
                    <p className="text-sm text-muted-foreground">{detailEmp.designation}</p>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Department</p><p className="font-medium">{detailEmp.department}</p></div>
                  <div><p className="text-muted-foreground">Type</p><p className="font-medium">{detailEmp.employmentType}</p></div>
                  <div><p className="text-muted-foreground">Location</p><p className="font-medium">{detailEmp.location}</p></div>
                  <div><p className="text-muted-foreground">Joining</p><p className="font-medium">{detailEmp.joiningDate}</p></div>
                </div>
                {detailEmp.skills && detailEmp.skills.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Skills</p>
                      <div className="flex flex-wrap gap-1.5">
                        {detailEmp.skills.map(s => <Badge key={s} variant="secondary">{s}</Badge>)}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailEmp(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
