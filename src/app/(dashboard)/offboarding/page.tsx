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
import { Checkbox } from "@/components/ui/checkbox";
import {
  UserMinus, Search, CheckCircle2, Clock, Users,
  Calendar, ListChecks, Target, AlertCircle, Shield,
  Laptop, Key, BookOpen, DollarSign, FileText, ChevronDown,
  ClipboardList, XCircle, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useEmployeeStore, startSync, type EmployeeDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// OFFBOARDING — Exit workflows, clearance tracking, settlement
// ═══════════════════════════════════════════════════════════════

const CLEARANCE_STEPS = [
  { key: "it_assets", label: "IT Assets Return", icon: Laptop, description: "Laptop, phone, accessories returned" },
  { key: "access_revoke", label: "Access Revocation", icon: Key, description: "Email, VPN, app access revoked" },
  { key: "knowledge", label: "Knowledge Transfer", icon: BookOpen, description: "Documentation and handover complete" },
  { key: "settlement", label: "Final Settlement", icon: DollarSign, description: "Salary, PF, gratuity processed" },
  { key: "exit_interview", label: "Exit Interview", icon: ClipboardList, description: "Feedback collected" },
  { key: "documentation", label: "Documentation", icon: FileText, description: "Experience letter, relieving letter issued" },
];

interface ClearanceStatus { [employeeId: string]: { [step: string]: boolean } }

export default function OffboardingPage() {
  const store = useEmployeeStore();
  const { items: employees, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("active");
  const [clearances, setClearances] = useState<ClearanceStatus>({});
  const [selectedEmp, setSelectedEmp] = useState<EmployeeDoc | null>(null);
  const [exitNotes, setExitNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesEmp, setNotesEmp] = useState<EmployeeDoc | null>(null);

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.employees, store); }, [initialized, store]);

  const exitEmployees = useMemo(() =>
    employees.filter(e => e.status === "notice_period" || e.status === "terminated"),
  [employees]);

  const filtered = useMemo(() => {
    let result = exitEmployees;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e => `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q));
    }
    return result;
  }, [exitEmployees, search]);

  // Memoised so the React Compiler can see that the memos below depend on
  // `clearances` through it. As a plain function it was recreated every render,
  // and the compiler bailed out of optimising the whole component.
  const getClearanceCount = useCallback((empId: string) => {
    const c = clearances[empId] || {};
    return CLEARANCE_STEPS.filter(s => c[s.key]).length;
  }, [clearances]);

  const getClearancePercent = (empId: string) => {
    return Math.round((getClearanceCount(empId) / CLEARANCE_STEPS.length) * 100);
  };

  const toggleClearance = (empId: string, step: string) => {
    setClearances(prev => ({
      ...prev,
      [empId]: { ...(prev[empId] || {}), [step]: !(prev[empId]?.[step]) },
    }));
    toast.success("Clearance updated");
  };

  const completedExits = useMemo(() =>
    exitEmployees.filter(e => getClearanceCount(e.id) === CLEARANCE_STEPS.length).length,
  [exitEmployees, clearances]);

  const pendingClearance = exitEmployees.length - completedExits;
  const noticeCount = exitEmployees.filter(e => e.status === "notice_period").length;
  const terminatedCount = exitEmployees.filter(e => e.status === "terminated").length;

  const deptDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    exitEmployees.forEach(e => { const d = e.department || "Unassigned"; map[d] = (map[d] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [exitEmployees]);

  const clearanceChart = useMemo(() =>
    CLEARANCE_STEPS.map(s => ({
      name: s.label.substring(0, 12),
      completed: exitEmployees.filter(e => clearances[e.id]?.[s.key]).length,
      pending: exitEmployees.length - exitEmployees.filter(e => clearances[e.id]?.[s.key]).length,
    })),
  [exitEmployees, clearances]);

  const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899"];

  const handleExitNotes = () => {
    if (notesEmp) {
      toast.success(`Exit interview notes saved for ${notesEmp.firstName} ${notesEmp.lastName}`);
    }
    setNotesOpen(false);
    setExitNotes("");
    setNotesEmp(null);
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Offboarding</h1>
          <p className="text-muted-foreground mt-1">Exit workflows and clearance management</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {[
          { label: "Active Exits", value: exitEmployees.length, icon: UserMinus, gradient: "from-violet-500 to-purple-600" },
          { label: "Completed", value: completedExits, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
          { label: "Notice Period", value: noticeCount, icon: Clock, gradient: "from-amber-500 to-orange-500" },
          { label: "Pending Clearance", value: pendingClearance, icon: AlertCircle, gradient: "from-red-500 to-orange-500" },
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search exiting employees..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active" className="gap-2"><ListChecks className="h-4 w-4" /> Clearance Tracking</TabsTrigger>
          <TabsTrigger value="workflow" className="gap-2"><Target className="h-4 w-4" /> Workflow Steps</TabsTrigger>
          <TabsTrigger value="settlement" className="gap-2"><DollarSign className="h-4 w-4" /> Settlement</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><Shield className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState icon={UserMinus} title="No exits in progress" description="Employees on notice period or terminated will appear here." />
          ) : (
            <div className="space-y-4 stagger-children">
              {filtered.map(emp => {
                const pct = getClearancePercent(emp.id);
                const empClearance = clearances[emp.id] || {};
                return (
                  <Card key={emp.id} className="animate-slide-up">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4 mb-4">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-gradient-to-br from-red-500 to-orange-500 text-white">
                            {emp.firstName?.[0]}{emp.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <h3 className="font-semibold">{emp.firstName} {emp.lastName}</h3>
                          <p className="text-sm text-muted-foreground">{emp.department} &middot; {emp.designation}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={cn(emp.status === "notice_period" ? "status-pending" : "status-rejected")}>
                            {emp.status === "notice_period" ? "Notice Period" : "Terminated"}
                          </Badge>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => { setNotesEmp(emp); setNotesOpen(true); }}>
                            <ClipboardList className="h-3 w-3" /> Exit Interview
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mb-3">
                        <Progress value={pct} className="flex-1 h-2" />
                        <span className="text-sm font-medium">{pct}% Complete</span>
                      </div>
                      <Button
                        variant="ghost" size="sm" className="gap-1 mb-2"
                        onClick={() => setSelectedEmp(selectedEmp?.id === emp.id ? null : emp)}
                      >
                        <ChevronDown className={cn("h-4 w-4 transition-transform", selectedEmp?.id === emp.id && "rotate-180")} />
                        {selectedEmp?.id === emp.id ? "Collapse" : "Expand"} Steps
                      </Button>
                      {selectedEmp?.id === emp.id && (
                        <div className="space-y-2 mt-2">
                          {CLEARANCE_STEPS.map((step, i) => (
                            <div key={step.key} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                              <Checkbox
                                checked={!!empClearance[step.key]}
                                onCheckedChange={() => toggleClearance(emp.id, step.key)}
                              />
                              <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", empClearance[step.key] ? "bg-green-100 dark:bg-green-900/30" : "bg-muted")}>
                                <step.icon className={cn("h-4 w-4", empClearance[step.key] ? "text-green-600" : "text-muted-foreground")} />
                              </div>
                              <div className="flex-1">
                                <p className={cn("text-sm font-medium", empClearance[step.key] && "line-through text-muted-foreground")}>{step.label}</p>
                                <p className="text-xs text-muted-foreground">{step.description}</p>
                              </div>
                              <Badge variant="outline" className={cn("text-xs", empClearance[step.key] ? "border-green-500 text-green-600" : "border-amber-500 text-amber-600")}>
                                {empClearance[step.key] ? "Done" : "Pending"}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="workflow" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {CLEARANCE_STEPS.map((step, i) => {
              const completed = exitEmployees.filter(e => clearances[e.id]?.[step.key]).length;
              const pct = exitEmployees.length ? Math.round((completed / exitEmployees.length) * 100) : 0;
              return (
                <Card key={step.key}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <step.icon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Step {i + 1}: {step.label}</p>
                        <p className="text-xs text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Progress value={pct} className="flex-1 h-2" />
                      <span className="text-sm font-medium">{completed}/{exitEmployees.length}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="settlement" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Settlement Calculator</CardTitle></CardHeader>
            <CardContent>
              {exitEmployees.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No employees pending settlement.</p>
              ) : (
                <div className="space-y-3">
                  {exitEmployees.map(emp => {
                    const salary = emp.salary || 50000;
                    const noticePay = salary;
                    const leaveEncashment = Math.round(salary * 0.15);
                    const gratuity = Math.round(salary * 0.5);
                    const total = noticePay + leaveEncashment + gratuity;
                    const settled = clearances[emp.id]?.settlement;
                    return (
                      <div key={emp.id} className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="text-xs bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                              {emp.firstName?.[0]}{emp.lastName?.[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{emp.firstName} {emp.lastName}</p>
                            <p className="text-xs text-muted-foreground">{emp.department}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                          <div className="text-right"><p className="text-muted-foreground text-xs">Notice Pay</p><p className="font-medium">${noticePay.toLocaleString()}</p></div>
                          <div className="text-right"><p className="text-muted-foreground text-xs">Leave Encash</p><p className="font-medium">${leaveEncashment.toLocaleString()}</p></div>
                          <div className="text-right"><p className="text-muted-foreground text-xs">Gratuity</p><p className="font-medium">${gratuity.toLocaleString()}</p></div>
                          <div className="text-right"><p className="text-muted-foreground text-xs">Total</p><p className="font-bold text-green-600">${total.toLocaleString()}</p></div>
                          <Badge className={cn(settled ? "status-active" : "status-pending")}>{settled ? "Settled" : "Pending"}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Clearance Progress</CardTitle></CardHeader>
              <CardContent>
                {clearanceChart.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={clearanceChart}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={10} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="completed" fill="#10b981" radius={[4, 4, 0, 0]} name="Completed" />
                      <Bar dataKey="pending" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Pending" />
                      <Legend />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Exits by Department</CardTitle></CardHeader>
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

          {/* Exit Summary Table */}
          <Card>
            <CardHeader><CardTitle className="text-base">Exit Summary</CardTitle></CardHeader>
            <CardContent>
              {exitEmployees.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No exit data.</p>
              ) : (
                <div className="space-y-2">
                  {exitEmployees.map(emp => {
                    const pct = getClearancePercent(emp.id);
                    const stepsComplete = getClearanceCount(emp.id);
                    return (
                      <div key={emp.id} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="text-xs bg-gradient-to-br from-red-500 to-orange-500 text-white">
                            {emp.firstName?.[0]}{emp.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="font-medium text-sm">{emp.firstName} {emp.lastName}</p>
                          <p className="text-xs text-muted-foreground">{emp.department} &middot; {emp.designation}</p>
                        </div>
                        <Badge className={cn("text-xs", emp.status === "notice_period" ? "status-pending" : "status-rejected")}>
                          {emp.status === "notice_period" ? "Notice" : "Terminated"}
                        </Badge>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{stepsComplete}/{CLEARANCE_STEPS.length} steps</span>
                          <div className="w-16">
                            <Progress value={pct} className="h-1.5" />
                          </div>
                          <span className={cn("text-xs font-medium", pct === 100 ? "text-green-600" : "text-amber-600")}>{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {CLEARANCE_STEPS.map(step => {
              const completed = exitEmployees.filter(e => clearances[e.id]?.[step.key]).length;
              const pct = exitEmployees.length ? Math.round((completed / exitEmployees.length) * 100) : 0;
              return (
                <Card key={step.key}>
                  <CardContent className="p-3 text-center">
                    <step.icon className={cn("h-5 w-5 mx-auto mb-1", pct === 100 ? "text-green-500" : "text-muted-foreground")} />
                    <p className="text-xs font-medium truncate">{step.label}</p>
                    <p className="text-lg font-bold">{pct}%</p>
                    <p className="text-[10px] text-muted-foreground">{completed}/{exitEmployees.length}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Exit Interview Notes Dialog */}
      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Exit Interview — {notesEmp?.firstName} {notesEmp?.lastName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Reason for Leaving</Label>
              <Select defaultValue="personal">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal Reasons</SelectItem>
                  <SelectItem value="career">Career Growth</SelectItem>
                  <SelectItem value="compensation">Compensation</SelectItem>
                  <SelectItem value="relocation">Relocation</SelectItem>
                  <SelectItem value="management">Management Issues</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Interview Notes</Label>
              <Textarea placeholder="Capture exit interview feedback..." value={exitNotes} onChange={e => setExitNotes(e.target.value)} rows={5} />
            </div>
            <div className="space-y-2">
              <Label>Would Rejoin?</Label>
              <Select defaultValue="maybe">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="maybe">Maybe</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleExitNotes}>Save Notes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
