// ═══════════════════════════════════════════════════════════════════════
// COMPREHENSIVE ZUSTAND STORE LIBRARY
// State management for every HRMS module
// ═══════════════════════════════════════════════════════════════════════

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── ID Generation ───────────────────────────────────────────────────
let _idCounter = 0;
export function genId(prefix = "ID"): string {
  _idCounter++;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

// ─── EMPLOYEE STORE ──────────────────────────────────────────────────
export interface EmployeeRecord {
  id: string; employeeId: string; firstName: string; lastName: string;
  email: string; phone?: string; designation: string; department: string;
  employmentType: string; status: string; joinDate: string;
  salary?: number; skills?: string[]; reportingTo?: string;
  location?: string; gender?: string; dob?: string;
}

interface EmployeeStore {
  employees: EmployeeRecord[];
  add: (emp: EmployeeRecord) => void;
  update: (id: string, data: Partial<EmployeeRecord>) => void;
  remove: (id: string) => void;
  getById: (id: string) => EmployeeRecord | undefined;
  getByDept: (dept: string) => EmployeeRecord[];
  getActive: () => EmployeeRecord[];
  getDepartments: () => string[];
}

export const useEmployees = create<EmployeeStore>((set, get) => ({
  employees: [],
  add: (emp) => set((s) => ({ employees: [...s.employees, emp] })),
  update: (id, data) => set((s) => ({ employees: s.employees.map((e) => e.id === id ? { ...e, ...data } : e) })),
  remove: (id) => set((s) => ({ employees: s.employees.filter((e) => e.id !== id) })),
  getById: (id) => get().employees.find((e) => e.id === id),
  getByDept: (dept) => get().employees.filter((e) => e.department === dept),
  getActive: () => get().employees.filter((e) => e.status === "active"),
  getDepartments: () => [...new Set(get().employees.map((e) => e.department))],
}));

// ─── LEAVE STORE ─────────────────────────────────────────────────────
export interface LeaveRecord {
  id: string; employeeId: string; employeeName: string; type: string;
  startDate: string; endDate: string; days: number; reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  appliedOn: string; approvedBy?: string; approvedAt?: string;
  rejectionReason?: string; halfDay?: boolean;
}

export interface LeaveBalanceRecord {
  employeeId: string; type: string; total: number; used: number; pending: number;
}

interface LeaveStore {
  requests: LeaveRecord[];
  balances: LeaveBalanceRecord[];
  addRequest: (req: LeaveRecord) => void;
  updateStatus: (id: string, status: LeaveRecord["status"], by?: string, reason?: string) => void;
  cancelRequest: (id: string, reason: string) => void;
  setBalances: (balances: LeaveBalanceRecord[]) => void;
  getPending: () => LeaveRecord[];
  getByEmployee: (empId: string) => LeaveRecord[];
}

export const useLeaves = create<LeaveStore>((set, get) => ({
  requests: [],
  balances: [],
  addRequest: (req) => set((s) => ({ requests: [req, ...s.requests] })),
  updateStatus: (id, status, by, reason) => set((s) => ({
    requests: s.requests.map((r) => r.id === id ? { ...r, status, approvedBy: by, approvedAt: new Date().toISOString(), rejectionReason: reason } : r),
  })),
  cancelRequest: (id, reason) => set((s) => ({
    requests: s.requests.map((r) => r.id === id ? { ...r, status: "cancelled" as const, rejectionReason: reason } : r),
  })),
  setBalances: (balances) => set({ balances }),
  getPending: () => get().requests.filter((r) => r.status === "pending"),
  getByEmployee: (empId) => get().requests.filter((r) => r.employeeId === empId),
}));

// ─── ATTENDANCE STORE ────────────────────────────────────────────────
export interface AttendanceEntry {
  id: string; employeeId: string; employeeName: string; date: string;
  clockIn?: string; clockOut?: string;
  status: "present" | "absent" | "late" | "half_day" | "on_leave" | "wfh" | "holiday" | "weekend";
  hours?: number; overtime?: number; location?: string;
  method?: string; shift?: string; lateMinutes?: number;
}

interface AttendanceStore {
  entries: AttendanceEntry[];
  isClockedIn: boolean;
  currentSessionId: string | null;
  clockIn: (entry: AttendanceEntry) => void;
  clockOut: (id: string, time: string, hours: number) => void;
  addEntry: (entry: AttendanceEntry) => void;
  getToday: () => AttendanceEntry[];
  getByDate: (date: string) => AttendanceEntry[];
  getByEmployee: (empId: string) => AttendanceEntry[];
}

export const useAttendance = create<AttendanceStore>((set, get) => ({
  entries: [],
  isClockedIn: false,
  currentSessionId: null,
  clockIn: (entry) => set((s) => ({
    entries: [entry, ...s.entries],
    isClockedIn: true,
    currentSessionId: entry.id,
  })),
  clockOut: (id, time, hours) => set((s) => ({
    entries: s.entries.map((e) => e.id === id ? { ...e, clockOut: time, hours } : e),
    isClockedIn: false,
    currentSessionId: null,
  })),
  addEntry: (entry) => set((s) => ({ entries: [entry, ...s.entries] })),
  getToday: () => {
    const today = new Date().toISOString().split("T")[0];
    return get().entries.filter((e) => e.date === today);
  },
  getByDate: (date) => get().entries.filter((e) => e.date === date),
  getByEmployee: (empId) => get().entries.filter((e) => e.employeeId === empId),
}));

// ─── EXPENSE STORE ───────────────────────────────────────────────────
export interface ExpenseEntry {
  id: string; employeeId: string; employeeName: string;
  category: string; subCategory?: string; description: string;
  amount: number; date: string; receipt: boolean;
  status: "draft" | "submitted" | "approved" | "rejected" | "reimbursed";
  approvedBy?: string; rejectionReason?: string;
  project?: string; billable: boolean; merchant?: string;
  paymentMethod: string;
}

interface ExpenseStore {
  expenses: ExpenseEntry[];
  add: (exp: ExpenseEntry) => void;
  updateStatus: (id: string, status: ExpenseEntry["status"], by?: string, reason?: string) => void;
  remove: (id: string) => void;
  getPending: () => ExpenseEntry[];
  getByEmployee: (empId: string) => ExpenseEntry[];
  getTotal: (status?: string) => number;
}

export const useExpenses = create<ExpenseStore>((set, get) => ({
  expenses: [],
  add: (exp) => set((s) => ({ expenses: [exp, ...s.expenses] })),
  updateStatus: (id, status, by, reason) => set((s) => ({
    expenses: s.expenses.map((e) => e.id === id ? { ...e, status, approvedBy: by, rejectionReason: reason } : e),
  })),
  remove: (id) => set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) })),
  getPending: () => get().expenses.filter((e) => e.status === "submitted"),
  getByEmployee: (empId) => get().expenses.filter((e) => e.employeeId === empId),
  getTotal: (status) => get().expenses.filter((e) => !status || e.status === status).reduce((s, e) => s + e.amount, 0),
}));

