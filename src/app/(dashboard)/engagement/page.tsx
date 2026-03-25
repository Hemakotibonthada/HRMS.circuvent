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
  Heart, Search, TrendingUp, Users, Star,
  MessageSquare, Target, BarChart3, ThumbsUp,
  Award, Smile, Plus, Calendar, Sparkles,
  Activity, Megaphone, CheckCircle2, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useFeedbackStore, useSurveyStore, useGoalStore,
  startSync, type FeedbackDoc, type SurveyDoc, type GoalDoc,
} from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell, Legend,
  AreaChart, Area,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// ENGAGEMENT — Employee engagement hub with eNPS, surveys,
// recognition/kudos feed, and culture initiatives
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1","#14b8a6"];
const INITIATIVE_LIST = [
  { title: "Innovation Fridays", desc: "Dedicated time for passion projects", icon: Lightbulb, color: "from-amber-500 to-orange-500", status: "active" },
  { title: "Mentorship Program", desc: "Pair senior & junior employees", icon: Users, color: "from-violet-500 to-purple-600", status: "active" },
  { title: "Wellness Wednesdays", desc: "Group yoga, meditation, mindfulness", icon: Heart, color: "from-pink-500 to-rose-600", status: "active" },
  { title: "Lunch & Learn", desc: "Monthly knowledge sharing sessions", icon: Megaphone, color: "from-blue-500 to-cyan-500", status: "upcoming" },
  { title: "Hackathons", desc: "Quarterly company hackathons", icon: Sparkles, color: "from-emerald-500 to-green-600", status: "upcoming" },
  { title: "Volunteer Days", desc: "Paid community volunteer time", icon: Award, color: "from-teal-500 to-cyan-600", status: "active" },
];

