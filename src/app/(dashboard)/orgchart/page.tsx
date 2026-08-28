"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Users, Building2, Search, ChevronDown, ChevronRight, Crown,
  MapPin, Mail, Phone, Briefcase, Star, TrendingUp,
  BarChart3, Eye, UserPlus, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  Tooltip as RTooltip,
} from "recharts";
import {
  useEmployeeStore, useDepartmentStore, startSync,
  type EmployeeDoc, type DepartmentDoc,
} from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { clickable } from "@/lib/a11y/clickable";

// ═══════════════════════════════════════════════════════════════
// ORG CHART — Interactive organizational hierarchy with dept
// views, team member cards, and search-to-find functionality
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const GRADIENTS = [
  "from-violet-500 to-purple-600", "from-blue-500 to-cyan-500",
  "from-emerald-500 to-green-600", "from-amber-500 to-orange-500",
  "from-pink-500 to-rose-600", "from-teal-500 to-cyan-600",
  "from-indigo-500 to-blue-600", "from-red-500 to-orange-500",
];

interface DeptGroup {
  name: string;
  head: string;
  headEmail: string;
  members: EmployeeDoc[];
  budget: number;
}

export default function OrgchartPage() {
  const empStore = useEmployeeStore();
  const deptStore = useDepartmentStore();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("departments");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedEmp, setSelectedEmp] = useState<EmployeeDoc | null>(null);

  // Escape closes the employee dialog. It had no keyboard dismissal at all —
  // the backdrop is mouse-only and deliberately not focusable, so without this
  // the only way out was to tab through the whole card to the Close button.
  // Escape is what every dialog is expected to do, and its absence is the kind
  // of thing only noticed by someone who cannot use a mouse.
  useEffect(() => {
    if (!selectedEmp) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSelectedEmp(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedEmp]);

  useEffect(() => { if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore); }, [empStore.initialized, empStore]);
  useEffect(() => { if (!deptStore.initialized) startSync(COLLECTIONS.departments, deptStore); }, [deptStore.initialized, deptStore]);

  const loading = (empStore.loading && !empStore.initialized) || (deptStore.loading && !deptStore.initialized);
  const employees = empStore.items;
  const departments = deptStore.items;

  // Build department groups from employees
  const deptGroups = useMemo((): DeptGroup[] => {
    const groups: Record<string, DeptGroup> = {};
    employees.forEach(emp => {
      const deptName = emp.department || "Unassigned";
      if (!groups[deptName]) {
        const deptDoc = departments.find(d => d.name === deptName);
        groups[deptName] = {
          name: deptName,
          head: deptDoc?.head || "",
          headEmail: deptDoc?.headEmail || "",
          members: [],
          budget: deptDoc?.budget || 0,
        };
      }
      groups[deptName].members.push(emp);
    });
    return Object.values(groups).sort((a, b) => b.members.length - a.members.length);
  }, [employees, departments]);

  // Filtered results
  const filteredGroups = useMemo(() => {
    if (!search) return deptGroups;
    const q = search.toLowerCase();
    return deptGroups.map(g => ({
      ...g,
      members: g.members.filter(m =>
        `${m.firstName} ${m.lastName}`.toLowerCase().includes(q) ||
        m.designation?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q)
      ),
    })).filter(g => g.members.length > 0 || g.name.toLowerCase().includes(q));
  }, [deptGroups, search]);

  // Stats
  const totalDepts = deptGroups.length;
  const totalHC = employees.length;
  const avgTeamSize = totalDepts > 0 ? Math.round(totalHC / totalDepts) : 0;

  // Headcount chart data
  const hcByDept = useMemo(() => {
    return deptGroups.map(g => ({ name: g.name, value: g.members.length }));
  }, [deptGroups]);

  const toggleExpand = (dept: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept); else next.add(dept);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(deptGroups.map(g => g.name)));
  const collapseAll = () => setExpanded(new Set());

  if (loading) return <DataLoadingSkeleton />;
  if (employees.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.orgchart} />;
  }

  const kpis = [
    { label: "Departments", value: totalDepts, icon: Building2, gradient: "from-violet-500 to-purple-600" },
    { label: "Total Headcount", value: totalHC, icon: Users, gradient: "from-blue-500 to-cyan-500" },
    { label: "Avg Team Size", value: avgTeamSize, icon: TrendingUp, gradient: "from-emerald-500 to-green-600" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Organization</h1>
          <p className="text-muted-foreground mt-1">Explore the company structure and find people</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={expandAll}>Expand All</Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>Collapse All</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search people, departments, designations..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="departments">Department View</TabsTrigger>
          <TabsTrigger value="tree">Tree View</TabsTrigger>
        </TabsList>

        {/* Department View */}
        <TabsContent value="departments" className="space-y-4 mt-4">
          {filteredGroups.length === 0 ? (
            <DataEmptyState title="No matching results" description="Try a different search term." compact />
          ) : (
            filteredGroups.map((dept, dIdx) => {
              const isExpanded = expanded.has(dept.name);
              const gradient = GRADIENTS[dIdx % GRADIENTS.length];
              return (
                <Card key={dept.name} className="border-0 shadow-sm">
                  <CardContent className="p-0">
                    {/* Department Header */}
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-xl"
                      {...clickable(() => toggleExpand(dept.name))}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn("h-12 w-12 rounded-xl bg-gradient-to-br flex items-center justify-center", gradient)}>
                          <Building2 className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-lg">{dept.name}</h3>
                            <Badge variant="outline">{dept.members.length} members</Badge>
                          </div>
                          {dept.head && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <Crown className="h-3 w-3 text-amber-500" /> {dept.head}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                      </div>
                    </div>

                    {/* Members */}
                    {isExpanded && (
                      <div className="border-t px-4 pb-4 pt-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {dept.members.map((emp) => {
                            const isHead = dept.head && `${emp.firstName} ${emp.lastName}`.includes(dept.head);
                            return (
                              <div
                                key={emp.id}
                                className={cn(
                                  "p-3 rounded-lg border hover:shadow-sm transition-all cursor-pointer",
                                  isHead ? "border-amber-300 bg-amber-50/50 dark:bg-amber-900/10" : "border-transparent bg-muted/30"
                                )}
                                {...clickable(() => setSelectedEmp(emp))}
                              >
                                <div className="flex items-center gap-3">
                                  <Avatar className="h-10 w-10">
                                    <AvatarFallback className={cn("text-xs text-white bg-gradient-to-br", gradient)}>
                                      {emp.firstName?.[0]}{emp.lastName?.[0]}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                      <p className="font-medium text-sm truncate">{emp.firstName} {emp.lastName}</p>
                                      {isHead && <Crown className="h-3 w-3 text-amber-500 shrink-0" />}
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">{emp.designation || "Employee"}</p>
                                  </div>
                                  <Badge className={emp.status === "active" ? "status-active" : "status-inactive"} variant="outline">
                                    {emp.status || "active"}
                                  </Badge>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Tree View */}
        <TabsContent value="tree" className="space-y-4 mt-4">
          {/* CEO / Top level */}
          <div className="flex justify-center mb-4">
            <Card className="border-0 shadow-sm w-fit">
              <CardContent className="p-4 text-center">
                <Avatar className="h-14 w-14 mx-auto mb-2">
                  <AvatarFallback className="text-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">CEO</AvatarFallback>
                </Avatar>
                <p className="font-semibold">CEO</p>
                <p className="text-xs text-muted-foreground">Organization Head</p>
              </CardContent>
            </Card>
          </div>

          {/* Department Grid */}
          <div className="flex justify-center">
            <div className="w-px h-8 bg-border" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {deptGroups.map((dept, idx) => (
              <Card key={dept.name} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="text-center mb-3">
                    <div className={cn("h-12 w-12 rounded-xl bg-gradient-to-br flex items-center justify-center mx-auto mb-2", GRADIENTS[idx % GRADIENTS.length])}>
                      <Building2 className="h-6 w-6 text-white" />
                    </div>
                    <h3 className="font-semibold text-sm">{dept.name}</h3>
                    {dept.head && <p className="text-xs text-muted-foreground">{dept.head}</p>}
                    <Badge variant="outline" className="mt-1">{dept.members.length}</Badge>
                  </div>
                  <Separator className="my-2" />
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {dept.members.slice(0, 6).map((emp) => (
                      <div key={emp.id} className="flex items-center gap-2 p-1 rounded hover:bg-muted/30 cursor-pointer text-xs" {...clickable(() => setSelectedEmp(emp))}>
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[8px] bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                            {emp.firstName?.[0]}{emp.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate">{emp.firstName} {emp.lastName}</span>
                      </div>
                    ))}
                    {dept.members.length > 6 && (
                      <p className="text-xs text-muted-foreground text-center">+{dept.members.length - 6} more</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Headcount Chart */}
          <Card className="border-0 shadow-sm mt-4">
            <CardHeader><CardTitle className="text-base">Headcount by Department</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={hcByDept}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" name="Employees" radius={[4, 4, 0, 0]}>
                    {hcByDept.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Employee Detail Dialog - reusing native Dialog */}
      {selectedEmp && (
        // The backdrop closes on click as a mouse convenience. It is
        // deliberately not focusable: a full-viewport tab stop announced as a
        // button is worse than useless. Keyboard users close with Escape (see
        // the effect above) or the Close button, which are the two things a
        // dialog is actually required to offer.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedEmp(null)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedEmp.firstName} ${selectedEmp.lastName}`}
            className="w-full max-w-sm mx-4 border-0 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <CardContent className="p-6">
              <div className="text-center mb-4">
                <Avatar className="h-16 w-16 mx-auto mb-3">
                  <AvatarFallback className="text-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                    {selectedEmp.firstName?.[0]}{selectedEmp.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <h3 className="font-semibold text-lg">{selectedEmp.firstName} {selectedEmp.lastName}</h3>
                <p className="text-sm text-muted-foreground">{selectedEmp.designation || "Employee"}</p>
                <Badge className="mt-2" variant="outline">{selectedEmp.department}</Badge>
              </div>
              <Separator className="my-3" />
              <div className="space-y-2 text-sm">
                {selectedEmp.email && (
                  <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /><span>{selectedEmp.email}</span></div>
                )}
                {selectedEmp.phone && (
                  <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /><span>{selectedEmp.phone}</span></div>
                )}
                {selectedEmp.location && (
                  <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground" /><span>{selectedEmp.location}</span></div>
                )}
                {selectedEmp.joiningDate && (
                  <div className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5 text-muted-foreground" /><span>Joined {selectedEmp.joiningDate}</span></div>
                )}
              </div>
              <Button className="w-full mt-4" variant="outline" onClick={() => setSelectedEmp(null)}>Close</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}