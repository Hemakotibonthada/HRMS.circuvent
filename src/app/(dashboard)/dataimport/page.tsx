"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload, Download, FileText, Table, Database, CheckCircle2,
  AlertTriangle, Clock, ArrowRight, ArrowUpRight, ChevronRight,
  File, FileSpreadsheet, Trash2, RefreshCw, Eye, Filter,
  Users, Calendar, DollarSign, Building2, Package, Briefcase,
  GraduationCap, Shield, Zap, BarChart3, Search, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════
// DATA IMPORT / EXPORT CENTER
// Bulk data import via CSV/Excel, data export with filters,
// template downloads, field mapping, validation, history
// ═══════════════════════════════════════════════════════════════

interface ImportTemplate {
  id: string; name: string; module: string; fields: number;
  icon: typeof Users; color: string; description: string;
  requiredFields: string[]; optionalFields: string[];
  sampleRows: number;
}

interface ExportConfig {
  id: string; name: string; module: string; fields: string[];
  format: "csv" | "xlsx" | "json" | "pdf";
  filters?: Record<string, string>;
  lastExported?: string;
  records?: number;
}

interface ImportJob {
  id: string; name: string; module: string; status: "processing" | "completed" | "failed" | "partial";
  totalRows: number; successRows: number; failedRows: number;
  startedAt: string; completedAt?: string; errors?: string[];
  uploadedBy: string; fileName: string; fileSize: string;
}

const IMPORT_TEMPLATES: ImportTemplate[] = [
  { id: "T001", name: "Employee Master Data", module: "Employees", fields: 24, icon: Users, color: "from-violet-500 to-purple-600", description: "Import employee profiles with personal, employment, and contact details", requiredFields: ["First Name", "Last Name", "Email", "Employee ID", "Department", "Designation", "Joining Date"], optionalFields: ["Phone", "DOB", "Gender", "Blood Group", "Address", "Bank Details", "PAN", "Aadhaar", "Emergency Contact", "Manager", "Skills"], sampleRows: 5 },
  { id: "T002", name: "Attendance Records", module: "Attendance", fields: 8, icon: Clock, color: "from-blue-500 to-cyan-500", description: "Bulk import attendance/clock-in data from biometric systems", requiredFields: ["Employee ID", "Date", "Clock In", "Clock Out"], optionalFields: ["Status", "Overtime", "Location", "Notes"], sampleRows: 100 },
  { id: "T003", name: "Leave Balances", module: "Leave", fields: 6, icon: Calendar, color: "from-emerald-500 to-green-600", description: "Set initial leave balances for all employees", requiredFields: ["Employee ID", "Leave Type", "Total", "Used"], optionalFields: ["Carry Forward", "Adjustment"], sampleRows: 50 },
  { id: "T004", name: "Payroll Data", module: "Payroll", fields: 18, icon: DollarSign, color: "from-amber-500 to-orange-500", description: "Import salary components and deductions for payroll processing", requiredFields: ["Employee ID", "Basic Pay", "HRA", "Month", "Year"], optionalFields: ["Special Allow", "Bonus", "PF", "PT", "TDS", "Loan", "LOP Days", "OT Hours"], sampleRows: 10 },
  { id: "T005", name: "Department Structure", module: "Departments", fields: 7, icon: Building2, color: "from-pink-500 to-rose-600", description: "Import organizational department hierarchy", requiredFields: ["Name", "Code", "Head"], optionalFields: ["Parent Dept", "Location", "Budget", "Description"], sampleRows: 8 },
  { id: "T006", name: "Asset Inventory", module: "Assets", fields: 12, icon: Package, color: "from-teal-500 to-cyan-600", description: "Bulk register hardware and software assets", requiredFields: ["Asset Name", "Type", "Serial Number", "Purchase Date", "Cost"], optionalFields: ["Brand", "Model", "Warranty", "Location", "Assigned To", "Condition", "Notes"], sampleRows: 20 },
  { id: "T007", name: "Job Postings", module: "Recruitment", fields: 14, icon: Briefcase, color: "from-indigo-500 to-blue-600", description: "Import multiple job openings at once", requiredFields: ["Title", "Department", "Experience Min/Max", "Location"], optionalFields: ["Description", "Requirements", "Skills", "Salary Range", "Job Type", "Openings"], sampleRows: 5 },
  { id: "T008", name: "Training Courses", module: "Training", fields: 10, icon: GraduationCap, color: "from-purple-500 to-violet-600", description: "Import course catalog from external LMS", requiredFields: ["Title", "Category", "Duration", "Level"], optionalFields: ["Instructor", "Description", "Skills", "Type", "Mandatory", "Cost"], sampleRows: 10 },
];

