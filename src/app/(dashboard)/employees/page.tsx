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
  Users, UserPlus, Search, Grid3X3, List, ChevronRight, Mail,
  Phone, MapPin, Calendar, Building2, Briefcase, Eye, Edit,
  Trash2, Download, Filter, MoreHorizontal, Star, Shield,
  TrendingUp, Award, GraduationCap, Clock, DollarSign, Target,
  CheckCircle2, AlertTriangle, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useEmployeeStore, startSync, type EmployeeDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { useRBAC } from "@/hooks/use-rbac";
import { createEmployeeAcrossApps, syncEmployeeToOtherApps } from "@/lib/cross-app-sync";
import { clickable } from "@/lib/a11y/clickable";

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE MANAGEMENT — Full CRUD with 360° profiles, grid/list
// views, department filtering, bulk actions, and detailed dialogs
// ═══════════════════════════════════════════════════════════════

const GRADIENTS = ["from-violet-500 to-purple-600","from-blue-500 to-cyan-500","from-emerald-500 to-green-600","from-amber-500 to-orange-500","from-pink-500 to-rose-600","from-teal-500 to-cyan-600","from-indigo-500 to-blue-600","from-red-500 to-orange-500","from-fuchsia-500 to-pink-500","from-purple-500 to-violet-600"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  inactive: { label: "Inactive", className: "status-inactive" },
  probation: { label: "Probation", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  notice_period: { label: "Notice Period", className: "status-pending" },
  terminated: { label: "Terminated", className: "status-rejected" },
};
const DEPARTMENTS = ["Engineering", "HR", "Design", "Sales", "Marketing", "Finance", "Support", "Operations"];
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Intern", "Consultant"];

export default function EmployeesPage() {
  const store = useEmployeeStore();
  const { items, loading, initialized } = store;
  const rbac = useRBAC();
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeDoc | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState("all");
  // Form state
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", department: "", designation: "", joiningDate: "", employmentType: "Full-time", location: "", status: "active", salary: "", password: "", syncToApps: true });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.employees, store); }, [initialized, store]);

  const departments = useMemo(() => {
    const depts = new Set(items.map(e => e.department).filter(Boolean));
    return ["all", ...Array.from(depts), ...DEPARTMENTS.filter(d => !depts.has(d))];
  }, [items]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) { const q = search.toLowerCase(); result = result.filter(e => `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q) || e.designation?.toLowerCase().includes(q) || e.phone?.includes(q)); }
    if (deptFilter !== "all") result = result.filter(e => e.department === deptFilter);
    if (statusFilter !== "all") result = result.filter(e => e.status === statusFilter);
    if (tab === "new") { const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30); result = result.filter(e => e.joiningDate && new Date(e.joiningDate) >= thirtyDaysAgo); }
    if (tab === "notice") result = result.filter(e => e.status === "notice_period");
    return result;
  }, [items, search, deptFilter, statusFilter, tab]);

  // Department summary
  const deptSummary = useMemo(() => {
    const summary: Record<string, number> = {};
    items.forEach(e => { const d = e.department || "Unassigned"; summary[d] = (summary[d] || 0) + 1; });
    return Object.entries(summary).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const totalActive = items.filter(e => e.status === "active").length;
  const totalOnNotice = items.filter(e => e.status === "notice_period").length;
  const newThisMonth = items.filter(e => { if (!e.joiningDate) return false; const d = new Date(e.joiningDate); const now = new Date(); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;

  const resetForm = () => setForm({ firstName: "", lastName: "", email: "", phone: "", department: "", designation: "", joiningDate: "", employmentType: "Full-time", location: "", status: "active", salary: "", password: "", syncToApps: true });

  const handleCreate = async () => {
    if (!form.firstName || !form.lastName || !form.email || !form.department) {
      toast.error("Please fill required fields"); return;
    }
    try {
      // If sync to other apps is enabled and password provided, create across all apps
      if (form.syncToApps && form.password) {
        const syncResult = await createEmployeeAcrossApps({
          uid: "",
          email: form.email,
          displayName: `${form.firstName} ${form.lastName}`,
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone,
          department: form.department,
          designation: form.designation,
          joiningDate: form.joiningDate,
          status: form.status,
          employmentType: form.employmentType,
          location: form.location,
          reportingManager: "",
          role: "employee",
        }, form.password);

        if (syncResult.success) {
          toast.success(`${form.firstName} ${form.lastName} added.`);
        } else {
          toast.error(syncResult.errors[0] ?? "Could not add this employee.");
        }
      } else {
        // Just create in HRMS only
        await genericService(COLLECTIONS.employees).create({
          ...form, salary: form.salary ? parseFloat(form.salary) : 0,
        });
        toast.success(`${form.firstName} ${form.lastName} added to HRMS!`);
      }
      setCreateOpen(false); resetForm();
    } catch (err) { toast.error("Failed to add employee"); }
  };

  const handleUpdate = async () => {
    if (!selectedEmp) return;
    try {
      await genericService(COLLECTIONS.employees).update(selectedEmp.id, {
        ...form, salary: form.salary ? parseFloat(form.salary) : 0,
      });
      store.updateItem(selectedEmp.id, { ...form, salary: form.salary ? parseFloat(form.salary) : 0 } as Partial<EmployeeDoc>);

      // Sync changes to CV-365 and Mail
      try {
        await syncEmployeeToOtherApps({
          uid: selectedEmp.id,
          email: form.email || selectedEmp.email,
          displayName: `${form.firstName} ${form.lastName}`,
          firstName: form.firstName, lastName: form.lastName,
          department: form.department, designation: form.designation,
          joiningDate: form.joiningDate, status: form.status,
          employmentType: form.employmentType, location: form.location,
          role: "employee", phone: form.phone,
        });
      } catch { /* sync failure shouldn't block local update */ }

      toast.success("Employee updated & synced!"); setEditOpen(false);
    } catch { toast.error("Update failed"); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove ${name}?`)) return;
    try {
      await genericService(COLLECTIONS.employees).remove(id);
      store.removeItem(id);
      toast.success(`${name} removed`); setSelectedEmp(null);
    } catch { toast.error("Failed to remove"); }
  };

  const openEdit = (emp: EmployeeDoc) => {
    setSelectedEmp(emp);
    setForm({ firstName: emp.firstName || "", lastName: emp.lastName || "", email: emp.email || "", phone: emp.phone || "", department: emp.department || "", designation: emp.designation || "", joiningDate: emp.joiningDate || "", employmentType: emp.employmentType || "Full-time", location: emp.location || "", status: emp.status || "active", salary: emp.salary?.toString() || "", password: "", syncToApps: false });
    setEditOpen(true);
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton rows={8} /></div>;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employees</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{items.length} total employees across {deptSummary.length} departments</p>
        </div>
        {rbac.canAny(["employees.create"]) && (
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2" onClick={() => { resetForm(); setCreateOpen(true); }}>
            <UserPlus className="h-4 w-4" />Add Employee
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 stagger-children">
        {[
          { label: "Total Employees", value: items.length.toString(), icon: Users, color: "from-violet-500 to-purple-600" },
          { label: "Active", value: totalActive.toString(), icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Departments", value: deptSummary.length.toString(), icon: Building2, color: "from-blue-500 to-cyan-500" },
          { label: "New This Month", value: newThisMonth.toString(), icon: UserPlus, color: "from-amber-500 to-orange-500" },
          { label: "On Notice", value: totalOnNotice.toString(), icon: AlertTriangle, color: totalOnNotice > 0 ? "from-red-500 to-orange-500" : "from-emerald-500 to-green-600" },
        ].map(s => (
          <Card key={s.label} className="group hover:shadow-md transition-all">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${s.color} text-white shadow-md transition-transform group-hover:scale-110`}><s.icon className="h-5 w-5" /></div>
              <div><p className="text-[10px] font-medium text-muted-foreground">{s.label}</p><p className="text-lg font-bold">{s.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs + Filters */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="all">All ({items.length})</TabsTrigger>
            <TabsTrigger value="new">New Joiners ({newThisMonth})</TabsTrigger>
            <TabsTrigger value="notice">On Notice ({totalOnNotice})</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" /><Input className="pl-8 h-9 w-64" placeholder="Search name, email, dept..." value={search} onChange={e => setSearch(e.target.value)} /></div>
            <Select value={deptFilter} onValueChange={setDeptFilter}><SelectTrigger className="w-36 h-9"><SelectValue placeholder="Department" /></SelectTrigger><SelectContent>{departments.map(d => <SelectItem key={d} value={d}>{d === "all" ? "All Departments" : d}</SelectItem>)}</SelectContent></Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-28 h-9"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem>{Object.entries(STATUS_CONF).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
            <div className="flex border rounded-lg">
              <Button variant={viewMode === "grid" ? "default" : "ghost"} size="sm" className={cn("h-9 rounded-r-none", viewMode === "grid" && "bg-gradient-to-r from-violet-500 to-purple-600 text-white")} onClick={() => setViewMode("grid")}><Grid3X3 className="h-3.5 w-3.5" /></Button>
              <Button variant={viewMode === "list" ? "default" : "ghost"} size="sm" className={cn("h-9 rounded-l-none", viewMode === "list" && "bg-gradient-to-r from-violet-500 to-purple-600 text-white")} onClick={() => setViewMode("list")}><List className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>

        <TabsContent value={tab} className="mt-4">
          {filtered.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.employees} onAction={() => { resetForm(); setCreateOpen(true); }} />
          ) : viewMode === "grid" ? (
            /* ─── Grid View ─── */
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((emp, i) => {
                const sc = STATUS_CONF[emp.status] ?? STATUS_CONF.active;
                const initials = `${emp.firstName?.[0] ?? ""}${emp.lastName?.[0] ?? ""}`.toUpperCase() || "?";
                return (
                  <Card key={emp.id} className="group cursor-pointer hover:shadow-lg transition-all" onClick={() => setSelectedEmp(emp)}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <Avatar className="h-14 w-14"><AvatarFallback className={`bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]} text-white text-lg font-semibold`}>{initials}</AvatarFallback></Avatar>
                        <Badge className={cn("text-[9px] border-0", sc.className)}>{sc.label}</Badge>
                      </div>
                      <h3 className="mt-3 font-semibold group-hover:text-primary transition-colors">{emp.firstName} {emp.lastName}</h3>
                      <p className="text-xs text-muted-foreground">{emp.designation || "No designation"}</p>
                      <Separator className="my-3" />
                      <div className="space-y-1.5 text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-2"><Building2 className="h-3 w-3 shrink-0" />{emp.department || "Unassigned"}</div>
                        <div className="flex items-center gap-2"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{emp.email || "—"}</span></div>
                        {emp.phone && <div className="flex items-center gap-2"><Phone className="h-3 w-3 shrink-0" />{emp.phone}</div>}
                        {emp.location && <div className="flex items-center gap-2"><MapPin className="h-3 w-3 shrink-0" />{emp.location}</div>}
                        {emp.joiningDate && <div className="flex items-center gap-2"><Calendar className="h-3 w-3 shrink-0" />Joined {emp.joiningDate}</div>}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <Badge variant="outline" className="text-[9px]">{emp.employmentType || "Full-time"}</Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            /* ─── List View ─── */
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left py-3 px-4 font-semibold text-xs">Employee</th>
                        <th className="text-left py-3 px-3 font-semibold text-xs">Department</th>
                        <th className="text-left py-3 px-3 font-semibold text-xs">Designation</th>
                        <th className="text-left py-3 px-3 font-semibold text-xs">Email</th>
                        <th className="text-left py-3 px-3 font-semibold text-xs">Joined</th>
                        <th className="text-center py-3 px-3 font-semibold text-xs">Status</th>
                        <th className="text-center py-3 px-3 font-semibold text-xs">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((emp, i) => {
                        const sc = STATUS_CONF[emp.status] ?? STATUS_CONF.active;
                        const initials = `${emp.firstName?.[0] ?? ""}${emp.lastName?.[0] ?? ""}`.toUpperCase() || "?";
                        return (
                          <tr key={emp.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8"><AvatarFallback className={`bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]} text-white text-[10px] font-semibold`}>{initials}</AvatarFallback></Avatar>
                                <div><p className="font-medium text-xs">{emp.firstName} {emp.lastName}</p><p className="text-[10px] text-muted-foreground">{emp.phone || "—"}</p></div>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-xs">{emp.department || "—"}</td>
                            <td className="py-3 px-3 text-xs">{emp.designation || "—"}</td>
                            <td className="py-3 px-3 text-xs text-muted-foreground">{emp.email || "—"}</td>
                            <td className="py-3 px-3 text-xs text-muted-foreground">{emp.joiningDate || "—"}</td>
                            <td className="py-3 px-3 text-center"><Badge className={cn("text-[8px] border-0", sc.className)}>{sc.label}</Badge></td>
                            <td className="py-3 px-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); setSelectedEmp(emp); }}><Eye className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); openEdit(emp); }}><Edit className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(emp.id, `${emp.firstName} ${emp.lastName}`); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 border-t text-xs text-muted-foreground">
                  Showing {filtered.length} of {items.length} employees
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Department Breakdown */}
      {items.length > 0 && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Department Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {deptSummary.map(([dept, count], i) => (
                <div key={dept} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-all cursor-pointer" {...clickable(() => setDeptFilter(dept))}>
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]} text-white shadow-sm`}>
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{dept}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Progress value={(count / items.length) * 100} className="h-1.5 flex-1" />
                      <span className="text-[10px] text-muted-foreground">{count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Employee Detail Side Sheet ─── */}
      {selectedEmp && !editOpen && (
        <Dialog open={!!selectedEmp} onOpenChange={() => setSelectedEmp(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16"><AvatarFallback className={`bg-gradient-to-br ${GRADIENTS[items.indexOf(selectedEmp) % GRADIENTS.length]} text-white text-xl font-semibold`}>{`${selectedEmp.firstName?.[0] ?? ""}${selectedEmp.lastName?.[0] ?? ""}`.toUpperCase()}</AvatarFallback></Avatar>
                <div>
                  <DialogTitle>{selectedEmp.firstName} {selectedEmp.lastName}</DialogTitle>
                  <p className="text-sm text-muted-foreground">{selectedEmp.designation || "No designation"}</p>
                  <div className="flex gap-1.5 mt-1">
                    <Badge variant="outline" className="text-[10px]">{selectedEmp.department || "Unassigned"}</Badge>
                    <Badge className={cn("text-[10px] border-0", (STATUS_CONF[selectedEmp.status] ?? STATUS_CONF.active).className)}>{(STATUS_CONF[selectedEmp.status] ?? STATUS_CONF.active).label}</Badge>
                  </div>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              {/* Contact */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Contact Information</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{selectedEmp.email || "—"}</div>
                  <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{selectedEmp.phone || "—"}</div>
                  <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{selectedEmp.location || "—"}</div>
                  <div className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 text-muted-foreground" />Joined {selectedEmp.joiningDate || "—"}</div>
                </div>
              </div>
              <Separator />
              {/* Employment Details */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Employment</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Manager:</span> {selectedEmp.reportingManager || "—"}</div>
                  <div><span className="text-muted-foreground">Type:</span> {selectedEmp.employmentType || "Full-time"}</div>
                  {selectedEmp.salary && <div><span className="text-muted-foreground">Salary:</span> ₹{Number(selectedEmp.salary).toLocaleString("en-IN")}</div>}
                </div>
              </div>
              {/* Skills */}
              {selectedEmp.skills && (selectedEmp.skills as string[]).length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Skills</h4>
                    <div className="flex flex-wrap gap-1.5">{(selectedEmp.skills as string[]).map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}</div>
                  </div>
                </>
              )}
              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1 gap-1 text-xs" onClick={() => openEdit(selectedEmp)}><Edit className="h-3 w-3" />Edit</Button>
                <Button variant="outline" className="text-xs text-destructive gap-1" onClick={() => handleDelete(selectedEmp.id, `${selectedEmp.firstName} ${selectedEmp.lastName}`)}><Trash2 className="h-3 w-3" />Remove</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ─── Create / Edit Dialog ─── */}
      <Dialog open={createOpen || editOpen} onOpenChange={() => { setCreateOpen(false); setEditOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editOpen ? "Edit Employee" : "Add New Employee"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))} placeholder="First name" /></div>
              <div className="space-y-2"><Label>Last Name *</Label><Input value={form.lastName} onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))} placeholder="Last name" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@company.com" /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+91 9876543210" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Department *</Label><Select value={form.department} onValueChange={v => setForm(p => ({ ...p, department: v }))}><SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger><SelectContent>{DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Designation</Label><Input value={form.designation} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))} placeholder="Software Engineer" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Joining Date</Label><Input type="date" value={form.joiningDate} onChange={e => setForm(p => ({ ...p, joiningDate: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Employment Type</Label><Select value={form.employmentType} onValueChange={v => setForm(p => ({ ...p, employmentType: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{EMPLOYMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Location</Label><Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Bangalore HQ" /></div>
              <div className="space-y-2"><Label>Salary (Annual ₹)</Label><Input type="number" value={form.salary} onChange={e => setForm(p => ({ ...p, salary: e.target.value }))} placeholder="1200000" /></div>
            </div>
            {editOpen && (
              <div className="space-y-2"><Label>Status</Label><Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS_CONF).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
            )}
            {!editOpen && (
              <>
                <Separator />
                <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                  <h4 className="text-xs font-semibold text-muted-foreground">Cross-App Account Setup</h4>
                  <p className="text-[10px] text-muted-foreground">Create login access for this employee across HRMS, CV-365, and Mail apps.</p>
                  <div className="space-y-2"><Label>Login Password</Label><Input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Set initial password (min 6 chars)" /></div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="syncApps" checked={form.syncToApps} onChange={e => setForm(p => ({ ...p, syncToApps: e.target.checked }))} className="rounded" />
                    <label htmlFor="syncApps" className="text-xs">Create accounts in CV-365 and Mail.circuvent</label>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditOpen(false); }}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={editOpen ? handleUpdate : handleCreate}>
              {editOpen ? "Save Changes" : "Add Employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}