// ═══════════════════════════════════════════════════════════════
// ADVANCED HOOKS FOR HRMS MODULES
// Real-time data hooks, computed metrics, permission-aware
// actions, and analytics helpers for all HRMS features
// ═══════════════════════════════════════════════════════════════

"use client";

import { useMemo, useCallback, useState, useEffect } from "react";
import {
  useEmployeeStore, useLeaveStore, useAttendanceStore,
  usePayrollStore, useExpenseStore, useGoalStore,
  useTicketStore, useJobStore, useCourseStore,
  useAnnouncementStore, useTeamStore, useAssetStore,
  startSync,
  type EmployeeDoc, type LeaveDoc, type AttendanceDoc,
  type PayrollDoc, type ExpenseDoc, type GoalDoc,
} from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";

// ─── Workforce Metrics Hook ──────────────────────────────────

export function useWorkforceMetrics() {
  const empStore = useEmployeeStore();

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [empStore]);

  return useMemo(() => {
    const items = empStore.items;
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const active = items.filter(e => e.status === "active").length;
    const inactive = items.filter(e => e.status === "inactive" || e.status === "terminated").length;
    const probation = items.filter(e => e.status === "probation").length;
    const notice = items.filter(e => e.status === "notice_period").length;

    const newThisMonth = items.filter(e => {
      if (!e.joiningDate) return false;
      return new Date(e.joiningDate) >= thisMonthStart;
    }).length;

    // Department distribution
    const depts: Record<string, number> = {};
    items.forEach(e => { depts[e.department || "Unassigned"] = (depts[e.department || "Unassigned"] || 0) + 1; });
    const departmentDistribution = Object.entries(depts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    // Location distribution
    const locs: Record<string, number> = {};
    items.forEach(e => { locs[e.location || "Unknown"] = (locs[e.location || "Unknown"] || 0) + 1; });
    const locationDistribution = Object.entries(locs).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    // Employment type distribution
    const types: Record<string, number> = {};
    items.forEach(e => { types[e.employmentType || "Full-time"] = (types[e.employmentType || "Full-time"] || 0) + 1; });
    const typeDistribution = Object.entries(types).map(([name, count]) => ({ name, count }));

    // Average tenure
    const tenures = items.filter(e => e.joiningDate).map(e => {
      return (now.getTime() - new Date(e.joiningDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    });
    const avgTenure = tenures.length > 0 ? tenures.reduce((a, b) => a + b, 0) / tenures.length : 0;

    // Salary stats
    const salaries = items.filter(e => e.salary && Number(e.salary) > 0).map(e => Number(e.salary));
    const avgSalary = salaries.length > 0 ? salaries.reduce((a, b) => a + b, 0) / salaries.length : 0;
    const totalPayroll = salaries.reduce((a, b) => a + b, 0);

    return {
      total: items.length,
      active,
      inactive,
      probation,
      notice,
      newThisMonth,
      departmentDistribution,
      locationDistribution,
      typeDistribution,
      avgTenure: Math.round(avgTenure * 10) / 10,
      avgSalary: Math.round(avgSalary),
      totalPayroll: Math.round(totalPayroll),
      attritionRate: items.length > 0 ? Math.round((inactive / items.length) * 1000) / 10 : 0,
      retentionRate: items.length > 0 ? Math.round(((items.length - inactive) / items.length) * 1000) / 10 : 100,
      loading: empStore.loading,
      initialized: empStore.initialized,
    };
  }, [empStore.items, empStore.loading, empStore.initialized]);
}

// ─── Leave Metrics Hook ──────────────────────────────────────

export function useLeaveMetrics() {
  const leaveStore = useLeaveStore();

  useEffect(() => {
    if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore);
  }, [leaveStore]);

  return useMemo(() => {
    const items = leaveStore.items;

    const pending = items.filter(l => l.status === "pending").length;
    const approved = items.filter(l => l.status === "approved").length;
    const rejected = items.filter(l => l.status === "rejected").length;
    const totalDays = items.reduce((s, l) => s + (l.days || 0), 0);

    // Type breakdown
    const types: Record<string, { count: number; days: number }> = {};
    items.forEach(l => {
      const t = l.leaveType || "Other";
      if (!types[t]) types[t] = { count: 0, days: 0 };
      types[t].count += 1;
      types[t].days += l.days || 0;
    });
    const typeBreakdown = Object.entries(types).map(([type, data]) => ({ type, ...data })).sort((a, b) => b.count - a.count);

    // Department usage
    const depts: Record<string, number> = {};
    items.forEach(l => { depts[l.department || "Other"] = (depts[l.department || "Other"] || 0) + 1; });
    const deptUsage = Object.entries(depts).map(([dept, count]) => ({ dept, count })).sort((a, b) => b.count - a.count);

    return {
      total: items.length,
      pending,
      approved,
      rejected,
      totalDays,
      avgDaysPerRequest: items.length > 0 ? Math.round((totalDays / items.length) * 10) / 10 : 0,
      typeBreakdown,
      deptUsage,
      approvalRate: items.length > 0 ? Math.round((approved / items.length) * 100) : 0,
      loading: leaveStore.loading,
      initialized: leaveStore.initialized,
    };
  }, [leaveStore.items, leaveStore.loading, leaveStore.initialized]);
}

// ─── Attendance Metrics Hook ─────────────────────────────────

export function useAttendanceMetrics() {
  const attStore = useAttendanceStore();

  useEffect(() => {
    if (!attStore.initialized) startSync(COLLECTIONS.attendance, attStore);
  }, [attStore]);

  return useMemo(() => {
    const items = attStore.items;
    const today = new Date().toISOString().split("T")[0];
    const todayRecords = items.filter(a => a.date === today);

    const present = todayRecords.filter(a => a.status === "present" || a.status === "late").length;
    const absent = todayRecords.filter(a => a.status === "absent").length;
    const wfh = todayRecords.filter(a => a.status === "wfh").length;
    const late = todayRecords.filter(a => a.status === "late").length;
    const onLeave = todayRecords.filter(a => a.status === "on_leave").length;

    const totalHours = items.reduce((s, a) => s + (a.hours || 0), 0);
    const avgHours = items.filter(a => (a.hours || 0) > 0).length > 0
      ? totalHours / items.filter(a => (a.hours || 0) > 0).length : 0;

    const totalOT = items.reduce((s, a) => s + (a.overtime || 0), 0);

    const attendanceRate = todayRecords.length > 0
      ? Math.round(((present + wfh) / todayRecords.length) * 100) : 0;

    return {
      totalRecords: items.length,
      today: {
        present, absent, wfh, late, onLeave,
        total: todayRecords.length,
      },
      avgHours: Math.round(avgHours * 10) / 10,
      totalOvertimeHours: Math.round(totalOT * 10) / 10,
      attendanceRate,
      loading: attStore.loading,
      initialized: attStore.initialized,
    };
  }, [attStore.items, attStore.loading, attStore.initialized]);
}

// ─── Expense Metrics Hook ────────────────────────────────────

export function useExpenseMetrics() {
  const expStore = useExpenseStore();

  useEffect(() => {
    if (!expStore.initialized) startSync(COLLECTIONS.expenses, expStore);
  }, [expStore]);

  return useMemo(() => {
    const items = expStore.items;

    const totalAmount = items.reduce((s, e) => s + (e.amount || 0), 0);
    const pending = items.filter(e => e.status === "pending");
    const approved = items.filter(e => e.status === "approved");
    const rejected = items.filter(e => e.status === "rejected");
    const reimbursed = items.filter(e => e.status === "reimbursed");

    const pendingAmount = pending.reduce((s, e) => s + (e.amount || 0), 0);
    const approvedAmount = approved.reduce((s, e) => s + (e.amount || 0), 0);

    // Category breakdown
    const cats: Record<string, { count: number; amount: number }> = {};
    items.forEach(e => {
      const c = e.category || "Other";
      if (!cats[c]) cats[c] = { count: 0, amount: 0 };
      cats[c].count += 1;
      cats[c].amount += e.amount || 0;
    });
    const categoryBreakdown = Object.entries(cats).map(([category, data]) => ({
      category, ...data, amount: Math.round(data.amount),
    })).sort((a, b) => b.amount - a.amount);

    return {
      total: items.length,
      totalAmount: Math.round(totalAmount),
      pendingCount: pending.length,
      pendingAmount: Math.round(pendingAmount),
      approvedCount: approved.length,
      approvedAmount: Math.round(approvedAmount),
      rejectedCount: rejected.length,
      reimbursedCount: reimbursed.length,
      avgClaim: items.length > 0 ? Math.round(totalAmount / items.length) : 0,
      categoryBreakdown,
      loading: expStore.loading,
      initialized: expStore.initialized,
    };
  }, [expStore.items, expStore.loading, expStore.initialized]);
}

// ─── Performance Metrics Hook ────────────────────────────────

export function usePerformanceMetrics() {
  const goalStore = useGoalStore();

  useEffect(() => {
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
  }, [goalStore]);

  return useMemo(() => {
    const items = goalStore.items;

    const completed = items.filter(g => g.status === "completed").length;
    const onTrack = items.filter(g => g.status === "on_track" || g.status === "in_progress").length;
    const atRisk = items.filter(g => g.status === "at_risk").length;
    const behind = items.filter(g => g.status === "behind" || g.status === "not_started").length;

    const avgProgress = items.length > 0
      ? Math.round(items.reduce((s, g) => s + (g.progress || 0), 0) / items.length) : 0;

    const completionRate = items.length > 0 ? Math.round((completed / items.length) * 100) : 0;

    // Status distribution
    const statuses: Record<string, number> = {};
    items.forEach(g => { statuses[g.status || "unknown"] = (statuses[g.status || "unknown"] || 0) + 1; });
    const statusDistribution = Object.entries(statuses).map(([status, count]) => ({
      name: status.replace(/_/g, " "), value: count,
    }));

    return {
      total: items.length,
      completed,
      onTrack,
      atRisk,
      behind,
      avgProgress,
      completionRate,
      statusDistribution,
      loading: goalStore.loading,
      initialized: goalStore.initialized,
    };
  }, [goalStore.items, goalStore.loading, goalStore.initialized]);
}

// ─── Helpdesk Metrics Hook ───────────────────────────────────

export function useHelpdeskMetrics() {
  const ticketStore = useTicketStore();

  useEffect(() => {
    if (!ticketStore.initialized) startSync(COLLECTIONS.helpdesk, ticketStore);
  }, [ticketStore]);

  return useMemo(() => {
    const items = ticketStore.items;

    const open = items.filter(t => t.status === "open").length;
    const inProgress = items.filter(t => t.status === "in_progress").length;
    const resolved = items.filter(t => t.status === "resolved").length;
    const closed = items.filter(t => t.status === "closed").length;

    // Priority breakdown
    const priorities: Record<string, number> = {};
    items.forEach(t => { priorities[t.priority || "medium"] = (priorities[t.priority || "medium"] || 0) + 1; });

    // Category breakdown
    const categories: Record<string, number> = {};
    items.forEach(t => { categories[t.category || "Other"] = (categories[t.category || "Other"] || 0) + 1; });

    const categoryBreakdown = Object.entries(categories).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);

    return {
      total: items.length,
      open,
      inProgress,
      resolved,
      closed,
      openAndInProgress: open + inProgress,
      priorityBreakdown: priorities,
      categoryBreakdown,
      resolutionRate: items.length > 0 ? Math.round(((resolved + closed) / items.length) * 100) : 0,
      loading: ticketStore.loading,
      initialized: ticketStore.initialized,
    };
  }, [ticketStore.items, ticketStore.loading, ticketStore.initialized]);
}

