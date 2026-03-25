"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FileText, FileSpreadsheet, FileDown } from "lucide-react";
import { toast } from "sonner";

interface DataExportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const EXPORT_MODULES = [
  { id: "employees", label: "Employee Directory", fields: ["Name", "Email", "Department", "Designation", "Status", "Join Date"] },
  { id: "attendance", label: "Attendance Records", fields: ["Employee", "Date", "Clock In", "Clock Out", "Hours", "Status"] },
  { id: "leave", label: "Leave Records", fields: ["Employee", "Type", "Start", "End", "Days", "Status"] },
  { id: "payroll", label: "Payroll Data", fields: ["Employee", "Gross", "Deductions", "Net", "Status"] },
  { id: "expenses", label: "Expense Claims", fields: ["Employee", "Category", "Amount", "Date", "Status"] },
  { id: "performance", label: "Performance Reviews", fields: ["Employee", "Cycle", "Self Rating", "Manager Rating", "Status"] },
];

export function DataExportDialog({ open, onOpenChange }: DataExportDialogProps) {
  const [format, setFormat] = useState("csv");
  const [selectedModule, setSelectedModule] = useState("employees");
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set(EXPORT_MODULES[0].fields));

  const currentModule = EXPORT_MODULES.find((m) => m.id === selectedModule)!;

  const toggleField = (field: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field); else next.add(field);
      return next;
    });
  };

  const handleModuleChange = (module: string) => {
    setSelectedModule(module);
    const mod = EXPORT_MODULES.find((m) => m.id === module);
    if (mod) setSelectedFields(new Set(mod.fields));
  };

  const handleExport = () => {
    toast.success(`Exporting ${currentModule.label} as ${format.toUpperCase()}...`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Download className="h-5 w-5 text-primary" />Export Data</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Module</Label>
            <Select value={selectedModule} onValueChange={handleModuleChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXPORT_MODULES.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Format</Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "csv", label: "CSV", icon: FileSpreadsheet },
                { id: "xlsx", label: "Excel", icon: FileSpreadsheet },
                { id: "pdf", label: "PDF", icon: FileText },
              ].map((f) => (
                <Button key={f.id} variant={format === f.id ? "default" : "outline"} size="sm" onClick={() => setFormat(f.id)} className="gap-1.5">
                  <f.icon className="h-3.5 w-3.5" />{f.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Fields to include</Label>
            <div className="grid grid-cols-2 gap-2">
              {currentModule.fields.map((field) => (
                <label key={field} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors">
                  <Checkbox checked={selectedFields.has(field)} onCheckedChange={() => toggleField(field)} />
                  {field}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleExport} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-1.5">
            <FileDown className="h-4 w-4" />Export {selectedFields.size} fields
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
