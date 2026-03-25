"use client";

import { useState, useMemo, useCallback } from "react";
import { create } from "zustand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Clock, Plus, Send, CheckCircle2, AlertCircle, Timer,
  Calendar, Briefcase, TrendingUp, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  PieChart, Pie, Cell, Tooltip as RTooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// TIMESHEETS — Weekly grid, project rows, submit for approval
// ═══════════════════════════════════════════════════════════════

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PIE_COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#6366f1", "#14b8a6"];

interface TimesheetRow {
  id: string;
  project: string;
  hours: number[];
}

interface TimesheetState {
  rows: TimesheetRow[];
  status: "draft" | "submitted" | "approved" | "rejected";
  weekStart: string;
  addRow: (project: string) => void;
  updateHours: (id: string, dayIndex: number, hours: number) => void;
  removeRow: (id: string) => void;
  setStatus: (status: TimesheetState["status"]) => void;
}

const useTimesheetStore = create<TimesheetState>((set) => ({
  rows: [
    { id: "1", project: "Project Alpha", hours: [8, 8, 7.5, 8, 8, 0, 0] },
    { id: "2", project: "Project Beta", hours: [0, 0, 0.5, 0, 0, 4, 0] },
    { id: "3", project: "Internal - Training", hours: [0, 0, 0, 0, 0, 0, 0] },
  ],
  status: "draft",
  weekStart: new Date(Date.now() - new Date().getDay() * 86400000 + 86400000).toISOString().slice(0, 10),
  addRow: (project) =>
    set((s) => ({
      rows: [...s.rows, { id: `r-${Date.now()}`, project, hours: [0, 0, 0, 0, 0, 0, 0] }],
    })),
  updateHours: (id, dayIndex, hours) =>
    set((s) => ({
      rows: s.rows.map((r) =>
        r.id === id ? { ...r, hours: r.hours.map((h, i) => (i === dayIndex ? hours : h)) } : r
      ),
    })),
  removeRow: (id) => set((s) => ({ rows: s.rows.filter((r) => r.id !== id) })),
  setStatus: (status) => set({ status }),
}));

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  submitted: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export default function TimesheetsPage() {
  const { rows, status, weekStart, addRow, updateHours, removeRow, setStatus } = useTimesheetStore();
  const [addOpen, setAddOpen] = useState(false);
  const [newProject, setNewProject] = useState("");

  const dayTotals = useMemo(() =>
    DAYS.map((_, i) => rows.reduce((sum, r) => sum + r.hours[i], 0)),
  [rows]);

  const rowTotals = useMemo(() =>
    rows.map((r) => r.hours.reduce((s, h) => s + h, 0)),
  [rows]);

  const grandTotal = useMemo(() => dayTotals.reduce((s, t) => s + t, 0), [dayTotals]);

  const pieData = useMemo(() =>
    rows.map((r, i) => ({
      name: r.project,
      value: rowTotals[i],
    })).filter((d) => d.value > 0),
  [rows, rowTotals]);

  const billableHours = useMemo(() =>
    rows.filter(r => !r.project.startsWith("Internal")).reduce((s, r) => s + r.hours.reduce((a, b) => a + b, 0), 0),
  [rows]);

  const handleAddProject = useCallback(() => {
    if (!newProject.trim()) { toast.error("Project name is required"); return; }
    if (rows.some((r) => r.project.toLowerCase() === newProject.toLowerCase())) {
      toast.error("Project already exists"); return;
    }
    addRow(newProject.trim());
    setNewProject("");
    setAddOpen(false);
    toast.success(`"${newProject}" added`);
  }, [newProject, rows, addRow]);

  const handleSubmit = useCallback(() => {
    if (grandTotal === 0) { toast.error("Log some hours before submitting"); return; }
    setStatus("submitted");
    toast.success("Timesheet submitted for approval");
  }, [grandTotal, setStatus]);

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Timesheets</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Week of {weekStart} · {grandTotal}h logged</p>
        </div>
        <div className="flex gap-2">
          <Badge className={cn("text-xs", STATUS_BADGE[status])}>{status}</Badge>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add Project
          </Button>
          <Button
            size="sm" className="gap-1 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0"
            disabled={status !== "draft"} onClick={handleSubmit}
          >
            <Send className="h-4 w-4" /> Submit
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Hours", value: `${grandTotal}h`, icon: Clock, color: "from-violet-500 to-purple-600" },
          { label: "Billable Hours", value: `${billableHours}h`, icon: TrendingUp, color: "from-emerald-500 to-green-600" },
          { label: "Projects", value: rows.length, icon: Briefcase, color: "from-blue-500 to-cyan-500" },
          { label: "Utilization", value: `${grandTotal > 0 ? Math.round((billableHours / grandTotal) * 100) : 0}%`, icon: BarChart3, color: "from-amber-500 to-orange-500" },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.color)}>
                <kpi.icon className="h-5 w-5 text-white" />
              </div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-lg font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Weekly Timesheet</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <DataEmptyState icon={Clock} title="No projects" description="Add a project to start logging hours." actionLabel="Add Project" onAction={() => setAddOpen(true)} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 font-medium w-48">Project</th>
                  {DAYS.map(d => <th key={d} className="text-center p-2 font-medium w-20">{d}</th>)}
                  <th className="text-center p-2 font-medium w-20">Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={row.id} className="border-b hover:bg-muted/50">
                    <td className="p-2 font-medium">{row.project}</td>
                    {DAYS.map((_, di) => (
                      <td key={di} className="p-1 text-center">
                        <Input
                          type="number"
                          min={0} max={24} step={0.5}
                          value={row.hours[di] || ""}
                          onChange={(e) => updateHours(row.id, di, parseFloat(e.target.value) || 0)}
                          className="w-16 text-center h-8 mx-auto"
                          disabled={status !== "draft"}
                        />
                      </td>
                    ))}
                    <td className="p-2 text-center font-semibold">{rowTotals[ri]}h</td>
                    <td className="p-1">
                      {status === "draft" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500" onClick={() => removeRow(row.id)}>
                          <AlertCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/30 font-semibold">
                  <td className="p-2">Total</td>
                  {dayTotals.map((t, i) => (
                    <td key={i} className={cn("p-2 text-center", t > 12 && "text-red-600")}>{t}h</td>
                  ))}
                  <td className="p-2 text-center text-violet-600">{grandTotal}h</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {pieData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Project Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Project Row</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Project Name</Label><Input value={newProject} onChange={e => setNewProject(e.target.value)} placeholder="e.g. Project Gamma" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddProject} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}