// ─── Recruitment Metrics Hook ────────────────────────────────

export function useRecruitmentMetrics() {
  const jobStore = useJobStore();

  useEffect(() => {
    if (!jobStore.initialized) startSync(COLLECTIONS.recruitment, jobStore);
  }, [jobStore]);

  return useMemo(() => {
    const items = jobStore.items;

    const openJobs = items.filter(j => j.status === "open").length;
    const closedJobs = items.filter(j => j.status === "closed").length;
    const totalOpenings = items.reduce((s, j) => s + (j.openings || 0), 0);
    const totalApplicants = items.reduce((s, j) => s + (j.applicants || 0), 0);

    // Department hiring
    const depts: Record<string, { jobs: number; openings: number }> = {};
    items.forEach(j => {
      const d = j.department || "Other";
      if (!depts[d]) depts[d] = { jobs: 0, openings: 0 };
      depts[d].jobs += 1;
      depts[d].openings += j.openings || 0;
    });
    const deptHiring = Object.entries(depts).map(([dept, data]) => ({ dept, ...data })).sort((a, b) => b.openings - a.openings);

    return {
      totalJobs: items.length,
      openJobs,
      closedJobs,
      totalOpenings,
      totalApplicants,
      avgApplicantsPerJob: items.length > 0 ? Math.round(totalApplicants / items.length) : 0,
      deptHiring,
      loading: jobStore.loading,
      initialized: jobStore.initialized,
    };
  }, [jobStore.items, jobStore.loading, jobStore.initialized]);
}

// ─── Dashboard Summary Hook ──────────────────────────────────

export function useDashboardSummary() {
  const workforce = useWorkforceMetrics();
  const leaves = useLeaveMetrics();
  const attendance = useAttendanceMetrics();
  const expenses = useExpenseMetrics();
  const performance = usePerformanceMetrics();
  const helpdesk = useHelpdeskMetrics();
  const recruitment = useRecruitmentMetrics();

  const isLoading = workforce.loading || leaves.loading || attendance.loading ||
    expenses.loading || performance.loading || helpdesk.loading || recruitment.loading;

  const isInitialized = workforce.initialized && leaves.initialized && attendance.initialized &&
    expenses.initialized && performance.initialized && helpdesk.initialized && recruitment.initialized;

  return {
    workforce,
    leaves,
    attendance,
    expenses,
    performance,
    helpdesk,
    recruitment,
    isLoading,
    isInitialized,
    actionItems: {
      pendingLeaves: leaves.pending,
      pendingExpenses: expenses.pendingCount,
      openTickets: helpdesk.openAndInProgress,
      openPositions: recruitment.openJobs,
      atRiskGoals: performance.atRisk,
    },
  };
}