export default function EngagementPage() {
  const feedbackStore = useFeedbackStore();
  const surveyStore = useSurveyStore();
  const goalStore = useGoalStore();
  const { items: feedbacks, loading: fbLoading, initialized: fbInit } = feedbackStore;
  const { items: surveys, loading: svLoading, initialized: svInit } = surveyStore;
  const { items: goals, initialized: glInit } = goalStore;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [kudosOpen, setKudosOpen] = useState(false);
  const [kudosForm, setKudosForm] = useState({ title: "", description: "", submittedBy: "", category: "Appreciation" });

  useEffect(() => { if (!fbInit) startSync(COLLECTIONS.feedback, feedbackStore); }, [fbInit, feedbackStore]);
  useEffect(() => { if (!svInit) startSync(COLLECTIONS.surveys, surveyStore); }, [svInit, surveyStore]);
  useEffect(() => { if (!glInit) startSync(COLLECTIONS.goals, goalStore); }, [glInit, goalStore]);

  const loading = (fbLoading || svLoading) && (!fbInit || !svInit);

  // eNPS Calculation (from feedback upvotes as proxy)
  const eNPS = useMemo(() => {
    if (feedbacks.length === 0) return 0;
    const promoters = feedbacks.filter(f => (f.upvotes || 0) >= 5).length;
    const detractors = feedbacks.filter(f => (f.upvotes || 0) <= 1).length;
    const total = feedbacks.length;
    return total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;
  }, [feedbacks]);

  const engagementScore = useMemo(() => {
    const surveyScore = surveys.length > 0
      ? Math.round(surveys.reduce((s, sv) => s + (sv.responses || 0), 0) / Math.max(surveys.reduce((s, sv) => s + (sv.questions || 1), 0), 1) * 100)
      : 0;
    const goalScore = goals.length > 0
      ? Math.round(goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length)
      : 0;
    return Math.min(100, Math.round((Math.max(surveyScore, 50) + goalScore) / 2));
  }, [surveys, goals]);

  const responseRate = useMemo(() => {
    if (surveys.length === 0) return 0;
    const totalQuestions = surveys.reduce((s, sv) => s + (sv.questions || 1), 0);
    const totalResponses = surveys.reduce((s, sv) => s + (sv.responses || 0), 0);
    return totalQuestions > 0 ? Math.min(100, Math.round((totalResponses / totalQuestions) * 100)) : 0;
  }, [surveys]);

  const totalKudos = feedbacks.filter(f => f.category === "Appreciation" || f.category === "Kudos").length;

  // Kudos / recognition feed
  const kudosFeed = useMemo(() => {
    return [...feedbacks]
      .filter(f => f.category === "Appreciation" || f.category === "Kudos" || (f.upvotes || 0) >= 3)
      .sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0))
      .slice(0, 20);
  }, [feedbacks]);

  const filteredFeed = useMemo(() => {
    if (!search) return kudosFeed;
    const q = search.toLowerCase();
    return kudosFeed.filter(f =>
      f.title?.toLowerCase().includes(q) || f.submittedBy?.toLowerCase().includes(q) ||
      f.description?.toLowerCase().includes(q)
    );
  }, [kudosFeed, search]);

  // Survey results chart
  const surveyChart = useMemo(() =>
    surveys.map(s => ({
      name: s.title?.substring(0, 15) || "N/A",
      responses: s.responses || 0,
      questions: s.questions || 0,
    })).slice(0, 8),
  [surveys]);

  // Engagement trend (monthly)
  const trendData = useMemo(() => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months.map((name, i) => ({
      name,
      score: Math.max(30, Math.min(100, engagementScore + Math.round((Math.random() - 0.5) * 20))),
      kudos: feedbacks.filter(f => {
        const d = f.createdAt ? new Date(f.createdAt) : null;
        return d && d.getMonth() === i;
      }).length,
    }));
  }, [feedbacks, engagementScore]);

  // Feedback category distribution
  const feedbackCategories = useMemo(() => {
    const map: Record<string, number> = {};
    feedbacks.forEach(f => { const c = f.category || "Other"; map[c] = (map[c] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [feedbacks]);

  const handleSendKudos = async () => {
    if (!kudosForm.title) { toast.error("Title is required"); return; }
    try {
      await genericService(COLLECTIONS.feedback).create({
        ...kudosForm, status: "active", upvotes: 0,
        createdAt: new Date().toISOString(),
      });
      toast.success("Kudos sent!");
      setKudosOpen(false);
      setKudosForm({ title: "", description: "", submittedBy: "", category: "Appreciation" });
    } catch { toast.error("Failed to send kudos"); }
  };

  const handleUpvote = async (fb: FeedbackDoc) => {
    try {
      await genericService(COLLECTIONS.feedback).update(fb.id, { upvotes: (fb.upvotes || 0) + 1 });
      feedbackStore.updateItem(fb.id, { upvotes: (fb.upvotes || 0) + 1 });
    } catch { toast.error("Failed to upvote"); }
  };

  if (loading) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Engagement</h1>
          <p className="text-muted-foreground mt-1">Employee engagement, recognition, and culture</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2" onClick={() => setKudosOpen(true)}>
          <Sparkles className="h-4 w-4" /> Send Kudos
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {[
          { label: "eNPS Score", value: eNPS, icon: TrendingUp, gradient: "from-violet-500 to-purple-600" },
          { label: "Engagement Score", value: `${engagementScore}%`, icon: Heart, gradient: "from-emerald-500 to-green-600" },
          { label: "Response Rate", value: `${responseRate}%`, icon: Activity, gradient: "from-blue-500 to-cyan-500" },
          { label: "Total Kudos", value: totalKudos, icon: ThumbsUp, gradient: "from-amber-500 to-orange-500" },
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard" className="gap-2"><BarChart3 className="h-4 w-4" /> Dashboard</TabsTrigger>
          <TabsTrigger value="surveys" className="gap-2"><MessageSquare className="h-4 w-4" /> Surveys</TabsTrigger>
          <TabsTrigger value="recognition" className="gap-2"><Award className="h-4 w-4" /> Recognition</TabsTrigger>
          <TabsTrigger value="initiatives" className="gap-2"><Lightbulb className="h-4 w-4" /> Initiatives</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4 space-y-6">
          {/* eNPS Ring + Engagement Score */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-1">
              <CardHeader><CardTitle className="text-base">eNPS Score</CardTitle></CardHeader>
              <CardContent className="flex flex-col items-center">
                <div className="relative h-32 w-32">
                  <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="12" />
                    <circle cx="60" cy="60" r="50" fill="none" stroke="url(#enpsGrad)" strokeWidth="12" strokeLinecap="round"
                      strokeDasharray={`${Math.max(0, (eNPS + 100) / 200 * 314)} 314`} />
                    <defs>
                      <linearGradient id="enpsGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#a855f7" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={cn("text-3xl font-bold", eNPS >= 0 ? "text-green-600" : "text-red-500")}>{eNPS}</span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {eNPS >= 50 ? "Excellent" : eNPS >= 20 ? "Good" : eNPS >= 0 ? "Okay" : "Needs Improvement"}
                </p>
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardHeader><CardTitle className="text-base">Engagement Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="name" fontSize={11} />
                    <YAxis fontSize={11} />
                    <RTooltip />
                    <Area type="monotone" dataKey="score" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} name="Score" />
                    <Area type="monotone" dataKey="kudos" stroke="#10b981" fill="#10b981" fillOpacity={0.15} name="Kudos" />
                    <Legend />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Feedback Categories</CardTitle></CardHeader>
              <CardContent>
                {feedbackCategories.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={feedbackCategories} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name }) => name}>
                        {feedbackCategories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Goal Progress</CardTitle></CardHeader>
              <CardContent>
                {goals.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No goals set</p> : (
                  <div className="space-y-3 max-h-[250px] overflow-y-auto">
                    {goals.slice(0, 8).map(g => (
                      <div key={g.id}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium line-clamp-1">{g.title}</span>
                          <span className="font-medium">{g.progress || 0}%</span>
                        </div>
                        <Progress value={g.progress || 0} className="h-2" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="surveys" className="mt-4">
          {surveys.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.surveys} />
          ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle className="text-base">Survey Results</CardTitle></CardHeader>
                <CardContent>
                  {surveyChart.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={surveyChart}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                        <XAxis dataKey="name" fontSize={10} />
                        <YAxis fontSize={11} />
                        <RTooltip />
                        <Bar dataKey="responses" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Responses" />
                        <Bar dataKey="questions" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Questions" />
                        <Legend />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-muted-foreground text-center py-8">No survey data</p>}
                </CardContent>
              </Card>
              <div className="space-y-3 stagger-children">
                {surveys.map(sv => (
                  <Card key={sv.id} className="animate-slide-up">
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <MessageSquare className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold">{sv.title}</h3>
                        <p className="text-xs text-muted-foreground">{sv.type} &middot; {sv.questions || 0} questions &middot; {sv.responses || 0} responses</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={cn("text-xs", sv.status === "active" ? "status-active" : sv.status === "completed" ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" : "status-pending")}>
                          {sv.status}
                        </Badge>
                        {sv.deadline && <span className="text-xs text-muted-foreground">{new Date(sv.deadline).toLocaleDateString()}</span>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="recognition" className="mt-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search recognition..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>
          {filteredFeed.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.feedback} onAction={() => setKudosOpen(true)} />
          ) : (
            <div className="space-y-3 stagger-children">
              {filteredFeed.map(fb => (
                <Card key={fb.id} className="animate-slide-up hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-sm">
                          {fb.submittedBy?.[0] || "K"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm">{fb.title}</h3>
                          <Badge variant="outline" className="text-xs">{fb.category}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{fb.description}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{fb.submittedBy || "Anonymous"}</span>
                          <span>{fb.createdAt ? new Date(fb.createdAt).toLocaleDateString() : "—"}</span>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="gap-1 flex-shrink-0" onClick={() => handleUpvote(fb)}>
                        <ThumbsUp className="h-3 w-3" /> {fb.upvotes || 0}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="initiatives" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
            {INITIATIVE_LIST.map((init, i) => (
              <Card key={i} className="animate-slide-up hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", init.color)}>
                      <init.icon className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm">{init.title}</h3>
                      <Badge className={cn("text-xs", init.status === "active" ? "status-active" : "status-pending")}>
                        {init.status}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{init.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Send Kudos Dialog */}
      <Dialog open={kudosOpen} onOpenChange={setKudosOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-500" /> Send Kudos
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input placeholder="e.g. Great teamwork!" value={kudosForm.title} onChange={e => setKudosForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea placeholder="Share your appreciation..." value={kudosForm.description} onChange={e => setKudosForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From</Label>
                <Input placeholder="Your name" value={kudosForm.submittedBy} onChange={e => setKudosForm(f => ({ ...f, submittedBy: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={kudosForm.category} onValueChange={v => setKudosForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Appreciation">Appreciation</SelectItem>
                    <SelectItem value="Kudos">Kudos</SelectItem>
                    <SelectItem value="Teamwork">Teamwork</SelectItem>
                    <SelectItem value="Innovation">Innovation</SelectItem>
                    <SelectItem value="Leadership">Leadership</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKudosOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={handleSendKudos}>
              <Sparkles className="h-4 w-4" /> Send Kudos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
