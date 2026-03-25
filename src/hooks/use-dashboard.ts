"use client";

import { useState, useEffect, useMemo, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// DASHBOARD & MODULE-SPECIFIC HOOKS
// Custom hooks for each HRMS module providing data management,
// computed values, and business logic
// ═══════════════════════════════════════════════════════════════

// ─── Employee Dashboard Hook ─────────────────────────────────

interface EmployeeSummary {
  total: number;
  active: number;
  onLeave: number;
  wfh: number;
  noticePeriod: number;
  newJoiners: number;
  exits: number;
  departments: Record<string, number>;
  locations: Record<string, number>;
  averageTenure: number;
  genderRatio: { male: number; female: number; other: number };
}

export function useEmployeeSummary(): EmployeeSummary {
  return useMemo(() => ({
    total: 127,
    active: 118,
    onLeave: 4,
    wfh: 3,
    noticePeriod: 2,
    newJoiners: 4,
    exits: 2,
    departments: { Engineering: 42, Sales: 22, Support: 18, Marketing: 15, Design: 12, Finance: 10, HR: 8 },
    locations: { "Bangalore HQ": 95, Mumbai: 22, Hyderabad: 10 },
    averageTenure: 2.4,
    genderRatio: { male: 74, female: 48, other: 5 },
  }), []);
}

// ─── Attendance Dashboard Hook ───────────────────────────────

interface AttendanceSummary {
  todayPresent: number;
  todayAbsent: number;
  todayWFH: number;
  todayOnLeave: number;
  todayLate: number;
  weeklyAvg: number;
  monthlyAvg: number;
  attendanceRate: number;
  overtimeThisMonth: number;
  regularizationPending: number;
}

export function useAttendanceSummary(): AttendanceSummary {
  return useMemo(() => ({
    todayPresent: 110,
    todayAbsent: 5,
    todayWFH: 8,
    todayOnLeave: 4,
    todayLate: 3,
    weeklyAvg: 92.5,
    monthlyAvg: 94.2,
    attendanceRate: 94.2,
    overtimeThisMonth: 185,
    regularizationPending: 2,
  }), []);
}

// ─── Leave Summary Hook ─────────────────────────────────────

interface LeaveSummary {
  pendingApprovals: number;
  todayOnLeave: string[];
  tomorrowOnLeave: string[];
  leaveCalendar: { date: string; count: number }[];
  mostCommonType: string;
  avgLeavesPerMonth: number;
  totalLeavesTaken: number;
  upcomingHolidays: { name: string; date: string }[];
}

export function useLeaveSummary(): LeaveSummary {
  return useMemo(() => ({
    pendingApprovals: 3,
    todayOnLeave: ["Amit Shah"],
    tomorrowOnLeave: ["Vikram Mehta", "Aman Gupta"],
    leaveCalendar: [
      { date: "2026-03-25", count: 1 }, { date: "2026-03-26", count: 3 },
      { date: "2026-03-27", count: 3 }, { date: "2026-03-28", count: 3 },
      { date: "2026-04-02", count: 2 }, { date: "2026-04-03", count: 2 },
    ],
    mostCommonType: "Casual Leave",
    avgLeavesPerMonth: 42,
    totalLeavesTaken: 252,
    upcomingHolidays: [
      { name: "Good Friday", date: "Apr 18" },
      { name: "May Day", date: "May 1" },
    ],
  }), []);
}

// ─── Payroll Summary Hook ────────────────────────────────────

interface PayrollSummary {
  currentMonthCost: number;
  previousMonthCost: number;
  yearToDateCost: number;
  avgSalary: number;
  medianSalary: number;
  highestPaid: number;
  lowestPaid: number;
  totalDeductions: number;
  totalPF: number;
  totalTax: number;
  pendingProcessing: number;
  onHold: number;
  payrollMonth: string;
  isProcessed: boolean;
}

export function usePayrollSummary(): PayrollSummary {
  return useMemo(() => ({
    currentMonthCost: 9000000,
    previousMonthCost: 8800000,
    yearToDateCost: 54000000,
    avgSalary: 985000,
    medianSalary: 850000,
    highestPaid: 2400000,
    lowestPaid: 360000,
    totalDeductions: 2000000,
    totalPF: 1080000,
    totalTax: 1200000,
    pendingProcessing: 0,
    onHold: 1,
    payrollMonth: "March 2026",
    isProcessed: true,
  }), []);
}

// ─── Recruitment Summary Hook ────────────────────────────────

interface RecruitmentSummary {
  openPositions: number;
  urgentPositions: number;
  totalApplications: number;
  shortlisted: number;
  interviewsScheduled: number;
  offersExtended: number;
  offersAccepted: number;
  avgTimeToHire: number;
  costPerHire: number;
  offerAcceptanceRate: number;
  topSources: { source: string; count: number }[];
  pipeline: { stage: string; count: number }[];
}

export function useRecruitmentSummary(): RecruitmentSummary {
  return useMemo(() => ({
    openPositions: 12,
    urgentPositions: 5,
    totalApplications: 580,
    shortlisted: 245,
    interviewsScheduled: 18,
    offersExtended: 45,
    offersAccepted: 38,
    avgTimeToHire: 18,
    costPerHire: 45000,
    offerAcceptanceRate: 84,
    topSources: [
      { source: "Referrals", count: 192 },
      { source: "LinkedIn", count: 156 },
      { source: "Naukri", count: 98 },
      { source: "Direct", count: 74 },
      { source: "Campus", count: 60 },
    ],
    pipeline: [
      { stage: "Applied", count: 580 },
      { stage: "Screened", count: 245 },
      { stage: "Interview", count: 120 },
      { stage: "Offered", count: 45 },
      { stage: "Joined", count: 32 },
    ],
  }), []);
}

// ─── Performance Summary Hook ────────────────────────────────

interface PerformanceSummary {
  activeReviewCycle: string;
  selfReviewsDone: number;
  managerReviewsDone: number;
  totalReviews: number;
  avgRating: number;
  ratingDistribution: { rating: string; count: number }[];
  topPerformers: { name: string; rating: number }[];
  goalsOnTrack: number;
  goalsAtRisk: number;
  goalsBehind: number;
  goalsCompleted: number;
}

export function usePerformanceSummary(): PerformanceSummary {
  return useMemo(() => ({
    activeReviewCycle: "Q1 FY26",
    selfReviewsDone: 85,
    managerReviewsDone: 42,
    totalReviews: 127,
    avgRating: 3.9,
    ratingDistribution: [
      { rating: "5 (Outstanding)", count: 8 },
      { rating: "4-4.9 (Exceeds)", count: 35 },
      { rating: "3-3.9 (Meets)", count: 65 },
      { rating: "2-2.9 (Needs Imp.)", count: 14 },
      { rating: "1-1.9 (Below)", count: 3 },
    ],
    topPerformers: [
      { name: "Riya Gupta", rating: 4.4 },
      { name: "Priya Sharma", rating: 4.4 },
      { name: "Vikram Mehta", rating: 4.1 },
      { name: "Aman Gupta", rating: 4.1 },
    ],
    goalsOnTrack: 72,
    goalsAtRisk: 15,
    goalsBehind: 8,
    goalsCompleted: 32,
  }), []);
}

// ─── Training Summary Hook ───────────────────────────────────

interface TrainingSummary {
  totalCourses: number;
  activeCourses: number;
  totalEnrollments: number;
  completionRate: number;
  avgTrainingHours: number;
  mandatoryPending: number;
  certificationsEarned: number;
  learningBudgetUsed: number;
  learningBudgetTotal: number;
  popularCourses: { name: string; enrollments: number }[];
  categories: { name: string; count: number }[];
}

export function useTrainingSummary(): TrainingSummary {
  return useMemo(() => ({
    totalCourses: 10,
    activeCourses: 8,
    totalEnrollments: 328,
    completionRate: 72,
    avgTrainingHours: 48,
    mandatoryPending: 9,
    certificationsEarned: 23,
    learningBudgetUsed: 35000,
    learningBudgetTotal: 50000,
    popularCourses: [
      { name: "React & Next.js Mastery", enrollments: 28 },
      { name: "POSH Compliance", enrollments: 127 },
      { name: "AWS Solutions Architect", enrollments: 15 },
      { name: "Leadership Fundamentals", enrollments: 22 },
    ],
    categories: [
      { name: "Technical", count: 5 },
      { name: "Compliance", count: 2 },
      { name: "Leadership", count: 1 },
      { name: "Soft Skills", count: 1 },
      { name: "Design", count: 1 },
    ],
  }), []);
}

// ─── Helpdesk Summary Hook ───────────────────────────────────

interface HelpdeskSummary {
  totalTickets: number;
  openTickets: number;
  inProgress: number;
  resolved: number;
  avgResolutionTime: number;
  slaBreached: number;
  categoryBreakdown: { category: string; count: number }[];
  priorityBreakdown: { priority: string; count: number }[];
  topAgents: { name: string; resolved: number; avgTime: number }[];
  satisfaction: number;
}

export function useHelpdeskSummary(): HelpdeskSummary {
  return useMemo(() => ({
    totalTickets: 342,
    openTickets: 7,
    inProgress: 5,
    resolved: 328,
    avgResolutionTime: 5.2,
    slaBreached: 12,
    categoryBreakdown: [
      { category: "IT Support", count: 145 },
      { category: "HR Query", count: 82 },
      { category: "Facilities", count: 48 },
      { category: "Payroll", count: 35 },
      { category: "Access Request", count: 32 },
    ],
    priorityBreakdown: [
      { priority: "Low", count: 120 },
      { priority: "Medium", count: 135 },
      { priority: "High", count: 65 },
      { priority: "Urgent", count: 22 },
    ],
    topAgents: [
      { name: "Sanjay IT", resolved: 145, avgTime: 3.8 },
      { name: "Priya Sharma", resolved: 82, avgTime: 6.2 },
      { name: "Facilities Team", resolved: 48, avgTime: 8.5 },
    ],
    satisfaction: 4.2,
  }), []);
}

// ─── Engagement Summary Hook ─────────────────────────────────

interface EngagementSummary {
  eNPS: number;
  engagementScore: number;
  pulseResponseRate: number;
  totalKudos: number;
  surveysPending: number;
  cultureScore: number;
  topCoreValues: { value: string; mentions: number }[];
  recentKudos: { from: string; to: string; message: string }[];
  monthlyTrend: { month: string; score: number }[];
}

export function useEngagementSummary(): EngagementSummary {
  return useMemo(() => ({
    eNPS: 29,
    engagementScore: 82,
    pulseResponseRate: 78,
    totalKudos: 156,
    surveysPending: 1,
    cultureScore: 85,
    topCoreValues: [
      { value: "Innovation", mentions: 42 },
      { value: "Collaboration", mentions: 38 },
      { value: "Excellence", mentions: 31 },
      { value: "Integrity", mentions: 27 },
    ],
    recentKudos: [
      { from: "Aman Gupta", to: "Neha Desai", message: "Brilliant caching solution" },
      { from: "Vikram Mehta", to: "Riya Gupta", message: "Amazing dashboard redesign" },
      { from: "Priya Sharma", to: "Deepak Shah", message: "Great team player" },
    ],
    monthlyTrend: [
      { month: "Oct", score: 72 }, { month: "Nov", score: 74 },
      { month: "Dec", score: 73 }, { month: "Jan", score: 76 },
      { month: "Feb", score: 77 }, { month: "Mar", score: 82 },
    ],
  }), []);
}

// ─── Date Utilities Hook ─────────────────────────────────────

export function useDateUtils() {
  return useMemo(() => ({
    today: new Date().toISOString().split("T")[0],
    todayFormatted: new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    currentMonth: new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    currentQuarter: `Q${Math.ceil((new Date().getMonth() + 1) / 3)}`,
    currentFY: `FY${new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1}-${(new Date().getMonth() >= 3 ? new Date().getFullYear() + 1 : new Date().getFullYear()).toString().slice(-2)}`,
    daysInMonth: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(),
    dayOfMonth: new Date().getDate(),
    isWeekend: new Date().getDay() === 0 || new Date().getDay() === 6,
    workingDaysThisMonth: (() => {
      const year = new Date().getFullYear();
      const month = new Date().getMonth();
      let count = 0;
      const lastDay = new Date(year, month + 1, 0).getDate();
      for (let d = 1; d <= lastDay; d++) {
        const day = new Date(year, month, d).getDay();
        if (day !== 0 && day !== 6) count++;
      }
      return count;
    })(),
    greeting: new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening",
  }), []);
}

// ─── Currency Formatting Hook ────────────────────────────────

export function useCurrencyFormatter() {
  const formatINR = useCallback((amount: number): string => {
    return "₹" + amount.toLocaleString("en-IN");
  }, []);

  const formatINRShort = useCallback((amount: number): string => {
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
    if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
    return `₹${amount}`;
  }, []);

  const formatUSD = useCallback((amount: number): string => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  }, []);

  return { formatINR, formatINRShort, formatUSD };
}