// ─── ANNOUNCEMENT STORE ──────────────────────────────────────────────
export interface AnnouncementEntry {
  id: string; title: string; content: string;
  priority: "low" | "normal" | "high" | "urgent";
  author: string; authorRole?: string; department?: string;
  pinned: boolean; likes: number; comments: number; views: number;
  createdAt: string;
}

interface AnnouncementStore {
  items: AnnouncementEntry[];
  add: (item: AnnouncementEntry) => void;
  remove: (id: string) => void;
  togglePin: (id: string) => void;
  like: (id: string) => void;
  getPinned: () => AnnouncementEntry[];
}

export const useAnnouncements = create<AnnouncementStore>((set, get) => ({
  items: [],
  add: (item) => set((s) => ({ items: [item, ...s.items] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  togglePin: (id) => set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, pinned: !i.pinned } : i) })),
  like: (id) => set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, likes: i.likes + 1 } : i) })),
  getPinned: () => get().items.filter((i) => i.pinned),
}));

// ─── RECRUITMENT STORE ───────────────────────────────────────────────
export interface JobEntry {
  id: string; title: string; department: string; location: string;
  type: string; experience: string; salary?: string;
  description: string; requirements: string[];
  status: "draft" | "open" | "closed" | "on_hold" | "filled";
  applicants: number; hiringManager: string;
  urgency: "low" | "normal" | "high" | "critical";
  postedDate: string; closingDate?: string;
}

export interface CandidateEntry {
  id: string; jobId: string; jobTitle: string; name: string;
  email: string; phone?: string; experience: string;
  skills: string[]; source: string;
  stage: "applied" | "screening" | "phone_screen" | "technical" | "culture_fit" | "offer" | "hired" | "rejected";
  rating: number; currentCompany?: string;
  expectedSalary?: string; noticePeriod?: string;
  interviewScore?: number; notes?: string;
  appliedDate: string;
}

