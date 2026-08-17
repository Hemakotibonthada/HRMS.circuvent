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
import { FileText, Plus, Search, FolderOpen, HardDrive, CheckCircle2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useDocumentStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  active: "status-active",
  draft: "status-inactive",
  archived: "status-rejected",
};

export default function DocumentsPage() {
  const store = useDocumentStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.documents, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (d) =>
        (d.name || "").toLowerCase().includes(q) ||
        (d.category || "").toLowerCase().includes(q) ||
        (d.uploadedBy || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const active = items.filter((d) => d.status === "active").length;
  const categories = useMemo(
    () => [...new Set(items.map((d) => d.category).filter(Boolean))],
    [items]
  );
  const types = useMemo(
    () => [...new Set(items.map((d) => d.type).filter(Boolean))],
    [items]
  );

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((d) => {
      map[d.category || "Other"] = (map[d.category || "Other"] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const typeBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((d) => {
      map[d.type || "Other"] = (map[d.type || "Other"] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      name: fd.get("name") as string,
      type: fd.get("type") as string,
      category: fd.get("category") as string,
      uploadedBy: fd.get("uploadedBy") as string,
      size: "—",
      url: "",
      version: "1.0",
      status: "active",
    };
    try {
      await genericService(COLLECTIONS.documents).create(data);
      toast.success("Document added!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to add document");
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
          <h1 className="text-2xl font-bold tracking-tight">Document Management</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} documents &middot; {categories.length} categories
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Upload Document
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Documents", value: items.length, icon: FileText, color: "from-violet-500 to-purple-600" },
          { label: "Active", value: active, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Categories", value: categories.length, icon: FolderOpen, color: "from-amber-500 to-orange-500" },
          { label: "File Types", value: types.length, icon: HardDrive, color: "from-blue-500 to-cyan-500" },
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
        <Input placeholder="Search documents..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Documents</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.documents} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching documents found.</p>
          ) : (
            filtered.map((doc) => (
              <Card key={doc.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white")}>
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.type} &middot; {doc.category} &middot; v{doc.version} &middot; {doc.uploadedBy} &middot; {doc.size}
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[doc.status])}>{doc.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">By Category</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {categoryBreakdown.map((c) => (
                    <div key={c.name} className="flex items-center gap-3">
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm flex-1">{c.name}</span>
                      <span className="font-semibold">{c.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">By File Type</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {typeBreakdown.map((t) => (
                    <div key={t.name} className="flex items-center gap-3">
                      <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm flex-1">{t.name}</span>
                      <span className="font-semibold">{t.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : (
            <DataEmptyState {...EMPTY_STATES.documents} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label>Document Name</Label><Input name="name" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select name="type">
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PDF">PDF</SelectItem>
                    <SelectItem value="DOCX">DOCX</SelectItem>
                    <SelectItem value="XLSX">XLSX</SelectItem>
                    <SelectItem value="PPT">PPT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Category</Label>
                <Select name="category">
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HR Policy">HR Policy</SelectItem>
                    <SelectItem value="Template">Template</SelectItem>
                    <SelectItem value="Report">Report</SelectItem>
                    <SelectItem value="SOP">SOP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Uploaded By</Label><Input name="uploadedBy" required /></div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">Upload</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
