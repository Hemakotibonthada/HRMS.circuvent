import { create } from "zustand";

// ═══════════════════════════════════════════════════════════════
// COMPREHENSIVE HRMS STORES — All Zustand stores for data
// management across every HRMS module, including CRUD operations,
// filtering, sorting, and computed derived state
// ═══════════════════════════════════════════════════════════════

// ─── Employee Module Store ───────────────────────────────────

interface Employee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  joiningDate: string;
  status: "active" | "inactive" | "probation" | "notice_period";
  reportingManager: string;
  location: string;
  employmentType: "full_time" | "part_time" | "contract" | "intern";
  salary: number;
  skills: string[];
  avatar?: string;
}

interface EmployeeStore {
  employees: Employee[];
  selectedIds: Set<string>;
  searchQuery: string;
  filters: { department: string; status: string; location: string; type: string };
  sortBy: keyof Employee | null;
  sortDir: "asc" | "desc";
  addEmployee: (employee: Employee) => void;
  updateEmployee: (id: string, updates: Partial<Employee>) => void;
  removeEmployee: (id: string) => void;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setSearch: (query: string) => void;
  setFilter: (key: string, value: string) => void;
  setSort: (key: keyof Employee) => void;
  getFiltered: () => Employee[];
  getByDepartment: (dept: string) => Employee[];
  getStats: () => { total: number; active: number; onProbation: number; onNotice: number; departments: number };
}