interface RecruitmentStore {
  jobs: JobEntry[];
  candidates: CandidateEntry[];
  addJob: (job: JobEntry) => void;
  updateJob: (id: string, data: Partial<JobEntry>) => void;
  addCandidate: (candidate: CandidateEntry) => void;
  updateCandidateStage: (id: string, stage: CandidateEntry["stage"]) => void;
  rateCandidate: (id: string, rating: number) => void;
  getOpenJobs: () => JobEntry[];
  getCandidatesByJob: (jobId: string) => CandidateEntry[];
  getCandidatesByStage: (stage: string) => CandidateEntry[];
}

export const useRecruitment = create<RecruitmentStore>((set, get) => ({
  jobs: [],
  candidates: [],
  addJob: (job) => set((s) => ({ jobs: [job, ...s.jobs] })),
  updateJob: (id, data) => set((s) => ({ jobs: s.jobs.map((j) => j.id === id ? { ...j, ...data } : j) })),
  addCandidate: (candidate) => set((s) => ({ candidates: [candidate, ...s.candidates] })),
  updateCandidateStage: (id, stage) => set((s) => ({ candidates: s.candidates.map((c) => c.id === id ? { ...c, stage } : c) })),
  rateCandidate: (id, rating) => set((s) => ({ candidates: s.candidates.map((c) => c.id === id ? { ...c, rating } : c) })),
  getOpenJobs: () => get().jobs.filter((j) => j.status === "open"),
  getCandidatesByJob: (jobId) => get().candidates.filter((c) => c.jobId === jobId),
  getCandidatesByStage: (stage) => get().candidates.filter((c) => c.stage === stage),
}));

// ─── HELPDESK STORE ──────────────────────────────────────────────────
export interface TicketEntry {
  id: string; title: string; description: string;
  category: string; priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "resolved" | "closed";
  reporter: string; reporterDept: string;
  assignedTo?: string; replies: number;
  createdAt: string; resolvedAt?: string;
}

interface HelpdeskStore {
  tickets: TicketEntry[];
  add: (ticket: TicketEntry) => void;
  updateStatus: (id: string, status: TicketEntry["status"]) => void;
  assign: (id: string, assignee: string) => void;
  getOpen: () => TicketEntry[];
  getByReporter: (reporter: string) => TicketEntry[];
}

export const useHelpdesk = create<HelpdeskStore>((set, get) => ({
  tickets: [],
  add: (ticket) => set((s) => ({ tickets: [ticket, ...s.tickets] })),
  updateStatus: (id, status) => set((s) => ({
    tickets: s.tickets.map((t) => t.id === id ? { ...t, status, ...(status === "resolved" ? { resolvedAt: new Date().toISOString() } : {}) } : t),
  })),
  assign: (id, assignee) => set((s) => ({
    tickets: s.tickets.map((t) => t.id === id ? { ...t, assignedTo: assignee, status: "in_progress" as const } : t),
  })),
  getOpen: () => get().tickets.filter((t) => t.status === "open" || t.status === "in_progress"),
  getByReporter: (reporter) => get().tickets.filter((t) => t.reporter === reporter),
}));

// ─── PERFORMANCE STORE ───────────────────────────────────────────────
export interface GoalEntry {
  id: string; title: string; description?: string;
  owner: string; ownerDept: string;
  category: "business" | "individual" | "team" | "learning";
  priority: "low" | "medium" | "high" | "critical";
  status: "not_started" | "in_progress" | "at_risk" | "completed" | "deferred";
  progress: number; weight: number;
  startDate: string; dueDate: string;
  keyResults: { title: string; target: string; current: string; progress: number }[];
}

export interface FeedbackEntry {
  id: string; from: string; to: string; fromRole: string;
  type: "praise" | "suggestion" | "concern";
  message: string; visibility: "public" | "private";
  values?: string[]; reactions: { emoji: string; count: number }[];
  createdAt: string;
}

interface PerformanceStore {
  goals: GoalEntry[];
  feedback: FeedbackEntry[];
  addGoal: (goal: GoalEntry) => void;
  updateGoal: (id: string, data: Partial<GoalEntry>) => void;
  addFeedback: (fb: FeedbackEntry) => void;
  reactToFeedback: (id: string, emoji: string) => void;
  getByOwner: (owner: string) => GoalEntry[];
  getAtRisk: () => GoalEntry[];
}

