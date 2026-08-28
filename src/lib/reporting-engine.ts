// ═══════════════════════════════════════════════════════════════
// HR REPORTING & ANALYTICS ENGINE
// Comprehensive analytics computations, report generation,
// trend analysis, and workforce metrics calculations
// ═══════════════════════════════════════════════════════════════

import type { EmployeeDoc, PayrollDoc, LeaveDoc, AttendanceDoc, GoalDoc, ExpenseDoc } from "@/stores/unified-store";

// ─── Workforce Analytics ─────────────────────────────────────

export interface WorkforceMetrics {
  totalHeadcount: number;
  activeCount: number;
  inactiveCount: number;
  probationCount: number;
  noticeCount: number;
  departmentDistribution: Record<string, number>;
  locationDistribution: Record<string, number>;
  employmentTypeDistribution: Record<string, number>;
  genderDistribution: Record<string, number>;
  averageTenure: number;
  newHiresThisMonth: number;
  newHiresThisQuarter: number;
  attritionRate: number;
  retentionRate: number;
  avgSalary: number;
  medianSalary: number;
  totalPayrollCost: number;
}

export function computeWorkforceMetrics(employees: EmployeeDoc[]): WorkforceMetrics {
  const active = employees.filter(e => e.status === "active");
  const inactive = employees.filter(e => e.status === "inactive" || e.status === "terminated");
  const probation = employees.filter(e => e.status === "probation");
  const notice = employees.filter(e => e.status === "notice_period");

  const departmentDistribution: Record<string, number> = {};
  const locationDistribution: Record<string, number> = {};
  const employmentTypeDistribution: Record<string, number> = {};

  employees.forEach(e => {
    const dept = e.department || "Unassigned";
    departmentDistribution[dept] = (departmentDistribution[dept] || 0) + 1;
    
    const loc = e.location || "Unknown";
    locationDistribution[loc] = (locationDistribution[loc] || 0) + 1;

    const type = e.employmentType || "Full-time";
    employmentTypeDistribution[type] = (employmentTypeDistribution[type] || 0) + 1;
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

  const newHiresThisMonth = employees.filter(e => {
    if (!e.joiningDate) return false;
    return new Date(e.joiningDate) >= monthStart;
  }).length;

  const newHiresThisQuarter = employees.filter(e => {
    if (!e.joiningDate) return false;
    return new Date(e.joiningDate) >= quarterStart;
  }).length;

  // Calculate average tenure
  const tenures = employees.filter(e => e.joiningDate).map(e => {
    const joinDate = new Date(e.joiningDate);
    return (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  });
  const averageTenure = tenures.length > 0 ? tenures.reduce((a, b) => a + b, 0) / tenures.length : 0;

  // Salary metrics
  const salaries = employees.filter(e => e.salary && e.salary > 0).map(e => e.salary as number);
  const avgSalary = salaries.length > 0 ? salaries.reduce((a, b) => a + b, 0) / salaries.length : 0;
  const sortedSalaries = [...salaries].sort((a, b) => a - b);
  const medianSalary = sortedSalaries.length > 0 
    ? sortedSalaries.length % 2 === 0
      ? (sortedSalaries[sortedSalaries.length / 2 - 1] + sortedSalaries[sortedSalaries.length / 2]) / 2
      : sortedSalaries[Math.floor(sortedSalaries.length / 2)]
    : 0;

  const totalPayrollCost = salaries.reduce((a, b) => a + b, 0);
  const attritionRate = employees.length > 0 ? (inactive.length / employees.length) * 100 : 0;
  const retentionRate = 100 - attritionRate;

  return {
    totalHeadcount: employees.length,
    activeCount: active.length,
    inactiveCount: inactive.length,
    probationCount: probation.length,
    noticeCount: notice.length,
    departmentDistribution,
    locationDistribution,
    employmentTypeDistribution,
    genderDistribution: {},
    averageTenure: Math.round(averageTenure * 10) / 10,
    newHiresThisMonth,
    newHiresThisQuarter,
    attritionRate: Math.round(attritionRate * 10) / 10,
    retentionRate: Math.round(retentionRate * 10) / 10,
    avgSalary: Math.round(avgSalary),
    medianSalary: Math.round(medianSalary),
    totalPayrollCost: Math.round(totalPayrollCost),
  };
}

// ─── Payroll Analytics ───────────────────────────────────────

export interface PayrollMetrics {
  totalGross: number;
  totalNet: number;
  totalDeductions: number;
  processedCount: number;
  pendingCount: number;
  avgSalary: number;
  highestSalary: number;
  lowestSalary: number;
  departmentCosts: Array<{ department: string; cost: number; headcount: number; avg: number }>;
  monthlyTrend: Array<{ month: string; gross: number; net: number; deductions: number }>;
  componentBreakdown: Array<{ component: string; amount: number; percentage: number }>;
}

export function computePayrollMetrics(payroll: PayrollDoc[]): PayrollMetrics {
  const totalGross = payroll.reduce((s, p) => s + (p.grossEarnings || 0), 0);
  const totalNet = payroll.reduce((s, p) => s + (p.netPay || 0), 0);
  const totalDeductions = payroll.reduce((s, p) => s + (p.totalDeductions || 0), 0);
  const processedCount = payroll.filter(p => p.status === "processed" || p.status === "paid").length;
  const pendingCount = payroll.filter(p => p.status === "draft" || p.status === "processing").length;

  const netPays = payroll.filter(p => (p.netPay || 0) > 0).map(p => p.netPay || 0);
  const avgSalary = netPays.length > 0 ? netPays.reduce((a, b) => a + b, 0) / netPays.length : 0;
  const highestSalary = Math.max(...netPays, 0);
  const lowestSalary = netPays.length > 0 ? Math.min(...netPays) : 0;

  // Department costs
  const deptMap = new Map<string, { cost: number; count: number }>();
  payroll.forEach(p => {
    const dept = p.department || "Other";
    const existing = deptMap.get(dept) || { cost: 0, count: 0 };
    existing.cost += p.netPay || 0;
    existing.count += 1;
    deptMap.set(dept, existing);
  });
  const departmentCosts = Array.from(deptMap.entries()).map(([department, data]) => ({
    department, cost: data.cost, headcount: data.count, avg: Math.round(data.cost / data.count),
  })).sort((a, b) => b.cost - a.cost);

  // Monthly trend
  const monthMap = new Map<string, { gross: number; net: number; deductions: number }>();
  payroll.forEach(p => {
    const key = `${p.month || "Unknown"} ${p.year || ""}`.trim();
    const existing = monthMap.get(key) || { gross: 0, net: 0, deductions: 0 };
    existing.gross += p.grossEarnings || 0;
    existing.net += p.netPay || 0;
    existing.deductions += p.totalDeductions || 0;
    monthMap.set(key, existing);
  });
  const monthlyTrend = Array.from(monthMap.entries()).map(([month, data]) => ({
    month, ...data,
  }));

  // Component breakdown
  const totalBasic = payroll.reduce((s, p) => s + (p.basicPay || 0), 0);
  const totalHRA = payroll.reduce((s, p) => s + (p.hra || 0), 0);
  const totalSpecial = payroll.reduce((s, p) => s + (p.specialAllowance || 0), 0);
  const totalComponent = totalBasic + totalHRA + totalSpecial + totalDeductions;
  const componentBreakdown = [
    { component: "Basic Pay", amount: totalBasic, percentage: totalComponent > 0 ? Math.round((totalBasic / totalComponent) * 100) : 0 },
    { component: "HRA", amount: totalHRA, percentage: totalComponent > 0 ? Math.round((totalHRA / totalComponent) * 100) : 0 },
    { component: "Special Allowance", amount: totalSpecial, percentage: totalComponent > 0 ? Math.round((totalSpecial / totalComponent) * 100) : 0 },
    { component: "Deductions", amount: totalDeductions, percentage: totalComponent > 0 ? Math.round((totalDeductions / totalComponent) * 100) : 0 },
  ];

  return {
    totalGross: Math.round(totalGross),
    totalNet: Math.round(totalNet),
    totalDeductions: Math.round(totalDeductions),
    processedCount,
    pendingCount,
    avgSalary: Math.round(avgSalary),
    highestSalary: Math.round(highestSalary),
    lowestSalary: Math.round(lowestSalary),
    departmentCosts,
    monthlyTrend,
    componentBreakdown,
  };
}

// ─── Leave Analytics ─────────────────────────────────────────

export interface LeaveMetrics {
  totalRequests: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  cancelledCount: number;
  totalDaysTaken: number;
  avgDaysPerRequest: number;
  typeDistribution: Array<{ type: string; count: number; days: number }>;
  monthlyTrend: Array<{ month: string; approved: number; rejected: number; pending: number }>;
  departmentUsage: Array<{ department: string; requests: number; days: number }>;
  topReasons: Array<{ reason: string; count: number }>;
}

export function computeLeaveMetrics(leaves: LeaveDoc[]): LeaveMetrics {
  const pending = leaves.filter(l => l.status === "pending");
  const approved = leaves.filter(l => l.status === "approved");
  const rejected = leaves.filter(l => l.status === "rejected");
  const cancelled = leaves.filter(l => l.status === "cancelled");

  const totalDaysTaken = leaves.reduce((s, l) => s + (l.days || 0), 0);
  const avgDaysPerRequest = leaves.length > 0 ? totalDaysTaken / leaves.length : 0;

  // Type distribution
  const typeMap = new Map<string, { count: number; days: number }>();
  leaves.forEach(l => {
    const type = l.leaveType || "Other";
    const existing = typeMap.get(type) || { count: 0, days: 0 };
    existing.count += 1;
    existing.days += l.days || 0;
    typeMap.set(type, existing);
  });
  const typeDistribution = Array.from(typeMap.entries()).map(([type, data]) => ({
    type, ...data,
  })).sort((a, b) => b.count - a.count);

  // Department usage
  const deptMap = new Map<string, { requests: number; days: number }>();
  leaves.forEach(l => {
    const dept = l.department || "Other";
    const existing = deptMap.get(dept) || { requests: 0, days: 0 };
    existing.requests += 1;
    existing.days += l.days || 0;
    deptMap.set(dept, existing);
  });
  const departmentUsage = Array.from(deptMap.entries()).map(([department, data]) => ({
    department, ...data,
  })).sort((a, b) => b.requests - a.requests);

  return {
    totalRequests: leaves.length,
    pendingCount: pending.length,
    approvedCount: approved.length,
    rejectedCount: rejected.length,
    cancelledCount: cancelled.length,
    totalDaysTaken: Math.round(totalDaysTaken),
    avgDaysPerRequest: Math.round(avgDaysPerRequest * 10) / 10,
    typeDistribution,
    monthlyTrend: [],
    departmentUsage,
    topReasons: [],
  };
}

// ─── Attendance Metrics ──────────────────────────────────────

export interface AttendanceMetrics {
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  wfhCount: number;
  onLeaveCount: number;
  attendanceRate: number;
  avgWorkingHours: number;
  totalOvertimeHours: number;
  regularizationPending: number;
  departmentAttendance: Array<{ department: string; present: number; total: number; rate: number }>;
}

export function computeAttendanceMetrics(attendance: AttendanceDoc[]): AttendanceMetrics {
  const present = attendance.filter(a => a.status === "present");
  const absent = attendance.filter(a => a.status === "absent");
  const late = attendance.filter(a => a.status === "late");
  const wfh = attendance.filter(a => a.status === "wfh");
  const onLeave = attendance.filter(a => a.status === "on_leave");

  const attendanceRate = attendance.length > 0 
    ? ((present.length + late.length + wfh.length) / attendance.length) * 100 : 0;

  const totalHours = attendance.reduce((s, a) => s + (a.hours || 0), 0);
  const avgWorkingHours = attendance.filter(a => (a.hours || 0) > 0).length > 0
    ? totalHours / attendance.filter(a => (a.hours || 0) > 0).length : 0;

  const totalOvertimeHours = attendance.reduce((s, a) => s + (a.overtime || 0), 0);

  // Department attendance
  const deptMap = new Map<string, { present: number; total: number }>();
  attendance.forEach(a => {
    const dept = (a as unknown as { department?: string }).department || "Unknown";
    const existing = deptMap.get(dept) || { present: 0, total: 0 };
    existing.total += 1;
    if (a.status === "present" || a.status === "late" || a.status === "wfh") existing.present += 1;
    deptMap.set(dept, existing);
  });
  const departmentAttendance = Array.from(deptMap.entries()).map(([department, data]) => ({
    department, ...data, rate: data.total > 0 ? Math.round((data.present / data.total) * 100) : 0,
  }));

  return {
    totalRecords: attendance.length,
    presentCount: present.length,
    absentCount: absent.length,
    lateCount: late.length,
    wfhCount: wfh.length,
    onLeaveCount: onLeave.length,
    attendanceRate: Math.round(attendanceRate * 10) / 10,
    avgWorkingHours: Math.round(avgWorkingHours * 10) / 10,
    totalOvertimeHours: Math.round(totalOvertimeHours * 10) / 10,
    regularizationPending: 0,
    departmentAttendance,
  };
}

// ─── Performance Analytics ───────────────────────────────────

export interface PerformanceMetrics {
  totalGoals: number;
  completedGoals: number;
  onTrackGoals: number;
  atRiskGoals: number;
  behindGoals: number;
  avgProgress: number;
  completionRate: number;
  statusDistribution: Array<{ status: string; count: number }>;
  categoryDistribution: Array<{ category: string; count: number; avgProgress: number }>;
  topPerformers: Array<{ employeeId: string; goals: number; avgProgress: number }>;
}

export function computePerformanceMetrics(goals: GoalDoc[]): PerformanceMetrics {
  const completed = goals.filter(g => g.status === "completed");
  const onTrack = goals.filter(g => g.status === "on_track" || g.status === "in_progress");
  const atRisk = goals.filter(g => g.status === "at_risk");
  const behind = goals.filter(g => g.status === "behind" || g.status === "not_started");

  const avgProgress = goals.length > 0 
    ? goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length : 0;

  const completionRate = goals.length > 0 ? (completed.length / goals.length) * 100 : 0;

  // Status distribution
  const statusMap = new Map<string, number>();
  goals.forEach(g => {
    const status = (g.status || "unknown").replace(/_/g, " ");
    statusMap.set(status, (statusMap.get(status) || 0) + 1);
  });
  const statusDistribution = Array.from(statusMap.entries()).map(([status, count]) => ({
    status, count,
  }));

  // Category distribution
  const catMap = new Map<string, { count: number; totalProgress: number }>();
  goals.forEach(g => {
    const cat = g.category || "General";
    const existing = catMap.get(cat) || { count: 0, totalProgress: 0 };
    existing.count += 1;
    existing.totalProgress += g.progress || 0;
    catMap.set(cat, existing);
  });
  const categoryDistribution = Array.from(catMap.entries()).map(([category, data]) => ({
    category, count: data.count, avgProgress: Math.round(data.totalProgress / data.count),
  }));

  // Top performers by employee
  const empGoalMap = new Map<string, { goals: number; totalProgress: number }>();
  goals.forEach(g => {
    const empId = g.employeeId || "unknown";
    const existing = empGoalMap.get(empId) || { goals: 0, totalProgress: 0 };
    existing.goals += 1;
    existing.totalProgress += g.progress || 0;
    empGoalMap.set(empId, existing);
  });
  const topPerformers = Array.from(empGoalMap.entries())
    .map(([employeeId, data]) => ({
      employeeId, goals: data.goals, avgProgress: Math.round(data.totalProgress / data.goals),
    }))
    .sort((a, b) => b.avgProgress - a.avgProgress)
    .slice(0, 10);

  return {
    totalGoals: goals.length,
    completedGoals: completed.length,
    onTrackGoals: onTrack.length,
    atRiskGoals: atRisk.length,
    behindGoals: behind.length,
    avgProgress: Math.round(avgProgress),
    completionRate: Math.round(completionRate),
    statusDistribution,
    categoryDistribution,
    topPerformers,
  };
}

// ─── Expense Analytics ───────────────────────────────────────

export interface ExpenseMetrics {
  totalSubmitted: number;
  totalApproved: number;
  totalRejected: number;
  totalPending: number;
  totalReimbursed: number;
  totalAmount: number;
  avgClaimAmount: number;
  highestClaim: number;
  categoryBreakdown: Array<{ category: string; amount: number; count: number }>;
  departmentSpend: Array<{ department: string; amount: number; count: number }>;
  statusSummary: Array<{ status: string; count: number; amount: number }>;
}

export function computeExpenseMetrics(expenses: ExpenseDoc[]): ExpenseMetrics {
  const approved = expenses.filter(e => e.status === "approved");
  const rejected = expenses.filter(e => e.status === "rejected");
  const pending = expenses.filter(e => e.status === "pending");
  const reimbursed = expenses.filter(e => e.status === "reimbursed");

  const totalAmount = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const avgClaimAmount = expenses.length > 0 ? totalAmount / expenses.length : 0;
  const highestClaim = Math.max(...expenses.map(e => e.amount || 0), 0);

  // Category breakdown
  const catMap = new Map<string, { amount: number; count: number }>();
  expenses.forEach(e => {
    const cat = e.category || "Other";
    const existing = catMap.get(cat) || { amount: 0, count: 0 };
    existing.amount += e.amount || 0;
    existing.count += 1;
    catMap.set(cat, existing);
  });
  const categoryBreakdown = Array.from(catMap.entries()).map(([category, data]) => ({
    category, ...data,
  })).sort((a, b) => b.amount - a.amount);

  // Department spend
  const deptMap = new Map<string, { amount: number; count: number }>();
  expenses.forEach(e => {
    const dept = e.department || "Other";
    const existing = deptMap.get(dept) || { amount: 0, count: 0 };
    existing.amount += e.amount || 0;
    existing.count += 1;
    deptMap.set(dept, existing);
  });
  const departmentSpend = Array.from(deptMap.entries()).map(([department, data]) => ({
    department, ...data,
  })).sort((a, b) => b.amount - a.amount);

  // Status summary
  const statusMap = new Map<string, { count: number; amount: number }>();
  expenses.forEach(e => {
    const status = e.status || "unknown";
    const existing = statusMap.get(status) || { count: 0, amount: 0 };
    existing.count += 1;
    existing.amount += e.amount || 0;
    statusMap.set(status, existing);
  });
  const statusSummary = Array.from(statusMap.entries()).map(([status, data]) => ({
    status, ...data,
  }));

  return {
    totalSubmitted: expenses.length,
    totalApproved: approved.length,
    totalRejected: rejected.length,
    totalPending: pending.length,
    totalReimbursed: reimbursed.length,
    totalAmount: Math.round(totalAmount),
    avgClaimAmount: Math.round(avgClaimAmount),
    highestClaim: Math.round(highestClaim),
    categoryBreakdown,
    departmentSpend,
    statusSummary,
  };
}

// ─── Report Generation Helpers ───────────────────────────────

export interface ReportConfig {
  id: string;
  name: string;
  description: string;
  category: string;
  dataSource: "employees" | "payroll" | "leaves" | "attendance" | "expenses" | "goals" | "helpdesk";
  fields: string[];
  format: ("csv" | "xlsx" | "pdf")[];
}

export const REPORT_TEMPLATES: ReportConfig[] = [
  { id: "headcount", name: "Employee Headcount", description: "Current headcount by department, location, and type", category: "Workforce", dataSource: "employees", fields: ["name","department","designation","status","joiningDate","location"], format: ["csv","xlsx","pdf"] },
  { id: "attrition", name: "Attrition Analysis", description: "Voluntary and involuntary attrition with trends", category: "Workforce", dataSource: "employees", fields: ["name","department","status","joiningDate"], format: ["csv","pdf"] },
  { id: "payroll_summary", name: "Payroll Summary", description: "Complete payroll breakdown with taxes", category: "Payroll", dataSource: "payroll", fields: ["employeeName","department","basicPay","grossEarnings","totalDeductions","netPay","status"], format: ["csv","xlsx","pdf"] },
  { id: "attendance_summary", name: "Attendance Summary", description: "Daily/monthly attendance with late markers", category: "Attendance", dataSource: "attendance", fields: ["employeeName","date","clockIn","clockOut","status","hours"], format: ["csv","xlsx"] },
  { id: "leave_utilization", name: "Leave Utilization", description: "Leave balance and utilization by type", category: "Leave", dataSource: "leaves", fields: ["employeeName","leaveType","fromDate","toDate","days","status"], format: ["csv","xlsx","pdf"] },
  { id: "expense_report", name: "Expense Report", description: "Expense claims by category and status", category: "Finance", dataSource: "expenses", fields: ["employeeName","category","amount","date","status"], format: ["csv","xlsx"] },
  { id: "performance_review", name: "Performance Reviews", description: "Goal completion and ratings", category: "Performance", dataSource: "goals", fields: ["title","category","progress","status","weight","dueDate"], format: ["csv","pdf"] },
  { id: "training_compliance", name: "Training Compliance", description: "Training completion and certification status", category: "Learning", dataSource: "employees", fields: ["name","department","designation"], format: ["csv","xlsx"] },
  { id: "recruitment_pipeline", name: "Recruitment Pipeline", description: "Hiring funnel and conversion rates", category: "Recruitment", dataSource: "employees", fields: ["name","department","designation","joiningDate"], format: ["csv","pdf"] },
  { id: "helpdesk_metrics", name: "Helpdesk Metrics", description: "Ticket resolution times and SLA compliance", category: "Support", dataSource: "helpdesk", fields: ["title","category","priority","status","createdAt"], format: ["csv","xlsx","pdf"] },
  { id: "diversity", name: "Diversity Report", description: "Gender, age, and demographic analysis", category: "Workforce", dataSource: "employees", fields: ["name","department","designation","status"], format: ["csv","pdf"] },
  { id: "compensation", name: "Compensation Report", description: "Salary bands and pay equity analysis", category: "Payroll", dataSource: "payroll", fields: ["employeeName","department","basicPay","grossEarnings","netPay"], format: ["csv","xlsx"] },
];

// ─── CSV Export Helper ───────────────────────────────────────

export function generateCSV<T extends Record<string, unknown>>(data: T[], fields: string[], filename: string): void {
  if (data.length === 0) return;
  
  const headers = fields.join(",");
  const rows = data.map(item => 
    fields.map(field => {
      const val = item[field];
      const str = val == null ? "" : String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(",")
  );
  
  const csvContent = [headers, ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ─── Date Range Helpers ──────────────────────────────────────

export function getDateRange(period: "today" | "week" | "month" | "quarter" | "year"): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  let start: Date;

  switch (period) {
    case "today":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "week":
      start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      break;
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "quarter":
      start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      break;
    case "year":
      start = new Date(now.getFullYear(), 0, 1);
      break;
  }

  return { start, end };
}

export function getFinancialYear(date: Date = new Date()): string {
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `FY${year}-${(year + 1).toString().slice(-2)}`;
}

export function getQuarter(date: Date = new Date()): number {
  const month = date.getMonth();
  // Indian FY starts April
  const fyMonth = month >= 3 ? month - 3 : month + 9;
  return Math.floor(fyMonth / 3) + 1;
}

// ─── Formatting Helpers ──────────────────────────────────────

export function formatCurrency(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN");
}

export function formatCurrencyShort(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount}`;
}

export function formatNumber(num: number): string {
  return num.toLocaleString("en-IN");
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function calculateTenure(joiningDate: string): string {
  const start = new Date(joiningDate);
  const now = new Date();
  const years = Math.floor((now.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const months = Math.floor(((now.getTime() - start.getTime()) % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000));
  
  if (years > 0 && months > 0) return `${years}y ${months}m`;
  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}m`;
  return "New";
}

// ─── Trend Analysis ──────────────────────────────────────────

export function computeGrowthRate(current: number, previous: number): { rate: number; direction: "up" | "down" | "flat" } {
  if (previous === 0) return { rate: current > 0 ? 100 : 0, direction: current > 0 ? "up" : "flat" };
  const rate = ((current - previous) / previous) * 100;
  return {
    rate: Math.abs(Math.round(rate * 10) / 10),
    direction: rate > 0 ? "up" : rate < 0 ? "down" : "flat",
  };
}

export function computeMovingAverage(data: number[], window: number): number[] {
  if (data.length < window) return data;
  const result: number[] = [];
  for (let i = window - 1; i < data.length; i++) {
    const sum = data.slice(i - window + 1, i + 1).reduce((a, b) => a + b, 0);
    result.push(Math.round(sum / window));
  }
  return result;
}

export function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
