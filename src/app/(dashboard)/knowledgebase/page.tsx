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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  BookOpen, Plus, Search, FileText, Eye, ThumbsUp,
  ThumbsDown, Tag, Calendar, User, TrendingUp,
  Star, Clock, HelpCircle, Briefcase, Shield,
  Lightbulb, Building2, Monitor, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { type BaseRecord } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// KNOWLEDGE BASE — Article management, search, categories,
// voting, and trending articles
// ═══════════════════════════════════════════════════════════════

interface ArticleDoc extends BaseRecord {
  title: string; content: string; category: string;
  author: string; tags: string; views: number;
  helpful: number; notHelpful: number;
  status: string; publishedAt: string;
}

interface ArticleStore {
  items: ArticleDoc[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  setItems: (items: ArticleDoc[]) => void;
  addItem: (item: ArticleDoc) => void;
  updateItem: (id: string, updates: Partial<ArticleDoc>) => void;
  removeItem: (id: string) => void;
  setLoading: (v: boolean) => void;
  setInitialized: (v: boolean) => void;
  setError: (e: string | null) => void;
}

const useArticleStore = create<ArticleStore>((set) => ({
  items: [], loading: false, initialized: false, error: null,
  setItems: (items) => set({ items, loading: false, initialized: true }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) => set((s) => ({ items: s.items.map(i => i.id === id ? { ...i, ...updates } : i) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setError: (error) => set({ error }),
}));

const CATEGORIES = [
  { key: "Getting Started", icon: Lightbulb, color: "from-amber-500 to-orange-500" },
  { key: "HR Policies", icon: FileText, color: "from-violet-500 to-purple-600" },
  { key: "Benefits", icon: Shield, color: "from-emerald-500 to-green-600" },
  { key: "IT", icon: Monitor, color: "from-blue-500 to-cyan-500" },
  { key: "Facilities", icon: Building2, color: "from-pink-500 to-rose-600" },
];
const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1","#14b8a6"];

export default function KnowledgeBasePage() {
  const store = useArticleStore();
  const { items: articles, loading, initialized } = store;

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [tab, setTab] = useState("browse");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewArticle, setViewArticle] = useState<ArticleDoc | null>(null);
  const [form, setForm] = useState({
    title: "", content: "", category: "Getting Started",
    author: "", tags: "",
  });

  useEffect(() => {
    if (!store.initialized) {
      store.setLoading(true);
      genericService(COLLECTIONS.knowledgebase).getAll().then(data => {
        store.setItems(data as unknown as ArticleDoc[]);
      }).catch(() => { store.setItems([]); });
    }
  }, [store]);

  const filtered = useMemo(() => {
    let result = articles;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.title?.toLowerCase().includes(q) || a.content?.toLowerCase().includes(q) ||
        a.author?.toLowerCase().includes(q) || a.tags?.toLowerCase().includes(q) ||
        a.category?.toLowerCase().includes(q)
      );
    }
    if (catFilter !== "all") result = result.filter(a => a.category === catFilter);
    return result;
  }, [articles, search, catFilter]);

  const popularArticles = useMemo(() =>
    [...articles].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10),
  [articles]);

  const trendingArticles = useMemo(() =>
    [...articles].sort((a, b) => (b.helpful || 0) - (a.helpful || 0)).slice(0, 10),
  [articles]);

  const totalViews = useMemo(() => articles.reduce((s, a) => s + (a.views || 0), 0), [articles]);
  const totalHelpful = useMemo(() => articles.reduce((s, a) => s + (a.helpful || 0), 0), [articles]);

  const categoryData = useMemo(() =>
    CATEGORIES.map(c => ({
      name: c.key,
      count: articles.filter(a => a.category === c.key).length,
    })),
  [articles]);