export const usePerformance = create<PerformanceStore>((set, get) => ({
  goals: [],
  feedback: [],
  addGoal: (goal) => set((s) => ({ goals: [goal, ...s.goals] })),
  updateGoal: (id, data) => set((s) => ({ goals: s.goals.map((g) => g.id === id ? { ...g, ...data } : g) })),
  addFeedback: (fb) => set((s) => ({ feedback: [fb, ...s.feedback] })),
  reactToFeedback: (id, emoji) => set((s) => ({
    feedback: s.feedback.map((f) => {
      if (f.id !== id) return f;
      const existing = f.reactions.find((r) => r.emoji === emoji);
      if (existing) return { ...f, reactions: f.reactions.map((r) => r.emoji === emoji ? { ...r, count: r.count + 1 } : r) };
      return { ...f, reactions: [...f.reactions, { emoji, count: 1 }] };
    }),
  })),
  getByOwner: (owner) => get().goals.filter((g) => g.owner === owner),
  getAtRisk: () => get().goals.filter((g) => g.status === "at_risk"),
}));

// ─── TRAINING STORE ──────────────────────────────────────────────────
export interface CourseEntry {
  id: string; title: string; category: string; instructor: string;
  duration: string; type: "online" | "classroom" | "hybrid" | "self_paced";
  level: "beginner" | "intermediate" | "advanced" | "expert";
  description: string; enrolled: number; maxCapacity: number;
  rating: number; reviews: number; completionRate: number;
  skills: string[]; certification: boolean; mandatory: boolean;
  status: "upcoming" | "in_progress" | "completed" | "archived";
  modules: { title: string; duration: string; completed: boolean }[];
  startDate?: string; endDate?: string;
}

export interface EnrollmentEntry {
  id: string; courseId: string; employeeId: string;
  progress: number; status: "enrolled" | "in_progress" | "completed" | "dropped";
  enrolledAt: string; completedAt?: string; score?: number;
}

interface TrainingStore {
  courses: CourseEntry[];
  enrollments: EnrollmentEntry[];
  addCourse: (course: CourseEntry) => void;
  updateCourse: (id: string, data: Partial<CourseEntry>) => void;
  enroll: (enrollment: EnrollmentEntry) => void;
  updateProgress: (id: string, progress: number) => void;
  completeCourse: (id: string, score?: number) => void;
  getCoursesByCategory: (category: string) => CourseEntry[];
  getEnrollmentsByEmployee: (empId: string) => EnrollmentEntry[];
}

export const useTraining = create<TrainingStore>((set, get) => ({
  courses: [],
  enrollments: [],
  addCourse: (course) => set((s) => ({ courses: [course, ...s.courses] })),
  updateCourse: (id, data) => set((s) => ({ courses: s.courses.map((c) => c.id === id ? { ...c, ...data } : c) })),
  enroll: (enrollment) => set((s) => ({ enrollments: [...s.enrollments, enrollment] })),
  updateProgress: (id, progress) => set((s) => ({
    enrollments: s.enrollments.map((e) => e.id === id ? { ...e, progress, status: progress >= 100 ? "completed" as const : "in_progress" as const } : e),
  })),
  completeCourse: (id, score) => set((s) => ({
    enrollments: s.enrollments.map((e) => e.id === id ? { ...e, progress: 100, status: "completed" as const, completedAt: new Date().toISOString(), score } : e),
  })),
  getCoursesByCategory: (category) => get().courses.filter((c) => c.category === category),
  getEnrollmentsByEmployee: (empId) => get().enrollments.filter((e) => e.employeeId === empId),
}));

// ─── ASSET STORE ─────────────────────────────────────────────────────
export interface AssetEntry {
  id: string; name: string; category: string; serial: string;
  assignedTo?: string; assignedToName?: string; department?: string;
  status: "available" | "assigned" | "maintenance" | "retired";
  purchaseDate: string; value: number; condition: "new" | "good" | "fair" | "poor";
}

interface AssetStore {
  assets: AssetEntry[];
  add: (asset: AssetEntry) => void;
  update: (id: string, data: Partial<AssetEntry>) => void;
  remove: (id: string) => void;
  assign: (id: string, to: string, toName: string) => void;
  unassign: (id: string) => void;
  getAvailable: () => AssetEntry[];
  getByAssignee: (to: string) => AssetEntry[];
  getTotalValue: () => number;
}