// ─── Search & Filter Hook ────────────────────────────────────

export function useSearchAndFilter<T>(
  data: T[],
  searchFields: (keyof T)[],
  filterConfig?: Record<string, (item: T, value: string) => boolean>
) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});

  const setFilter = useCallback((key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearch("");
  }, []);

  const filteredData = useMemo(() => {
    let result = data;

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(item =>
        searchFields.some(field => {
          const val = item[field];
          return val != null && String(val).toLowerCase().includes(q);
        })
      );
    }

    // Filters
    if (filterConfig) {
      Object.entries(filters).forEach(([key, value]) => {
        if (!value || value === "all") return;
        const filterFn = filterConfig[key];
        if (filterFn) {
          result = result.filter(item => filterFn(item, value));
        }
      });
    }

    return result;
  }, [data, search, searchFields, filters, filterConfig]);

  const activeFilterCount = Object.values(filters).filter(v => v && v !== "all").length + (search ? 1 : 0);

  return {
    search,
    setSearch,
    filters,
    setFilter,
    clearFilters,
    filteredData,
    activeFilterCount,
    totalCount: data.length,
    filteredCount: filteredData.length,
  };
}

// ─── Notification Badge Hook ─────────────────────────────────

export function useNotificationBadge() {
  const [count, setCount] = useState(7);

  const increment = useCallback(() => setCount(prev => prev + 1), []);
  const decrement = useCallback(() => setCount(prev => Math.max(0, prev - 1)), []);
  const reset = useCallback(() => setCount(0), []);

  return { count, increment, decrement, reset, hasNotifications: count > 0 };
}

