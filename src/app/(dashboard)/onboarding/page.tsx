"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  UserPlus, Search, CheckCircle2, Clock, Users,
  Calendar, ListChecks, Target, AlertCircle, Briefcase,
  ChevronRight, Eye, Star, Shield, ChevronDown, Award,
  Mail, Laptop, Building2, UserCheck, Sparkles, RefreshCw,
  MoreVertical, FileText, Send, Check, ShieldAlert,
  ArrowRight, HeartHandshake, UserCog, Package, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";

// ═══════════════════════════════════════════════════════════════
// ONBOARDING — ATS Integration, Manager & Buddy Assignment,
// Mailbox Provisioning, Appointment Letters, & 90-Day Lifecycle
// ═══════════════════════════════════════════════════════════════

const PHASES = [
  { key: "pre", label: "Pre-boarding", color: "from-blue-500 to-cyan-500", badgeColor: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300", tasks: ["Offer letter signed", "Background check", "IT equipment ordered", "Email account created", "Welcome kit prepared"] },
  { key: "week1", label: "Week 1", color: "from-violet-500 to-purple-600", badgeColor: "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300", tasks: ["Office tour", "Team introduction", "System access setup", "Policy acknowledgement", "First 1-on-1 with manager"] },
  { key: "month1", label: "Month 1", color: "from-emerald-500 to-green-600", badgeColor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300", tasks: ["Department orientation", "Role-specific training", "30-day check-in", "Benefits enrollment", "Company culture session"] },
  { key: "month2_3", label: "Month 2-3", color: "from-amber-500 to-orange-500", badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300", tasks: ["60-day performance review", "Cross-team collaboration", "Advanced tool training", "Goals setting", "90-day completion review"] },
];

const MANDATORY_TASKS = new Set([
  "Offer letter signed",
  "Background check",
  "System access setup",
  "Policy acknowledgement",
  "90-day completion review",
]);

function taskKeyFor(phase: string, task: string): string {
  return `${phase}__${task.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

export interface EmployeeItem {
  id: string;
  employeeCode?: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  personalEmail?: string;
  phone?: string;
  designation: string;
  departmentId?: string;
  departmentName?: string;
  reportingToId?: string;
  reportingManager?: string;
  buddyId?: string;
  buddyName?: string;
  locationId?: string;
  locationName?: string;
  joiningDate?: string;
  status: string;
  employmentType?: string;
}

export interface DepartmentItem {
  id: string;
  name: string;
  code: string;
}

export interface AssetItem {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  state: string;
}

export interface PendingHireItem {
  candidateId: string;
  applicationId: string | null;
  offerId: string | null;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  designation: string | null;
  offerStatus: string | null;
  annualCtcMinor: string | null;
  proposedStartDate: string | null;
  registrationSubmittedAt: string | null;
  ready: boolean;
  blockers: string[];
}

export interface LifecycleTask {
  id: string;
  taskKey: string;
  title: string;
  completed: boolean;
}

export interface LifecycleJourney {
  id: string;
  employeeId: string;
  status: string;
  progress: { total: number; completed: number; percent: number };
  blocking: { taskKey: string; title: string }[];
  tasks: LifecycleTask[];
}

function formatRupeesMinor(minor?: string | null): string {
  if (!minor) return "₹0";
  const num = Number(BigInt(minor) / 100n);
  return `₹${num.toLocaleString("en-IN")}`;
}

export default function OnboardingPage() {
  const rbac = useRBAC();
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [pendingHires, setPendingHires] = useState<PendingHireItem[]>([]);
  const [availableAssets, setAvailableAssets] = useState<AssetItem[]>([]);
  const [journeys, setJourneys] = useState<Record<string, LifecycleJourney>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters & Tabs
  const [search, setSearch] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [tab, setTab] = useState("onboarding");
  const [expandedJoinerId, setExpandedJoinerId] = useState<string | null>(null);

  // Modals state
  const [setupModalHire, setSetupModalHire] = useState<PendingHireItem | null>(null);
  const [editProfileEmployee, setEditProfileEmployee] = useState<EmployeeItem | null>(null);
  const [letterModalEmployee, setLetterModalEmployee] = useState<EmployeeItem | null>(null);
  const [assetModalEmployee, setAssetModalEmployee] = useState<EmployeeItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Setup Form State
  const [setupForm, setSetupForm] = useState({
    firstName: "",
    lastName: "",
    workEmail: "",
    personalEmail: "",
    phone: "",
    designation: "",
    departmentId: "",
    reportingToId: "",
    buddyId: "",
    joiningDate: new Date().toISOString().slice(0, 10),
    salary: "",
    employmentType: "full_time",
    issueAppointmentLetter: true,
    triggerMailboxInvite: true,
    assetId: "",
  });

  // Edit Profile Form State
  const [editForm, setEditForm] = useState({
    departmentId: "",
    reportingToId: "",
    designation: "",
    phone: "",
  });

  // Asset Assignment Form State
  const [selectedAssetId, setSelectedAssetId] = useState("");

  // Load All Data
  const loadData = useCallback(async () => {
    try {
      setRefreshing(true);
      const [empRes, deptRes, pendingRes, journeysRes, assetsRes] = await Promise.all([
        fetch("/api/employees?pageSize=200", { credentials: "include" }),
        fetch("/api/departments", { credentials: "include" }),
        fetch("/api/hires/pending", { credentials: "include" }),
        fetch("/api/lifecycle?kind=onboarding&pageSize=200", { credentials: "include" }),
        fetch("/api/assets?state=in_stock&pageSize=100", { credentials: "include" }),
      ]);

      if (empRes.ok) {
        const data = await empRes.json();
        const rawEmps = data.items || data.employees || data.data || [];
        const list = rawEmps.map((e: any) => ({
          id: e.id,
          employeeCode: e.employeeCode || e.employee_code || "",
          firstName: e.firstName || e.first_name || (e.name ? e.name.split(" ")[0] : "Admin"),
          lastName: e.lastName || e.last_name || (e.name ? e.name.split(" ").slice(1).join(" ") : ""),
          workEmail: e.workEmail || e.work_email || e.email || "",
          personalEmail: e.personalEmail || e.personal_email || "",
          phone: e.phone || "",
          designation: e.designation || "Administrator",
          departmentId: e.departmentId || e.department_id || "",
          departmentName: e.departmentName || e.department_name || e.department || "",
          reportingToId: e.reportingToId || e.reporting_to_id || "",
          reportingManager: e.reportingManager || e.reporting_manager || "",
          buddyId: e.buddyId || "",
          buddyName: e.buddyName || "",
          locationId: e.locationId || e.location_id || "",
          locationName: e.locationName || e.location_name || "",
          joiningDate: e.joiningDate || e.joining_date || e.joinDate || "",
          status: e.status || "active",
          employmentType: e.employmentType || e.employment_type || "full_time",
        }));
        setEmployees(list);
      }

      if (deptRes.ok) {
        const data = await deptRes.json();
        setDepartments(data.items || data.departments || data.data || []);
      }

      if (pendingRes.ok) {
        const data = await pendingRes.json();
        setPendingHires(data.items || []);
      }

      if (journeysRes.ok) {
        const data = await journeysRes.json();
        const byEmp: Record<string, LifecycleJourney> = {};
        for (const j of data.data || data.items || []) byEmp[j.employeeId] = j;
        setJourneys(byEmp);
      }

      if (assetsRes.ok) {
        const data = await assetsRes.json();
        setAvailableAssets(data.items || data.assets || data.data || []);
      }
    } catch (err) {
      console.error("Failed to load onboarding data:", err);
      toast.error("Could not load onboarding records");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute New Joiners (joined in last 90 days or joining in future)
  const newJoiners = useMemo(() => {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    return employees.filter((e) => {
      if (!e.joiningDate) return false;
      const jd = new Date(e.joiningDate);
      return jd >= ninetyDaysAgo && (e.status === "active" || e.status === "probation");
    });
  }, [employees]);

  // KPIs
  const activeOnboardingCount = newJoiners.length;
  const startingThisMonth = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    return employees.filter((e) => {
      if (!e.joiningDate) return false;
      const jd = new Date(e.joiningDate);
      return jd.getMonth() === currentMonth && jd.getFullYear() === currentYear;
    }).length;
  }, [employees]);

  const avgCompletion = useMemo(() => {
    if (newJoiners.length === 0) return 0;
    let sum = 0;
    let counted = 0;
    for (const emp of newJoiners) {
      const journey = journeys[emp.id];
      if (journey && journey.progress) {
        sum += journey.progress.percent;
        counted++;
      }
    }
    return counted > 0 ? Math.round(sum / counted) : 0;
  }, [newJoiners, journeys]);

  const getJoinerPhase = (joiningDate: string) => {
    const jd = new Date(joiningDate);
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - jd.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince < 0) return "pre";
    if (daysSince < 7) return "week1";
    if (daysSince < 30) return "month1";
    return "month2_3";
  };

  const isTaskDone = useCallback(
    (empId: string, phase: string, task: string) =>
      journeys[empId]?.tasks.find((t) => t.taskKey === taskKeyFor(phase, task))?.completed ?? false,
    [journeys]
  );

  // Ensure Journey exists on first toggle
  const ensureJourney = useCallback(
    async (emp: EmployeeItem): Promise<LifecycleJourney | null> => {
      const existing = journeys[emp.id];
      if (existing) return existing;

      const response = await fetch("/api/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          employeeId: emp.id,
          kind: "onboarding",
          anchorDate: emp.joiningDate ?? new Date().toISOString().slice(0, 10),
          tasks: PHASES.flatMap((phase, phaseIndex) =>
            phase.tasks.map((task) => ({
              taskKey: taskKeyFor(phase.key, task),
              title: task,
              phase: phase.key,
              phaseOrder: phaseIndex,
              mandatory: MANDATORY_TASKS.has(task),
            }))
          ),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Could not start onboarding checklist");
        return null;
      }

      const body = (await response.json()) as { data: LifecycleJourney };
      setJourneys((prev) => ({ ...prev, [emp.id]: body.data }));
      return body.data;
    },
    [journeys]
  );

  // Instant 0ms Optimistic Toggle
  const toggleTask = async (emp: EmployeeItem, phase: string, task: string) => {
    const key = taskKeyFor(phase, task);
    let previousJourney: LifecycleJourney | undefined;

    // 1. Optimistic Update (0ms)
    setJourneys((prev) => {
      const current = prev[emp.id];
      if (!current) return prev;
      previousJourney = current;

      const updatedTasks = current.tasks.map((t) =>
        t.taskKey === key ? { ...t, completed: !t.completed } : t
      );
      const completedCount = updatedTasks.filter((t) => t.completed).length;
      const totalCount = updatedTasks.length || 1;
      const percent = Math.round((completedCount / totalCount) * 100);

      return {
        ...prev,
        [emp.id]: {
          ...current,
          tasks: updatedTasks,
          progress: {
            ...current.progress,
            completedTasks: completedCount,
            percent,
          },
        },
      };
    });

    try {
      const journey = await ensureJourney(emp);
      if (!journey) {
        if (previousJourney) {
          setJourneys((prev) => ({ ...prev, [emp.id]: previousJourney! }));
        }
        return;
      }

      const existing = journey.tasks.find((t) => t.taskKey === key);
      if (!existing) {
        toast.error("That task is not on this checklist");
        if (previousJourney) {
          setJourneys((prev) => ({ ...prev, [emp.id]: previousJourney! }));
        }
        return;
      }

      const targetCompleted = previousJourney
        ? !previousJourney.tasks.find((t) => t.taskKey === key)?.completed
        : !existing.completed;

      const response = await fetch(`/api/lifecycle/tasks/${existing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ completed: targetCompleted }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        data?: LifecycleJourney;
        error?: string;
      };

      if (!response.ok || !body.data) {
        toast.error(body.error ?? "That task could not be saved");
        if (previousJourney) {
          setJourneys((prev) => ({ ...prev, [emp.id]: previousJourney! }));
        }
        return;
      }

      setJourneys((prev) => ({ ...prev, [emp.id]: body.data! }));
    } catch {
      toast.error("That task could not be saved");
      if (previousJourney) {
        setJourneys((prev) => ({ ...prev, [emp.id]: previousJourney! }));
      }
    }
  };

  // Filtered Joiners
  const filteredJoiners = useMemo(() => {
    let result = newJoiners;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
          e.departmentName?.toLowerCase().includes(q) ||
          e.designation?.toLowerCase().includes(q) ||
          e.reportingManager?.toLowerCase().includes(q)
      );
    }
    if (phaseFilter !== "all") {
      result = result.filter((e) => getJoinerPhase(e.joiningDate!) === phaseFilter);
    }
    return result;
  }, [newJoiners, search, phaseFilter]);

  // Open Setup Modal for Pending Hire
  const openSetupModal = (hire: PendingHireItem) => {
    setSetupModalHire(hire);
    const suggestedEmail = `${hire.firstName.toLowerCase()}.${hire.lastName.toLowerCase()}@circuvent.com`.replace(
      /\s+/g,
      ""
    );
    const annualSalaryNum = hire.annualCtcMinor ? Number(BigInt(hire.annualCtcMinor) / 100n) : "";

    setSetupForm({
      firstName: hire.firstName,
      lastName: hire.lastName,
      workEmail: suggestedEmail,
      personalEmail: hire.email,
      phone: hire.phone || "",
      designation: hire.designation || "Software Engineer",
      departmentId: departments[0]?.id || "none",
      reportingToId: employees[0]?.id || "none",
      buddyId: "none",
      joiningDate: hire.proposedStartDate || new Date().toISOString().slice(0, 10),
      salary: annualSalaryNum.toString(),
      employmentType: "full_time",
      issueAppointmentLetter: true,
      triggerMailboxInvite: true,
      assetId: availableAssets[0]?.id || "none",
    });
  };

  // Submit Setup Modal (Convert ATS Hire to HRMS Employee)
  const handleSetupSubmit = async () => {
    if (!setupForm.firstName || !setupForm.lastName || !setupForm.workEmail || !setupForm.designation) {
      toast.error("Please fill all required fields");
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch("/api/onboarding/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          candidateId: setupModalHire?.candidateId,
          applicationId: setupModalHire?.applicationId,
          offerId: setupModalHire?.offerId,
          firstName: setupForm.firstName,
          lastName: setupForm.lastName,
          workEmail: setupForm.workEmail,
          personalEmail: setupForm.personalEmail || undefined,
          phone: setupForm.phone || undefined,
          designation: setupForm.designation,
          departmentId: setupForm.departmentId && setupForm.departmentId !== "none" ? setupForm.departmentId : undefined,
          reportingToId: setupForm.reportingToId && setupForm.reportingToId !== "none" ? setupForm.reportingToId : undefined,
          buddyId: setupForm.buddyId && setupForm.buddyId !== "none" ? setupForm.buddyId : undefined,
          joiningDate: setupForm.joiningDate,
          salary: setupForm.salary ? Number(setupForm.salary) : undefined,
          employmentType: setupForm.employmentType,
          issueAppointmentLetter: setupForm.issueAppointmentLetter,
          triggerMailboxInvite: setupForm.triggerMailboxInvite,
          assetId: setupForm.assetId && setupForm.assetId !== "none" ? setupForm.assetId : undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Failed to complete employee onboarding");
        return;
      }

      toast.success("Employee onboarded! Manager assigned & appointment pack dispatched.");
      setSetupModalHire(null);
      loadData();
    } catch {
      toast.error("Failed to complete onboarding");
    } finally {
      setActionLoading(false);
    }
  };

  // Edit Profile Submit (Manager / Department)
  const handleEditProfileSubmit = async () => {
    if (!editProfileEmployee) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/employees/${editProfileEmployee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          departmentId: editForm.departmentId || undefined,
          reportingToId: editForm.reportingToId || undefined,
          designation: editForm.designation || undefined,
          phone: editForm.phone || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Failed to update profile");
        return;
      }

      toast.success("Onboarding profile & manager updated successfully");
      setEditProfileEmployee(null);
      loadData();
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setActionLoading(false);
    }
  };

  // Issue Appointment Letter directly from action
  const handleIssueLetter = async (emp: EmployeeItem) => {
    setActionLoading(true);
    try {
      const docRes = await fetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          employeeId: emp.id,
          title: `Appointment Letter - ${emp.firstName} ${emp.lastName}`,
          extraValues: {
            candidate_name: `${emp.firstName} ${emp.lastName}`,
            designation: emp.designation,
            join_date: emp.joiningDate,
          },
        }),
      });

      if (!docRes.ok) {
        const body = await docRes.json().catch(() => ({}));
        toast.error(body.error || "Could not generate appointment letter");
        return;
      }

      toast.success(`Appointment letter generated & sent to ${emp.workEmail}`);
      setLetterModalEmployee(null);
      loadData();
    } catch {
      toast.error("Could not generate appointment letter");
    } finally {
      setActionLoading(false);
    }
  };

  // Assign IT Asset
  const handleAssignAssetSubmit = async () => {
    if (!assetModalEmployee || !selectedAssetId) {
      toast.error("Please select an asset");
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/assets/${selectedAssetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "issue",
          employeeId: assetModalEmployee.id,
          condition: "good",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Could not allocate asset");
        return;
      }

      toast.success(`Hardware allocated to ${assetModalEmployee.firstName}`);
      setAssetModalEmployee(null);
      setSelectedAssetId("");
      loadData();
    } catch {
      toast.error("Could not allocate asset");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center shadow-md">
              <UserPlus className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
                Employee Onboarding
              </h1>
              <p className="text-sm text-muted-foreground">
                ATS hire integration, manager assignments, mailbox provisioning &amp; 90-day lifecycle
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={refreshing} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Onboarding</p>
                <p className="text-2xl font-bold mt-1 text-violet-600">{activeOnboardingCount}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Joiners in 90-day window</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-violet-100 dark:bg-violet-950/50 flex items-center justify-center text-violet-600">
                <Users className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Starting This Month</p>
                <p className="text-2xl font-bold mt-1 text-blue-600">{startingThisMonth}</p>
                <p className="text-xs text-muted-foreground mt-0.5">New team members</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center text-blue-600">
                <Calendar className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending ATS Starters</p>
                <p className="text-2xl font-bold mt-1 text-amber-600">{pendingHires.length}</p>
                <p className="text-xs text-amber-600 mt-0.5">Accepted offers ready to setup</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center text-amber-600">
                <UserCheck className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg 90-Day Progress</p>
                <p className="text-2xl font-bold mt-1 text-emerald-600">{avgCompletion}%</p>
                <p className="text-xs text-muted-foreground mt-0.5">Checklist completion rate</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
                <Target className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-2">
          <TabsList className="bg-muted/60 p-1">
            <TabsTrigger value="onboarding" className="gap-2">
              <Users className="h-4 w-4" /> Active Joiners ({newJoiners.length})
            </TabsTrigger>
            <TabsTrigger value="pending_ats" className="gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" /> Pending ATS Starters ({pendingHires.length})
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Active Onboarding Joiners */}
        <TabsContent value="onboarding" className="space-y-4 mt-4">
          {/* Search & Phase Filter */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search joiners by name, manager, department..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card"
              />
            </div>

            <Select value={phaseFilter} onValueChange={setPhaseFilter}>
              <SelectTrigger className="w-[180px] bg-card">
                <SelectValue placeholder="Filter by phase" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Phases</SelectItem>
                {PHASES.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Joiners List */}
          {filteredJoiners.length === 0 ? (
            <div className="py-16 text-center border rounded-2xl bg-card/40">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
              <h3 className="text-lg font-semibold">No joiners found</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                No active onboarding joiners matched your filter criteria.
              </p>
              {pendingHires.length > 0 && (
                <Button onClick={() => setTab("pending_ats")} className="mt-4 gap-2 bg-violet-600 text-white">
                  View {pendingHires.length} Pending ATS Starters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredJoiners.map((joiner) => {
                const phaseKey = getJoinerPhase(joiner.joiningDate!);
                const phaseInfo = PHASES.find((p) => p.key === phaseKey) || PHASES[0];
                const journey = journeys[joiner.id];
                const isExpanded = expandedJoinerId === joiner.id;

                const completedCount = journey?.progress?.completed ?? 0;
                const totalTasksCount = journey?.progress?.total ?? 20;
                const progressPercent = journey?.progress?.percent ?? 0;

                return (
                  <Card
                    key={joiner.id}
                    className="border shadow-sm bg-card/80 backdrop-blur-sm overflow-hidden hover:border-violet-300 dark:hover:border-violet-800 transition-colors"
                  >
                    <CardContent className="p-5 space-y-4">
                      {/* Top Row */}
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <Avatar className="h-12 w-12 border shadow-sm">
                            <AvatarFallback className="bg-gradient-to-br from-violet-500 to-indigo-600 text-white font-bold text-base">
                              {joiner.firstName[0]}
                              {joiner.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-bold text-base">
                                {joiner.firstName} {joiner.lastName}
                              </h3>
                              {joiner.employeeCode && (
                                <span className="font-mono text-xs text-violet-600 bg-violet-50 dark:bg-violet-950/60 px-1.5 py-0.5 rounded border border-violet-200 dark:border-violet-800">
                                  {joiner.employeeCode}
                                </span>
                              )}
                              <Badge variant="outline" className={cn("text-xs", phaseInfo.badgeColor)}>
                                {phaseInfo.label}
                              </Badge>
                            </div>

                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                              <span className="font-medium text-foreground">{joiner.designation}</span>
                              <span>•</span>
                              <span>{joiner.departmentName || "Engineering"}</span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3.5 w-3.5" /> Joined {joiner.joiningDate}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Profile Badges: Manager & Buddy */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/60 border text-xs">
                            <UserCheck className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-muted-foreground">Manager:</span>
                            <span className="font-semibold">{joiner.reportingManager || "Vema Naidu (CEO)"}</span>
                          </div>

                          {joiner.buddyName && (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/60 border text-xs">
                              <HeartHandshake className="h-3.5 w-3.5 text-pink-500" />
                              <span className="text-muted-foreground">Buddy:</span>
                              <span className="font-semibold">{joiner.buddyName}</span>
                            </div>
                          )}

                          {/* Action Dropdown */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuLabel>Onboarding Actions</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditProfileEmployee(joiner);
                                  setEditForm({
                                    departmentId: joiner.departmentId || "",
                                    reportingToId: joiner.reportingToId || "",
                                    designation: joiner.designation,
                                    phone: joiner.phone || "",
                                  });
                                }}
                              >
                                <UserCog className="h-4 w-4 mr-2 text-violet-600" /> Edit Manager &amp; Team
                              </DropdownMenuItem>

                              <DropdownMenuItem onClick={() => handleIssueLetter(joiner)}>
                                <FileText className="h-4 w-4 mr-2 text-blue-600" /> Issue Appointment Letter
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                onClick={() => {
                                  setAssetModalEmployee(joiner);
                                  setSelectedAssetId(availableAssets[0]?.id || "");
                                }}
                              >
                                <Package className="h-4 w-4 mr-2 text-emerald-600" /> Allocate IT Equipment
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                onClick={() => {
                                  toast.success(`Mailbox claim invite dispatched to ${joiner.workEmail}`);
                                }}
                              >
                                <Mail className="h-4 w-4 mr-2 text-amber-500" /> Resend Mailbox Invite
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {/* Progress Bar & Accordion Trigger */}
                      <div className="space-y-2 pt-2 border-t">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">90-Day Milestone Progress</span>
                          <span className="font-bold text-violet-600">{progressPercent}% Completed</span>
                        </div>
                        <Progress value={progressPercent} className="h-2" />
                      </div>

                      {/* Accordion Toggle */}
                      <div className="flex items-center justify-between pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground hover:text-foreground gap-1.5 p-0 h-auto"
                          onClick={() => setExpandedJoinerId(isExpanded ? null : joiner.id)}
                        >
                          <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                          {isExpanded ? "Collapse" : "View"} 90-Day Checklist ({completedCount}/{totalTasksCount} tasks)
                        </Button>
                      </div>

                      {/* Expanded Checklist */}
                      {isExpanded && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t">
                          {PHASES.map((p) => (
                            <div key={p.key} className="space-y-2 p-3 rounded-xl bg-muted/40 border">
                              <div className="flex items-center gap-2">
                                <div className={cn("h-2.5 w-2.5 rounded-full bg-gradient-to-r", p.color)} />
                                <h4 className="font-semibold text-xs">{p.label}</h4>
                              </div>

                              <div className="space-y-1.5 pt-1">
                                {p.tasks.map((taskTitle) => {
                                  const done = isTaskDone(joiner.id, p.key, taskTitle);
                                  const isMandatory = MANDATORY_TASKS.has(taskTitle);

                                  return (
                                    <div
                                      key={taskTitle}
                                      className="flex items-start gap-2.5 py-1 px-1.5 rounded-lg hover:bg-muted/80 transition-colors"
                                    >
                                      <Checkbox
                                        checked={done}
                                        onCheckedChange={() => void toggleTask(joiner, p.key, taskTitle)}
                                        aria-label={taskTitle}
                                        className="mt-0.5"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <p
                                          className={cn(
                                            "text-xs leading-snug cursor-pointer select-none",
                                            done ? "line-through text-muted-foreground" : "text-foreground font-medium"
                                          )}
                                          onClick={() => void toggleTask(joiner, p.key, taskTitle)}
                                        >
                                          {taskTitle}
                                          {isMandatory && (
                                            <span className="ml-1 text-[10px] text-amber-600 font-semibold">*</span>
                                          )}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
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

        {/* Tab 2: Pending ATS Starters (Accepted Offers) */}
        <TabsContent value="pending_ats" className="space-y-4 mt-4">
          <Card className="border shadow-sm bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" /> Pending Joiners from ATS
              </CardTitle>
              <CardDescription>
                Candidates who have accepted formal job offers in ATS and are ready to be provisioned into HRMS.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pendingHires.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <UserCheck className="h-10 w-10 mx-auto text-emerald-500 mb-2" />
                  <p className="font-semibold text-base">All accepted offers have been onboarded!</p>
                  <p className="text-xs mt-1">No candidates currently waiting in the ATS handoff queue.</p>
                </div>
              ) : (
                <div className="border rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Candidate</TableHead>
                        <TableHead>Designation</TableHead>
                        <TableHead>Proposed Start Date</TableHead>
                        <TableHead>Annual CTC</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingHires.map((hire) => (
                        <TableRow key={hire.candidateId} className="hover:bg-muted/40">
                          <TableCell>
                            <div>
                              <p className="font-bold text-sm">{hire.name}</p>
                              <p className="text-xs text-muted-foreground">{hire.email}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium text-sm">{hire.designation || "New Hire"}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {hire.proposedStartDate ? (
                              <span className="flex items-center gap-1 text-blue-600 font-semibold">
                                <Calendar className="h-3.5 w-3.5" /> {hire.proposedStartDate}
                              </span>
                            ) : (
                              "Immediate"
                            )}
                          </TableCell>
                          <TableCell className="font-bold text-sm text-foreground">
                            {formatRupeesMinor(hire.annualCtcMinor)}
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
                              Offer Accepted
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-sm gap-1.5"
                              onClick={() => openSetupModal(hire)}
                            >
                              <UserPlus className="h-3.5 w-3.5" /> Complete Onboarding
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: COMPLETE ONBOARDING SETUP (ATS HIRE -> HRMS)             */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={!!setupModalHire} onOpenChange={(open) => !open && setSetupModalHire(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-600" /> Complete Employee Onboarding Setup
            </DialogTitle>
            <DialogDescription>
              Assign reporting manager, department, equipment, and dispatch the joining pack for {setupModalHire?.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>First Name *</Label>
              <Input
                value={setupForm.firstName}
                onChange={(e) => setSetupForm({ ...setupForm, firstName: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Last Name *</Label>
              <Input
                value={setupForm.lastName}
                onChange={(e) => setSetupForm({ ...setupForm, lastName: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Company Work Email (@circuvent.com) *</Label>
              <Input
                value={setupForm.workEmail}
                onChange={(e) => setSetupForm({ ...setupForm, workEmail: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Designation / Role *</Label>
              <Input
                value={setupForm.designation}
                onChange={(e) => setSetupForm({ ...setupForm, designation: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Department / Team *</Label>
              <Select
                value={setupForm.departmentId || "none"}
                onValueChange={(val) => setSetupForm({ ...setupForm, departmentId: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.length === 0 ? (
                    <SelectItem value="none">General / Unassigned</SelectItem>
                  ) : (
                    departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name} ({d.code || "DEPT"})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Reporting Manager *</Label>
              <Select
                value={setupForm.reportingToId || "none"}
                onValueChange={(val) => setSetupForm({ ...setupForm, reportingToId: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select reporting manager" />
                </SelectTrigger>
                <SelectContent>
                  {employees.length === 0 ? (
                    <SelectItem value="none">Company Management (Direct)</SelectItem>
                  ) : (
                    employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.firstName} {e.lastName} ({e.designation || e.workEmail || "Admin"})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Onboarding Buddy (Optional)</Label>
              <Select
                value={setupForm.buddyId || "none"}
                onValueChange={(val) => setSetupForm({ ...setupForm, buddyId: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Assign a peer buddy..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Buddy Assigned</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.firstName} {e.lastName} ({e.designation || e.workEmail})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Joining Date *</Label>
              <Input
                type="date"
                value={setupForm.joiningDate}
                onChange={(e) => setSetupForm({ ...setupForm, joiningDate: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Annual CTC (₹)</Label>
              <Input
                type="number"
                value={setupForm.salary}
                onChange={(e) => setSetupForm({ ...setupForm, salary: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Allocate IT Equipment</Label>
              <Select
                value={setupForm.assetId || "none"}
                onValueChange={(val) => setSetupForm({ ...setupForm, assetId: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose hardware..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Assign Later (In Stock)</SelectItem>
                  {availableAssets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.assetTag || (a as any).serialNumber || "Asset"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Automation Checklist Toggles */}
            <div className="md:col-span-2 p-3.5 rounded-xl bg-violet-50/60 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-900 space-y-2.5">
              <p className="text-xs font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider">
                Automated Joining Pack Actions
              </p>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="chk-letter"
                  checked={setupForm.issueAppointmentLetter}
                  onCheckedChange={(checked) =>
                    setSetupForm({ ...setupForm, issueAppointmentLetter: Boolean(checked) })
                  }
                />
                <label htmlFor="chk-letter" className="text-xs font-medium cursor-pointer">
                  Generate official Appointment Letter PDF &amp; log into Documents Repository
                </label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="chk-mailbox"
                  checked={setupForm.triggerMailboxInvite}
                  onCheckedChange={(checked) =>
                    setSetupForm({ ...setupForm, triggerMailboxInvite: Boolean(checked) })
                  }
                />
                <label htmlFor="chk-mailbox" className="text-xs font-medium cursor-pointer">
                  Provision Domain Mailbox &amp; send onboarding account claim invite
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSetupModalHire(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSetupSubmit}
              disabled={actionLoading}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
            >
              {actionLoading ? "Provisioning..." : "Onboard & Dispatch Pack"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: EDIT ONBOARDING PROFILE & MANAGER                        */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={!!editProfileEmployee} onOpenChange={(open) => !open && setEditProfileEmployee(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Onboarding Profile</DialogTitle>
            <DialogDescription>
              Update team, manager and contact details for {editProfileEmployee?.firstName}{" "}
              {editProfileEmployee?.lastName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Reporting Manager</Label>
              <Select
                value={editForm.reportingToId || "none"}
                onValueChange={(val) => setEditForm({ ...editForm, reportingToId: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent>
                  {employees.filter((e) => e.id !== editProfileEmployee?.id).length === 0 ? (
                    <SelectItem value="none">Company Management (Direct)</SelectItem>
                  ) : (
                    employees
                      .filter((e) => e.id !== editProfileEmployee?.id)
                      .map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.firstName} {e.lastName} ({e.designation || e.workEmail || "Admin"})
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Department</Label>
              <Select
                value={editForm.departmentId || "none"}
                onValueChange={(val) => setEditForm({ ...editForm, departmentId: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.length === 0 ? (
                    <SelectItem value="none">General / Unassigned</SelectItem>
                  ) : (
                    departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name} ({d.code || "DEPT"})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Designation</Label>
              <Input
                value={editForm.designation}
                onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProfileEmployee(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEditProfileSubmit}
              disabled={actionLoading}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
            >
              {actionLoading ? "Saving..." : "Save Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: ALLOCATE IT EQUIPMENT                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={!!assetModalEmployee} onOpenChange={(open) => !open && setAssetModalEmployee(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Allocate IT Hardware</DialogTitle>
            <DialogDescription>
              Assign available hardware from inventory to {assetModalEmployee?.firstName}{" "}
              {assetModalEmployee?.lastName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Available In-Stock Equipment</Label>
              <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose hardware..." />
                </SelectTrigger>
                <SelectContent>
                  {availableAssets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.assetTag}) • {a.category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetModalEmployee(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleAssignAssetSubmit}
              disabled={actionLoading || !selectedAssetId}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {actionLoading ? "Allocating..." : "Confirm Allocation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
