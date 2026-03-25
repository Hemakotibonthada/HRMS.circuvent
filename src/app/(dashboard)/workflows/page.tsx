"use client";

import { useState, useMemo, useCallback } from "react";
import { create } from "zustand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  GitBranch, Plus, Search, Play, Pause, CheckCircle2,
  Clock, AlertTriangle, ArrowRight, Settings, Layers,
  ZapIcon, RefreshCw, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { COLLECTIONS, genericService } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

const STATUS_CONF: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  paused: { label: "Paused", className: "status-pending" },
  completed: { label: "Completed", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

const WORKFLOW_TEMPLATES = [
  { id: "leave", name: "Leave Approval", category: "HR", steps: ["Apply", "Manager Review", "HR Approval", "Complete"] },
  { id: "expense", name: "Expense Reimbursement", category: "Finance", steps: ["Submit", "Manager Approve", "Finance Review", "Reimburse"] },
  { id: "onboarding", name: "Employee Onboarding", category: "HR", steps: ["Offer Accepted", "IT Setup", "HR Induction", "Team Intro", "Complete"] },
  { id: "exit", name: "Exit Process", category: "HR", steps: ["Resignation", "Manager Ack", "Knowledge Transfer", "Clearance", "Final Settlement"] },
  { id: "asset", name: "Asset Request", category: "IT", steps: ["Request", "Manager Approve", "IT Provision", "Deliver"] },
  { id: "travel", name: "Travel Approval", category: "Admin", steps: ["Request", "Manager Approve", "Finance Approve", "Book"] },
];

interface WorkflowInstance {
  id: string;
  templateId: string;
  templateName: string;
  initiator: string;
  currentStep: number;
  totalSteps: number;
  status: string;
  startedAt: string;
  updatedAt: string;
}

interface WorkflowStore {
  instances: WorkflowInstance[];
  loading: boolean;
  add: (w: WorkflowInstance) => void;
  update: (id: string, data: Partial<WorkflowInstance>) => void;
  remove: (id: string) => void;
  setInstances: (items: WorkflowInstance[]) => void;
}

const useWorkflowStore = create<WorkflowStore>((set) => ({
  instances: [],
  loading: false,
  add: (w) => set((s) => ({ instances: [w, ...s.instances] })),
  update: (id, data) => set((s) => ({ instances: s.instances.map((i) => i.id === id ? { ...i, ...data } : i) })),
  remove: (id) => set((s) => ({ instances: s.instances.filter((i) => i.id !== id) })),
  setInstances: (instances) => set({ instances }),
}));

export default function WorkflowsPage() {
  const store = useWorkflowStore();
  const { instances } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("templates");
  const [selectedTemplate, setSelectedTemplate] = useState<typeof WORKFLOW_TEMPLATES[0] | null>(null);
  const [initiator, setInitiator] = useState("");

  const filteredTemplates = useMemo(() => {
    if (!search) return WORKFLOW_TEMPLATES;
    const q = search.toLowerCase();
    return WORKFLOW_TEMPLATES.filter(t =>
      t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
    );
  }, [search]);

  const filteredInstances = useMemo(() => {
    if (!search) return instances;
    const q = search.toLowerCase();
    return instances.filter(i =>
      i.templateName.toLowerCase().includes(q) || i.initiator.toLowerCase().includes(q)
    );
  }, [instances, search]);

  const templateUsage = useMemo(() =>
    WORKFLOW_TEMPLATES.map(t => ({
      name: t.name.split(" ")[0],
      count: instances.filter(i => i.templateId === t.id).length,
    })),
  [instances]);

  const handleStart = useCallback(async () => {
    if (!selectedTemplate || !initiator) {
      toast.error("Please enter initiator name"); return;
    }
    try {
      const id = await genericService(COLLECTIONS.workflows).create({
        templateId: selectedTemplate.id, templateName: selectedTemplate.name,
        initiator, currentStep: 0, totalSteps: selectedTemplate.steps.length,
        status: "active", startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      store.add({
        id, templateId: selectedTemplate.id, templateName: selectedTemplate.name,
        initiator, currentStep: 0, totalSteps: selectedTemplate.steps.length,
        status: "active", startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      toast.success(`Started "${selectedTemplate.name}" workflow`);
      setSelectedTemplate(null);
      setInitiator("");
    } catch {
      toast.error("Failed to start workflow");
    }
  }, [selectedTemplate, initiator, store]);

  const handleAdvance = useCallback(async (inst: WorkflowInstance) => {
    const nextStep = inst.currentStep + 1;
    const isComplete = nextStep >= inst.totalSteps;
    try {
      await genericService(COLLECTIONS.workflows).update(inst.id, {
        currentStep: nextStep, status: isComplete ? "completed" : "active",
        updatedAt: new Date().toISOString(),
      });
      store.update(inst.id, {
        currentStep: nextStep, status: isComplete ? "completed" : "active",
        updatedAt: new Date().toISOString(),
      });
      toast.success(isComplete ? "Workflow completed!" : "Advanced to next step");
    } catch {
      toast.error("Failed to advance workflow");
    }
  }, [store]);

  const activeCount = instances.filter(i => i.status === "active").length;
  const completedCount = instances.filter(i => i.status === "completed").length;

  const kpis = [
    { label: "Templates", value: WORKFLOW_TEMPLATES.length, icon: Layers, gradient: "from-violet-500 to-purple-600" },
    { label: "Active Workflows", value: activeCount, icon: Play, gradient: "from-emerald-500 to-green-600" },
    { label: "Completed", value: completedCount, icon: CheckCircle2, gradient: "from-blue-500 to-cyan-500" },
    { label: "Total Instances", value: instances.length, icon: GitBranch, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Workflows</h1>
          <p className="text-muted-foreground mt-1">Automate HR processes with workflow templates</p>
        </div>
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
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="instances">Execution Log</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4 mt-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search templates…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map(t => (
              <Card key={t.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <GitBranch className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{t.name}</p>
                        <Badge variant="secondary" className="text-xs">{t.category}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {t.steps.map((step, i) => (
                      <span key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
                        {i > 0 && <ArrowRight className="h-3 w-3" />}
                        <span className="px-1.5 py-0.5 rounded bg-muted">{step}</span>
                      </span>
                    ))}
                  </div>
                  <Button size="sm" className="w-full bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setSelectedTemplate(t)}>
                    <Play className="h-3.5 w-3.5" /> Start Workflow
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="instances" className="space-y-4 mt-4">
          {filteredInstances.length === 0 ? (
            <DataEmptyState icon={GitBranch} title="No workflow executions" description="Start a workflow from the Templates tab." />
          ) : (
            <div className="space-y-2">
              {filteredInstances.map(inst => {
                const tpl = WORKFLOW_TEMPLATES.find(t => t.id === inst.templateId);
                const pct = inst.totalSteps > 0 ? Math.round((inst.currentStep / inst.totalSteps) * 100) : 0;
                return (
                  <Card key={inst.id} className="border-0 shadow-sm">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{inst.templateName}</p>
                          <p className="text-xs text-muted-foreground">by {inst.initiator} · {new Date(inst.startedAt).toLocaleDateString()}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={cn("text-xs", STATUS_CONF[inst.status]?.className)}>{STATUS_CONF[inst.status]?.label}</Badge>
                          {inst.status === "active" && (
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => handleAdvance(inst)}>
                              <ArrowRight className="h-3 w-3" /> Next
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground">{inst.currentStep}/{inst.totalSteps}</span>
                      </div>
                      {tpl && (
                        <div className="flex flex-wrap gap-1">
                          {tpl.steps.map((step, i) => (
                            <Badge key={i} variant={i < inst.currentStep ? "default" : i === inst.currentStep ? "secondary" : "outline"} className="text-xs">
                              {step}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Workflow Usage</CardTitle></CardHeader>
            <CardContent>
              {instances.length === 0 ? <DataEmptyState compact icon={GitBranch} title="No data yet" description="Start workflows to see analytics." /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={templateUsage}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {selectedTemplate && (
        <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Start: {selectedTemplate.name}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Initiator Name</Label><Input value={initiator} onChange={e => setInitiator(e.target.value)} placeholder="Enter employee name" /></div>
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">Steps ({selectedTemplate.steps.length}):</p>
                {selectedTemplate.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-xs">{i + 1}</span>
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedTemplate(null)}>Cancel</Button>
              <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={handleStart}>
                <Play className="h-4 w-4" /> Start
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
