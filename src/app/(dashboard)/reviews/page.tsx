"use client";

import { useState, useEffect, useMemo } from "react";
import { dateKeyInZone } from "@/lib/date-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Star, Search, Plus, ClipboardList, CheckCircle, Clock, Users, Send, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useGoalStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const REVIEW_STATUSES = ["Draft", "Self-Assessment", "Manager Review", "Calibration", "Completed"];
const RATINGS = [
  { value: 1, label: "Needs Improvement" },
  { value: 2, label: "Below Expectations" },
  { value: 3, label: "Meets Expectations" },
  { value: 4, label: "Exceeds Expectations" },
  { value: 5, label: "Outstanding" },
];
const REVIEW_CATEGORIES = ["Technical Skills", "Communication", "Leadership", "Teamwork", "Problem Solving", "Innovation"];

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button" onClick={() => onChange?.(i)} className="focus:outline-none">
          <Star className={cn("h-4 w-4 transition-colors", i <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
        </button>
      ))}
    </div>
  );
}

export default function ReviewsPage() {
  const store = useGoalStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("cycles");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.goals, store); }, [initialized, store]);

  const reviewGoals = useMemo(() => items.filter(g => g.category === "review" || g.category === "performance"), [items]);

  const filtered = useMemo(() => {
    let result = reviewGoals;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(g => g.title?.toLowerCase().includes(q) || g.employeeId?.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") result = result.filter(g => g.status === statusFilter);
    return result;
  }, [reviewGoals, search, statusFilter]);

  const totalReviews = reviewGoals.length;
  const completed = reviewGoals.filter(g => g.status === "completed" || g.status === "Completed").length;
  const pending = reviewGoals.filter(g => g.status !== "completed" && g.status !== "Completed").length;
  const avgRating = reviewGoals.length > 0 ? (reviewGoals.reduce((s, g) => s + (g.progress || 0), 0) / reviewGoals.length / 20).toFixed(1) : "0";

  const handleSubmitReview = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const totalRatings = Object.values(ratings);
    const avgScore = totalRatings.length > 0 ? Math.round((totalRatings.reduce((a, b) => a + b, 0) / totalRatings.length) * 20) : 0;
    const data = {
      title: `Review: ${fd.get("employeeName") as string}`,
      description: fd.get("comments") as string,
      employeeId: fd.get("employeeName") as string,
      category: "review",
      weight: 100,
      progress: avgScore,
      status: "completed",
      dueDate: dateKeyInZone(new Date()),
    };
    try {
      await genericService(COLLECTIONS.goals).create(data);
      toast.success("Review submitted!");
      setSubmitOpen(false);
      setRatings({});
    } catch { toast.error("Failed to submit review"); }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Performance Reviews</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{totalReviews} reviews &middot; {completed} completed</p>
        </div>
        <Button onClick={() => setSubmitOpen(true)} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"><Plus className="h-4 w-4" />Submit Review</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Reviews", value: totalReviews, icon: ClipboardList, color: "from-violet-500 to-purple-600" },
          { label: "Completed", value: completed, icon: CheckCircle, color: "from-emerald-500 to-green-600" },
          { label: "Pending", value: pending, icon: Clock, color: "from-amber-500 to-orange-500" },
          { label: "Avg Rating", value: `${avgRating}/5`, icon: Star, color: "from-blue-500 to-cyan-500" },
        ].map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-md">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white", kpi.color)}><kpi.icon className="h-5 w-5" /></div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-xl font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="cycles">Review Cycles</TabsTrigger><TabsTrigger value="self">Self-Assessment</TabsTrigger><TabsTrigger value="manager">Manager Review</TabsTrigger><TabsTrigger value="calibration">Calibration</TabsTrigger></TabsList>

        <TabsContent value="cycles" className="mt-4 space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search reviews..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Status</SelectItem>{REVIEW_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.performance} />
          ) : (
            <div className="space-y-3">
              {filtered.map(review => (
                <Card key={review.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white"><Star className="h-5 w-5" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{review.title}</p>
                      <p className="text-xs text-muted-foreground">{review.employeeId} &middot; Due: {review.dueDate}</p>
                    </div>
                    <div className="w-20">
                      <Progress value={review.progress || 0} className="h-1.5" />
                    </div>
                    <StarRating value={Math.round((review.progress || 0) / 20)} />
                    <Badge variant={review.status === "completed" || review.status === "Completed" ? "default" : "secondary"} className="text-xs">{review.status}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="self" className="mt-4">
          <Card className="border-0 shadow-md">
            <CardHeader><CardTitle className="text-lg">Self-Assessment Form</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Rate yourself on the following competencies:</p>
              {REVIEW_CATEGORIES.map(cat => (
                <div key={cat} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
                  <span className="text-sm font-medium">{cat}</span>
                  <StarRating value={ratings[`self_${cat}`] || 0} onChange={v => setRatings(prev => ({ ...prev, [`self_${cat}`]: v }))} />
                </div>
              ))}
              <Textarea placeholder="Additional comments about your performance..." className="mt-3" />
              <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => toast.success("Self-assessment saved")}><Send className="h-4 w-4" />Save Assessment</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manager" className="mt-4">
          <Card className="border-0 shadow-md">
            <CardHeader><CardTitle className="text-lg">Manager Review Form</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Evaluate the employee on the following competencies:</p>
              {REVIEW_CATEGORIES.map(cat => (
                <div key={cat} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
                  <span className="text-sm font-medium">{cat}</span>
                  <StarRating value={ratings[`mgr_${cat}`] || 0} onChange={v => setRatings(prev => ({ ...prev, [`mgr_${cat}`]: v }))} />
                </div>
              ))}
              <Textarea placeholder="Manager feedback and development areas..." className="mt-3" />
              <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => toast.success("Manager review saved")}><Send className="h-4 w-4" />Submit Review</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calibration" className="mt-4">
          <Card className="border-0 shadow-md">
            <CardHeader><CardTitle className="text-lg">Rating Calibration View</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Rating summary across all reviews in this cycle:</p>
                {RATINGS.map(r => {
                  const count = reviewGoals.filter(g => {
                    const rating = Math.round((g.progress || 0) / 20);
                    return rating === r.value;
                  }).length;
                  return (
                    <div key={r.value}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="flex items-center gap-1">{r.value} — {r.label}</span>
                        <span className="font-bold">{count}</span>
                      </div>
                      <Progress value={totalReviews > 0 ? (count / totalReviews) * 100 : 0} className="h-2" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Submit Review Dialog */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Submit Review</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmitReview} className="space-y-4">
            <div><Label>Employee Name</Label><Input name="employeeName" required /></div>
            <div>
              <Label>Competency Ratings</Label>
              <div className="space-y-2 mt-2">
                {REVIEW_CATEGORIES.map(cat => (
                  <div key={cat} className="flex items-center justify-between">
                    <span className="text-sm">{cat}</span>
                    <StarRating value={ratings[cat] || 0} onChange={v => setRatings(prev => ({ ...prev, [cat]: v }))} />
                  </div>
                ))}
              </div>
            </div>
            <div><Label>Comments</Label><Textarea name="comments" rows={3} placeholder="Overall performance comments..." /></div>
            <DialogFooter><Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2"><Send className="h-4 w-4" />Submit</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
