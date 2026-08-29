"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Users, Plus, Search, UserCheck, Building2, Star,
  Target, Shield, Eye, Trash2, Grid3X3,
  BarChart3, ArrowUpRight, Briefcase, Award, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useTeamStore, useEmployeeStore, startSync,
  type TeamDoc, type EmployeeDoc,
} from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// TEAM MANAGEMENT — Team cards, member management, health scores
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1","#14b8a6"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  inactive: { label: "Inactive", className: "status-rejected" },
  forming: { label: "Forming", className: "status-pending" },
};
const DEPARTMENTS = ["Engineering", "HR", "Design", "Sales", "Marketing", "Finance", "Support", "Operations"];

export default function TeamsPage() {
  const teamStore = useTeamStore();
  const empStore = useEmployeeStore();
  const { items: teams, loading, initialized } = teamStore;
  const { items: employees, initialized: empInit } = empStore;

  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [tab, setTab] = useState("grid");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTeam, setDetailTeam] = useState<TeamDoc | null>(null);
  const [form, setForm] = useState({ name: "", description: "", lead: "", department: "", status: "active" });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.teams, teamStore); }, [initialized, teamStore]);
  useEffect(() => { if (!empInit) startSync(COLLECTIONS.employees, empStore); }, [empInit, empStore]);

  const filtered = useMemo(() => {
    let result = teams;
    if (search) { const q = search.toLowerCase(); result = result.filter(t => t.name?.toLowerCase().includes(q) || t.lead?.toLowerCase().includes(q) || t.department?.toLowerCase().includes(q)); }
    if (deptFilter !== "all") result = result.filter(t => t.department === deptFilter);
    return result;
  }, [teams, search, deptFilter]);

  const deptDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    teams.forEach(t => { const d = t.department || "Unassigned"; map[d] = (map[d] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [teams]);

  const sizeDistribution = useMemo(() =>
    teams.map(t => ({ name: t.name?.substring(0, 12) || "N/A", members: t.memberCount || 0 }))
      .sort((a, b) => b.members - a.members).slice(0, 10),
  [teams]);

  const totalMembers = useMemo(() => teams.reduce((s, t) => s + (t.memberCount || 0), 0), [teams]);
  const avgSize = teams.length ? Math.round(totalMembers / teams.length) : 0;
  const uniqueDepts = new Set(teams.map(t => t.department).filter(Boolean)).size;
  const activeTeams = teams.filter(t => t.status === "active").length;

  const teamMembers = useMemo(() => {
    if (!detailTeam) return [];
    return employees.filter(e => e.department === detailTeam.department).slice(0, detailTeam.memberCount || 10);
  }, [detailTeam, employees]);

  const resetForm = () => setForm({ name: "", description: "", lead: "", department: "", status: "active" });

  const handleCreate = async () => {
    if (!form.name || !form.department) { toast.error("Name and department are required"); return; }
    try {
      await genericService(COLLECTIONS.teams).create({ ...form, memberCount: 0 });
      toast.success(`Team "${form.name}" created!`);
      setCreateOpen(false); resetForm();
    } catch { toast.error("Failed to create team"); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete team "${name}"?`)) return;
    try {
      await genericService(COLLECTIONS.teams).remove(id);
      teamStore.removeItem(id);
      toast.success(`"${name}" deleted`);
    } catch { toast.error("Delete failed"); }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
          <p className="text-muted-foreground mt-1">Manage cross-functional teams and squads</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2" onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4" /> Create Team
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {[
          { label: "Total Teams", value: teams.length, icon: Users, gradient: "from-violet-500 to-purple-600" },
          { label: "Active Teams", value: activeTeams, icon: Shield, gradient: "from-emerald-500 to-green-600" },
          { label: "Avg Team Size", value: avgSize, icon: Target, gradient: "from-blue-500 to-cyan-500" },
          { label: "Departments", value: uniqueDepts, icon: Building2, gradient: "from-amber-500 to-orange-500" },
        ].map(kpi => (
          <Card key={kpi.label} className="animate-slide-up">
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("h-12 w-12 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md", kpi.gradient)}>
                <kpi.icon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search teams..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="grid" className="gap-2"><Grid3X3 className="h-4 w-4" /> Grid View</TabsTrigger>
          <TabsTrigger value="list" className="gap-2"><Users className="h-4 w-4" /> List View</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><BarChart3 className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="grid" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.teams} onAction={() => setCreateOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              {filtered.map((team, idx) => {
                return (
                  <Card key={team.id} className="hover:shadow-lg transition-shadow animate-slide-up cursor-pointer group" onClick={() => setDetailTeam(team)}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow">
                            <Users className="h-5 w-5 text-white" />
                          </div>
                          <div>
                            <CardTitle className="text-base">{team.name}</CardTitle>
                            <p className="text-xs text-muted-foreground">{team.department}</p>
                          </div>
                        </div>
                        <Badge className={cn(STATUS_CONF[team.status]?.className || "status-active")}>
                          {STATUS_CONF[team.status]?.label || team.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <UserCheck className="h-4 w-4" />
                        <span>Lead: {team.lead || "Unassigned"}</span>
                      </div>
                      {team.description && <p className="text-sm text-muted-foreground line-clamp-2">{team.description}</p>}
                      <Separator />
                      {/*
                        A "Health" figure used to sit next to Members here —
                        Math.min(100, 50 + memberCount * 5), so a team's health
                        was just a function of its size and nothing else about
                        it (no engagement, attrition or output signal exists
                        per team anywhere in the schema). A 3-person team
                        always "scored" 65% and a 10-person team always scored
                        100%, dressed up with a heart icon and a progress bar
                        as if it meant something. Removed rather than shown
                        next to real data it would be mistaken for.
                      */}
                      <div className="text-sm"><p className="text-muted-foreground">Members</p><p className="font-semibold text-lg">{team.memberCount || 0}</p></div>
                      <div className="flex items-center gap-1 pt-1">
                        {Array.from({ length: Math.min(5, team.memberCount || 0) }).map((_, i) => (
                          <Avatar key={i} className="h-7 w-7 -ml-1 first:ml-0 border-2 border-background">
                            <AvatarFallback className="text-[10px] bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                              {String.fromCharCode(65 + i)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {(team.memberCount || 0) > 5 && <span className="text-xs text-muted-foreground ml-1">+{(team.memberCount || 0) - 5}</span>}
                      </div>
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={e => { e.stopPropagation(); setDetailTeam(team); }}>
                          <Eye className="h-3 w-3" /> View
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={e => { e.stopPropagation(); handleDelete(team.id, team.name); }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* List View */}
        <TabsContent value="list" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.teams} onAction={() => setCreateOpen(true)} />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">Team</th>
                        <th className="text-left p-3 font-medium">Lead</th>
                        <th className="text-left p-3 font-medium">Department</th>
                        <th className="text-center p-3 font-medium">Members</th>
                        <th className="text-center p-3 font-medium">Status</th>
                        <th className="text-right p-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(team => {
                        return (
                          <tr key={team.id} className="border-b hover:bg-muted/30 transition-colors">
                            <td className="p-3">
                              <div className="flex items-center gap-2">
				<Avatar className="h-7 w-7">
                                  <AvatarFallback className="text-[10px] bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                                    {team.name?.[0] || "T"}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="font-medium">{team.name}</span>
                              </div>
                            </td>
                            <td className="p-3 text-muted-foreground">{team.lead || "—"}</td>
                            <td className="p-3 text-muted-foreground">{team.department}</td>
                            <td className="p-3 text-center font-medium">{team.memberCount || 0}</td>
                            {/* Health column removed — see the Grid view card for why. */}
                            <td className="p-3 text-center">
                              <Badge className={cn("text-xs", STATUS_CONF[team.status]?.className || "status-active")}>
                                {STATUS_CONF[team.status]?.label || team.status}
                              </Badge>
                            </td>
                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDetailTeam(team)}>
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(team.id, team.name)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Team Size Distribution</CardTitle></CardHeader>
              <CardContent>
                {sizeDistribution.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={sizeDistribution}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={11} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="members" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Teams by Department</CardTitle></CardHeader>
              <CardContent>
                {deptDistribution.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={deptDistribution} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name }) => name}>
                        {deptDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/*
            This card used to be "Team Health Summary" with a per-team
            Math.min(100, 50 + memberCount * 5) score — a number dressed up
            as a health signal that was really just headcount in disguise.
            Renamed to what it actually shows (roster + status) now that the
            invented figure is gone; nothing here is measured that isn't
            already a real, stored field.
          */}
          <Card>
            <CardHeader><CardTitle className="text-base">Team Overview</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {teams.map(t => {
                  return (
                    <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                          <Users className="h-4 w-4 text-white" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{t.name}</p>
                          <p className="text-xs text-muted-foreground">{t.department} &middot; {t.lead || "No lead"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-semibold text-sm">{t.memberCount || 0}</p>
                          <p className="text-xs text-muted-foreground">Members</p>
                        </div>
                        <Badge className={cn("text-xs", STATUS_CONF[t.status]?.className || "status-active")}>
                          {STATUS_CONF[t.status]?.label || t.status}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Team Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Form New Team / Squad</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Create functional workgroups, assign leadership, and align cross-functional teams.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Team Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Core Platform Squad, Growth Marketing"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="h-9 text-xs"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-violet-500" />
                  Team Lead / Manager
                </Label>
                {employees && employees.length > 0 ? (
                  <Select value={form.lead} onValueChange={v => setForm(f => ({ ...f, lead: v }))}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select team lead..." />
                    </SelectTrigger>
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
                    placeholder="Lead name"
                    value={form.lead}
                    onChange={e => setForm(f => ({ ...f, lead: e.target.value }))}
                    className="h-9 text-xs"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Primary Department <span className="text-destructive">*</span>
                </Label>
                <Select value={form.department} onValueChange={v => setForm(f => ({ ...f, department: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map(d => <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Team Charter &amp; Objective</Label>
              <Textarea
                placeholder="Key missions, technical responsibilities, and team scope..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                className="text-xs resize-none"
              />
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> Create Team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Team Detail Dialog */}
      <Dialog open={!!detailTeam} onOpenChange={() => setDetailTeam(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">{detailTeam?.name}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {detailTeam?.department} Department &middot; Led by {detailTeam?.lead || "Unassigned"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {detailTeam && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-3 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Department</p>
                  <p className="font-semibold text-foreground mt-0.5">{detailTeam.department}</p>
                </div>
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Team Lead</p>
                  <p className="font-semibold text-foreground mt-0.5">{detailTeam.lead || "—"}</p>
                </div>
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Status</p>
                  <Badge className={cn("mt-1 text-[11px]", STATUS_CONF[detailTeam.status]?.className || "status-active")}>
                    {STATUS_CONF[detailTeam.status]?.label || detailTeam.status}
                  </Badge>
                </div>
              </div>

              {detailTeam.description && (
                <div className="p-3 rounded-lg border bg-muted/20">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Team Charter</p>
                  <p className="text-xs text-foreground leading-relaxed">{detailTeam.description}</p>
                </div>
              )}

              <Separator />

              <div>
                <h4 className="font-semibold text-xs mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4 text-violet-500" /> Team Roster ({teamMembers.length} Members)
                </h4>
                {teamMembers.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No members tagged under this team's department yet.</p>
                ) : (
                  <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                    {teamMembers.map(emp => (
                      <div key={emp.id} className="flex items-center gap-3 p-2.5 rounded-xl border bg-muted/20 hover:bg-muted/40 transition-colors">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-[11px] font-bold bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                            {emp.firstName?.[0]}{emp.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{emp.firstName} {emp.lastName}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{emp.designation || "Team Member"} &middot; {emp.email}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] uppercase font-semibold">{emp.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setDetailTeam(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
