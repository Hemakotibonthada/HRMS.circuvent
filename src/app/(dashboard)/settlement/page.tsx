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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Receipt, Search, CheckCircle2, Clock, DollarSign,
  Download, Users, Calendar, FileText, Briefcase,
  AlertTriangle, ArrowUpRight, Building2, CreditCard,
  ClipboardCheck, Banknote, MinusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, Tooltip as RTooltip,
} from "recharts";
import { useEmployeeStore, startSync, type EmployeeDoc } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// SETTLEMENT — Full & Final settlement calculator
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];

const CLEARANCE_STEPS = [
  { label: "Manager Clearance", key: "manager" },
  { label: "IT Asset Return", key: "it" },
  { label: "Finance Clearance", key: "finance" },
  { label: "HR Documentation", key: "hr" },
  { label: "ID Card & Access", key: "access" },
  { label: "Final Sign-off", key: "signoff" },
];

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  processing: { label: "Processing", className: "status-pending" },
  completed: { label: "Completed", className: "status-active" },
  pending: { label: "Pending", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  hold: { label: "On Hold", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

export default function SettlementPage() {
  const empStore = useEmployeeStore();
  const { items: employees, loading, initialized } = empStore;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("active");
  const [detailItem, setDetailItem] = useState<EmployeeDoc | null>(null);
  const [clearances, setClearances] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, empStore]);

  // Filter exiting employees
  const exitingEmployees = useMemo(() =>
    employees.filter(e => e.status === "exiting" || e.status === "resigned" || e.status === "terminated"),
  [employees]);

  // Compute settlement components for an employee
  const computeSettlement = useCallback((emp: EmployeeDoc) => {
    const salary = emp.salary || 30000;
    const basicPay = Math.round(salary * 0.4);
    const earnedLeave = Math.round(basicPay / 30 * 8); // estimate 8 days
    const yearsOfService = emp.joiningDate
      ? Math.max(1, Math.round((Date.now() - new Date(emp.joiningDate).getTime()) / (365.25 * 86400000)))
      : 1;
    const gratuity = yearsOfService >= 5 ? Math.round(basicPay * 15 / 26 * yearsOfService) : 0;
    const noticePay = Math.round(salary); // 1 month
    const pf = Math.round(basicPay * 0.12 * yearsOfService);
    const taxDeduction = Math.round(salary * 0.1);
    const loanRecovery = 0;
    const totalEarnings = basicPay + earnedLeave + gratuity + noticePay + pf;
    const totalDeductions = taxDeduction + loanRecovery;
    const netSettlement = totalEarnings - totalDeductions;
    return {
      basicPay, earnedLeave, gratuity, noticePay, pf,
      taxDeduction, loanRecovery, totalEarnings, totalDeductions, netSettlement,
      yearsOfService,
    };
  }, []);

  const totalAmount = useMemo(() =>
    exitingEmployees.reduce((s, e) => s + computeSettlement(e).netSettlement, 0),
  [exitingEmployees, computeSettlement]);

  const completedSettlements = useMemo(() => {
    return exitingEmployees.filter(e => {
      const ec = clearances[e.id];
      if (!ec) return false;
      return CLEARANCE_STEPS.every(s => ec[s.key]);
    }).length;
  }, [exitingEmployees, clearances]);

  const filtered = useMemo(() => {
    if (!search) return exitingEmployees;
    const q = search.toLowerCase();
    return exitingEmployees.filter(e =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.department?.toLowerCase().includes(q)
    );
  }, [exitingEmployees, search]);

  // Settlement component distribution
  const componentData = useMemo(() => {
    if (exitingEmployees.length === 0) return [];
    const totals = exitingEmployees.reduce((acc, e) => {
      const s = computeSettlement(e);
      return {
        basicPay: acc.basicPay + s.basicPay,
        earnedLeave: acc.earnedLeave + s.earnedLeave,
        gratuity: acc.gratuity + s.gratuity,
        noticePay: acc.noticePay + s.noticePay,
        pf: acc.pf + s.pf,
      };
    }, { basicPay: 0, earnedLeave: 0, gratuity: 0, noticePay: 0, pf: 0 });
    return [
      { name: "Basic Pay", value: totals.basicPay },
      { name: "Earned Leave", value: totals.earnedLeave },
      { name: "Gratuity", value: totals.gratuity },
      { name: "Notice Pay", value: totals.noticePay },
      { name: "PF", value: totals.pf },
    ];
  }, [exitingEmployees, computeSettlement]);

  const toggleClearance = (empId: string, stepKey: string) => {
    setClearances(prev => ({
      ...prev,
      [empId]: { ...(prev[empId] || {}), [stepKey]: !(prev[empId]?.[stepKey]) },
    }));
  };

  const getClearanceProgress = (empId: string) => {
    const ec = clearances[empId] || {};
    const done = CLEARANCE_STEPS.filter(s => ec[s.key]).length;
    return Math.round((done / CLEARANCE_STEPS.length) * 100);
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && exitingEmployees.length === 0) {
    return <DataEmptyState icon={Briefcase} title="No active settlements" description="Full &amp; final settlements appear when employees exit." />;
  }

  const kpis = [
    { label: "Active Settlements", value: exitingEmployees.length, icon: Clock, gradient: "from-amber-500 to-orange-500" },
    { label: "Total Amount", value: `₹${Math.round(totalAmount / 1000)}K`, icon: DollarSign, gradient: "from-violet-500 to-purple-600" },
    { label: "Completed", value: completedSettlements, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "In Progress", value: exitingEmployees.length - completedSettlements, icon: AlertTriangle, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Settlement</h1>
          <p className="text-muted-foreground mt-1">Full &amp; final settlement calculator &amp; clearance tracker</p>
        </div>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" /> Export Report
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
        <Input placeholder="Search employees..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">Active Settlements</TabsTrigger>
          <TabsTrigger value="breakdown">Components</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-3 mt-4">
          {filtered.map(emp => {
            const settlement = computeSettlement(emp);
            const progress = getClearanceProgress(emp.id);
            return (
              <Card key={emp.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setDetailItem(emp)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs">
                          {emp.firstName?.[0]}{emp.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{emp.firstName} {emp.lastName}</h3>
                          <Badge variant="outline">{emp.department}</Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{emp.designation}</span>
                          <span>{settlement.yearsOfService} year{settlement.yearsOfService !== 1 ? "s" : ""} of service</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-lg font-bold">₹{settlement.netSettlement.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Net settlement</p>
                      </div>
                      <div className="text-right w-24">
                        <p className="text-xs text-muted-foreground mb-1">Clearance</p>
                        <Progress value={progress} className="h-2" />
                        <p className="text-xs font-medium mt-0.5">{progress}%</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="breakdown" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Settlement Component Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={componentData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {componentData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Settlement by Employee</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={exitingEmployees.slice(0, 8).map(e => ({
                    name: `${e.firstName?.[0]}. ${e.lastName}`,
                    amount: computeSettlement(e).netSettlement,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="amount" name="Net Amount" fill="#8b5cf6" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!detailItem} onOpenChange={v => { if (!v) setDetailItem(null); }}>
        <DialogContent className="max-w-2xl">
          {detailItem && (() => {
            const s = computeSettlement(detailItem);
            const empId = detailItem.id;
            return (
              <>
                <DialogHeader><DialogTitle>Settlement Details — {detailItem.firstName} {detailItem.lastName}</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div><p className="text-muted-foreground">Department</p><p className="font-medium">{detailItem.department}</p></div>
                    <div><p className="text-muted-foreground">Designation</p><p className="font-medium">{detailItem.designation}</p></div>
                    <div><p className="text-muted-foreground">Service</p><p className="font-medium">{s.yearsOfService} year{s.yearsOfService !== 1 ? "s" : ""}</p></div>
                  </div>
                  <Separator />
                  {/* Earnings */}
                  <div>
                    <h4 className="font-semibold text-sm mb-2 text-emerald-600 flex items-center gap-1"><Banknote className="h-4 w-4" /> Earnings</h4>
                    <div className="space-y-2 text-sm">
                      {[
                        { label: "Basic Pay (Last Month)", amount: s.basicPay },
                        { label: "Earned Leave Encashment", amount: s.earnedLeave },
                        { label: "Gratuity", amount: s.gratuity },
                        { label: "Notice Period Pay", amount: s.noticePay },
                        { label: "Provident Fund", amount: s.pf },
                      ].map(row => (
                        <div key={row.label} className="flex justify-between">
                          <span>{row.label}</span>
                          <span className="font-medium">₹{row.amount.toLocaleString()}</span>
                        </div>
                      ))}
                      <Separator />
                      <div className="flex justify-between font-semibold text-emerald-600">
                        <span>Total Earnings</span>
                        <span>₹{s.totalEarnings.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  {/* Deductions */}
                  <div>
                    <h4 className="font-semibold text-sm mb-2 text-red-500 flex items-center gap-1"><MinusCircle className="h-4 w-4" /> Deductions</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span>Tax Deduction</span><span className="font-medium">₹{s.taxDeduction.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Loan Recovery</span><span className="font-medium">₹{s.loanRecovery.toLocaleString()}</span></div>
                      <Separator />
                      <div className="flex justify-between font-semibold text-red-500">
                        <span>Total Deductions</span><span>₹{s.totalDeductions.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-gradient-to-r from-violet-500/10 to-purple-500/10 flex justify-between items-center">
                    <span className="font-bold text-lg">Net Settlement</span>
                    <span className="font-bold text-2xl bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">₹{s.netSettlement.toLocaleString()}</span>
                  </div>
                  <Separator />
                  {/* Clearance Checklist */}
                  <div>
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><ClipboardCheck className="h-4 w-4" /> Clearance Checklist</h4>
                    <div className="space-y-2">
                      {CLEARANCE_STEPS.map((step, i) => (
                        <div key={step.key} className="flex items-center gap-3">
                          <Checkbox
                            checked={clearances[empId]?.[step.key] || false}
                            onCheckedChange={() => toggleClearance(empId, step.key)}
                          />
                          <div className="flex items-center gap-2">
                            <span className={cn("text-sm", clearances[empId]?.[step.key] ? "line-through text-muted-foreground" : "font-medium")}>
                              {i + 1}. {step.label}
                            </span>
                            {clearances[empId]?.[step.key] && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Progress value={getClearanceProgress(empId)} className="h-2 mt-3" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDetailItem(null)}>Close</Button>
                  <Button variant="outline" className="gap-2"><Download className="h-4 w-4" /> Export</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
