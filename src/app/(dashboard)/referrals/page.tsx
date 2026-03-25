"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserPlus, Plus, Search, Clock, CheckCircle2, DollarSign, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useReferralStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";

const STATUS_COLORS: Record<string, string> = {
  submitted: "status-pending",
  interviewing: "status-pending",
  hired: "status-active",
  rejected: "status-rejected",
};

export default function ReferralsPage() {
  const store = useReferralStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.referrals, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (r) =>
        (r.referrerName || "").toLowerCase().includes(q) ||
        (r.candidateName || "").toLowerCase().includes(q) ||
        (r.position || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const hired = items.filter((r) => r.status === "hired").length;
  const pending = items.filter(
    (r) => r.status === "submitted" || r.status === "interviewing"
  ).length;
  const totalBonus = items
    .filter((r) => r.status === "hired")
    .reduce((s, r) => s + (r.bonus || 0), 0);
  const conversionRate =
    items.length > 0 ? Math.round((hired / items.length) * 100) : 0;

  const positionBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((r) => {
      map[r.position || "Other"] = (map[r.position || "Other"] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      referrerName: fd.get("referrer") as string,
      candidateName: fd.get("candidate") as string,
      position: fd.get("position") as string,
      status: "submitted",
      bonus: 0,
      referredDate: new Date().toISOString().split("T")[0],
    };
    try {
      await genericService(COLLECTIONS.referrals).create(data);
      toast.success("Referral submitted!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to submit referral");
    }
  };

  if (loading && !initialized)
    return (
      <div className="p-6">
        <DataLoadingSkeleton />
      </div>
    );

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employee Referrals</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} referrals &middot; {conversionRate}% conversion
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Refer Someone
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Referrals", value: items.length, icon: Users, color: "from-violet-500 to-purple-600" },
          { label: "In Progress", value: pending, icon: Clock, color: "from-amber-500 to-orange-500" },
          { label: "Hired", value: hired, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Bonus Paid", value: `₹${totalBonus.toLocaleString()}`, icon: DollarSign, color: "from-blue-500 to-cyan-500" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("p-3 rounded-xl bg-gradient-to-r text-white", kpi.color)}>
                <kpi.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search referrals..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Referrals</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.referrals} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching referrals found.</p>
          ) : (
            filtered.map((ref) => (
              <Card key={ref.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white")}>
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{ref.candidateName}</p>
                    <p className="text-xs text-muted-foreground">
                      Referred by {ref.referrerName} &middot; {ref.position} &middot; {ref.referredDate}
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[ref.status])}>{ref.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">By Position</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {positionBreakdown.map((p) => (
                    <div key={p.name} className="flex items-center gap-3">
                      <span className="text-sm flex-1">{p.name}</span>
                      <span className="font-semibold">{p.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Status Summary</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Submitted", count: items.filter((r) => r.status === "submitted").length, color: "bg-amber-500" },
                    { label: "Interviewing", count: items.filter((r) => r.status === "interviewing").length, color: "bg-blue-500" },
                    { label: "Hired", count: hired, color: "bg-emerald-500" },
                    { label: "Rejected", count: items.filter((r) => r.status === "rejected").length, color: "bg-red-500" },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center gap-3">
                      <div className={cn("h-3 w-3 rounded-full", s.color)} />
                      <span className="text-sm flex-1">{s.label}</span>
                      <span className="font-semibold">{s.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : (
            <DataEmptyState {...EMPTY_STATES.referrals} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Refer a Candidate</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Your Name</Label><Input name="referrer" required /></div>
              <div><Label>Candidate Name</Label><Input name="candidate" required /></div>
            </div>
            <div><Label>Position</Label><Input name="position" required /></div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">Submit Referral</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
