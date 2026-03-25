"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  GraduationCap, Search, Play, Users, Clock, Star,
  BookOpen, Award, TrendingUp, Filter, BarChart3,
  CheckCircle2, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  Tooltip as RTooltip,
} from "recharts";
import { useCourseStore, startSync } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const COURSE_EMOJIS: Record<string, string> = {
  Technical: "💻", Leadership: "🎯", Communication: "💬", Compliance: "📋",
  Safety: "🛡️", "Soft Skills": "🤝", Design: "🎨", Finance: "💰",
  HR: "👥", Management: "📊", Other: "📚",
};
const LEVEL_COLORS: Record<string, string> = {
  Beginner: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Intermediate: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Advanced: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const LEARNING_PATHS = [
  { id: "new-manager", name: "New Manager Path", courses: 5, duration: "40 hrs" },
  { id: "tech-lead", name: "Tech Lead Track", courses: 7, duration: "56 hrs" },
  { id: "compliance", name: "Annual Compliance", courses: 3, duration: "12 hrs" },
  { id: "leadership", name: "Leadership Excellence", courses: 6, duration: "48 hrs" },
];

export default function LMSPage() {
  const store = useCourseStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [tab, setTab] = useState("courses");

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.training, store);
  }, [initialized, store]);

  const categories = useMemo(() => [...new Set(items.map(c => c.category))], [items]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.title?.toLowerCase().includes(q) || c.instructor?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "all") result = result.filter(c => c.category === categoryFilter);
    return result;
  }, [items, search, categoryFilter]);

  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(c => { counts[c.category || "Other"] = (counts[c.category || "Other"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  const levelData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(c => { counts[c.level || "Other"] = (counts[c.level || "Other"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  const handleEnroll = useCallback(async (courseId: string, title: string) => {
    try {
      await genericService(COLLECTIONS.enrollments).create({
        courseId, enrolledAt: new Date().toISOString(), status: "enrolled", progress: 0,
      });
      toast.success(`Enrolled in "${title}"`);
    } catch {
      toast.error("Failed to enroll");
    }
  }, []);

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Learning Management</h1>
          <p className="text-muted-foreground mt-1">Browse and enroll in training courses</p>
        </div>
        <DataEmptyState {...EMPTY_STATES.training} />
      </div>
    );
  }

  const totalEnrolled = items.reduce((s, c) => s + (c.enrolled || 0), 0);
  const totalCompleted = items.reduce((s, c) => s + (c.completed || 0), 0);
  const avgRating = items.length > 0 ? (items.reduce((s, c) => s + (c.rating || 0), 0) / items.length).toFixed(1) : "0";
  const mandatoryCount = items.filter(c => c.mandatory).length;

  const kpis = [
    { label: "Total Courses", value: items.length, icon: BookOpen, gradient: "from-violet-500 to-purple-600" },
    { label: "Total Enrolled", value: totalEnrolled, icon: Users, gradient: "from-blue-500 to-cyan-500" },
    { label: "Completions", value: totalCompleted, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Avg Rating", value: `${avgRating} ★`, icon: Star, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Learning Management</h1>
        <p className="text-muted-foreground mt-1">Browse and enroll in training courses</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{kpi.label}</p><p className="text-2xl font-bold mt-1">{kpi.value}</p></div><div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}><kpi.icon className="h-5 w-5 text-white" /></div></div></CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="paths">Learning Paths</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="courses" className="space-y-4 mt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search courses…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(course => (
              <Card key={course.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-3xl">{COURSE_EMOJIS[course.category] || COURSE_EMOJIS.Other}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{course.title}</p>
                      <p className="text-xs text-muted-foreground">{course.instructor} · {course.duration}</p>
                    </div>
                    {course.mandatory && <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs">Required</Badge>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs">{course.category}</Badge>
                    <Badge className={cn("text-xs", LEVEL_COLORS[course.level] || "bg-gray-100 text-gray-700")}>{course.level}</Badge>
                    <span className="text-xs text-muted-foreground ml-auto">⭐ {course.rating || 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{course.enrolled || 0} enrolled · {course.completed || 0} completed</span>
                  </div>
                  <Button size="sm" className="w-full bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => handleEnroll(course.id, course.title)}>
                    <Play className="h-3.5 w-3.5" /> Enroll
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="paths" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {LEARNING_PATHS.map(path => (
              <Card key={path.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                      <Layers className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold">{path.name}</p>
                      <p className="text-xs text-muted-foreground">{path.courses} courses · {path.duration}</p>
                    </div>
                  </div>
                  <Progress value={0} className="h-2" />
                  <Button size="sm" variant="outline" className="gap-2">
                    <Play className="h-3.5 w-3.5" /> Start Path
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Courses by Category</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={categoryData} cx="50%" cy="50%" outerRadius={90} dataKey="value" nameKey="name" label>
                      {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend />
                    <RTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Courses by Level</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={levelData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" fill="#8b5cf6" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