export const useEmployeeStore = create<EmployeeStore>((set, get) => ({
  employees: [],
  selectedIds: new Set(),
  searchQuery: "",
  filters: { department: "all", status: "all", location: "all", type: "all" },
  sortBy: null,
  sortDir: "asc",

  addEmployee: (employee) => set((state) => ({ employees: [...state.employees, employee] })),
  updateEmployee: (id, updates) => set((state) => ({
    employees: state.employees.map((e) => (e.id === id ? { ...e, ...updates } : e)),
  })),
  removeEmployee: (id) => set((state) => ({
    employees: state.employees.filter((e) => e.id !== id),
    selectedIds: new Set([...state.selectedIds].filter((s) => s !== id)),
  })),
  toggleSelect: (id) => set((state) => {
    const next = new Set(state.selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { selectedIds: next };
  }),
  selectAll: () => set((state) => ({ selectedIds: new Set(state.employees.map((e) => e.id)) })),
  clearSelection: () => set({ selectedIds: new Set() }),
  setSearch: (query) => set({ searchQuery: query }),
  setFilter: (key, value) => set((state) => ({ filters: { ...state.filters, [key]: value } })),
  setSort: (key) => set((state) => ({
    sortBy: key,
    sortDir: state.sortBy === key && state.sortDir === "asc" ? "desc" : "asc",
  })),

  getFiltered: () => {
    const { employees, searchQuery, filters, sortBy, sortDir } = get();
    let result = [...employees];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) => `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || e.employeeId.toLowerCase().includes(q)
      );
    }
    if (filters.department !== "all") result = result.filter((e) => e.department === filters.department);
    if (filters.status !== "all") result = result.filter((e) => e.status === filters.status);
    if (filters.location !== "all") result = result.filter((e) => e.location === filters.location);
    if (filters.type !== "all") result = result.filter((e) => e.employmentType === filters.type);
    if (sortBy) {
      result.sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        if (aVal == null || bVal == null) return 0;
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  },
  getByDepartment: (dept) => get().employees.filter((e) => e.department === dept),
  getStats: () => {
    const { employees } = get();
    return {
      total: employees.length,
      active: employees.filter((e) => e.status === "active").length,
      onProbation: employees.filter((e) => e.status === "probation").length,
      onNotice: employees.filter((e) => e.status === "notice_period").length,
      departments: new Set(employees.map((e) => e.department)).size,
    };
  },
}));

// ─── Leave Module Store ──────────────────────────────────────

interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  appliedOn: string;
  approvedBy?: string;
  approvedOn?: string;
  comments?: string;
}

interface LeaveBalance {
  leaveType: string;
  total: number;
  used: number;
  pending: number;
  balance: number;
}

interface LeaveStore {
  requests: LeaveRequest[];
  balances: LeaveBalance[];
  addRequest: (request: LeaveRequest) => void;
  updateStatus: (id: string, status: LeaveRequest["status"], approvedBy?: string) => void;
  cancelRequest: (id: string) => void;
  getPending: () => LeaveRequest[];
  getByEmployee: (employeeId: string) => LeaveRequest[];
  getByStatus: (status: LeaveRequest["status"]) => LeaveRequest[];
  updateBalance: (leaveType: string, updates: Partial<LeaveBalance>) => void;
  getTotalBalance: () => number;
}

export const useLeaveStore = create<LeaveStore>((set, get) => ({
  requests: [],
  balances: [],
  addRequest: (request) => set((state) => ({ requests: [...state.requests, request] })),
  updateStatus: (id, status, approvedBy) => set((state) => ({
    requests: state.requests.map((r) =>
      r.id === id ? { ...r, status, approvedBy, approvedOn: new Date().toISOString() } : r
    ),
  })),
  cancelRequest: (id) => set((state) => ({
    requests: state.requests.map((r) => (r.id === id ? { ...r, status: "cancelled" as const } : r)),
  })),
  getPending: () => get().requests.filter((r) => r.status === "pending"),
  getByEmployee: (employeeId) => get().requests.filter((r) => r.employeeId === employeeId),
  getByStatus: (status) => get().requests.filter((r) => r.status === status),
  updateBalance: (leaveType, updates) => set((state) => ({
    balances: state.balances.map((b) => (b.leaveType === leaveType ? { ...b, ...updates } : b)),
  })),
  getTotalBalance: () => get().balances.reduce((sum, b) => sum + b.balance, 0),
}));

// ─── Attendance Module Store ─────────────────────────────────

interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
  status: "present" | "absent" | "half_day" | "wfh" | "on_leave" | "late";
  workedHours: number;
  overtimeHours: number;
  location: string;
}

interface AttendanceStore {
  records: AttendanceRecord[];
  isClockedIn: boolean;
  currentSessionStart?: string;
  add: (record: AttendanceRecord) => void;
  clockIn: () => void;
  clockOut: () => void;
  getByDate: (date: string) => AttendanceRecord[];
  getByEmployee: (empId: string) => AttendanceRecord[];
  getTodayStats: () => { present: number; absent: number; wfh: number; late: number; onLeave: number };
}

export const useAttendanceStore = create<AttendanceStore>((set, get) => ({
  records: [],
  isClockedIn: false,
  currentSessionStart: undefined,
  add: (record) => set((state) => ({ records: [...state.records, record] })),
  clockIn: () => set({ isClockedIn: true, currentSessionStart: new Date().toISOString() }),
  clockOut: () => set({ isClockedIn: false, currentSessionStart: undefined }),
  getByDate: (date) => get().records.filter((r) => r.date === date),
  getByEmployee: (empId) => get().records.filter((r) => r.employeeId === empId),
  getTodayStats: () => {
    const today = new Date().toISOString().split("T")[0];
    const todayRecords = get().records.filter((r) => r.date === today);
    return {
      present: todayRecords.filter((r) => r.status === "present" || r.status === "late").length,
      absent: todayRecords.filter((r) => r.status === "absent").length,
      wfh: todayRecords.filter((r) => r.status === "wfh").length,
      late: todayRecords.filter((r) => r.status === "late").length,
      onLeave: todayRecords.filter((r) => r.status === "on_leave").length,
    };
  },
}));

// ─── Payroll Module Store ────────────────────────────────────

interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  month: string;
  year: number;
  basicPay: number;
  hra: number;
  specialAllowance: number;
  grossEarnings: number;
  pfEmployee: number;
  professionalTax: number;
  incomeTax: number;
  totalDeductions: number;
  netPay: number;
  status: "draft" | "processing" | "processed" | "paid" | "on_hold";
}

interface PayrollStore {
  records: PayrollRecord[];
  isLocked: boolean;
  add: (record: PayrollRecord) => void;
  updateStatus: (id: string, status: PayrollRecord["status"]) => void;
  lock: () => void;
  unlock: () => void;
  getByMonth: (month: string, year: number) => PayrollRecord[];
  getTotalPayroll: () => { gross: number; deductions: number; net: number };
  getProcessed: () => number;
  getPending: () => number;
}

export const usePayrollStore = create<PayrollStore>((set, get) => ({
  records: [],
  isLocked: true,
  add: (record) => set((state) => ({ records: [...state.records, record] })),
  updateStatus: (id, status) => set((state) => ({
    records: state.records.map((r) => (r.id === id ? { ...r, status } : r)),
  })),
  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false }),
  getByMonth: (month, year) => get().records.filter((r) => r.month === month && r.year === year),
  getTotalPayroll: () => {
    const { records } = get();
    return {
      gross: records.reduce((s, r) => s + r.grossEarnings, 0),
      deductions: records.reduce((s, r) => s + r.totalDeductions, 0),
      net: records.reduce((s, r) => s + r.netPay, 0),
    };
  },
  getProcessed: () => get().records.filter((r) => r.status === "processed" || r.status === "paid").length,
  getPending: () => get().records.filter((r) => r.status === "draft" || r.status === "processing").length,
}));

// ─── Expense Module Store ────────────────────────────────────

interface ExpenseRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  category: string;
  amount: number;
  date: string;
  description: string;
  receipt: boolean;
  status: "pending" | "approved" | "rejected" | "reimbursed";
  items: { desc: string; amount: number }[];
}

interface ExpenseStore {
  expenses: ExpenseRecord[];
  add: (expense: ExpenseRecord) => void;
  updateStatus: (id: string, status: ExpenseRecord["status"]) => void;
  getByStatus: (status: ExpenseRecord["status"]) => ExpenseRecord[];
  getTotals: () => { pending: number; approved: number; reimbursed: number; total: number };
}

export const useExpenseStore = create<ExpenseStore>((set, get) => ({
  expenses: [],
  add: (expense) => set((state) => ({ expenses: [...state.expenses, expense] })),
  updateStatus: (id, status) => set((state) => ({
    expenses: state.expenses.map((e) => (e.id === id ? { ...e, status } : e)),
  })),
  getByStatus: (status) => get().expenses.filter((e) => e.status === status),
  getTotals: () => {
    const { expenses } = get();
    return {
      pending: expenses.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0),
      approved: expenses.filter((e) => e.status === "approved").reduce((s, e) => s + e.amount, 0),
      reimbursed: expenses.filter((e) => e.status === "reimbursed").reduce((s, e) => s + e.amount, 0),
      total: expenses.reduce((s, e) => s + e.amount, 0),
    };
  },
}));

// ─── Recruitment Module Store ────────────────────────────────

interface JobPosting {
  id: string;
  title: string;
  department: string;
  location: string;
  type: "permanent" | "contract" | "intern";
  experience: { min: number; max: number };
  salaryRange: { min: number; max: number };
  status: "open" | "closed" | "on_hold" | "draft";
  applicants: number;
  postedDate: string;
  hiringManager: string;
}

interface Candidate {
  id: string;
  jobId: string;
  name: string;
  email: string;
  phone: string;
  experience: number;
  currentCTC: number;
  expectedCTC: number;
  noticePeriod: number;
  stage: "applied" | "screening" | "interview" | "offer" | "accepted" | "joined" | "rejected";
  rating: number;
  source: string;
  appliedDate: string;
}

interface RecruitmentStore {
  jobs: JobPosting[];
  candidates: Candidate[];
  addJob: (job: JobPosting) => void;
  updateJob: (id: string, updates: Partial<JobPosting>) => void;
  addCandidate: (candidate: Candidate) => void;
  updateCandidateStage: (id: string, stage: Candidate["stage"]) => void;
  getJobCandidates: (jobId: string) => Candidate[];
  getPipelineStats: () => Record<Candidate["stage"], number>;
  getOpenJobs: () => JobPosting[];
}

export const useRecruitmentStore = create<RecruitmentStore>((set, get) => ({
  jobs: [],
  candidates: [],
  addJob: (job) => set((state) => ({ jobs: [...state.jobs, job] })),
  updateJob: (id, updates) => set((state) => ({
    jobs: state.jobs.map((j) => (j.id === id ? { ...j, ...updates } : j)),
  })),
  addCandidate: (candidate) => set((state) => ({ candidates: [...state.candidates, candidate] })),
  updateCandidateStage: (id, stage) => set((state) => ({
    candidates: state.candidates.map((c) => (c.id === id ? { ...c, stage } : c)),
  })),
  getJobCandidates: (jobId) => get().candidates.filter((c) => c.jobId === jobId),
  getPipelineStats: () => {
    const stages: Candidate["stage"][] = ["applied", "screening", "interview", "offer", "accepted", "joined", "rejected"];
    const counts = {} as Record<Candidate["stage"], number>;
    stages.forEach((s) => { counts[s] = get().candidates.filter((c) => c.stage === s).length; });
    return counts;
  },
  getOpenJobs: () => get().jobs.filter((j) => j.status === "open"),
}));

// ─── Helpdesk Module Store ───────────────────────────────────

interface Ticket {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "waiting" | "resolved" | "closed";
  reporterId: string;
  reporterName: string;
  assigneeId?: string;
  assigneeName?: string;
  createdAt: string;
  updatedAt: string;
  messages: { from: string; message: string; time: string; isAgent: boolean }[];
  tags: string[];
}

interface HelpdeskStore {
  tickets: Ticket[];
  add: (ticket: Ticket) => void;
  updateStatus: (id: string, status: Ticket["status"]) => void;
  assign: (id: string, assigneeId: string, assigneeName: string) => void;
  addMessage: (ticketId: string, message: Ticket["messages"][0]) => void;
  getOpen: () => Ticket[];
  getByPriority: (priority: Ticket["priority"]) => Ticket[];
  getStats: () => { open: number; inProgress: number; resolved: number; avgResolution: string; slaCompliance: number };
}

export const useHelpdeskStore = create<HelpdeskStore>((set, get) => ({
  tickets: [],
  add: (ticket) => set((state) => ({ tickets: [...state.tickets, ticket] })),
  updateStatus: (id, status) => set((state) => ({
    tickets: state.tickets.map((t) => (t.id === id ? { ...t, status, updatedAt: new Date().toISOString() } : t)),
  })),
  assign: (id, assigneeId, assigneeName) => set((state) => ({
    tickets: state.tickets.map((t) => (t.id === id ? { ...t, assigneeId, assigneeName, status: "in_progress" as const, updatedAt: new Date().toISOString() } : t)),
  })),
  addMessage: (ticketId, message) => set((state) => ({
    tickets: state.tickets.map((t) => (t.id === ticketId ? { ...t, messages: [...t.messages, message], updatedAt: new Date().toISOString() } : t)),
  })),
  getOpen: () => get().tickets.filter((t) => t.status === "open" || t.status === "in_progress"),
  getByPriority: (priority) => get().tickets.filter((t) => t.priority === priority),
  getStats: () => {
    const { tickets } = get();
    return {
      open: tickets.filter((t) => t.status === "open").length,
      inProgress: tickets.filter((t) => t.status === "in_progress").length,
      resolved: tickets.filter((t) => t.status === "resolved" || t.status === "closed").length,
      avgResolution: "4.2 hrs",
      slaCompliance: 92,
    };
  },
}));

// ─── Performance Module Store ────────────────────────────────

interface PerformanceReview {
  id: string;
  employeeId: string;
  employeeName: string;
  managerId: string;
  managerName: string;
  cycleId: string;
  selfRating?: number;
  managerRating?: number;
  finalRating?: number;
  status: "pending_self" | "pending_manager" | "pending_calibration" | "completed";
  goals: { id: string; title: string; progress: number; status: string; weight: number }[];
  strengths: string[];
  improvements: string[];
}

interface PerformanceStore {
  reviews: PerformanceReview[];
  add: (review: PerformanceReview) => void;
  updateRating: (id: string, type: "self" | "manager", rating: number) => void;
  updateStatus: (id: string, status: PerformanceReview["status"]) => void;
  updateGoalProgress: (reviewId: string, goalId: string, progress: number) => void;
  getByEmployee: (empId: string) => PerformanceReview[];
  getByStatus: (status: PerformanceReview["status"]) => PerformanceReview[];
  getAvgRating: () => number;
  getCompletionRate: () => number;
}

export const usePerformanceStore = create<PerformanceStore>((set, get) => ({
  reviews: [],
  add: (review) => set((state) => ({ reviews: [...state.reviews, review] })),
  updateRating: (id, type, rating) => set((state) => ({
    reviews: state.reviews.map((r) =>
      r.id === id ? { ...r, [type === "self" ? "selfRating" : "managerRating"]: rating } : r
    ),
  })),
  updateStatus: (id, status) => set((state) => ({
    reviews: state.reviews.map((r) => (r.id === id ? { ...r, status } : r)),
  })),
  updateGoalProgress: (reviewId, goalId, progress) => set((state) => ({
    reviews: state.reviews.map((r) =>
      r.id === reviewId
        ? { ...r, goals: r.goals.map((g) => (g.id === goalId ? { ...g, progress } : g)) }
        : r
    ),
  })),
  getByEmployee: (empId) => get().reviews.filter((r) => r.employeeId === empId),
  getByStatus: (status) => get().reviews.filter((r) => r.status === status),
  getAvgRating: () => {
    const completed = get().reviews.filter((r) => r.finalRating != null);
    if (completed.length === 0) return 0;
    return +(completed.reduce((s, r) => s + (r.finalRating ?? 0), 0) / completed.length).toFixed(1);
  },
  getCompletionRate: () => {
    const { reviews } = get();
    if (reviews.length === 0) return 0;
    return Math.round((reviews.filter((r) => r.status === "completed").length / reviews.length) * 100);
  },
}));

// ─── Training Module Store ───────────────────────────────────

interface CourseRecord {
  id: string;
  title: string;
  category: string;
  type: string;
  instructor: string;
  duration: string;
  enrolled: number;
  completed: number;
  rating: number;
  status: "active" | "upcoming" | "completed" | "draft";
  mandatory: boolean;
}

interface EnrollmentRecord {
  id: string;
  courseId: string;
  employeeId: string;
  progress: number;
  score?: number;
  status: "enrolled" | "in_progress" | "completed" | "dropped";
  enrolledAt: string;
  completedAt?: string;
}

interface TrainingStore {
  courses: CourseRecord[];
  enrollments: EnrollmentRecord[];
  addCourse: (course: CourseRecord) => void;
  enroll: (enrollment: EnrollmentRecord) => void;
  updateProgress: (enrollmentId: string, progress: number) => void;
  complete: (enrollmentId: string, score: number) => void;
  getCourseEnrollments: (courseId: string) => EnrollmentRecord[];
  getEmployeeEnrollments: (empId: string) => EnrollmentRecord[];
  getCompletionRate: (courseId: string) => number;
  getTotalTrainingHours: () => number;
}

export const useTrainingStore = create<TrainingStore>((set, get) => ({
  courses: [],
  enrollments: [],
  addCourse: (course) => set((state) => ({ courses: [...state.courses, course] })),
  enroll: (enrollment) => set((state) => ({ enrollments: [...state.enrollments, enrollment] })),
  updateProgress: (enrollmentId, progress) => set((state) => ({
    enrollments: state.enrollments.map((e) => (e.id === enrollmentId ? { ...e, progress, status: "in_progress" as const } : e)),
  })),
  complete: (enrollmentId, score) => set((state) => ({
    enrollments: state.enrollments.map((e) =>
      e.id === enrollmentId ? { ...e, progress: 100, score, status: "completed" as const, completedAt: new Date().toISOString() } : e
    ),
  })),
  getCourseEnrollments: (courseId) => get().enrollments.filter((e) => e.courseId === courseId),
  getEmployeeEnrollments: (empId) => get().enrollments.filter((e) => e.employeeId === empId),
  getCompletionRate: (courseId) => {
    const enrollments = get().enrollments.filter((e) => e.courseId === courseId);
    if (enrollments.length === 0) return 0;
    return Math.round((enrollments.filter((e) => e.status === "completed").length / enrollments.length) * 100);
  },
  getTotalTrainingHours: () => {
    const { courses, enrollments } = get();
    return enrollments.filter((e) => e.status === "completed").reduce((total, e) => {
      const course = courses.find((c) => c.id === e.courseId);
      return total + (course ? parseInt(course.duration) || 0 : 0);
    }, 0);
  },
}));

// ─── Asset Module Store ──────────────────────────────────────

interface AssetRecord {
  id: string;
  name: string;
  type: string;
  brand: string;
  model: string;
  serialNumber: string;
  purchaseDate: string;
  cost: number;
  status: "assigned" | "available" | "maintenance" | "retired";
  assignedTo?: string;
  condition: "excellent" | "good" | "fair" | "poor";
  location: string;
}

interface AssetStore {
  assets: AssetRecord[];
  add: (asset: AssetRecord) => void;
  update: (id: string, updates: Partial<AssetRecord>) => void;
  assign: (id: string, employeeName: string) => void;
  unassign: (id: string) => void;
  retire: (id: string) => void;
  getByStatus: (status: AssetRecord["status"]) => AssetRecord[];
  getByType: (type: string) => AssetRecord[];
  getTotalValue: () => number;
  getStats: () => { total: number; assigned: number; available: number; maintenance: number };
}

export const useAssetStore = create<AssetStore>((set, get) => ({
  assets: [],
  add: (asset) => set((state) => ({ assets: [...state.assets, asset] })),
  update: (id, updates) => set((state) => ({
    assets: state.assets.map((a) => (a.id === id ? { ...a, ...updates } : a)),
  })),
  assign: (id, employeeName) => set((state) => ({
    assets: state.assets.map((a) => (a.id === id ? { ...a, status: "assigned" as const, assignedTo: employeeName } : a)),
  })),
  unassign: (id) => set((state) => ({
    assets: state.assets.map((a) => (a.id === id ? { ...a, status: "available" as const, assignedTo: undefined } : a)),
  })),
  retire: (id) => set((state) => ({
    assets: state.assets.map((a) => (a.id === id ? { ...a, status: "retired" as const } : a)),
  })),
  getByStatus: (status) => get().assets.filter((a) => a.status === status),
  getByType: (type) => get().assets.filter((a) => a.type === type),
  getTotalValue: () => get().assets.reduce((s, a) => s + a.cost, 0),
  getStats: () => {
    const { assets } = get();
    return {
      total: assets.length,
      assigned: assets.filter((a) => a.status === "assigned").length,
      available: assets.filter((a) => a.status === "available").length,
      maintenance: assets.filter((a) => a.status === "maintenance").length,
    };
  },
}));

// ─── Notification Store ──────────────────────────────────────

interface NotificationItem {
  id: string;
  type: "info" | "success" | "warning" | "error" | "action";
  title: string;
  message: string;
  read: boolean;
  actionUrl?: string;
  createdAt: string;
  module: string;
}

interface NotificationStore {
  notifications: NotificationItem[];
  add: (notification: NotificationItem) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clearAll: () => void;
  getUnreadCount: () => number;
  getUnread: () => NotificationItem[];
  getByModule: (module: string) => NotificationItem[];
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  add: (notification) => set((state) => ({ notifications: [notification, ...state.notifications] })),
  markRead: (id) => set((state) => ({
    notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
  })),
  markAllRead: () => set((state) => ({
    notifications: state.notifications.map((n) => ({ ...n, read: true })),
  })),
  remove: (id) => set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),
  clearAll: () => set({ notifications: [] }),
  getUnreadCount: () => get().notifications.filter((n) => !n.read).length,
  getUnread: () => get().notifications.filter((n) => !n.read),
  getByModule: (module) => get().notifications.filter((n) => n.module === module),
}));

// ─── UI Preferences Store ────────────────────────────────────

interface UIPreferences {
  sidebarCollapsed: boolean;
  tablePageSize: number;
  defaultView: "grid" | "list" | "table";
  dashboardWidgets: string[];
  recentPages: string[];
  favoriteModules: string[];
}

interface UIStore extends UIPreferences {
  toggleSidebar: () => void;
  setPageSize: (size: number) => void;
  setDefaultView: (view: UIPreferences["defaultView"]) => void;
  addRecentPage: (page: string) => void;
  toggleFavorite: (module: string) => void;
  isFavorite: (module: string) => boolean;
}

export const useUIStore = create<UIStore>((set, get) => ({
  sidebarCollapsed: false,
  tablePageSize: 10,
  defaultView: "list",
  dashboardWidgets: ["headcount", "attendance", "leaves", "payroll", "recruitment", "alerts"],
  recentPages: [],
  favoriteModules: [],

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setPageSize: (size) => set({ tablePageSize: size }),
  setDefaultView: (view) => set({ defaultView: view }),
  addRecentPage: (page) => set((state) => ({
    recentPages: [page, ...state.recentPages.filter((p) => p !== page)].slice(0, 10),
  })),
  toggleFavorite: (module) => set((state) => ({
    favoriteModules: state.favoriteModules.includes(module)
      ? state.favoriteModules.filter((m) => m !== module)
      : [...state.favoriteModules, module],
  })),
  isFavorite: (module) => get().favoriteModules.includes(module),
}));