// ─── Real-time Clock Hook ────────────────────────────────────

export function useRealtimeClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return {
    time,
    timeString: time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    dateString: time.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    hour: time.getHours(),
    minute: time.getMinutes(),
    isWorkingHours: time.getHours() >= 9 && time.getHours() < 18,
  };
}

// ─── Responsive Layout Hook ──────────────────────────────────

export function useResponsive() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1024);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return {
    isMobile: width < 640,
    isTablet: width >= 640 && width < 1024,
    isDesktop: width >= 1024,
    isWide: width >= 1280,
    width,
  };
}

// ─── Permission-aware Action Hook ────────────────────────────

export function usePermissionAction(
  requiredPermission: string,
  userRole: string = "employee"
) {
  const hasPermission = useMemo(() => {
    const rolePermissions: Record<string, string[]> = {
      admin: ["*"],
      hr: ["employees.*", "leave.*", "attendance.*", "payroll.view", "recruitment.*", "onboarding.*", "reports.*", "settings.view"],
      employee: ["dashboard.view", "leave.view", "leave.apply", "attendance.view", "payslip.view_own", "profile.edit_own"],
    };
    const perms = rolePermissions[userRole] || [];
    if (perms.includes("*")) return true;
    return perms.some(p => {
      if (p.endsWith(".*")) {
        const prefix = p.replace(".*", "");
        return requiredPermission.startsWith(prefix);
      }
      return p === requiredPermission;
    });
  }, [requiredPermission, userRole]);

  return { hasPermission, canPerform: hasPermission };
}

// ─── Form State Tracking Hook ────────────────────────────────

export function useFormDirtyState(initialValues: Record<string, unknown>) {
  const [values, setValues] = useState(initialValues);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const isDirty = useMemo(() => {
    return Object.keys(values).some(key => values[key] !== initialValues[key]);
  }, [values, initialValues]);

  const dirtyFields = useMemo(() => {
    return Object.keys(values).filter(key => values[key] !== initialValues[key]);
  }, [values, initialValues]);

  const setValue = useCallback((key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setTouched(prev => ({ ...prev, [key]: true }));
  }, []);

  const reset = useCallback(() => {
    setValues(initialValues);
    setTouched({});
  }, [initialValues]);

  return { values, setValue, isDirty, dirtyFields, touched, reset };
}
