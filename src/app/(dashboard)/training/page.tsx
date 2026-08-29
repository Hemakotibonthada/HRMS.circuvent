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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  GraduationCap, Plus, Search, CheckCircle2, Clock, Star, TrendingUp,
  BookOpen, Users, Play, Award, Filter, Eye, Calendar,
  Layers, Zap, Target, BarChart3, FileText, Video, Headphones,
  ChevronRight, ExternalLink, Heart, Sparkles, User, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip,
} from "recharts";
import { useCourseStore, useEmployeeStore, startSync, type CourseDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// TRAINING — LMS with course catalog, learning paths,
// certification tracker, enrollment, and training analytics
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const COURSE_CATEGORIES = ["Technical", "Leadership", "Compliance", "Soft Skills", "Product", "Security", "Design", "Data"];
const LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"];
const TYPES = ["Online", "Classroom", "Workshop", "Webinar", "Self-paced"];
const COURSE_EMOJIS: Record<string, string> = {
  Technical: "💻", Leadership: "🎯", Compliance: "📋", "Soft Skills": "🤝",
  Product: "📦", Security: "🔒", Design: "🎨", Data: "📊",
};
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  upcoming: { label: "Upcoming", className: "status-pending" },
  completed: { label: "Completed", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  draft: { label: "Draft", className: "status-inactive" },
};
const LEVEL_CONF: Record<string, string> = {
  Beginner: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Intermediate: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Advanced: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Expert: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export default function TrainingPage() {
  const rbac = useRBAC();
  const store = useCourseStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const { items: employees, initialized: empInit } = empStore;

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [tab, setTab] = useState("catalog");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<CourseDoc | null>(null);
  const [form, setForm] = useState({
    title: "", category: "Technical", type: "Self-paced", instructor: "", duration: "4h 00m",
    level: "Beginner", description: "", mandatory: false,
  });

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.training, store);
    if (!empInit) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empInit, empStore]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.title?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q) ||
        c.instructor?.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "all") result = result.filter(c => c.category === categoryFilter);
    if (levelFilter !== "all") result = result.filter(c => c.level === levelFilter);
    return result;
  }, [items, search, categoryFilter, levelFilter]);

  // KPIs
  const totalCourses = items.length;
  const totalEnrollments = items.reduce((s, c) => s + (c.enrolled || 0), 0);
  const completionRate = totalEnrollments > 0
    ? Math.round((items.reduce((s, c) => s + (c.completed || 0), 0) / totalEnrollments) * 100)
    : 0;
  const certifications = items.filter(c => c.status === "completed" && c.mandatory).length;

  // Category distribution
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(c => {
      counts[c.category || "Other"] = (counts[c.category || "Other"] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Level distribution
  const levelData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(c => {
      counts[c.level || "Beginner"] = (counts[c.level || "Beginner"] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Enrollment trend
  const enrollmentData = useMemo(() => {
    return items.slice(0, 8).map(c => ({
      name: c.title?.slice(0, 15) || "Course",
      enrolled: c.enrolled || 0,
      completed: c.completed || 0,
    }));
  }, [items]);

  const resetForm = () => setForm({ title: "", category: "", type: "", instructor: "", duration: "", level: "", description: "", mandatory: false });

  const handleCreate = async () => {
    if (!form.title || !form.category) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.training).create({
        ...form,
        status: "active",
        enrolled: 0,
        completed: 0,
        rating: 0,
      });
      toast.success(`Course "${form.title}" created!`);
      setCreateOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to create course");
    }
  };

  const handleEnroll = async (courseId: string) => {
    try {
      const course = items.find(c => c.id === courseId);
      if (!course) return;
      await genericService(COLLECTIONS.training).update(courseId, {
        enrolled: (course.enrolled || 0) + 1,
      });
      toast.success("Enrolled successfully!");
    } catch {
      toast.error("Failed to enroll");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.training} onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Courses", value: totalCourses, icon: BookOpen, gradient: "from-violet-500 to-purple-600" },
    { label: "Enrollments", value: totalEnrollments, icon: Users, gradient: "from-blue-500 to-cyan-500" },
    { label: "Completion Rate", value: `${completionRate}%`, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Certifications", value: certifications, icon: Award, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Training</h1>
          <p className="text-muted-foreground mt-1">Browse courses, track learning, and earn certifications</p>
        </div>
        {rbac.can("training.manage") && (
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Course
          </Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search courses, skills..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {COURSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Level" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            {LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="learning">My Learning</TabsTrigger>
          <TabsTrigger value="certifications">Certifications</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Catalog Tab */}
        <TabsContent value="catalog" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.training} compact onAction={() => setCreateOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((course) => {
                const emoji = COURSE_EMOJIS[course.category] || "📚";
                const st = STATUS_CONF[course.status] || STATUS_CONF.active;
                const lvl = LEVEL_CONF[course.level] || LEVEL_CONF.Beginner;
                return (
                  <Card key={course.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer group" onClick={() => setSelectedCourse(course)}>
                    <CardContent className="p-0">
                      <div className="h-32 bg-gradient-to-br from-violet-500/20 to-purple-500/20 rounded-t-xl flex items-center justify-center text-5xl">
                        {emoji}
                      </div>
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm flex-1 truncate">{course.title}</h3>
                          {course.mandatory && <Badge variant="outline" className="text-[10px] shrink-0">Required</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{course.instructor || "Unknown Instructor"}</p>
                        <div className="flex items-center gap-2 mb-3">
                          <Badge className={lvl}>{course.level || "Beginner"}</Badge>
                          <Badge variant="outline" className="text-xs">{course.type || "Online"}</Badge>
                          <span className="text-xs text-muted-foreground ml-auto">{course.duration || "1h"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star key={i} className={cn("h-3 w-3", i < (course.rating || 0) ? "text-amber-500 fill-amber-500" : "text-gray-300")} />
                            ))}
                            <span className="text-xs text-muted-foreground ml-1">{course.rating || 0}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{course.enrolled || 0} enrolled</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* My Learning Tab */}
        <TabsContent value="learning" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Learning Paths</CardTitle></CardHeader>
            <CardContent>
              {["Full-Stack Development", "Cloud Architecture", "Leadership Essentials"].map((path, i) => (
                <div key={path} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 mb-2 last:mb-0">
                  <div className="flex items-center gap-3">
                    <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", ["from-violet-500 to-purple-600", "from-blue-500 to-cyan-500", "from-amber-500 to-orange-500"][i])}>
                      <Layers className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{path}</p>
                      <p className="text-xs text-muted-foreground">{3 + i} courses · {10 + i * 5}h total</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={30 + i * 25} className="w-24 h-2" />
                    <span className="text-xs font-medium">{30 + i * 25}%</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">In Progress</CardTitle></CardHeader>
            <CardContent>
              {items.filter(c => c.status === "active").length === 0 ? (
                <DataEmptyState title="No courses in progress" description="Enroll in courses to start learning." compact />
              ) : (
                <div className="space-y-3">
                  {items.filter(c => c.status === "active").slice(0, 5).map((course) => (
                    <div key={course.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{COURSE_EMOJIS[course.category] || "📚"}</span>
                        <div>
                          <p className="font-medium text-sm">{course.title}</p>
                          <p className="text-xs text-muted-foreground">{course.instructor} · {course.duration}</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="gap-1">
                        <Play className="h-3 w-3" /> Continue
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Certifications Tab */}
        <TabsContent value="certifications" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Certification Tracker</CardTitle></CardHeader>
            <CardContent>
              {items.filter(c => c.mandatory).length === 0 ? (
                <DataEmptyState title="No certifications required" description="Mandatory courses with certifications will appear here." compact />
              ) : (
                <div className="space-y-3">
                  {items.filter(c => c.mandatory).map((course) => (
                    <div key={course.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                          <Award className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{course.title}</p>
                          <p className="text-xs text-muted-foreground">{course.category} · Required</p>
                        </div>
                      </div>
                      <Badge className={course.completed > 0 ? "status-active" : "status-pending"}>
                        {course.completed > 0 ? "Certified" : "Pending"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Courses by Category</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Enrollment vs Completion</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={enrollmentData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Legend />
                    <Bar dataKey="enrolled" name="Enrolled" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Course Detail Dialog */}
      <Dialog open={!!selectedCourse} onOpenChange={(v) => { if (!v) setSelectedCourse(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedCourse && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="text-2xl">{COURSE_EMOJIS[selectedCourse.category] || "📚"}</span>
                  {selectedCourse.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className={(STATUS_CONF[selectedCourse.status] || STATUS_CONF.active).className}>
                    {(STATUS_CONF[selectedCourse.status] || STATUS_CONF.active).label}
                  </Badge>
                  <Badge className={LEVEL_CONF[selectedCourse.level] || LEVEL_CONF.Beginner}>{selectedCourse.level || "Beginner"}</Badge>
                  <Badge variant="outline">{selectedCourse.type || "Online"}</Badge>
                  {selectedCourse.mandatory && <Badge variant="outline">Mandatory</Badge>}
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Instructor</p><p className="font-medium">{selectedCourse.instructor || "TBA"}</p></div>
                  <div><p className="text-muted-foreground">Duration</p><p className="font-medium">{selectedCourse.duration || "N/A"}</p></div>
                  <div><p className="text-muted-foreground">Enrolled</p><p className="font-medium">{selectedCourse.enrolled || 0}</p></div>
                  <div><p className="text-muted-foreground">Completed</p><p className="font-medium">{selectedCourse.completed || 0}</p></div>
                </div>
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={cn("h-4 w-4", i < (selectedCourse.rating || 0) ? "text-amber-500 fill-amber-500" : "text-gray-300")} />
                    ))}
                    <span className="text-sm ml-1">{selectedCourse.rating || 0}/5</span>
                  </div>
                </div>
                <Separator />
                <div>
                  <h4 className="font-semibold text-sm mb-2">Course Modules</h4>
                  <div className="space-y-2">
                    {["Introduction", "Core Concepts", "Hands-on Practice", "Advanced Topics", "Assessment"].map((mod, i) => (
                      <div key={mod} className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/30">
                        <div className="h-6 w-6 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-xs font-medium text-violet-700 dark:text-violet-400">
                          {i + 1}
                        </div>
                        <span>{mod}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter className="pt-2 gap-2">
                <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setSelectedCourse(null)}>Close</Button>
                <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg gap-1.5" onClick={() => { handleEnroll(selectedCourse.id); setSelectedCourse(null); }}>
                  <Play className="h-4 w-4" /> Enroll Now
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ENHANCED CREATE COURSE DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <GraduationCap className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Publish Learning Course</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Create skill paths, mandatory compliance trainings, or technical workshops.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Course Title <span className="text-destructive">*</span></Label>
              <Input
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Full-Stack Next.js 15 &amp; TypeScript Masterclass"
                className="h-9 text-xs"
                required
              />
            </div>

            {/* Category Selector Pills */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Subject Category <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {COURSE_CATEGORIES.map(cat => {
                  const active = form.category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, category: cat }))}
                      className={cn(
                        "p-2 rounded-lg border text-center transition-all cursor-pointer",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 font-bold shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <span className="text-xs">{COURSE_EMOJIS[cat] || "📚"} {cat}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Skill Level</Label>
                <Select value={form.level} onValueChange={(v) => setForm(f => ({ ...f, level: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEVELS.map(l => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Delivery Format</Label>
                <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Estimated Duration</Label>
                <Input
                  value={form.duration}
                  onChange={(e) => setForm(f => ({ ...f, duration: e.target.value }))}
                  placeholder="e.g. 4h 30m"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-violet-500" />
                Course Instructor / Lead Trainer
              </Label>
              {employees && employees.length > 0 ? (
                <Select value={form.instructor} onValueChange={v => setForm(f => ({ ...f, instructor: v }))}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select internal trainer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map(emp => {
                      const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || String(emp.id);
                      const sub = [emp.designation, emp.department].filter(Boolean).join(" · ");
                      return (
                        <SelectItem key={emp.id} value={name} className="text-xs">
                          <span className="font-medium">{name}</span>
                          {sub ? <span className="text-muted-foreground ml-2 text-[11px]">({sub})</span> : null}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.instructor}
                  onChange={(e) => setForm(f => ({ ...f, instructor: e.target.value }))}
                  placeholder="Instructor or academy name"
                  className="h-9 text-xs"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Syllabus Overview &amp; Learning Objectives</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Detail the target outcomes, prerequisites, and curriculum outline..."
                rows={3}
                className="text-xs resize-none"
              />
            </div>

            <div className="p-3 rounded-lg border bg-muted/20 flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Award className="h-3.5 w-3.5 text-amber-500" /> Mandatory Compliance Training
                </p>
                <p className="text-[10px] text-muted-foreground">Enforces automated completion tracking for all staff</p>
              </div>
              <Switch checked={form.mandatory} onCheckedChange={v => setForm(f => ({ ...f, mandatory: v }))} />
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all gap-1.5" onClick={handleCreate}>
              <Send className="h-4 w-4" /> Publish Course
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