export const useAssets = create<AssetStore>((set, get) => ({
  assets: [],
  add: (asset) => set((s) => ({ assets: [asset, ...s.assets] })),
  update: (id, data) => set((s) => ({ assets: s.assets.map((a) => a.id === id ? { ...a, ...data } : a) })),
  remove: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),
  assign: (id, to, toName) => set((s) => ({
    assets: s.assets.map((a) => a.id === id ? { ...a, assignedTo: to, assignedToName: toName, status: "assigned" as const } : a),
  })),
  unassign: (id) => set((s) => ({
    assets: s.assets.map((a) => a.id === id ? { ...a, assignedTo: undefined, assignedToName: undefined, status: "available" as const } : a),
  })),
  getAvailable: () => get().assets.filter((a) => a.status === "available"),
  getByAssignee: (to) => get().assets.filter((a) => a.assignedTo === to),
  getTotalValue: () => get().assets.reduce((s, a) => s + a.value, 0),
}));

// ─── NOTIFICATION STORE ──────────────────────────────────────────────
export interface NotificationEntry {
  id: string; type: string; title: string; message: string;
  read: boolean; avatar?: string; time: string; actionUrl?: string;
}

interface NotificationStore {
  items: NotificationEntry[];
  add: (item: NotificationEntry) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  getUnread: () => NotificationEntry[];
  getUnreadCount: () => number;
}

export const useNotifications = create<NotificationStore>((set, get) => ({
  items: [],
  add: (item) => set((s) => ({ items: [item, ...s.items] })),
  markRead: (id) => set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, read: true } : i) })),
  markAllRead: () => set((s) => ({ items: s.items.map((i) => ({ ...i, read: true })) })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [] }),
  getUnread: () => get().items.filter((i) => !i.read),
  getUnreadCount: () => get().items.filter((i) => !i.read).length,
}));

// ─── PAYROLL STORE ───────────────────────────────────────────────────
export interface PayrollEntry {
  id: string; employeeId: string; employeeName: string;
  month: number; year: number;
  basic: number; hra: number; conveyance: number; special: number;
  medical: number; bonus: number; shiftAllow: number;
  grossSalary: number;
  pf: number; pt: number; tds: number; insurance: number;
  loanEmi: number; otherDeductions: number;
  totalDeductions: number; netSalary: number;
  status: "draft" | "processed" | "approved" | "paid" | "on_hold";
  processedAt?: string; paidAt?: string;
}

interface PayrollStore {
  records: PayrollRecord[];
  add: (record: PayrollRecord) => void;
  updateStatus: (id: string, status: PayrollEntry["status"]) => void;
  getByMonth: (month: number, year: number) => PayrollRecord[];
  getTotal: (field: "grossSalary" | "netSalary" | "totalDeductions") => number;
}

type PayrollRecord = PayrollEntry;

export const usePayroll = create<PayrollStore>((set, get) => ({
  records: [],
  add: (record) => set((s) => ({ records: [record, ...s.records] })),
  updateStatus: (id, status) => set((s) => ({
    records: s.records.map((r) => r.id === id ? { ...r, status } : r),
  })),
  getByMonth: (month, year) => get().records.filter((r) => r.month === month && r.year === year),
  getTotal: (field) => get().records.reduce((s, r) => s + (r[field] as number), 0),
}));

// ─── TRAVEL STORE ────────────────────────────────────────────────────
export interface TravelRequest {
  id: string; employeeId: string; employeeName: string;
  from: string; to: string; purpose: string;
  startDate: string; endDate: string; days: number;
  budget: number; transport: string; accommodation: string;
  status: "pending" | "approved" | "rejected" | "completed";
  approvedBy?: string;
}

interface TravelStore {
  requests: TravelRequest[];
  add: (req: TravelRequest) => void;
  updateStatus: (id: string, status: TravelRequest["status"], by?: string) => void;
  getPending: () => TravelRequest[];
}

export const useTravel = create<TravelStore>((set, get) => ({
  requests: [],
  add: (req) => set((s) => ({ requests: [req, ...s.requests] })),
  updateStatus: (id, status, by) => set((s) => ({
    requests: s.requests.map((r) => r.id === id ? { ...r, status, approvedBy: by } : r),
  })),
  getPending: () => get().requests.filter((r) => r.status === "pending"),
}));

