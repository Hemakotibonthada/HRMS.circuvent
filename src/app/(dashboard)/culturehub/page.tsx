"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Heart, Star, Award, Search, Plus, Users, Lightbulb, Handshake, Shield, Smile, Trophy, CalendarDays, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFeedbackStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const CORE_VALUES = [
  { name: "Innovation", icon: Lightbulb, color: "from-amber-500 to-orange-500", description: "Pushing boundaries, embracing new ideas" },
  { name: "Collaboration", icon: Handshake, color: "from-blue-500 to-cyan-500", description: "Working together, shared success" },
  { name: "Integrity", icon: Shield, color: "from-emerald-500 to-green-600", description: "Honesty, transparency, doing what's right" },
  { name: "Excellence", icon: Star, color: "from-violet-500 to-purple-600", description: "Striving for the best in everything we do" },
  { name: "Empathy", icon: Heart, color: "from-pink-500 to-rose-600", description: "Understanding, caring for each other" },
];

export default function CultureHubPage() {
  const store = useFeedbackStore();
  const { items, loading, initialized } = store;
  const [tab, setTab] = useState("values");
  const [search, setSearch] = useState("");
  const [kudosOpen, setKudosOpen] = useState(false);

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.feedback, store); }, [initialized, store]);

  const kudos = useMemo(() => items.filter(f => f.category === "kudos" || f.category === "recognition" || f.category === "appreciation"), [items]);

  const filteredKudos = useMemo(() => {
    if (!search) return kudos;
    const q = search.toLowerCase();
    return kudos.filter(k => k.title?.toLowerCase().includes(q) || k.submittedBy?.toLowerCase().includes(q));
  }, [kudos, search]);

  const leaderboard = useMemo(() => {
    const userCounts = new Map<string, number>();
    kudos.forEach(k => {
      const user = k.submittedBy || "Anonymous";
      userCounts.set(user, (userCounts.get(user) || 0) + 1);
    });
    return Array.from(userCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [kudos]);

  const totalKudos = kudos.length;
  const totalUpvotes = items.reduce((s, f) => s + (f.upvotes || 0), 0);
  const uniqueGivers = new Set(kudos.map(k => k.submittedBy)).size;
  const thisMonth = kudos.filter(k => {
    if (!k.createdAt) return false;
    const d = new Date(k.createdAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const handleGiveKudos = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      title: fd.get("title") as string,
      category: "kudos",
      description: fd.get("message") as string,
      submittedBy: fd.get("from") as string,
      status: "active",
      upvotes: 0,
      createdAt: new Date().toISOString(),
    };
    try {
      await genericService(COLLECTIONS.feedback).create(data);
      toast.success("Kudos sent! 🎉");
      setKudosOpen(false);
    } catch { toast.error("Failed to send kudos"); }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Culture Hub</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{totalKudos} kudos given &middot; {uniqueGivers} contributors</p>
        </div>
        <Button onClick={() => setKudosOpen(true)} className="bg-gradient-to-r from-pink-500 to-rose-600 text-white border-0 shadow-md gap-2"><Award className="h-4 w-4" />Give Kudos</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Kudos", value: totalKudos, icon: Award, color: "from-violet-500 to-purple-600" },
          { label: "Total Upvotes", value: totalUpvotes, icon: Smile, color: "from-amber-500 to-orange-500" },
          { label: "This Month", value: thisMonth, icon: CalendarDays, color: "from-blue-500 to-cyan-500" },
          { label: "Contributors", value: uniqueGivers, icon: Users, color: "from-emerald-500 to-green-600" },
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
        <TabsList><TabsTrigger value="values">Core Values</TabsTrigger><TabsTrigger value="kudos">Kudos Wall</TabsTrigger><TabsTrigger value="events">Events</TabsTrigger><TabsTrigger value="leaderboard">Leaderboard</TabsTrigger></TabsList>

        <TabsContent value="values" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {CORE_VALUES.map(value => (
              <Card key={value.name} className="border-0 shadow-md hover:shadow-lg transition-shadow">
                <CardContent className="p-6 text-center">
                  <div className={cn("h-14 w-14 rounded-2xl bg-gradient-to-br mx-auto flex items-center justify-center text-white mb-3", value.color)}>
                    <value.icon className="h-7 w-7" />
                  </div>
                  <h3 className="text-lg font-bold">{value.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{value.description}</p>
                  <Badge variant="secondary" className="mt-3 text-xs">
                    {kudos.filter(k => k.title?.toLowerCase().includes(value.name.toLowerCase())).length} kudos
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="kudos" className="mt-4 space-y-4">
          <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search kudos..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
          {filteredKudos.length === 0 ? (
            <DataEmptyState icon={Award} title="No kudos yet" description="Start recognizing your colleagues for great work!" actionLabel="Give Kudos" onAction={() => setKudosOpen(true)} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredKudos.map(k => (
                <Card key={k.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center text-white"><Award className="h-5 w-5" /></div>
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{k.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{k.description}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs text-muted-foreground">By {k.submittedBy}</span>
                          <div className="flex items-center gap-1"><Smile className="h-3 w-3 text-amber-500" /><span className="text-xs">{k.upvotes || 0}</span></div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          {/*
            Used to list "Town Hall / Fun Friday / Birthday Celebrations / Hackathon"
            with fixed cadences ("Every Friday", "Quarterly") as if this org's actual
            events calendar, when nothing schedules, tracks or confirms any of it —
            every tenant would have seen the same made-up programme. There is a real
            `events` collection (COLLECTIONS.events) but no store or page populates
            it yet, so an honest empty state is the only accurate option here.
          */}
          <DataEmptyState icon={CalendarDays} title="No events tracked yet" description="A company events calendar isn't set up yet, so nothing here reflects your organization's actual schedule." />
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-4">
          {leaderboard.length === 0 ? (
            <DataEmptyState icon={Trophy} title="No leaderboard data" description="Give kudos to populate the leaderboard." />
          ) : (
            <Card className="border-0 shadow-md">
              <CardHeader><CardTitle className="text-lg">Recognition Leaderboard</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {leaderboard.map((entry, idx) => (
                  <div key={entry.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <span className={cn("h-8 w-8 rounded-full flex items-center justify-center font-bold text-sm", idx === 0 ? "bg-amber-100 text-amber-700" : idx === 1 ? "bg-gray-100 text-gray-700" : idx === 2 ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground")}>
                      {idx + 1}
                    </span>
                    <p className="flex-1 text-sm font-semibold">{entry.name}</p>
                    <Badge variant="secondary" className="text-xs">{entry.count} kudos</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Give Kudos Dialog */}
      <Dialog open={kudosOpen} onOpenChange={setKudosOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Give Kudos</DialogTitle></DialogHeader>
          <form onSubmit={handleGiveKudos} className="space-y-4">
            <div><Label>Your Name</Label><Input name="from" required /></div>
            <div><Label>Kudos Title</Label><Input name="title" required placeholder="e.g., Great teamwork on Project X!" /></div>
            <div><Label>Core Value</Label>
              <Select name="value"><SelectTrigger><SelectValue placeholder="Select value" /></SelectTrigger>
                <SelectContent>{CORE_VALUES.map(v => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Message</Label><Textarea name="message" rows={3} placeholder="Describe why this person deserves kudos..." /></div>
            <DialogFooter><Button type="submit" className="bg-gradient-to-r from-pink-500 to-rose-600 text-white border-0 gap-2"><Send className="h-4 w-4" />Send Kudos</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
