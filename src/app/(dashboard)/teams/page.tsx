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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Users, Plus, Search, UserCheck, Building2, Star,
  Target, Heart, Shield, Eye, Trash2, Grid3X3,
  BarChart3, ArrowUpRight, Briefcase, Award,
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
                const healthScore = Math.min(100, 50 + (team.memberCount || 0) * 5);
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
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div><p className="text-muted-foreground">Members</p><p className="font-semibold text-lg">{team.memberCount || 0}</p></div>
                        <div>
                          <p className="text-muted-foreground">Health</p>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-lg">{healthScore}%</p>
                            <Heart className={cn("h-4 w-4", healthScore >= 80 ? "text-green-500" : healthScore >= 50 ? "text-amber-500" : "text-red-500")} />
                          </div>
                        </div>
                      </div>
                      <Progress value={healthScore} className="h-2" />
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
                        <th className="text-center p-3 font-medium">Health</th>
                        <th className="text-center p-3 font-medium">Status</th>
                        <th className="text-right p-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(team => {
                        const healthScore = Math.min(100, 50 + (team.memberCount || 0) * 5);
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
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Progress value={healthScore} className="h-1.5 w-16" />
                                <span className="text-xs">{healthScore}%</span>
                              </div>
                            </td>
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

          {/* Team Health Summary */}
          <Card>
            <CardHeader><CardTitle className="text-base">Team Health Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {teams.map(t => {
                  const healthScore = Math.min(100, 50 + (t.memberCount || 0) * 5);
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
                        <div className="w-24">
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">Health</span>
                            <span className={cn("font-medium", healthScore >= 80 ? "text-green-600" : healthScore >= 50 ? "text-amber-600" : "text-red-600")}>{healthScore}%</span>
                          </div>
                          <Progress value={healthScore} className="h-1.5" />
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Create Team</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Team Name *</Label>
              <Input placeholder="e.g. Platform Squad" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Team Lead</Label>
                <Input placeholder="Lead name" value={form.lead} onChange={e => setForm(f => ({ ...f, lead: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Department *</Label>
                <Select value={form.department} onValueChange={v => setForm(f => ({ ...f, department: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Team description..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>Create Team</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Team Detail Dialog */}
      <Dialog open={!!detailTeam} onOpenChange={() => setDetailTeam(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Users className="h-5 w-5 text-white" />
              </div>
              {detailTeam?.name}
            </DialogTitle>
          </DialogHeader>
          {detailTeam && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-sm text-muted-foreground">Department</p><p className="font-medium">{detailTeam.department}</p></div>
                <div><p className="text-sm text-muted-foreground">Lead</p><p className="font-medium">{detailTeam.lead || "—"}</p></div>
                <div><p className="text-sm text-muted-foreground">Status</p><Badge className={cn(STATUS_CONF[detailTeam.status]?.className || "status-active")}>{STATUS_CONF[detailTeam.status]?.label || detailTeam.status}</Badge></div>
              </div>
              {detailTeam.description && <p className="text-sm text-muted-foreground">{detailTeam.description}</p>}
              <Separator />
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2"><Users className="h-4 w-4" /> Members ({teamMembers.length})</h4>
                {teamMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No members found.</p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {teamMembers.map(emp => (
                      <div key={emp.id} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                            {emp.firstName?.[0]}{emp.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{emp.firstName} {emp.lastName}</p>
                          <p className="text-xs text-muted-foreground">{emp.designation || "—"}</p>
                        </div>
                        <Badge variant="outline" className="text-xs">{emp.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