// ─── LOAN STORE ──────────────────────────────────────────────────────
export interface LoanEntry {
  id: string; employeeId: string; employeeName: string;
  type: string; amount: number; tenure: number; emiAmount: number;
  paidEmis: number; disbursed: string;
  status: "pending" | "active" | "closed";
}

interface LoanStore {
  loans: LoanEntry[];
  add: (loan: LoanEntry) => void;
  payEmi: (id: string) => void;
  getActive: () => LoanEntry[];
  getOutstanding: () => number;
}

export const useLoans = create<LoanStore>((set, get) => ({
  loans: [],
  add: (loan) => set((s) => ({ loans: [loan, ...s.loans] })),
  payEmi: (id) => set((s) => ({
    loans: s.loans.map((l) => {
      if (l.id !== id) return l;
      const newPaid = l.paidEmis + 1;
      return { ...l, paidEmis: newPaid, status: newPaid >= l.tenure ? "closed" as const : l.status };
    }),
  })),
  getActive: () => get().loans.filter((l) => l.status === "active"),
  getOutstanding: () => get().loans.filter((l) => l.status === "active").reduce((s, l) => s + (l.amount - l.paidEmis * l.emiAmount), 0),
}));

// ─── GRIEVANCE STORE ─────────────────────────────────────────────────
export interface GrievanceEntry {
  id: string; title: string; category: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string; reporter: string; reporterDept: string;
  anonymous: boolean; assignedTo: string;
  status: "open" | "investigating" | "escalated" | "resolved" | "closed";
  resolution?: string; createdAt: string;
  timeline: { date: string; action: string; by: string }[];
}

interface GrievanceStore {
  cases: GrievanceEntry[];
  add: (c: GrievanceEntry) => void;
  updateStatus: (id: string, status: GrievanceEntry["status"], resolution?: string) => void;
  addTimelineEvent: (id: string, event: { date: string; action: string; by: string }) => void;
  getOpen: () => GrievanceEntry[];
}

export const useGrievances = create<GrievanceStore>((set, get) => ({
  cases: [],
  add: (c) => set((s) => ({ cases: [c, ...s.cases] })),
  updateStatus: (id, status, resolution) => set((s) => ({
    cases: s.cases.map((c) => c.id === id ? { ...c, status, resolution } : c),
  })),
  addTimelineEvent: (id, event) => set((s) => ({
    cases: s.cases.map((c) => c.id === id ? { ...c, timeline: [...c.timeline, event] } : c),
  })),
  getOpen: () => get().cases.filter((c) => ["open", "investigating", "escalated"].includes(c.status)),
}));

// ─── WFH STORE ───────────────────────────────────────────────────────
export interface WfhRequest {
  id: string; employeeId: string; employeeName: string; dept: string;
  startDate: string; endDate: string; days: number;
  reason: string; location: string;
  status: "pending" | "approved" | "rejected";
  approvedBy?: string;
}

interface WfhStore {
  requests: WfhRequest[];
  add: (req: WfhRequest) => void;
  updateStatus: (id: string, status: WfhRequest["status"], by?: string) => void;
  getPending: () => WfhRequest[];
  getActiveToday: () => number;
}

export const useWfh = create<WfhStore>((set, get) => ({
  requests: [],
  add: (req) => set((s) => ({ requests: [req, ...s.requests] })),
  updateStatus: (id, status, by) => set((s) => ({
    requests: s.requests.map((r) => r.id === id ? { ...r, status, approvedBy: by } : r),
  })),
  getPending: () => get().requests.filter((r) => r.status === "pending"),
  getActiveToday: () => {
    const today = new Date().toISOString().split("T")[0];
    return get().requests.filter((r) => r.status === "approved" && r.startDate <= today && r.endDate >= today).length;
  },
}));

// ─── VISITOR STORE ───────────────────────────────────────────────────
export interface VisitorEntry {
  id: string; name: string; company: string; purpose: string;
  host: string; hostDept: string; date: string;
  checkIn?: string; checkOut?: string;
  status: "expected" | "checked_in" | "checked_out";
  badge?: string;
}

interface VisitorStore {
  visitors: VisitorEntry[];
  add: (v: VisitorEntry) => void;
  checkIn: (id: string, time: string, badge: string) => void;
  checkOut: (id: string, time: string) => void;
  getToday: () => VisitorEntry[];
  getCheckedIn: () => VisitorEntry[];
}

