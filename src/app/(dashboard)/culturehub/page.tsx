"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Heart, Star, Award, Search, Plus, Users, Lightbulb,
  Handshake, Shield, Smile, Trophy, CalendarDays, Send,
  Sparkles, User, ThumbsUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFeedbackStore, useEmployeeStore, startSync, type FeedbackDoc } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const CORE_VALUES = [
  { name: "Innovation", icon: Lightbulb, color: "from-amber-500 to-orange-500", description: "Pushing boundaries, embracing creative new ideas", points: 50 },
  { name: "Collaboration", icon: Handshake, color: "from-blue-500 to-cyan-500", description: "Working together towards shared organizational success", points: 50 },
  { name: "Integrity", icon: Shield, color: "from-emerald-500 to-green-600", description: "Honesty, transparency, and doing what's right", points: 75 },
  { name: "Excellence", icon: Star, color: "from-violet-500 to-purple-600", description: "Striving for the highest quality in everything we do", points: 100 },
  { name: "Empathy", icon: Heart, color: "from-pink-500 to-rose-600", description: "Understanding, caring, and lifting each other up", points: 50 },
];

export default function CultureHubPage() {
  const store = useFeedbackStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const { items: employees, initialized: empInit } = empStore;

  const [tab, setTab] = useState("values");
  const [search, setSearch] = useState("");
  const [kudosOpen, setKudosOpen] = useState(false);

  // Kudos Form State
  const [recipient, setRecipient] = useState("");
  const [fromUser, setFromUser] = useState("");
  const [selectedValue, setSelectedValue] = useState(CORE_VALUES[0].name);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [pointsBonus, setPointsBonus] = useState(50);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.feedback, store);
    if (!empInit) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empInit, empStore]);

  const kudos = useMemo(() => {
    return items.filter(f => f.category === "kudos" || f.category === "recognition" || f.category === "appreciation" || f.category === "Appreciation");
  }, [items]);

  const filteredKudos = useMemo(() => {
    if (!search) return kudos;
    const q = search.toLowerCase();
    return kudos.filter(k =>
      k.title?.toLowerCase().includes(q) ||
      k.submittedBy?.toLowerCase().includes(q) ||
      k.description?.toLowerCase().includes(q)
    );
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
    if (!recipient.trim() || !message.trim()) {
      toast.error("Please choose a recipient and write a kudos message.");
      return;
    }

    setSubmitting(true);
    const kudosTitle = title.trim() || `Recognition for living our value: ${selectedValue}`;
    const author = fromUser.trim() || (employees[0] ? `${employees[0].firstName} ${employees[0].lastName}` : "Team Member");
    const fullDesc = `To: ${recipient} · Value: ${selectedValue} (+${pointsBonus} pts)\n\n${message.trim()}`;

    const data: Omit<FeedbackDoc, "id"> = {
      title: kudosTitle,
      category: "kudos",
      description: fullDesc,
      submittedBy: author,
      status: "active",
      upvotes: 1,
      createdAt: new Date().toISOString(),
    };

    try {
      const id = await genericService(COLLECTIONS.feedback).create(data as unknown as Record<string, unknown>);
      store.addItem({ ...data, id } as FeedbackDoc);
      toast.success(`Kudos sent to ${recipient}! 🎉`);
      setKudosOpen(false);
      setMessage("");
      setTitle("");
    } catch {
      toast.error("Failed to send kudos");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpvoteKudos = async (id: string, currentVotes: number) => {
    try {
      await genericService(COLLECTIONS.feedback).update(id, { upvotes: (currentVotes || 0) + 1 });
      store.updateItem(id, { upvotes: (currentVotes || 0) + 1 });
      toast.success("Kudos cheered! 👏");
    } catch {
      toast.error("Failed to cheer kudos");
    }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton rows={6} /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Culture &amp; Recognition Hub</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{totalKudos} kudos shared &middot; {uniqueGivers} active contributors</p>
        </div>
        <Button
          onClick={() => {
            if (employees.length > 0 && !fromUser) {
              setFromUser([employees[0].firstName, employees[0].lastName].filter(Boolean).join(" "));
            }
            setKudosOpen(true);
          }}
          className="bg-gradient-to-r from-pink-500 to-rose-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
        >
          <Award className="h-4 w-4" /> Give Kudos
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Kudos Given", value: totalKudos, icon: Award, color: "from-pink-500 to-rose-600", sub: "Peer recognitions" },
          { label: "Total Cheers & Likes", value: totalUpvotes, icon: Smile, color: "from-amber-500 to-orange-500", sub: "Community praise" },
          { label: "Given This Month", value: thisMonth, icon: CalendarDays, color: "from-blue-500 to-cyan-500", sub: "Monthly momentum" },
          { label: "Team Contributors", value: uniqueGivers, icon: Users, color: "from-emerald-500 to-green-600", sub: "Active recognition" },
        ].map(kpi => (
          <Card key={kpi.label} className="border shadow-xs">
            <CardContent className="p-4 flex items-center gap-3.5">
              <div className={cn("p-3 rounded-xl bg-gradient-to-br text-white", kpi.color)}>
                <kpi.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="values">Core Values</TabsTrigger>
          <TabsTrigger value="kudos">Kudos Wall</TabsTrigger>
          <TabsTrigger value="leaderboard">Recognition Leaderboard</TabsTrigger>
        </TabsList>

        {/* Core Values Tab */}
        <TabsContent value="values" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {CORE_VALUES.map(value => {
              const count = kudos.filter(k => k.description?.toLowerCase().includes(value.name.toLowerCase()) || k.title?.toLowerCase().includes(value.name.toLowerCase())).length;
              return (
                <Card key={value.name} className="hover:shadow-md transition-shadow border">
                  <CardContent className="p-6 text-center">
                    <div className={cn("h-14 w-14 rounded-2xl bg-gradient-to-br mx-auto flex items-center justify-center text-white mb-3 shadow-md", value.color)}>
                      <value.icon className="h-7 w-7" />
                    </div>
                    <h3 className="text-lg font-bold text-foreground">{value.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{value.description}</p>
                    <div className="flex items-center justify-center gap-2 mt-4">
                      <Badge variant="secondary" className="text-[11px] font-semibold">
                        {count} Recognitions
                      </Badge>
                      <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-[10px]">
                        +{value.points} pts
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Kudos Wall Tab */}
        <TabsContent value="kudos" className="mt-4 space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search kudos by teammate, value, or message..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-xs h-9" />
          </div>

          {filteredKudos.length === 0 ? (
            <DataEmptyState icon={Award} title="No kudos yet" description="Start recognizing your colleagues for great work and living company values!" actionLabel="Give Kudos" onAction={() => setKudosOpen(true)} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredKudos.map(k => (
                <Card key={k.id} className="hover:shadow-sm transition-all border">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center text-white shrink-0 shadow-xs">
                        <Heart className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-foreground">{k.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap leading-relaxed">{k.description}</p>
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">From: {k.submittedBy}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUpvoteKudos(k.id, k.upvotes || 0)}
                            className="h-7 px-2.5 rounded-full text-xs hover:bg-pink-50 dark:hover:bg-pink-950/40 text-pink-600 dark:text-pink-400 gap-1.5"
                          >
                            <Smile className="h-3.5 w-3.5 text-pink-500" />
                            <span className="font-bold">{k.upvotes || 1} Cheers</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Leaderboard Tab */}
        <TabsContent value="leaderboard" className="mt-4">
          {leaderboard.length === 0 ? (
            <DataEmptyState icon={Trophy} title="No leaderboard data" description="Give kudos to populate the company culture leaderboard." />
          ) : (
            <Card className="border">
              <CardHeader><CardTitle className="text-base font-bold">Top Recognition Champions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {leaderboard.map((entry, idx) => (
                  <div key={entry.name} className="flex items-center gap-3 p-2.5 rounded-xl border bg-muted/20 hover:bg-muted/40 transition-colors">
                    <span className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0",
                      idx === 0 ? "bg-amber-500 text-white shadow-xs" :
                      idx === 1 ? "bg-slate-400 text-white shadow-xs" :
                      idx === 2 ? "bg-amber-700 text-white shadow-xs" :
                      "bg-muted text-muted-foreground"
                    )}>
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{entry.name}</p>
                      <p className="text-[11px] text-muted-foreground">Culture Champion</p>
                    </div>
                    <Badge variant="outline" className="text-xs font-bold text-pink-600 dark:text-pink-400">
                      {entry.count} Kudos Sent
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ENHANCED GIVE KUDOS DIALOG */}
      <Dialog open={kudosOpen} onOpenChange={setKudosOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-md">
                <Heart className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Send Peer Recognition &amp; Kudos</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Celebrate teammates living our company values with recognition points.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleGiveKudos} className="space-y-4 mt-2">
            {/* Recipient Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-pink-500" />
                Select Colleague to Recognize <span className="text-destructive">*</span>
              </Label>
              {employees && employees.length > 0 ? (
                <Select value={recipient} onValueChange={setRecipient}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Choose colleague..." />
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
                  placeholder="Colleague full name"
                  value={recipient}
                  onChange={e => setRecipient(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              )}
            </div>

            {/* Core Value Selection Cards */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Associated Core Value</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CORE_VALUES.map(v => {
                  const Icon = v.icon;
                  const active = selectedValue === v.name;
                  return (
                    <button
                      key={v.name}
                      type="button"
                      onClick={() => {
                        setSelectedValue(v.name);
                        setPointsBonus(v.points);
                      }}
                      className={cn(
                        "p-2.5 rounded-lg border text-left transition-all cursor-pointer",
                        active
                          ? "bg-pink-50 dark:bg-pink-950/40 border-pink-500 text-pink-700 dark:text-pink-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Icon className={cn("h-4 w-4", active ? "text-pink-600" : "text-muted-foreground")} />
                        <span className="text-[10px] font-bold px-1 rounded bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300">
                          +{v.points} pts
                        </span>
                      </div>
                      <p className="font-bold text-xs text-foreground truncate">{v.name}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title / Headline */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Kudos Title / Headline (Optional)</Label>
              <Input
                placeholder="e.g. Exceptional teamwork launching the Q3 sprint!"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            {/* Message */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Appreciation Note &amp; Impact <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="Share what they did, how they embodied this value, and the positive impact on the team..."
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={3}
                className="text-xs resize-none"
                required
              />
            </div>

            {/* Sender / From */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">From (Your Name)</Label>
              <Input
                placeholder="Your name"
                value={fromUser}
                onChange={e => setFromUser(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button type="button" variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setKudosOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-gradient-to-r from-pink-500 to-rose-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all gap-1.5">
                <Send className="h-4 w-4" /> {submitting ? "Broadcasting…" : "Send Recognition"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
