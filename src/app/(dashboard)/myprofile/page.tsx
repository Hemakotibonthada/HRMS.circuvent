"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  User, Mail, Phone, MapPin, Calendar, Building2, Briefcase,
  Shield, GraduationCap, Award, Clock, DollarSign, Edit,
  Save, Target, Star, FileText, Heart, Key,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { accountPortalUrl } from "@/lib/account-portal";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import { useEmployeeStore, useGoalStore, useLeaveStore, useAttendanceStore, useExpenseStore, startSync, type EmployeeDoc } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataLoadingSkeleton } from "@/components/data-empty-state";
import { GetTheApp } from "@/components/get-the-app";

const GRADIENTS = ["from-violet-500 to-purple-600","from-blue-500 to-cyan-500","from-emerald-500 to-green-600","from-amber-500 to-orange-500","from-pink-500 to-rose-600"];
const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];

export default function MyProfilePage() {
  const { user } = useAuth();
  const rbac = useRBAC();
  const empStore = useEmployeeStore();
  const goalStore = useGoalStore();
  const leaveStore = useLeaveStore();
  const attStore = useAttendanceStore();
  const expStore = useExpenseStore();
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ phone: "", location: "" });

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
    if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore);
    if (!attStore.initialized) startSync(COLLECTIONS.attendance, attStore);
    if (!expStore.initialized) startSync(COLLECTIONS.expenses, expStore);
  }, [empStore, goalStore, leaveStore, attStore, expStore]);

  // Find the current user's employee record
  const myProfile = useMemo(() => {
    if (!user?.email) return null;
    return empStore.items.find(e => e.email === user.email) || null;
  }, [empStore.items, user]);

  const myGoals = useMemo(() => {
    if (!myProfile) return [];
    return goalStore.items.filter(g => g.employeeId === myProfile.id);
  }, [goalStore.items, myProfile]);

  const myLeaves = useMemo(() => {
    if (!myProfile) return [];
    return leaveStore.items.filter(l => l.employeeId === myProfile.id);
  }, [leaveStore.items, myProfile]);

  const myAttendance = useMemo(() => {
    if (!myProfile) return [];
    return attStore.items.filter(a => a.employeeId === myProfile.id);
  }, [attStore.items, myProfile]);

  const myExpenses = useMemo(() => {
    if (!myProfile) return [];
    return expStore.items.filter(e => e.employeeId === myProfile.id);
  }, [expStore.items, myProfile]);

  // Chart data
  const leaveByType = useMemo(() => {
    const m: Record<string, number> = {};
    myLeaves.forEach(l => { m[l.leaveType || "Other"] = (m[l.leaveType || "Other"] || 0) + (l.days || 1); });
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [myLeaves]);

  const goalRadar = useMemo(() => {
    const cats: Record<string, { total: number; sum: number }> = {};
    myGoals.forEach(g => {
      const c = g.category || "General";
      if (!cats[c]) cats[c] = { total: 0, sum: 0 };
      cats[c].total++;
      cats[c].sum += (g.progress || 0);
    });
    return Object.entries(cats).map(([name, v]) => ({
      category: name.length > 10 ? name.substring(0, 10) + "…" : name,
      progress: v.total > 0 ? Math.round(v.sum / v.total) : 0,
    }));
  }, [myGoals]);

  const initials = user?.displayName?.split(" ").map(n => n[0]).join("").toUpperCase() || user?.email?.[0]?.toUpperCase() || "?";
  const displayName = user?.displayName || user?.email || "User";

  const handleSaveProfile = async () => {
    if (!myProfile) return;
    try {
      await genericService(COLLECTIONS.employees).update(myProfile.id, {
        phone: editForm.phone || myProfile.phone,
        location: editForm.location || myProfile.location,
      });
      empStore.updateItem(myProfile.id, {
        phone: editForm.phone || myProfile.phone,
        location: editForm.location || myProfile.location,
      } as Partial<EmployeeDoc>);
      toast.success("Profile updated!");
      setEditing(false);
    } catch {
      toast.error("Failed to update profile");
    }
  };

  if (empStore.loading && !empStore.initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6">
      {/* Renders nothing until the Play listing is live — see
          src/lib/mobile-app.ts. This is the right place for it: the person
          reading their own profile is the person who wants the app. */}
      <GetTheApp variant="card" className="animate-slide-up" />

      {/* Profile Header */}
      <div className="animate-slide-up">
        <div className="rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-600 p-6 text-white shadow-xl">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20 border-3 border-white/30 overflow-hidden shrink-0">
              <AvatarImage
                src={myProfile?.avatarUrl || user?.avatarUrl || (user?.uid ? `${accountPortalUrl()}/api/profile/avatar/${user.uid}` : undefined)}
                alt={displayName}
                className="object-cover h-full w-full"
              />
              <AvatarFallback className="bg-white/20 text-white text-2xl font-bold">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{displayName}</h1>
              <p className="text-white/70 text-sm">{myProfile?.designation || "Employee"} · {myProfile?.department || "Unassigned"}</p>
              <div className="flex gap-2 mt-2">
                <Badge className="bg-white/20 text-white border-0 text-xs">{rbac.role}</Badge>
                <Badge className="bg-white/20 text-white border-0 text-xs">{myProfile?.status || "active"}</Badge>
                <Badge className="bg-white/20 text-white border-0 text-xs">{myProfile?.employmentType || "Full-time"}</Badge>
              </div>
            </div>
            <Button variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20 gap-1" onClick={() => { setEditing(!editing); if (myProfile) setEditForm({ phone: myProfile.phone || "", location: myProfile.location || "" }); }}>
              <Edit className="h-4 w-4" />{editing ? "Cancel" : "Edit Profile"}
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="goals">My Goals ({myGoals.length})</TabsTrigger>
          <TabsTrigger value="leaves">My Leaves ({myLeaves.length})</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Personal Info */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><User className="h-4 w-4 text-violet-500" />Personal Information</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { icon: Mail, label: "Email", value: user?.email || "—" },
                  { icon: Phone, label: "Phone", value: myProfile?.phone || "—", editable: true, field: "phone" },
                  { icon: MapPin, label: "Location", value: myProfile?.location || "—", editable: true, field: "location" },
                  { icon: Calendar, label: "Joined", value: myProfile?.joiningDate || "—" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-3">
                    <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1">
                      <p className="text-[10px] text-muted-foreground">{item.label}</p>
                      {editing && item.editable ? (
                        <Input
                          className="h-8 text-sm mt-0.5"
                          value={editForm[item.field as keyof typeof editForm] || ""}
                          onChange={e => setEditForm(p => ({ ...p, [item.field as string]: e.target.value }))}
                          placeholder={`Enter ${item.label.toLowerCase()}`}
                        />
                      ) : (
                        <p className="text-sm font-medium">{item.value}</p>
                      )}
                    </div>
                  </div>
                ))}
                {editing && (
                  <Button className="w-full mt-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-1" onClick={handleSaveProfile}>
                    <Save className="h-4 w-4" />Save Changes
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Employment Info */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Briefcase className="h-4 w-4 text-blue-500" />Employment Details</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { icon: Building2, label: "Department", value: myProfile?.department || "Unassigned" },
                  { icon: Briefcase, label: "Designation", value: myProfile?.designation || "—" },
                  { icon: User, label: "Manager", value: myProfile?.reportingManager || "—" },
                  { icon: Shield, label: "Role", value: rbac.role },
                  { icon: Clock, label: "Employment Type", value: myProfile?.employmentType || "Full-time" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-3">
                    <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div><p className="text-[10px] text-muted-foreground">{item.label}</p><p className="text-sm font-medium">{item.value}</p></div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Quick Stats */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Active Goals", value: myGoals.filter(g => g.status !== "completed").length.toString(), icon: Target, color: "from-violet-500 to-purple-600" },
              { label: "Leave Requests", value: myLeaves.length.toString(), icon: Calendar, color: "from-blue-500 to-cyan-500" },
              { label: "Avg Goal Progress", value: `${myGoals.length > 0 ? Math.round(myGoals.reduce((s, g) => s + (g.progress || 0), 0) / myGoals.length) : 0}%`, icon: Star, color: "from-amber-500 to-orange-500" },
              { label: "Pending Leaves", value: myLeaves.filter(l => l.status === "pending").length.toString(), icon: Clock, color: "from-pink-500 to-rose-600" },
            ].map(s => (
              <Card key={s.label} className="group"><CardContent className="flex items-center gap-3 p-4"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${s.color} text-white shadow-md transition-transform group-hover:scale-110`}><s.icon className="h-5 w-5" /></div><div><p className="text-[10px] font-medium text-muted-foreground">{s.label}</p><p className="text-lg font-bold">{s.value}</p></div></CardContent></Card>
            ))}
          </div>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Leave Usage Donut */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="h-4 w-4 text-blue-500" />Leave Usage by Type</CardTitle></CardHeader>
              <CardContent>
                {leaveByType.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={leaveByType} cx="50%" cy="50%" innerRadius={45} outerRadius={85} paddingAngle={3} dataKey="value" labelLine={false}>
                        {leaveByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No leave data yet</p>}
              </CardContent>
            </Card>

            {/* Goal Progress Radar */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4 text-violet-500" />Goal Progress by Category</CardTitle></CardHeader>
              <CardContent>
                {goalRadar.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <RadarChart data={goalRadar}>
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="category" tick={{ fontSize: 10 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                      <Radar name="Progress %" dataKey="progress" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} strokeWidth={2} />
                      <RTooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No goals data yet</p>}
              </CardContent>
            </Card>
          </div>

          {/* Summary Stats */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total Leave Days", value: myLeaves.filter(l => l.status === "approved").reduce((s, l) => s + (l.days || 0), 0), icon: Calendar, color: "text-blue-600" },
              { label: "Total Expenses", value: `₹${myExpenses.reduce((s, e) => s + (e.amount || 0), 0).toLocaleString()}`, icon: DollarSign, color: "text-emerald-600" },
              { label: "Attendance Days", value: myAttendance.length, icon: Clock, color: "text-amber-600" },
              { label: "Goals Completed", value: myGoals.filter(g => g.status === "completed").length, icon: Star, color: "text-violet-600" },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="p-4 text-center">
                  <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Goals */}
        <TabsContent value="goals" className="mt-4 space-y-3">
          {myGoals.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground"><Target className="h-12 w-12 mx-auto mb-3 opacity-30" /><p className="text-sm font-medium">No goals set yet</p><p className="text-xs mt-1">Goals assigned to you will appear here</p></div>
          ) : (
            myGoals.map(goal => (
              <Card key={goal.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold">{goal.title}</h3>
                    <Badge className={cn("text-[9px] border-0", goal.status === "completed" ? "status-active" : goal.status === "at_risk" ? "status-pending" : goal.status === "behind" ? "status-rejected" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400")}>{goal.status?.replace(/_/g, " ")}</Badge>
                  </div>
                  {goal.description && <p className="text-xs text-muted-foreground mb-2">{goal.description}</p>}
                  <Progress value={goal.progress || 0} className="h-2" />
                  <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                    <span>{goal.progress || 0}%</span>
                    <span>Due {goal.dueDate || "TBD"}</span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Leaves */}
        <TabsContent value="leaves" className="mt-4 space-y-2">
          {myLeaves.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground"><Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" /><p className="text-sm font-medium">No leave requests</p><p className="text-xs mt-1">Your leave history will appear here</p></div>
          ) : (
            myLeaves.map(leave => (
              <Card key={leave.id}>
                <CardContent className="p-3.5 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-semibold">{leave.leaveType}</h3>
                      <Badge className={cn("text-[8px] border-0", leave.status === "approved" ? "status-active" : leave.status === "pending" ? "status-pending" : "status-rejected")}>{leave.status}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{leave.fromDate} — {leave.toDate} · {leave.days} day(s)</p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Account */}
        <TabsContent value="account" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Key className="h-4 w-4 text-amber-500" />Account Security</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div><p className="text-xs font-medium">Email</p><p className="text-[10px] text-muted-foreground">{user?.email}</p></div>
                <Badge className="status-active text-[9px] border-0">Verified</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div><p className="text-xs font-medium">Role</p><p className="text-[10px] text-muted-foreground">{rbac.role}</p></div>
                <Badge variant="outline" className="text-[9px]">{rbac.isAdmin ? "Full Access" : rbac.isHR ? "HR Access" : "Standard"}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div><p className="text-xs font-medium">Password</p><p className="text-[10px] text-muted-foreground">Last changed: Unknown</p></div>
                <Button variant="outline" size="sm" className="text-xs">Change</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
