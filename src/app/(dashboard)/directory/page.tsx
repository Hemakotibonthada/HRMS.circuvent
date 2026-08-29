"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Users, Search, LayoutGrid, List, Mail, Phone, MapPin,
  Building2, Filter, Briefcase, Star, Calendar, Code,
  Shield, GraduationCap, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useEmployeeStore, startSync, type EmployeeDoc } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const GRADIENTS = [
  "from-violet-500 to-purple-600", "from-blue-500 to-cyan-500",
  "from-emerald-500 to-green-600", "from-amber-500 to-orange-500",
  "from-pink-500 to-rose-600", "from-teal-500 to-cyan-600",
];

export default function DirectoryPage() {
  const empStore = useEmployeeStore();
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<EmployeeDoc | null>(null);
  const [profileTab, setProfileTab] = useState<"employment" | "contact">("employment");

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [empStore]);

  const loading = empStore.loading && !empStore.initialized;
  const employees = empStore.items;

  const departments = useMemo(() => [...new Set(employees.map(e => e.department).filter(Boolean))].sort(), [employees]);

  const filtered = useMemo(() => {
    let list = employees;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q) ||
        e.designation.toLowerCase().includes(q) ||
        (e.skills || []).some(s => s.toLowerCase().includes(q))
      );
    }
    if (deptFilter !== "all") list = list.filter(e => e.department === deptFilter);
    return list;
  }, [employees, search, deptFilter]);

  const totalEmployees = employees.length;
  const activeEmps = employees.filter(e => e.status === "active").length;
  const deptCount = departments.length;
  const locCount = new Set(employees.map(e => e.location).filter(Boolean)).size;

  const getGradient = (id: string) => {
    const hash = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return GRADIENTS[hash % GRADIENTS.length];
  };

  if (loading) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employee Directory</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{totalEmployees} employees · {deptCount} departments</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={view === "grid" ? "default" : "outline"} className="gap-1" onClick={() => setView("grid")}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button size="sm" variant={view === "list" ? "default" : "outline"} className="gap-1" onClick={() => setView("list")}>
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Employees", value: totalEmployees, icon: Users, color: "from-violet-500 to-purple-600" },
          { label: "Active", value: activeEmps, icon: Star, color: "from-emerald-500 to-green-600" },
          { label: "Departments", value: deptCount, icon: Building2, color: "from-blue-500 to-cyan-500" },
          { label: "Locations", value: locCount, icon: MapPin, color: "from-amber-500 to-orange-500" },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.color)}>
                <kpi.icon className="h-5 w-5 text-white" />
              </div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-lg font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, email, department, skill…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-[180px]"><Filter className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <DataEmptyState {...EMPTY_STATES.employees} />
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(emp => (
            <Card key={emp.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => { setSelected(emp); setProfileTab("employment"); }}>
              <CardContent className="p-5 space-y-3 text-center">
                <Avatar className="h-16 w-16 mx-auto overflow-hidden">
                  {emp.avatarUrl && (
                    <AvatarImage src={emp.avatarUrl} alt={`${emp.firstName} ${emp.lastName}`} className="object-cover h-full w-full" />
                  )}
                  <AvatarFallback className={cn("bg-gradient-to-br text-white text-lg font-bold", getGradient(emp.id))}>
                    {emp.firstName?.[0]}{emp.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-semibold text-sm">{emp.firstName} {emp.lastName}</h3>
                  <p className="text-xs text-muted-foreground">{emp.designation}</p>
                </div>
                <Badge variant="secondary" className="text-xs">{emp.department}</Badge>
                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{emp.email.split("@")[0]}</span>
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{emp.location || "–"}</span>
                </div>
                {emp.skills && emp.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-center">
                    {emp.skills.slice(0, 3).map(s => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                    {emp.skills.length > 3 && <Badge variant="outline" className="text-xs">+{emp.skills.length - 3}</Badge>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(emp => (
            <Card key={emp.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => { setSelected(emp); setProfileTab("employment"); }}>
              <CardContent className="p-4 flex items-center gap-4">
                <Avatar className="h-10 w-10 overflow-hidden shrink-0">
                  {emp.avatarUrl && (
                    <AvatarImage src={emp.avatarUrl} alt={`${emp.firstName} ${emp.lastName}`} className="object-cover h-full w-full" />
                  )}
                  <AvatarFallback className={cn("bg-gradient-to-br text-white text-xs font-bold", getGradient(emp.id))}>
                    {emp.firstName[0]}{emp.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm truncate">{emp.firstName} {emp.lastName}</h3>
                    <Badge variant="secondary" className="text-xs shrink-0">{emp.department}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{emp.designation} · {emp.email}</p>
                </div>
                <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{emp.location || "–"}</span>
                  <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{emp.phone || "–"}</span>
                </div>
                <Badge className={cn("text-xs shrink-0", emp.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700")}>{emp.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Employee Profile</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 overflow-hidden shrink-0">
                  {selected.avatarUrl && (
                    <AvatarImage src={selected.avatarUrl} alt={`${selected.firstName} ${selected.lastName}`} className="object-cover h-full w-full" />
                  )}
                  <AvatarFallback className={cn("bg-gradient-to-br text-white text-lg font-bold", getGradient(selected.id))}>
                    {selected.firstName?.[0]}{selected.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="text-lg font-bold">{selected.firstName} {selected.lastName}</h2>
                  <p className="text-sm text-muted-foreground">{selected.designation}</p>
                  <Badge className={cn("text-xs mt-1", selected.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700")}>{selected.status}</Badge>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" variant={profileTab === "employment" ? "default" : "outline"} onClick={() => setProfileTab("employment")}>Employment</Button>
                <Button size="sm" variant={profileTab === "contact" ? "default" : "outline"} onClick={() => setProfileTab("contact")}>Contact</Button>
              </div>

              <Separator />

              {profileTab === "employment" ? (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Department</p><p className="font-medium">{selected.department}</p></div></div>
                  <div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Employment Type</p><p className="font-medium">{selected.employmentType}</p></div></div>
                  <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Joined</p><p className="font-medium">{selected.joiningDate || "–"}</p></div></div>
                  <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Status</p><p className="font-medium capitalize">{selected.status}</p></div></div>
                  {selected.reportingManager && (
                    <div className="flex items-center gap-2 col-span-2"><Users className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Reporting Manager</p><p className="font-medium">{selected.reportingManager}</p></div></div>
                  )}
                  {selected.skills && selected.skills.length > 0 && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Code className="h-3 w-3" />Skills</p>
                      <div className="flex flex-wrap gap-1">
                        {selected.skills.map(s => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium break-all">{selected.email}</p></div></div>
                  <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{selected.phone || "–"}</p></div></div>
                  <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Location</p><p className="font-medium">{selected.location || "–"}</p></div></div>
                  <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Department</p><p className="font-medium">{selected.department}</p></div></div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
