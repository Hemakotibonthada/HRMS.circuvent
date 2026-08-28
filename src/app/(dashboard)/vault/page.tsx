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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  FileText, Plus, Search, FolderOpen, Upload,
  Eye, Lock, Globe, Shield, Users, Calendar, Clock,
  Filter, MoreHorizontal, ChevronRight, File, Folder,
  AlertTriangle, CheckCircle2, Tag, ExternalLink, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  Tooltip as RTooltip,
} from "recharts";
import { useDocumentStore, startSync, type DocumentDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// VAULT — Document management with folders, categories, access
// control, versioning, and document analytics
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const DOC_CATEGORIES = [
  { value: "policies", label: "Policies", icon: Shield, color: "#8b5cf6" },
  { value: "templates", label: "Templates", icon: FileText, color: "#06b6d4" },
  { value: "forms", label: "Forms", icon: File, color: "#10b981" },
  { value: "legal", label: "Legal", icon: Lock, color: "#f59e0b" },
  { value: "training", label: "Training", icon: Users, color: "#ec4899" },
  { value: "general", label: "General", icon: Folder, color: "#6366f1" },
];
const ACCESS_LEVELS = ["public", "hr-only", "managers", "restricted"];
const ACCESS_CONF: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  public: { label: "Public", className: "status-active", icon: Globe },
  "hr-only": { label: "HR Only", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", icon: Shield },
  managers: { label: "Managers", className: "status-pending", icon: Users },
  restricted: { label: "Restricted", className: "status-rejected", icon: Lock },
};
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  draft: { label: "Draft", className: "status-inactive" },
  archived: { label: "Archived", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  expired: { label: "Expired", className: "status-rejected" },
};

export default function VaultPage() {
  const store = useDocumentStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [accessFilter, setAccessFilter] = useState("all");
  const [tab, setTab] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentDoc | null>(null);
  const [form, setForm] = useState({
    name: "", category: "", type: "", uploadedBy: "",
    version: "1.0", status: "active", accessLevel: "public",
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.documents, store); }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(d =>
        d.name?.toLowerCase().includes(q) ||
        d.category?.toLowerCase().includes(q) ||
        d.uploadedBy?.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "all") result = result.filter(d => d.category === categoryFilter);
    if (accessFilter !== "all") result = result.filter(d => d.status === accessFilter);
    // Tab filtering
    if (tab === "folders") result = result; // show all but grouped
    if (tab === "shared") result = result.filter(d => d.status === "active");
    if (tab === "expiring") result = result.filter(d => d.status === "expired" || d.status === "archived");
    return result;
  }, [items, search, categoryFilter, accessFilter, tab]);

  // KPIs
  const totalDocs = items.length;
  const categories = new Set(items.map(d => d.category)).size;
  const sharedCount = items.filter(d => d.status === "active").length;
  const restrictedCount = items.filter(d => d.status === "archived" || d.status === "expired").length;

  // Category distribution
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(d => {
      counts[d.category || "General"] = (counts[d.category || "General"] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Access level distribution
  const accessData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(d => {
      const status = d.status || "active";
      const label = STATUS_CONF[status]?.label || status;
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Grouped by category
  const groupedDocs = useMemo(() => {
    const groups: Record<string, DocumentDoc[]> = {};
    items.forEach(d => {
      const cat = d.category || "General";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(d);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  const resetForm = () => setForm({ name: "", category: "", type: "", uploadedBy: "", version: "1.0", status: "active", accessLevel: "public" });

  const handleCreate = async () => {
    if (!form.name || !form.category) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.documents).create({
        ...form,
        size: "0 KB",
        url: "",
      });
      toast.success(`Document "${form.name}" uploaded!`);
      setCreateOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to upload document");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await genericService(COLLECTIONS.documents).update(id, { status: "archived" });
      toast.success("Document archived");
      setSelectedDoc(null);
    } catch {
      toast.error("Failed to archive document");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.documents} onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Total Documents", value: totalDocs, icon: FileText, gradient: "from-violet-500 to-purple-600" },
    { label: "Categories", value: categories, icon: FolderOpen, gradient: "from-blue-500 to-cyan-500" },
    { label: "Active", value: sharedCount, icon: Globe, gradient: "from-emerald-500 to-green-600" },
    { label: "Archived", value: restrictedCount, icon: Lock, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Vault</h1>
          <p className="text-muted-foreground mt-1">Manage documents, policies, and templates</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Upload className="h-4 w-4" /> Upload Document
        </Button>
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
          <Input placeholder="Search documents..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {DOC_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={accessFilter} onValueChange={setAccessFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(STATUS_CONF).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="folders">Folders</TabsTrigger>
          <TabsTrigger value="shared">Active</TabsTrigger>
          <TabsTrigger value="expiring">Archived</TabsTrigger>
        </TabsList>

        {/* All Documents Tab */}
        <TabsContent value="all" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.documents} compact onAction={() => setCreateOpen(true)} />
          ) : (
            filtered.map((doc) => {
              const st = STATUS_CONF[doc.status] || STATUS_CONF.active;
              const catConf = DOC_CATEGORIES.find(c => c.value === doc.category);
              return (
                <Card key={doc.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedDoc(doc)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${catConf?.color || "#8b5cf6"}20` }}>
                          {catConf ? <catConf.icon className="h-5 w-5" style={{ color: catConf.color }} /> : <FileText className="h-5 w-5 text-violet-600" />}
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm">{doc.name}</h3>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                            <span>{doc.category || "General"}</span>
                            <span>v{doc.version || "1.0"}</span>
                            <span>{doc.uploadedBy || "Unknown"}</span>
                            <span>{doc.size || "—"}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={st.className}>{st.label}</Badge>
                        {/* Download/Share icon buttons used to sit here with no onClick at
                            all — every document's url is "" (nothing here ever stores a real
                            file), so there was never anything to download or share. */}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Folders Tab */}
        <TabsContent value="folders" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {DOC_CATEGORIES.map((cat) => {
              const count = items.filter(d => d.category === cat.value).length;
              return (
                <Card key={cat.value} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setCategoryFilter(cat.value)}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${cat.color}20` }}>
                        <cat.icon className="h-6 w-6" style={{ color: cat.color }} />
                      </div>
                      <div>
                        <h3 className="font-semibold">{cat.label}</h3>
                        <p className="text-sm text-muted-foreground">{count} document{count !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Documents by Category</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label>
                      {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Document Status</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={accessData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" name="Documents" radius={[4, 4, 0, 0]}>
                      {accessData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Shared/Active Tab */}
        <TabsContent value="shared" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState title="No active documents" description="Active documents will appear here." compact />
          ) : (
            filtered.map((doc) => (
              <Card key={doc.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedDoc(doc)}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-emerald-600" />
                      <span className="font-medium text-sm">{doc.name}</span>
                      <Badge variant="outline" className="text-xs">{doc.category}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{doc.uploadedBy}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Archived Tab */}
        <TabsContent value="expiring" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState title="No archived documents" description="Archived or expired documents will appear here." compact />
          ) : (
            filtered.map((doc) => (
              <Card key={doc.id} className="border-0 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="font-medium text-sm">{doc.name}</span>
                      <Badge className={(STATUS_CONF[doc.status] || STATUS_CONF.archived).className}>
                        {(STATUS_CONF[doc.status] || STATUS_CONF.archived).label}
                      </Badge>
                    </div>
                    <Button variant="outline" size="sm">Restore</Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Document Detail Dialog */}
      <Dialog open={!!selectedDoc} onOpenChange={(v) => { if (!v) setSelectedDoc(null); }}>
        <DialogContent>
          {selectedDoc && (
            <>
              <DialogHeader><DialogTitle>{selectedDoc.name}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className={(STATUS_CONF[selectedDoc.status] || STATUS_CONF.active).className}>
                    {(STATUS_CONF[selectedDoc.status] || STATUS_CONF.active).label}
                  </Badge>
                  <Badge variant="outline">{selectedDoc.category || "General"}</Badge>
                  <Badge variant="outline">v{selectedDoc.version || "1.0"}</Badge>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Type</p><p className="font-medium">{selectedDoc.type || "Document"}</p></div>
                  <div><p className="text-muted-foreground">Size</p><p className="font-medium">{selectedDoc.size || "Unknown"}</p></div>
                  <div><p className="text-muted-foreground">Uploaded By</p><p className="font-medium">{selectedDoc.uploadedBy || "Unknown"}</p></div>
                  <div><p className="text-muted-foreground">Version</p><p className="font-medium">{selectedDoc.version || "1.0"}</p></div>
                </div>
              </div>
              {/* A fabricated "Version History" list (hardcoded v1.0/v0.9/v0.8 entries) used
                  to render here for every document, claiming prior revisions that never
                  existed — this record only ever stores a single version string, never a
                  real history. Removed rather than invent one. */}
              <DialogFooter className="gap-2">
                <Button variant="outline" className="text-red-600 border-red-200" onClick={() => handleDelete(selectedDoc.id)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Archive
                </Button>
                {/* Share/Download buttons removed: they had no onClick handler and no file
                    storage backs them (every document's url is ""), so they could only ever
                    look broken or lie about doing something. */}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Upload Document Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Document Name *</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Employee Handbook v3" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {DOC_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Access Level</Label>
                <Select value={form.accessLevel} onValueChange={(v) => setForm(f => ({ ...f, accessLevel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCESS_LEVELS.map(a => <SelectItem key={a} value={a}>{ACCESS_CONF[a]?.label || a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Uploaded By</Label>
              <Input value={form.uploadedBy} onChange={(e) => setForm(f => ({ ...f, uploadedBy: e.target.value }))} placeholder="Your name" />
            </div>
            <div className="border-2 border-dashed rounded-xl p-8 text-center">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Drag and drop files here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, XLSX up to 25MB</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>
              <Upload className="h-4 w-4 mr-2" /> Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