  const authorData = useMemo(() => {
    const map: Record<string, number> = {};
    articles.forEach(a => { const auth = a.author || "Unknown"; map[auth] = (map[auth] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [articles]);

  const getCategoryInfo = (cat: string) => CATEGORIES.find(c => c.key === cat) || CATEGORIES[0];

  const handleVote = async (article: ArticleDoc, type: "helpful" | "notHelpful") => {
    try {
      const updates = { [type]: (article[type] || 0) + 1 };
      await genericService(COLLECTIONS.knowledgebase).update(article.id, updates);
      store.updateItem(article.id, updates as Partial<ArticleDoc>);
      toast.success("Thanks for your feedback!");
    } catch { toast.error("Failed to record vote"); }
  };

  const resetForm = () => setForm({ title: "", content: "", category: "Getting Started", author: "", tags: "" });

  const handleCreate = async () => {
    if (!form.title || !form.content) { toast.error("Title and content are required"); return; }
    try {
      await genericService(COLLECTIONS.knowledgebase).create({
        ...form, views: 0, helpful: 0, notHelpful: 0,
        status: "published", publishedAt: new Date().toISOString(),
      });
      toast.success("Article published!");
      setCreateOpen(false); resetForm();
    } catch { toast.error("Failed to create article"); }
  };

  const handleView = async (article: ArticleDoc) => {
    setViewArticle(article);
    try {
      await genericService(COLLECTIONS.knowledgebase).update(article.id, { views: (article.views || 0) + 1 });
      store.updateItem(article.id, { views: (article.views || 0) + 1 });
    } catch { /* silent */ }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
          <p className="text-muted-foreground mt-1">Company knowledge, policies, and how-to guides</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2" onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4" /> Add Article
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 stagger-children">
        {[
          { label: "Articles", value: articles.length, icon: BookOpen, gradient: "from-violet-500 to-purple-600" },
          { label: "Total Views", value: totalViews, icon: Eye, gradient: "from-blue-500 to-cyan-500" },
          { label: "Helpful Votes", value: totalHelpful, icon: ThumbsUp, gradient: "from-emerald-500 to-green-600" },
          { label: "Categories", value: CATEGORIES.length, icon: Tag, gradient: "from-amber-500 to-orange-500" },
          { label: "Authors", value: new Set(articles.map(a => a.author).filter(Boolean)).size, icon: User, gradient: "from-pink-500 to-rose-600" },
        ].map(kpi => (
          <Card key={kpi.label} className="animate-slide-up">
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("h-11 w-11 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md", kpi.gradient)}>
                <kpi.icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search articles, tags, topics..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.key} value={c.key}>{c.key}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Category Quick Access */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {CATEGORIES.map(cat => {
          const count = articles.filter(a => a.category === cat.key).length;
          return (
            <Card key={cat.key} className={cn("cursor-pointer hover:shadow-md transition-shadow", catFilter === cat.key && "ring-2 ring-violet-500")} onClick={() => setCatFilter(catFilter === cat.key ? "all" : cat.key)}>
              <CardContent className="p-3 text-center">
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center mx-auto mb-2", cat.color)}>
                  <cat.icon className="h-5 w-5 text-white" />
                </div>
                <p className="text-xs font-medium">{cat.key}</p>
                <p className="text-lg font-bold">{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="browse" className="gap-2"><BookOpen className="h-4 w-4" /> Browse</TabsTrigger>
          <TabsTrigger value="popular" className="gap-2"><TrendingUp className="h-4 w-4" /> Popular</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><BarChart3 className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.knowledgebase} onAction={() => setCreateOpen(true)} />
          ) : (
            <div className="space-y-3 stagger-children">
              {filtered.map(article => {
                const catInfo = getCategoryInfo(article.category);
                const CatIcon = catInfo.icon;
                const helpfulPct = (article.helpful || 0) + (article.notHelpful || 0) > 0
                  ? Math.round(((article.helpful || 0) / ((article.helpful || 0) + (article.notHelpful || 0))) * 100)
                  : 0;
                return (
                  <Card key={article.id} className="animate-slide-up hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleView(article)}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center flex-shrink-0 mt-1", catInfo.color)}>
                          <CatIcon className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold mb-1">{article.title}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{article.content}</p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                            <Badge variant="outline" className="text-xs">{article.category}</Badge>
                            <span className="flex items-center gap-1"><User className="h-3 w-3" /> {article.author || "Unknown"}</span>
                            <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> {article.views || 0} views</span>
                            <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" /> {helpfulPct}% helpful</span>
                            {article.tags && article.tags.split(",").slice(0, 3).map(tag => (
                              <Badge key={tag.trim()} variant="outline" className="text-[10px]">{tag.trim()}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="popular" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Eye className="h-4 w-4" /> Most Viewed</CardTitle></CardHeader>
              <CardContent>
                {popularArticles.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No articles</p> : (
                  <div className="space-y-2">
                    {popularArticles.map((article, i) => (
                      <div key={article.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer" onClick={() => handleView(article)}>
                        <span className="text-sm font-bold text-muted-foreground w-6 text-center">{i + 1}</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium line-clamp-1">{article.title}</p>
                          <p className="text-xs text-muted-foreground">{article.category}</p>
                        </div>
                        <span className="text-sm font-medium">{article.views || 0} views</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Star className="h-4 w-4" /> Most Helpful</CardTitle></CardHeader>
              <CardContent>
                {trendingArticles.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No articles</p> : (
                  <div className="space-y-2">
                    {trendingArticles.map((article, i) => (
                      <div key={article.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer" onClick={() => handleView(article)}>
                        <span className="text-sm font-bold text-muted-foreground w-6 text-center">{i + 1}</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium line-clamp-1">{article.title}</p>
                          <p className="text-xs text-muted-foreground">{article.category}</p>
                        </div>
                        <span className="text-sm font-medium flex items-center gap-1"><ThumbsUp className="h-3 w-3" /> {article.helpful || 0}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Articles by Category</CardTitle></CardHeader>
              <CardContent>
                {categoryData.every(c => c.count === 0) ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={categoryData} cx="50%" cy="50%" outerRadius={100} dataKey="count" label={({ name }) => name}>
                        {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Top Authors</CardTitle></CardHeader>
              <CardContent>
                {authorData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={authorData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={10} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Articles" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Article Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add Article</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input placeholder="Article title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.key} value={c.key}>{c.key}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Author</Label>
                <Input placeholder="Your name" value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Content *</Label>
              <Textarea placeholder="Write your article content..." value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} rows={6} />
            </div>
            <div className="space-y-2">
              <Label>Tags</Label>
              <Input placeholder="Comma-separated tags" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>Publish Article</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Article Dialog */}
      <Dialog open={!!viewArticle} onOpenChange={() => setViewArticle(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewArticle?.title}</DialogTitle>
          </DialogHeader>
          {viewArticle && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="outline">{viewArticle.category}</Badge>
                <span className="text-sm text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> {viewArticle.author || "Unknown"}</span>
                <span className="text-sm text-muted-foreground flex items-center gap-1"><Eye className="h-3 w-3" /> {viewArticle.views || 0} views</span>
                <span className="text-sm text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> {viewArticle.publishedAt ? new Date(viewArticle.publishedAt).toLocaleDateString() : "—"}</span>
              </div>
              <Separator />
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <p className="whitespace-pre-wrap">{viewArticle.content}</p>
              </div>
              {viewArticle.tags && (
                <div className="flex gap-2 flex-wrap">
                  {viewArticle.tags.split(",").map(tag => (
                    <Badge key={tag.trim()} variant="outline" className="text-xs"><Tag className="h-3 w-3 mr-1" />{tag.trim()}</Badge>
                  ))}
                </div>
              )}
              <Separator />
              <div className="flex items-center gap-4">
                <p className="text-sm text-muted-foreground">Was this helpful?</p>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => handleVote(viewArticle, "helpful")}>
                  <ThumbsUp className="h-4 w-4" /> {viewArticle.helpful || 0}
                </Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => handleVote(viewArticle, "notHelpful")}>
                  <ThumbsDown className="h-4 w-4" /> {viewArticle.notHelpful || 0}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
