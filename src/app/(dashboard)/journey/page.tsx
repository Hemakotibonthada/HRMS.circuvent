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
  Compass, Users, Target, Heart, Award, TrendingUp,
  Sparkles, GraduationCap, Star, ArrowRight, Eye,
  UserPlus, Handshake, Zap, LogOut, CheckCircle2,
  BarChart3, Smile,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend,
} from "recharts";
import {
  useEmployeeStore, useGoalStore, useFeedbackStore, startSync,
} from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { useNowMs } from "@/hooks/use-now";

// ═══════════════════════════════════════════════════════════════
// JOURNEY — Employee lifecycle journey map with 7 stages
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1"];

interface JourneyStage {
  name: string;
  icon: typeof Compass;
  color: string;
  description: string;
}

const STAGES: JourneyStage[] = [
  { name: "Attract", icon: Sparkles, color: "from-violet-500 to-purple-600", description: "Employer branding, job postings, career page" },
  { name: "Onboard", icon: UserPlus, color: "from-blue-500 to-cyan-500", description: "Orientation, documentation, training setup" },
  { name: "Develop", icon: GraduationCap, color: "from-emerald-500 to-green-600", description: "Skills training, mentoring, career paths" },
  { name: "Perform", icon: Target, color: "from-amber-500 to-orange-500", description: "Goals, reviews, performance management" },
  { name: "Recognize", icon: Award, color: "from-pink-500 to-rose-500", description: "Awards, kudos, achievements, bonuses" },
  { name: "Engage", icon: Heart, color: "from-red-500 to-orange-500", description: "Surveys, events, wellness, team building" },
  { name: "Transition", icon: LogOut, color: "from-gray-500 to-slate-600", description: "Resignation, retirement, alumni, offboarding" },
];