export const useVisitors = create<VisitorStore>((set, get) => ({
  visitors: [],
  add: (v) => set((s) => ({ visitors: [v, ...s.visitors] })),
  checkIn: (id, time, badge) => set((s) => ({
    visitors: s.visitors.map((v) => v.id === id ? { ...v, checkIn: time, badge, status: "checked_in" as const } : v),
  })),
  checkOut: (id, time) => set((s) => ({
    visitors: s.visitors.map((v) => v.id === id ? { ...v, checkOut: time, status: "checked_out" as const } : v),
  })),
  getToday: () => {
    const today = new Date().toISOString().split("T")[0];
    return get().visitors.filter((v) => v.date === today);
  },
  getCheckedIn: () => get().visitors.filter((v) => v.status === "checked_in"),
}));

// ─── SURVEY STORE ────────────────────────────────────────────────────
export interface SurveyEntry {
  id: string; title: string; description: string;
  status: "draft" | "active" | "completed";
  questions: number; responses: number; total: number;
  deadline: string; anonymous: boolean;
  avgRating: number; categories: string[];
}

interface SurveyStore {
  surveys: SurveyEntry[];
  add: (survey: SurveyEntry) => void;
  updateStatus: (id: string, status: SurveyEntry["status"]) => void;
  getActive: () => SurveyEntry[];
}

export const useSurveys = create<SurveyStore>((set, get) => ({
  surveys: [],
  add: (survey) => set((s) => ({ surveys: [survey, ...s.surveys] })),
  updateStatus: (id, status) => set((s) => ({ surveys: s.surveys.map((s2) => s2.id === id ? { ...s2, status } : s2) })),
  getActive: () => get().surveys.filter((s) => s.status === "active"),
}));

// ─── INCIDENT STORE ──────────────────────────────────────────────────
export interface IncidentEntry {
  id: string; title: string; category: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string; reporter: string; location: string;
  status: "reported" | "investigating" | "in_progress" | "resolved" | "closed";
  assignedTo: string; date: string;
}

interface IncidentStore {
  incidents: IncidentEntry[];
  add: (incident: IncidentEntry) => void;
  updateStatus: (id: string, status: IncidentEntry["status"]) => void;
  getOpen: () => IncidentEntry[];
}

export const useIncidents = create<IncidentStore>((set, get) => ({
  incidents: [],
  add: (incident) => set((s) => ({ incidents: [incident, ...s.incidents] })),
  updateStatus: (id, status) => set((s) => ({ incidents: s.incidents.map((i) => i.id === id ? { ...i, status } : i) })),
  getOpen: () => get().incidents.filter((i) => !["resolved", "closed"].includes(i.status)),
}));

// ─── FEEDBACK SUGGESTION STORE ───────────────────────────────────────
export interface FeedbackSuggestion {
  id: string; type: "suggestion" | "appreciation" | "concern";
  title: string; content: string; author: string;
  anonymous: boolean; votes: number;
  status: "under_review" | "acknowledged" | "in_progress" | "implemented";
  createdAt: string;
}

interface FeedbackSuggestionStore {
  items: FeedbackSuggestion[];
  add: (item: FeedbackSuggestion) => void;
  vote: (id: string) => void;
  updateStatus: (id: string, status: FeedbackSuggestion["status"]) => void;
}

export const useFeedbackSuggestions = create<FeedbackSuggestionStore>((set) => ({
  items: [],
  add: (item) => set((s) => ({ items: [item, ...s.items] })),
  vote: (id) => set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, votes: i.votes + 1 } : i) })),
  updateStatus: (id, status) => set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, status } : i) })),
}));

// ─── MEETING ROOM STORE ──────────────────────────────────────────────
export interface RoomBooking {
  id: string; roomId: string; roomName: string;
  bookedBy: string; purpose: string;
  date: string; startTime: string; endTime: string;
  attendees: number;
}

interface MeetingRoomStore {
  bookings: RoomBooking[];
  add: (booking: RoomBooking) => void;
  cancel: (id: string) => void;
  getByDate: (date: string) => RoomBooking[];
  getByRoom: (roomId: string) => RoomBooking[];
}

