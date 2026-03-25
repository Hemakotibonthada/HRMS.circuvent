// ═══════════════════════════════════════════════════════════════
// DATA SERVICE — Centralized data management
// Replaces hardcoded dummy data with live state management.
// In production, these would connect to Firestore.
// In local mode, starts empty — data is added via UI.
// ═══════════════════════════════════════════════════════════════

import { create } from "zustand";

// ─── Generic types ───────────────────────────────────────────

export interface Employee {
  id: string; employeeId: string; firstName: string; lastName: string;
  email: string; phone?: string; designation: string; departmentName: string;
  employmentType: "full_time" | "part_time" | "contract" | "intern";
  status: "active" | "on_leave" | "probation" | "notice_period" | "terminated" | "inactive";
  joinDate: string; skills?: string[]; avatar?: string;
  reportingTo?: string; salary?: number;
}

export interface LeaveRequest {
  id: string; employeeId: string; employeeName: string; leaveType: string;
  startDate: string; endDate: string; totalDays: number; reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  appliedOn: string; approvedBy?: string;
}

export interface ExpenseClaim {
  id: string; employeeId: string; employeeName: string; category: string;
  description: string; amount: number; date: string; receipt: boolean;
  status: "draft" | "submitted" | "approved" | "rejected" | "reimbursed";
}

export interface Announcement {
  id: string; title: string; content: string;
  priority: "low" | "normal" | "high" | "urgent";
  author: string; pinned: boolean; createdAt: string;
}

export interface AttendanceRecord {
  id: string; employeeId: string; employeeName: string; date: string;
  clockIn?: string; clockOut?: string;
  status: "present" | "absent" | "late" | "half_day" | "on_leave" | "wfh";
  totalHours?: number;
}

// ─── Zustand stores ──────────────────────────────────────────

interface EmployeeStore {
  employees: Employee[];
  addEmployee: (emp: Employee) => void;
  removeEmployee: (id: string) => void;
  updateEmployee: (id: string, data: Partial<Employee>) => void;
}

export const useEmployeeData = create<EmployeeStore>((set) => ({
  employees: [],
  addEmployee: (emp) => set((s) => ({ employees: [...s.employees, emp] })),
  removeEmployee: (id) => set((s) => ({ employees: s.employees.filter((e) => e.id !== id) })),
  updateEmployee: (id, data) => set((s) => ({
    employees: s.employees.map((e) => (e.id === id ? { ...e, ...data } : e)),
  })),
}));

interface LeaveStore {
  requests: LeaveRequest[];
  addRequest: (req: LeaveRequest) => void;
  updateStatus: (id: string, status: LeaveRequest["status"], approvedBy?: string) => void;
}

export const useLeaveData = create<LeaveStore>((set) => ({
  requests: [],
  addRequest: (req) => set((s) => ({ requests: [...s.requests, req] })),
  updateStatus: (id, status, approvedBy) => set((s) => ({
    requests: s.requests.map((r) => (r.id === id ? { ...r, status, approvedBy } : r)),
  })),
}));

interface ExpenseStore {
  claims: ExpenseClaim[];
  addClaim: (claim: ExpenseClaim) => void;
  updateStatus: (id: string, status: ExpenseClaim["status"]) => void;
}

export const useExpenseData = create<ExpenseStore>((set) => ({
  claims: [],
  addClaim: (claim) => set((s) => ({ claims: [...s.claims, claim] })),
  updateStatus: (id, status) => set((s) => ({
    claims: s.claims.map((c) => (c.id === id ? { ...c, status } : c)),
  })),
}));

interface AnnouncementStore {
  announcements: Announcement[];
  addAnnouncement: (a: Announcement) => void;
  removeAnnouncement: (id: string) => void;
}

export const useAnnouncementData = create<AnnouncementStore>((set) => ({
  announcements: [],
  addAnnouncement: (a) => set((s) => ({ announcements: [a, ...s.announcements] })),
  removeAnnouncement: (id) => set((s) => ({ announcements: s.announcements.filter((a) => a.id !== id) })),
}));

interface AttendanceStore {
  records: AttendanceRecord[];
  clockIn: (record: AttendanceRecord) => void;
  clockOut: (id: string, clockOut: string, totalHours: number) => void;
}

export const useAttendanceData = create<AttendanceStore>((set) => ({
  records: [],
  clockIn: (record) => set((s) => ({ records: [record, ...s.records] })),
  clockOut: (id, clockOut, totalHours) => set((s) => ({
    records: s.records.map((r) => (r.id === id ? { ...r, clockOut, totalHours } : r)),
  })),
}));

// ─── ID generators ───────────────────────────────────────────

let _counter = 0;
export function generateId(prefix: string): string {
  _counter++;
  return `${prefix}${Date.now().toString(36)}${_counter.toString(36)}`;
}