export default function JourneyPage() {
  const nowMs = useNowMs();
  const empStore = useEmployeeStore();
  const goalStore = useGoalStore();
  const feedbackStore = useFeedbackStore();
  const { items: employees, loading, initialized } = empStore;
  const { items: goals } = goalStore;
  const { items: feedback } = feedbackStore;
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [tab, setTab] = useState("map");

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
    if (!feedbackStore.initialized) startSync(COLLECTIONS.feedback, feedbackStore);
  }, [empStore, goalStore, feedbackStore]);

  // Stage metrics computed from stores
  const stageMetrics = useMemo(() => {
    const active = employees.filter(e => e.status === "active").length;
    const newJoiners = employees.filter(e => {
      if (!e.joiningDate || nowMs === null) return false;
      const diff = nowMs - new Date(e.joiningDate).getTime();
      return diff < 90 * 86400000; // last 90 days
    }).length;
    const withGoals = new Set(goals.map(g => g.employeeId)).size;
    const completedGoals = goals.filter(g => g.status === "Completed" || (g.progress || 0) >= 100).length;
    const avgGoalProgress = goals.length > 0
      ? Math.round(goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length)
      : 0;
    const feedbackCount = feedback.filter(f => f.status === "resolved" || f.category === "appreciation").length;
    const exiting = employees.filter(e => e.status === "exiting" || e.status === "resigned" || e.status === "terminated").length;

    return [
      { stage: "Attract", metric: `${employees.length} profiles`, count: employees.length, satisfaction: 75 },
      { stage: "Onboard", metric: `${newJoiners} new joiners`, count: newJoiners, satisfaction: 85 },
      { stage: "Develop", metric: `${withGoals} with goals`, count: withGoals, satisfaction: 70 },
      { stage: "Perform", metric: `${avgGoalProgress}% avg progress`, count: completedGoals, satisfaction: avgGoalProgress },
      { stage: "Recognize", metric: `${feedbackCount} recognitions`, count: feedbackCount, satisfaction: 80 },
      { stage: "Engage", metric: `${active} active`, count: active, satisfaction: 78 },
      { stage: "Transition", metric: `${exiting} exiting`, count: exiting, satisfaction: exiting > 0 ? 50 : 90 },
    ];
  }, [employees, goals, feedback, nowMs]);

  // Touchpoint details per stage
  const getTouchpoints = (stageName: string) => {
    switch (stageName) {
      case "Attract": return [
        { name: "Job Postings", detail: `${employees.length} total profiles in system` },
        { name: "Career Page", detail: "Employer branding touchpoint" },
        { name: "Social Media", detail: "LinkedIn, Glassdoor presence" },
        { name: "Referral Program", detail: "Employee referral pipeline" },
      ];
      case "Onboard": return [
        { name: "Welcome Kit", detail: "Day 1 orientation materials" },
        { name: "IT Setup", detail: "Laptop, email, access provisioning" },
        { name: "Buddy Pairing", detail: "Mentor assignment for new joiners" },
        { name: "30-60-90 Plan", detail: "Structured onboarding plan" },
      ];
      case "Develop": return [
        { name: "Training Programs", detail: "Technical & soft skills" },
        { name: "Mentorship", detail: "1:1 career guidance" },
        { name: "Certifications", detail: "Professional certifications" },
        { name: "Learning Path", detail: "Personalized development plan" },
      ];
      case "Perform": return [
        { name: "Goal Setting", detail: `${goals.length} active goals` },
        { name: "Quarterly Reviews", detail: "Performance check-ins" },
        { name: "360 Feedback", detail: "Multi-rater assessment" },
        { name: "Calibration", detail: "Rating calibration sessions" },
      ];
      case "Recognize": return [
        { name: "Spot Awards", detail: "Instant recognition" },
        { name: "Quarterly Awards", detail: "Top performer recognition" },
        { name: "Peer Kudos", detail: `${feedback.length} feedback entries` },
        { name: "Milestone Awards", detail: "Service anniversary awards" },
      ];
      case "Engage": return [
        { name: "Pulse Surveys", detail: "Monthly engagement surveys" },
        { name: "Town Halls", detail: "All-hands meetings" },
        { name: "Wellness Programs", detail: "Health & wellbeing initiatives" },
        { name: "Team Events", detail: "Social & team building" },
      ];
      case "Transition": return [
        { name: "Exit Interview", detail: "Structured feedback collection" },
        { name: "Knowledge Transfer", detail: "Documentation & handover" },
        { name: "Clearance Process", detail: "Multi-department clearance" },
        { name: "Alumni Network", detail: "Stay connected post-exit" },
      ];
      default: return [];
    }
  };

  // Stage-wise employee count chart
  const stageChartData = useMemo(() =>
    stageMetrics.map(s => ({ name: s.stage, count: s.count, satisfaction: s.satisfaction })),
  [stageMetrics]);

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && employees.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.employees} />;
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Employee Journey</h1>
        <p className="text-muted-foreground mt-1">Lifecycle journey map — Attract to Transition</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Total Employees", value: employees.length, icon: Users, gradient: "from-violet-500 to-purple-600" },
          { label: "Active Goals", value: goals.filter(g => g.status === "Active").length, icon: Target, gradient: "from-amber-500 to-orange-500" },
          { label: "Feedback Items", value: feedback.length, icon: Star, gradient: "from-emerald-500 to-green-600" },
          { label: "Avg Satisfaction", value: `${Math.round(stageMetrics.reduce((s, m) => s + m.satisfaction, 0) / stageMetrics.length)}%`, icon: Smile, gradient: "from-blue-500 to-cyan-500" },
        ].map(kpi => (
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="map">Journey Map</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Journey Map */}
        <TabsContent value="map" className="mt-4">
          {/* Timeline */}
          <Card className="border-0 shadow-sm mb-4">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                {STAGES.map((stage, i) => {
                  const metrics = stageMetrics.find(m => m.stage === stage.name);
                  const isSelected = selectedStage === stage.name;
                  return (
                    <div key={stage.name} className="flex items-center flex-1">
                      <div className="flex flex-col items-center cursor-pointer" onClick={() => setSelectedStage(isSelected ? null : stage.name)}>
                        <div className={cn(
                          "h-14 w-14 rounded-full flex items-center justify-center transition-all",
                          isSelected ? "ring-4 ring-violet-200 dark:ring-violet-800 scale-110" : "",
                          `bg-gradient-to-br ${stage.color}`
                        )}>
                          <stage.icon className="h-6 w-6 text-white" />
                        </div>
                        <p className={cn("text-xs font-semibold mt-2", isSelected ? "text-violet-600" : "")}>{stage.name}</p>
                        <p className="text-[10px] text-muted-foreground">{metrics?.metric}</p>
                      </div>
                      {i < STAGES.length - 1 && (
                        <div className="flex-1 mx-2 h-0.5 bg-gradient-to-r from-muted to-muted-foreground/20" />
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Selected Stage Detail */}
          {selectedStage && (() => {
            const stage = STAGES.find(s => s.name === selectedStage);
            const metrics = stageMetrics.find(m => m.stage === selectedStage);
            const touchpoints = getTouchpoints(selectedStage);
            if (!stage || !metrics) return null;
            return (
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center bg-gradient-to-br", stage.color)}>
                      <stage.icon className="h-4 w-4 text-white" />
                    </div>
                    {stage.name} Stage
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">{stage.description}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="p-4 rounded-lg bg-muted/30">
                      <p className="text-sm text-muted-foreground">Satisfaction Gauge</p>
                      <div className="flex items-center gap-3 mt-2">
                        <p className="text-3xl font-bold">{metrics.satisfaction}%</p>
                        <Progress value={metrics.satisfaction} className="flex-1 h-3" />
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/30">
                      <p className="text-sm text-muted-foreground">Employee Count</p>
                      <p className="text-3xl font-bold mt-2">{metrics.count}</p>
                    </div>
                  </div>
                  <Separator className="my-4" />
                  <h4 className="font-semibold text-sm mb-3">Touchpoints</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {touchpoints.map(tp => (
                      <div key={tp.name} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">{tp.name}</p>
                          <p className="text-xs text-muted-foreground">{tp.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* If no stage selected, show all stages summary */}
          {!selectedStage && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {STAGES.map(stage => {
                const metrics = stageMetrics.find(m => m.stage === stage.name);
                return (
                  <Card key={stage.name} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedStage(stage.name)}>
                    <CardContent className="p-5">
                      <div className="flex items-center gap-3 mb-3">
                        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br", stage.color)}>
                          <stage.icon className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{stage.name}</h3>
                          <p className="text-xs text-muted-foreground">{metrics?.metric}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">{stage.description}</p>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Satisfaction</span>
                        <span className="font-bold">{metrics?.satisfaction || 0}%</span>
                      </div>
                      <Progress value={metrics?.satisfaction || 0} className="h-2 mt-1" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Stage-wise Employee Count</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stageChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="count" name="Employees" fill="#8b5cf6" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Satisfaction by Stage</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stageChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} />
                    <RTooltip />
                    <Bar dataKey="satisfaction" name="Satisfaction %" fill="#10b981" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Score Summary */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Journey Health Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stageMetrics.map((m, i) => {
                  const stage = STAGES[i];
                  return (
                    <div key={m.stage} className="flex items-center gap-4">
                      <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center bg-gradient-to-br", stage.color)}>
                        <stage.icon className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium">{m.stage}</span>
                          <span className="text-muted-foreground">{m.satisfaction}%</span>
                        </div>
                        <Progress value={m.satisfaction} className={cn("h-2",
                          m.satisfaction < 50 ? "[&>div]:bg-red-500" :
                          m.satisfaction < 70 ? "[&>div]:bg-amber-500" : "")} />
                      </div>
                      <Badge className={cn(
                        m.satisfaction >= 70 ? "status-active" :
                        m.satisfaction >= 50 ? "status-pending" : "status-rejected"
                      )}>
                        {m.satisfaction >= 70 ? "Good" : m.satisfaction >= 50 ? "Fair" : "Low"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
              <Separator className="my-4" />
              <div className="p-4 rounded-lg bg-gradient-to-r from-violet-500/10 to-purple-500/10 text-center">
                <p className="text-sm text-muted-foreground">Overall Journey Score</p>
                <p className="text-4xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent mt-1">
                  {Math.round(stageMetrics.reduce((s, m) => s + m.satisfaction, 0) / stageMetrics.length)}%
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