const EXPORT_CONFIGS: ExportConfig[] = [
  { id: "EX01", name: "All Employees", module: "Employees", fields: ["Name", "Email", "Department", "Designation", "Status", "Joining Date"], format: "xlsx" },
  { id: "EX02", name: "Monthly Attendance", module: "Attendance", fields: ["Employee", "Date", "Clock In", "Clock Out", "Hours", "Status"], format: "csv" },
  { id: "EX03", name: "Payroll Summary", module: "Payroll", fields: ["Employee", "Basic", "Gross", "Deductions", "Net Pay", "Status"], format: "xlsx" },
  { id: "EX04", name: "Leave Report", module: "Leave", fields: ["Employee", "Type", "From", "To", "Days", "Status"], format: "csv" },
  { id: "EX05", name: "Asset Register", module: "Assets", fields: ["Name", "Type", "Serial", "Cost", "Status", "Assigned To"], format: "xlsx" },
  { id: "EX06", name: "Recruitment Pipeline", module: "Recruitment", fields: ["Candidate", "Job", "Stage", "Rating", "Source", "Applied Date"], format: "csv" },
  { id: "EX07", name: "Performance Reviews", module: "Performance", fields: ["Employee", "Cycle", "Self Rating", "Manager Rating", "Final", "Status"], format: "pdf" },
  { id: "EX08", name: "Expense Claims", module: "Expenses", fields: ["Employee", "Category", "Amount", "Date", "Status", "Approved By"], format: "xlsx" },
];

const IMPORT_HISTORY: ImportJob[] = [];