export const useMeetingRooms = create<MeetingRoomStore>((set, get) => ({
  bookings: [],
  add: (booking) => set((s) => ({ bookings: [booking, ...s.bookings] })),
  cancel: (id) => set((s) => ({ bookings: s.bookings.filter((b) => b.id !== id) })),
  getByDate: (date) => get().bookings.filter((b) => b.date === date),
  getByRoom: (roomId) => get().bookings.filter((b) => b.roomId === roomId),
}));

// ─── TIMESHEET STORE ─────────────────────────────────────────────────
export interface TimesheetEntry {
  id: string; employeeId: string; date: string; project: string;
  task: string; hours: number;
  status: "logged" | "submitted" | "approved" | "rejected";
}

interface TimesheetStore {
  entries: TimesheetEntry[];
  add: (entry: TimesheetEntry) => void;
  updateStatus: (id: string, status: TimesheetEntry["status"]) => void;
  getByDate: (date: string) => TimesheetEntry[];
  getWeeklyTotal: (empId: string) => number;
}

export const useTimesheets = create<TimesheetStore>((set, get) => ({
  entries: [],
  add: (entry) => set((s) => ({ entries: [entry, ...s.entries] })),
  updateStatus: (id, status) => set((s) => ({ entries: s.entries.map((e) => e.id === id ? { ...e, status } : e) })),
  getByDate: (date) => get().entries.filter((e) => e.date === date),
  getWeeklyTotal: (empId) => get().entries.filter((e) => e.employeeId === empId).reduce((s, e) => s + e.hours, 0),
}));

// ─── REFERRAL STORE ──────────────────────────────────────────────────
export interface ReferralEntry {
  id: string; referrer: string; referrerDept: string;
  candidateName: string; candidateEmail: string;
  position: string;
  status: "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";
  appliedDate: string; bonus: number;
}

interface ReferralStore {
  referrals: ReferralEntry[];
  add: (ref: ReferralEntry) => void;
  updateStatus: (id: string, status: ReferralEntry["status"]) => void;
  getHired: () => ReferralEntry[];
  getTotalBonus: () => number;
}

export const useReferrals = create<ReferralStore>((set, get) => ({
  referrals: [],
  add: (ref) => set((s) => ({ referrals: [ref, ...s.referrals] })),
  updateStatus: (id, status) => set((s) => ({ referrals: s.referrals.map((r) => r.id === id ? { ...r, status } : r) })),
  getHired: () => get().referrals.filter((r) => r.status === "hired"),
  getTotalBonus: () => get().referrals.filter((r) => r.status === "hired").reduce((s, r) => s + r.bonus, 0),
}));

// ─── OVERTIME STORE ──────────────────────────────────────────────────
export interface OvertimeEntry {
  id: string; employeeId: string; employeeName: string; dept: string;
  date: string; hours: number; rate: number; amount: number;
  reason: string;
  status: "pending" | "approved" | "paid";
}

interface OvertimeStore {
  entries: OvertimeEntry[];
  add: (entry: OvertimeEntry) => void;
  updateStatus: (id: string, status: OvertimeEntry["status"]) => void;
  getTotalHours: () => number;
  getTotalAmount: () => number;
}

export const useOvertime = create<OvertimeStore>((set, get) => ({
  entries: [],
  add: (entry) => set((s) => ({ entries: [entry, ...s.entries] })),
  updateStatus: (id, status) => set((s) => ({ entries: s.entries.map((e) => e.id === id ? { ...e, status } : e) })),
  getTotalHours: () => get().entries.reduce((s, e) => s + e.hours, 0),
  getTotalAmount: () => get().entries.reduce((s, e) => s + e.amount, 0),
}));

// ─── AUDIT LOG STORE ─────────────────────────────────────────────────
export interface AuditEntry {
  id: string; action: string; user: string; target: string;
  type: "auth" | "create" | "update" | "delete" | "security" | "export";
  ip: string; details: string; severity: "info" | "medium" | "high";
  timestamp: string;
}

interface AuditStore {
  logs: AuditEntry[];
  add: (log: AuditEntry) => void;
  getRecent: (count: number) => AuditEntry[];
  getByUser: (user: string) => AuditEntry[];
}

export const useAuditLog = create<AuditStore>((set, get) => ({
  logs: [],
  add: (log) => set((s) => ({ logs: [log, ...s.logs] })),
  getRecent: (count) => get().logs.slice(0, count),
  getByUser: (user) => get().logs.filter((l) => l.user === user),
}));
