"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { create } from "zustand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  FileText, Plus, Search, Download, Mail, Eye,
  Clock, CheckCircle2, Users, Printer, Send, Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { useEmployeeStore, startSync } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

const LETTER_TEMPLATES = [
  { id: "offer", name: "Offer Letter", category: "Recruitment" },
  { id: "appointment", name: "Appointment Letter", category: "Onboarding" },
  { id: "confirmation", name: "Confirmation Letter", category: "HR" },
  { id: "promotion", name: "Promotion Letter", category: "HR" },
  { id: "transfer", name: "Transfer Letter", category: "HR" },
  { id: "warning", name: "Warning Letter", category: "Disciplinary" },
  { id: "termination", name: "Termination Letter", category: "Exit" },
  { id: "experience", name: "Experience Certificate", category: "Exit" },
  { id: "relieving", name: "Relieving Letter", category: "Exit" },
  { id: "salary-revision", name: "Salary Revision Letter", category: "Payroll" },
  { id: "bonus", name: "Bonus Letter", category: "Payroll" },
  { id: "reference", name: "Reference Letter", category: "HR" },
];

interface LetterHistory {
  id: string;
  templateId: string;
  templateName: string;
  recipientName: string;
  recipientId: string;
  generatedAt: string;
  status: string;
}

interface LetterHistoryStore {
  items: LetterHistory[];
  add: (l: LetterHistory) => void;
  setItems: (items: LetterHistory[]) => void;
}

const useLetterHistoryStore = create<LetterHistoryStore>((set) => ({
  items: [],
  add: (l) => set((s) => ({ items: [l, ...s.items] })),
  setItems: (items) => set({ items }),
}));

const STATUS_CONF: Record<string, { label: string; className: string }> = {
  generated: { label: "Generated", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  sent: { label: "Sent", className: "status-active" },
  signed: { label: "Signed", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
};

export default function LettersPage() {
  const empStore = useEmployeeStore();
  const historyStore = useLetterHistoryStore();
  const [search, setSearch] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [empStore]);

  const filteredTemplates = useMemo(() => {
    if (!search) return LETTER_TEMPLATES;
    const q = search.toLowerCase();
    return LETTER_TEMPLATES.filter(t =>
      t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
    );
  }, [search]);

  const templateUsage = useMemo(() => {
    const counts: Record<string, number> = {};
    historyStore.items.forEach(l => { counts[l.templateName] = (counts[l.templateName] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name: name.split(" ")[0], value }));
  }, [historyStore.items]);

  const handleGenerate = useCallback(async () => {
    if (!selectedTemplate || !selectedEmployee) {
      toast.error("Select template and employee"); return;
    }
    const tpl = LETTER_TEMPLATES.find(t => t.id === selectedTemplate);
    const emp = empStore.items.find(e => e.id === selectedEmployee);
    if (!tpl || !emp) return;

    try {
      const id = await genericService(COLLECTIONS.documents).create({
        type: "letter", templateId: tpl.id, templateName: tpl.name,
        recipientId: emp.id, recipientName: `${emp.firstName} ${emp.lastName}`,
        notes, status: "generated", generatedAt: new Date().toISOString(),
      });
      historyStore.add({
        id, templateId: tpl.id, templateName: tpl.name,
        recipientId: emp.id, recipientName: `${emp.firstName} ${emp.lastName}`,
        generatedAt: new Date().toISOString(), status: "generated",
      });
      toast.success(`${tpl.name} generated for ${emp.firstName} ${emp.lastName}`);
      setGenerateOpen(false);
      setSelectedTemplate("");
      setSelectedEmployee("");
      setNotes("");
    } catch {
      toast.error("Failed to generate letter");
    }
  }, [selectedTemplate, selectedEmployee, notes, empStore.items, historyStore]);

  const kpis = [
    { label: "Templates", value: LETTER_TEMPLATES.length, icon: FileText, gradient: "from-violet-500 to-purple-600" },
    { label: "Generated", value: historyStore.items.length, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Sent", value: historyStore.items.filter(l => l.status === "sent").length, icon: Send, gradient: "from-blue-500 to-cyan-500" },
    { label: "Employees", value: empStore.items.length, icon: Users, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Letters</h1>
          <p className="text-muted-foreground mt-1">Generate and manage HR letters</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setGenerateOpen(true)}>
          <Plus className="h-4 w-4" /> Generate Letter
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{kpi.label}</p><p className="text-2xl font-bold mt-1">{kpi.value}</p></div><div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}><kpi.icon className="h-5 w-5 text-white" /></div></div></CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search templates…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredTemplates.map(t => (
          <Card key={t.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{t.name}</p>
                  <Badge variant="secondary" className="text-xs">{t.category}</Badge>
                </div>
              </div>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => { setSelectedTemplate(t.id); setGenerateOpen(true); }}>
                <Printer className="h-3.5 w-3.5" /> Generate
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {historyStore.items.length > 0 && (
        <>
          <Separator />
          <div>
            <h2 className="text-lg font-semibold mb-3">Generation History</h2>
            {templateUsage.length > 0 && (
              <Card className="border-0 shadow-sm mb-4">
                <CardContent className="p-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={templateUsage}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <RTooltip />
                      <Bar dataKey="value" fill="#8b5cf6" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
            <div className="space-y-2">
              {historyStore.items.map(letter => (
                <Card key={letter.id} className="border-0 shadow-sm">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                      <Mail className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{letter.templateName}</p>
                      <p className="text-xs text-muted-foreground">To: {letter.recipientName} · {new Date(letter.generatedAt).toLocaleDateString()}</p>
                    </div>
                    <Badge className={cn("text-xs", STATUS_CONF[letter.status]?.className)}>
                      {STATUS_CONF[letter.status]?.label || letter.status}
                    </Badge>
                    <Button size="sm" variant="ghost"><Download className="h-4 w-4" /></Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate Letter</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Template</Label>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>
                  {LETTER_TEMPLATES.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Recipient</Label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {empStore.items.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={handleGenerate}>
              <Printer className="h-4 w-4" /> Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