const STATUS_CONF: Record<string, { label: string; className: string }> = {
  processing: { label: "Processing", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  completed: { label: "Completed", className: "status-active" },
  failed: { label: "Failed", className: "status-rejected" },
  partial: { label: "Partial", className: "status-pending" },
};

const GRADIENTS = ["from-violet-500 to-purple-600","from-blue-500 to-cyan-500","from-emerald-500 to-green-600","from-amber-500 to-orange-500","from-pink-500 to-rose-600","from-teal-500 to-cyan-600","from-indigo-500 to-blue-600","from-purple-500 to-violet-600"];

export default function DataImportExportPage() {
  const [tab, setTab] = useState("import");
  const [selectedTemplate, setSelectedTemplate] = useState<ImportTemplate | null>(null);
  const [uploadStep, setUploadStep] = useState(0); // 0: select, 1: upload, 2: map, 3: validate, 4: complete
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null);
  const [exportFormat, setExportFormat] = useState("xlsx");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-slide-up">
        <div><h1 className="text-2xl font-bold tracking-tight">Data Center</h1><p className="text-muted-foreground text-sm mt-0.5">Import, export & manage your HR data</p></div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="text-xs gap-1"><RefreshCw className="h-3 w-3" />Refresh</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Import Templates", value: IMPORT_TEMPLATES.length.toString(), icon: Upload, color: "from-violet-500 to-purple-600" },
          { label: "Export Configs", value: EXPORT_CONFIGS.length.toString(), icon: Download, color: "from-emerald-500 to-green-600" },
          { label: "Total Records", value: "82K+", icon: Database, color: "from-blue-500 to-cyan-500" },
          { label: "Last Import", value: "Mar 20", icon: Clock, color: "from-amber-500 to-orange-500" },
        ].map(s => (<Card key={s.label} className="group"><CardContent className="flex items-center gap-3 p-4"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${s.color} text-white shadow-md transition-transform group-hover:scale-110`}><s.icon className="h-5 w-5" /></div><div><p className="text-[10px] font-medium text-muted-foreground">{s.label}</p><p className="text-lg font-bold">{s.value}</p></div></CardContent></Card>))}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="animate-slide-up" style={{ animationDelay: "120ms" }}>
        <TabsList><TabsTrigger value="import">Import Data</TabsTrigger><TabsTrigger value="export">Export Data</TabsTrigger><TabsTrigger value="history">Import History ({IMPORT_HISTORY.length})</TabsTrigger></TabsList>

        {/* IMPORT */}
        <TabsContent value="import" className="mt-4 space-y-4">
          <p className="text-xs text-muted-foreground">Select a template, download the sample file, fill your data, and upload to import.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {IMPORT_TEMPLATES.map(t => {
              // Employee import is the one of these that exists. The rest are
              // still tiles describing an importer nobody has written, and
              // they open a dialog that reports success without reading the
              // file — so they are marked as such rather than left looking
              // identical to the one that works.
              const built = t.module === "Employees";
              return (
              <Card key={t.id} className={cn("group transition-all", built ? "cursor-pointer hover:shadow-lg" : "opacity-60")}>
                <CardContent className="p-4 text-center">
                  <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${t.color} text-white shadow-md transition-transform ${built ? "group-hover:scale-110" : ""} mb-3`}><t.icon className="h-6 w-6" /></div>
                  <h3 className="text-xs font-semibold">{t.name}</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
                  <div className="flex justify-center gap-2 mt-2"><Badge variant="outline" className="text-[8px]">{t.fields} fields</Badge><Badge variant="outline" className="text-[8px]">{t.module}</Badge></div>
                  {built ? (
                    <Button size="sm" className="w-full mt-3 text-xs bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-1" asChild>
                      <Link href="/employees/import"><Upload className="h-3 w-3" />Import</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="w-full mt-3 text-xs gap-1" disabled>Not available yet</Button>
                  )}
                </CardContent>
              </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* EXPORT */}
        <TabsContent value="export" className="mt-4 space-y-2">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">Download your HR data in various formats</p>
            <Select value={exportFormat} onValueChange={setExportFormat}><SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="xlsx">Excel</SelectItem><SelectItem value="csv">CSV</SelectItem><SelectItem value="json">JSON</SelectItem><SelectItem value="pdf">PDF</SelectItem></SelectContent></Select>
          </div>
          {EXPORT_CONFIGS.map((exp, i) => (
            <Card key={exp.id} className="hover:shadow-sm transition-all group">
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]} text-white shadow-md`}><FileSpreadsheet className="h-5 w-5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><h3 className="text-xs font-semibold">{exp.name}</h3><Badge variant="outline" className="text-[8px]">{exp.module}</Badge><Badge variant="outline" className="text-[8px] uppercase">{exp.format}</Badge></div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground"><span>{exp.fields.length} fields</span><span>{exp.records?.toLocaleString()} records</span>{exp.lastExported && <span>Last: {exp.lastExported}</span>}</div>
                </div>
                <Button size="sm" className="text-xs gap-1 bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => toast.success(`Exporting ${exp.name}...`)}><Download className="h-3 w-3" />Export</Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* HISTORY */}
        <TabsContent value="history" className="mt-4 space-y-2">
          {IMPORT_HISTORY.map(job => {
            const sc = STATUS_CONF[job.status];
            const pct = job.totalRows > 0 ? Math.round((job.successRows / job.totalRows) * 100) : 0;
            return (
              <Card key={job.id} className={cn("hover:shadow-sm transition-all cursor-pointer", job.status === "failed" && "border-l-4 border-l-red-500", job.status === "partial" && "border-l-4 border-l-amber-500")} onClick={() => setSelectedJob(job)}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-md", job.status === "completed" ? "bg-gradient-to-br from-emerald-500 to-green-600" : job.status === "failed" ? "bg-gradient-to-br from-red-500 to-orange-500" : job.status === "partial" ? "bg-gradient-to-br from-amber-500 to-orange-500" : "bg-gradient-to-br from-blue-500 to-cyan-500")}>
                    {job.status === "completed" ? <CheckCircle2 className="h-5 w-5" /> : job.status === "failed" ? <AlertTriangle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><h3 className="text-xs font-semibold">{job.name}</h3><Badge className={cn("text-[8px] border-0", sc.className)}>{sc.label}</Badge><Badge variant="outline" className="text-[8px]">{job.module}</Badge></div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground"><span>{job.fileName} ({job.fileSize})</span><span>By {job.uploadedBy}</span><span>{job.startedAt}</span></div>
                    <div className="mt-1.5 flex items-center gap-2"><Progress value={pct} className="h-1.5 flex-1" /><span className="text-[10px] font-medium">{job.successRows}/{job.totalRows} rows</span>{job.failedRows > 0 && <span className="text-[10px] text-red-600">{job.failedRows} failed</span>}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      {/* Template Detail Dialog */}
      {selectedTemplate && (
        <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-violet-500" />Import: {selectedTemplate.name}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
              <div className="grid grid-cols-2 gap-3 text-xs"><div><p className="font-semibold text-muted-foreground mb-1">Required Fields ({selectedTemplate.requiredFields.length})</p>{selectedTemplate.requiredFields.map(f => (<div key={f} className="flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5 text-red-500" /><span>{f}</span></div>))}</div><div><p className="font-semibold text-muted-foreground mb-1">Optional Fields ({selectedTemplate.optionalFields.length})</p>{selectedTemplate.optionalFields.map(f => (<div key={f} className="flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5 text-muted-foreground/40" /><span className="text-muted-foreground">{f}</span></div>))}</div></div>
              <Separator />
              <div className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:bg-muted/50 transition-all">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Drop your file here or click to browse</p>
                <p className="text-[10px] text-muted-foreground mt-1">Supports .csv, .xlsx, .xls (max 10MB)</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-1 text-xs" onClick={() => toast.success("Downloading sample...")}><Download className="h-3 w-3" />Download Sample ({selectedTemplate.sampleRows} rows)</Button>
                <Button className="flex-1 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-1 text-xs" onClick={() => { toast.success("Import started!"); setSelectedTemplate(null); }}><Upload className="h-3 w-3" />Upload & Import</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Job Detail Dialog */}
      {selectedJob && (
        <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Import Details: {selectedJob.name}</DialogTitle></DialogHeader>
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-y-2"><div><span className="text-muted-foreground">Module:</span> {selectedJob.module}</div><div><span className="text-muted-foreground">Status:</span> <Badge className={cn("text-[8px] border-0 ml-1", STATUS_CONF[selectedJob.status].className)}>{STATUS_CONF[selectedJob.status].label}</Badge></div><div><span className="text-muted-foreground">File:</span> {selectedJob.fileName}</div><div><span className="text-muted-foreground">Size:</span> {selectedJob.fileSize}</div><div><span className="text-muted-foreground">Started:</span> {selectedJob.startedAt}</div><div><span className="text-muted-foreground">Completed:</span> {selectedJob.completedAt}</div><div><span className="text-muted-foreground">By:</span> {selectedJob.uploadedBy}</div></div>
              <div className="rounded-lg bg-muted/50 p-3"><div className="flex justify-between mb-1"><span className="text-muted-foreground">Progress</span><span className="font-semibold">{selectedJob.successRows}/{selectedJob.totalRows}</span></div><Progress value={(selectedJob.successRows / selectedJob.totalRows) * 100} className="h-2" /><div className="flex justify-between mt-1 text-[10px]"><span className="text-emerald-600">{selectedJob.successRows} success</span><span className="text-red-600">{selectedJob.failedRows} failed</span></div></div>
              {selectedJob.errors && selectedJob.errors.length > 0 && (<div><p className="font-semibold text-red-600 mb-1">Errors ({selectedJob.errors.length})</p>{selectedJob.errors.map((e, i) => (<p key={i} className="text-[10px] text-muted-foreground py-0.5 border-b last:border-0">⚠️ {e}</p>))}</div>)}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
