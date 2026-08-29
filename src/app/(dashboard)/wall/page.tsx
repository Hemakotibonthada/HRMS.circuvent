"use client";

import { useState, useEffect, useMemo } from "react";
import { create } from "zustand";
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
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare, Plus, Search, Heart, Share2, Send,
  Image, Hash, TrendingUp, Users, ThumbsUp, Smile,
  MoreHorizontal, Clock, Star, Flame, Sparkles, User, Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { useEmployeeStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { useNowMs } from "@/hooks/use-now";

// ═══════════════════════════════════════════════════════════════
// WALL — Employee engagement social wall
// ═══════════════════════════════════════════════════════════════

interface WallPost {
  id: string;
  author: string;
  department: string;
  content: string;
  tags: string[];
  likes: number;
  comments: number;
  shares: number;
  createdAt: string;
  liked: boolean;
  type: "post" | "achievement" | "welcome" | "announcement";
}

interface WallStore {
  items: WallPost[];
  loading: boolean;
  error: string | null;
  addItem: (item: WallPost) => void;
  updateItem: (id: string, updates: Partial<WallPost>) => void;
  removeItem: (id: string) => void;
  setItems: (items: WallPost[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const useWallStore = create<WallStore>((set) => ({
  items: [],
  loading: false,
  error: null,
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) => set((s) => ({
    items: s.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
  })),
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  setItems: (items) => set({ items, loading: false }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const POST_TYPES = ["post", "achievement", "welcome", "announcement"];
const TYPE_ICONS: Record<string, typeof MessageSquare> = {
  post: MessageSquare, achievement: Star, welcome: Users, announcement: Flame,
};
const TYPE_COLORS: Record<string, string> = {
  post: "from-blue-500 to-cyan-500", achievement: "from-amber-500 to-orange-500",
  welcome: "from-emerald-500 to-green-600", announcement: "from-violet-500 to-purple-600",
};

export default function WallPage() {
  const nowMs = useNowMs();
  const store = useWallStore();
  const empStore = useEmployeeStore();
  const { items: posts, loading } = store;
  const { items: employees, initialized: empInit } = empStore;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("feed");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    author: "", department: "Engineering", content: "", tags: "", type: "post",
  });
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized) {
      store.setLoading(true);
      genericService("socialPosts").getAll().then((data) => {
        store.setItems(data as unknown as WallPost[]);
        setInitialized(true);
      }).catch(() => {
        store.setError("Failed to load posts");
        store.setLoading(false);
        setInitialized(true);
      });
    }
    if (!empInit) startSync(COLLECTIONS.employees, empStore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, empInit]);

  // KPIs
  const totalPosts = posts.length;
  const totalLikes = posts.reduce((s, p) => s + (p.likes || 0), 0);
  const activeUsers = new Set(posts.map(p => p.author)).size;
  const engagementRate = totalPosts > 0
    ? Math.round((totalLikes + posts.reduce((s, p) => s + (p.comments || 0), 0)) / totalPosts * 10) / 10
    : 0;

  // Trending topics
  const trendingTopics = useMemo(() => {
    const tagCounts: Record<string, number> = {};
    posts.forEach(p => (p.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
    return Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [posts]);

  // Activity by day
  const activityData = useMemo(() => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const counts: Record<string, number> = {};
    posts.forEach(p => {
      if (!p.createdAt) return;
      const day = new Date(p.createdAt).toLocaleDateString("en-US", { weekday: "short" });
      counts[day] = (counts[day] || 0) + 1;
    });
    return days.map(d => ({ name: d, posts: counts[d] || 0 }));
  }, [posts]);

  const filtered = useMemo(() => {
    if (!search) return posts;
    const q = search.toLowerCase();
    return posts.filter(p =>
      p.author?.toLowerCase().includes(q) ||
      p.content?.toLowerCase().includes(q) ||
      p.tags?.some(t => t.toLowerCase().includes(q))
    );
  }, [posts, search]);

  const handleCreatePost = async () => {
    if (!form.author || !form.content) {
      toast.error("Please fill author and content"); return;
    }
    const newPost: WallPost = {
      id: `WP-${Date.now()}`,
      author: form.author, department: form.department,
      content: form.content,
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      likes: 0, comments: 0, shares: 0,
      createdAt: new Date().toISOString(),
      liked: false, type: form.type as WallPost["type"],
    };
    try {
      await genericService("socialPosts").create(newPost as unknown as Record<string, unknown>);
      store.addItem(newPost);
      toast.success("Post published!");
      setCreateOpen(false);
      setForm({ author: "", department: "", content: "", tags: "", type: "post" });
    } catch { toast.error("Failed to create post"); }
  };

  const handleLike = (id: string) => {
    const post = posts.find(p => p.id === id);
    if (!post) return;
    store.updateItem(id, { likes: (post.likes || 0) + (post.liked ? -1 : 1), liked: !post.liked });
  };

  const timeAgo = (dateStr: string) => {
    if (nowMs === null) return "";
    const diff = nowMs - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return `${Math.floor(diff / 60000)}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && posts.length === 0) {
    return <DataEmptyState icon={MessageSquare} title="No posts yet" description="Start the conversation! Share updates with your team." actionLabel="Create Post" onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Total Posts", value: totalPosts, icon: MessageSquare, gradient: "from-violet-500 to-purple-600" },
    { label: "Total Likes", value: totalLikes, icon: Heart, gradient: "from-rose-500 to-pink-600" },
    { label: "Active Users", value: activeUsers, icon: Users, gradient: "from-emerald-500 to-green-600" },
    { label: "Engagement Rate", value: engagementRate, icon: TrendingUp, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Wall</h1>
          <p className="text-muted-foreground mt-1">Employee engagement &amp; social feed</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create Post
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
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

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search posts, tags, people..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="feed">Feed</TabsTrigger>
          <TabsTrigger value="trending">Trending</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Feed */}
        <TabsContent value="feed" className="space-y-4 mt-4">
          {filtered.map(post => {
            const TypeIcon = TYPE_ICONS[post.type] || MessageSquare;
            return (
              <Card key={post.id} className="border-0 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className={cn("text-white text-xs bg-gradient-to-br", TYPE_COLORS[post.type] || TYPE_COLORS.post)}>
                        {post.author?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm">{post.author}</h3>
                        {post.department && <Badge variant="outline" className="text-xs">{post.department}</Badge>}
                        <Badge variant="outline" className="text-xs gap-1"><TypeIcon className="h-3 w-3" />{post.type}</Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                          <Clock className="h-3 w-3" />{post.createdAt ? timeAgo(post.createdAt) : ""}
                        </span>
                      </div>
                      <p className="text-sm mt-2 leading-relaxed">{post.content}</p>
                      {post.tags && post.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {post.tags.map(tag => (
                            <Badge key={tag} variant="secondary" className="text-xs gap-1"><Hash className="h-3 w-3" />{tag}</Badge>
                          ))}
                        </div>
                      )}
                      {/* Placeholder image area */}
                      {post.type === "achievement" && (
                        <div className="mt-3 p-4 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10 flex items-center gap-2">
                          <Star className="h-5 w-5 text-amber-500" />
                          <span className="text-sm text-amber-700 dark:text-amber-400">Achievement unlocked!</span>
                        </div>
                      )}
                      <Separator className="my-3" />
                      <div className="flex items-center gap-4">
                        <Button variant="ghost" size="sm"
                          className={cn("gap-1.5 text-xs", post.liked ? "text-rose-500" : "")}
                          onClick={() => handleLike(post.id)}>
                          <Heart className={cn("h-4 w-4", post.liked ? "fill-current" : "")} />
                          {post.likes || 0}
                        </Button>
                        <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                          <MessageSquare className="h-4 w-4" />{post.comments || 0}
                        </Button>
                        <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                          <Share2 className="h-4 w-4" />{post.shares || 0}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Trending */}
        <TabsContent value="trending" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Flame className="h-4 w-4 text-orange-500" /> Trending Topics</CardTitle></CardHeader>
            <CardContent>
              {trendingTopics.length === 0 ? (
                <DataEmptyState icon={Hash} title="No trending topics" description="Tags from posts will trend here." compact />
              ) : (
                <div className="space-y-3">
                  {trendingTopics.map(([tag, count], i) => (
                    <div key={tag} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                      <span className="text-lg font-bold text-muted-foreground w-6">{i + 1}</span>
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <Hash className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">#{tag}</p>
                        <p className="text-xs text-muted-foreground">{count} post{count !== 1 ? "s" : ""}</p>
                      </div>
                      <Badge variant="secondary">{count}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Weekly Activity</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={activityData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="posts" name="Posts" fill="#8b5cf6" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          {/* Activity Timeline */}
          <Card className="border-0 shadow-sm mt-4">
            <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {posts.slice(0, 6).map(post => (
                  <div key={post.id} className="flex items-start gap-3">
                    <div className="h-2 w-2 rounded-full bg-violet-500 mt-2" />
                    <div>
                      <p className="text-sm"><span className="font-medium">{post.author}</span> {post.type === "achievement" ? "earned an achievement" : "shared a post"}</p>
                      <p className="text-xs text-muted-foreground">{post.createdAt ? timeAgo(post.createdAt) : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ENHANCED CREATE POST DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Share to Company Wall</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Post project milestones, welcome team members, or celebrate team wins.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Post Type Selector Cards */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Post Category</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: "post", label: "General Update", icon: MessageSquare },
                  { id: "achievement", label: "Milestone & Win", icon: Star },
                  { id: "welcome", label: "Welcome Member", icon: Users },
                  { id: "announcement", label: "Team Bulletin", icon: Flame },
                ].map(t => {
                  const Icon = t.icon;
                  const active = form.type === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, type: t.id }))}
                      className={cn(
                        "p-2 rounded-lg border text-left transition-all cursor-pointer",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Icon className={cn("h-3.5 w-3.5", active ? "text-violet-600" : "text-muted-foreground")} />
                        <span className="font-bold text-xs truncate">{t.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Author Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-violet-500" />
                  Author / Contributor <span className="text-destructive">*</span>
                </Label>
                {employees && employees.length > 0 ? (
                  <Select
                    value={form.author}
                    onValueChange={v => {
                      const emp = employees.find(e => `${e.firstName} ${e.lastName}`.trim() === v);
                      setForm(f => ({ ...f, author: v, department: emp?.department || f.department }));
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select posting author..." />
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
                    placeholder="Your name"
                    value={form.author}
                    onChange={e => setForm(f => ({ ...f, author: e.target.value }))}
                    className="h-9 text-xs"
                    required
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Department</Label>
                <Input
                  value={form.department}
                  onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                  placeholder="e.g. Engineering, Design"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Post Content */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Post Content &amp; Thoughts <span className="text-destructive">*</span></Label>
              <Textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Share your milestone, team celebration, or project launch..."
                rows={4}
                className="text-xs resize-none"
                required
              />
            </div>

            {/* Tags / Keywords */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                Hashtags &amp; Topics
              </Label>
              <Input
                value={form.tags}
                onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                placeholder="teamwork, milestone, innovation, sprint-release"
                className="h-9 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all gap-1.5" onClick={handleCreatePost}>
              <Send className="h-4 w-4" /> Broadcast Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
