"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Users, Search, CheckCircle2, Clock, UserPlus,
  Briefcase, GraduationCap, Heart, CalendarDays, Star,
  Laptop, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { useEmployeeStore, startSync } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { useNowMs } from "@/hooks/use-now";

const ONBOARDING_PHASES = [
  { key: "preboarding", label: "Pre-boarding", icon: Briefcase, color: "text-blue-500" },
  { key: "day1", label: "Day 1", icon: Star, color: "text-amber-500" },
  { key: "week1", label: "Week 1", icon: Laptop, color: "text-violet-500" },
  { key: "month1", label: "Month 1", icon: GraduationCap, color: "text-emerald-500" },
  { key: "month3", label: "Month 3", icon: Heart, color: "text-rose-500" },
];

const ONBOARDING_TASKS = [
  { phase: "preboarding", task: "Offer letter sent", weight: 10 },
  { phase: "preboarding", task: "Background check", weight: 10 },
  { phase: "day1", task: "ID card issued", weight: 5 },
  { phase: "day1", task: "Workspace assigned", weight: 5 },
  { phase: "day1", task: "IT setup complete", weight: 10 },
  { phase: "week1", task: "HR induction", weight: 10 },
  { phase: "week1", task: "Team introduction", weight: 5 },
  { phase: "week1", task: "Policy acknowledgement", weight: 10 },
  { phase: "month1", task: "30-day check-in", weight: 10 },
  { phase: "month1", task: "Role-specific training", weight: 15 },
  { phase: "month3", task: "90-day review", weight: 10 },
];

export default function OnboardingHubPage() {
  const nowMs = useNowMs();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = empStore;
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, empStore]);

  const newJoiners = useMemo(() => {
    // Date.now() during render made "joined in the last 90 days" resolve
    // differently on the server and the client.
    if (nowMs === null) return [];
    const cutoff = nowMs - 90 * 24 * 60 * 60 * 1000;
    return items.filter(e => {
      if (!e.joiningDate) return false;
      return new Date(e.joiningDate).getTime() >= cutoff;
    }).sort((a, b) => new Date(b.joiningDate).getTime() - new Date(a.joiningDate).getTime());
  }, [items, nowMs]);

  const filtered = useMemo(() => {
    if (!search) return newJoiners;
    const q = search.toLowerCase();
    return newJoiners.filter(e =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.department?.toLowerCase().includes(q)
    );
  }, [newJoiners, search]);

  const getJoinerProgress = (joiningDate: string) => {
    if (nowMs === null) return 0;
    const daysSinceJoin = Math.floor((nowMs - new Date(joiningDate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceJoin >= 90) return 100;
    if (daysSinceJoin >= 30) return 75;
    if (daysSinceJoin >= 7) return 50;
    if (daysSinceJoin >= 1) return 25;
    return 10;
  };

  const getCurrentPhase = (joiningDate: string) => {
    if (nowMs === null) return "preboarding";
    const daysSinceJoin = Math.floor((nowMs - new Date(joiningDate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceJoin >= 90) return "month3";
    if (daysSinceJoin >= 30) return "month1";
    if (daysSinceJoin >= 7) return "week1";
    if (daysSinceJoin >= 1) return "day1";
    return "preboarding";
  };

  const getBuddyName = (emp: typeof items[0]) => {
    const deptPeers = items.filter(e =>
      e.department === emp.department && e.id !== emp.id && e.status === "active"
    );
    return deptPeers.length > 0 ? `${deptPeers[0].firstName} ${deptPeers[0].lastName}` : "Not assigned";
  };

  const phaseData = useMemo(() =>
    ONBOARDING_PHASES.map(p => ({
      name: p.label,
      count: newJoiners.filter(e => getCurrentPhase(e.joiningDate) === p.key).length,
    })),
  [newJoiners]);

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && newJoiners.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Onboarding Hub</h1>
          <p className="text-muted-foreground mt-1">Track new hire onboarding progress</p>
        </div>
        <DataEmptyState {...EMPTY_STATES.onboarding} />
      </div>
    );
  }

  const inProgress = newJoiners.filter(e => getJoinerProgress(e.joiningDate) < 100).length;
  const completed = newJoiners.filter(e => getJoinerProgress(e.joiningDate) >= 100).length;
  const avgProgress = newJoiners.length > 0 ? Math.round(newJoiners.reduce((s, e) => s + getJoinerProgress(e.joiningDate), 0) / newJoiners.length) : 0;

  const kpis = [
    { label: "New Joiners (90d)", value: newJoiners.length, icon: UserPlus, gradient: "from-violet-500 to-purple-600" },
    { label: "In Progress", value: inProgress, icon: Clock, gradient: "from-amber-500 to-orange-500" },
    { label: "Completed", value: completed, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Avg Progress", value: `${avgProgress}%`, icon: CalendarDays, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Onboarding Hub</h1>
        <p className="text-muted-foreground mt-1">Track new hire onboarding progress</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{kpi.label}</p><p className="text-2xl font-bold mt-1">{kpi.value}</p></div><div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}><kpi.icon className="h-5 w-5 text-white" /></div></div></CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Joiners by Phase</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={phaseData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <RTooltip />
                <Bar dataKey="count" fill="#8b5cf6" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Phase Progress</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {ONBOARDING_PHASES.map(phase => {
              const count = newJoiners.filter(e => getCurrentPhase(e.joiningDate) === phase.key).length;
              return (
                <div key={phase.key} className="flex items-center gap-3">
                  <phase.icon className={cn("h-4 w-4", phase.color)} />
                  <div className="flex-1">
                    <div className="flex justify-between text-xs mb-1">
                      <span>{phase.label}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                    <Progress value={newJoiners.length > 0 ? (count / newJoiners.length) * 100 : 0} className="h-1.5" />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search new joiners…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="space-y-3">
        {filtered.map(emp => {
          const progress = getJoinerProgress(emp.joiningDate);
          const phase = getCurrentPhase(emp.joiningDate);
          const phaseInfo = ONBOARDING_PHASES.find(p => p.key === phase);
          const buddy = getBuddyName(emp);
          return (
            <Card key={emp.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-sm">
                      {emp.firstName?.charAt(0)}{emp.lastName?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{emp.firstName} {emp.lastName}</p>
                      <Badge variant="secondary" className="text-xs">{phaseInfo?.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{emp.department} · {emp.designation} · Joined {new Date(emp.joiningDate).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Buddy: {buddy}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={progress} className="h-2 w-24" />
                      <span className="text-xs font-medium">{progress}%</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
