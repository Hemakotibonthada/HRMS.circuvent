// ═══════════════════════════════════════════════════════════════
// HRMS API SERVICE LAYER
// Comprehensive API client with type-safe endpoints, error
// handling, retry logic, caching, and request/response
// interceptors for the Circuvent HRMS platform
// ═══════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  errors?: Array<{ code: string; field?: string; message: string }>;
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface QueryParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  filters?: Record<string, string>;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestConfig {
  method: HttpMethod;
  path: string;
  body?: unknown;
  params?: QueryParams;
  headers?: Record<string, string>;
  timeout?: number;
  retry?: number;
  cache?: boolean;
}

// ─── Cache ───────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; timestamp: number; ttl: number }>();

function getCacheKey(method: string, path: string, params?: QueryParams): string {
  return `${method}:${path}:${JSON.stringify(params ?? {})}`;
}

function getFromCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown, ttl = 60000): void {
  cache.set(key, { data, timestamp: Date.now(), ttl });
}

export function clearCache(pattern?: string): void {
  if (pattern) {
    for (const key of cache.keys()) {
      if (key.includes(pattern)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}

// ─── Base HTTP Client ────────────────────────────────────────

const BASE_URL = "/api";
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;

async function httpRequest<T>(config: RequestConfig): Promise<ApiResponse<T>> {
  const { method, path, body, params, headers = {}, timeout = DEFAULT_TIMEOUT, retry = 0, cache: useCache = false } = config;

  // Check cache for GET requests
  if (method === "GET" && useCache) {
    const cacheKey = getCacheKey(method, path, params);
    const cached = getFromCache<ApiResponse<T>>(cacheKey);
    if (cached) return cached;
  }

  // Build URL with query params
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (params) {
    if (params.page) url.searchParams.set("page", params.page.toString());
    if (params.pageSize) url.searchParams.set("pageSize", params.pageSize.toString());
    if (params.sortBy) url.searchParams.set("sortBy", params.sortBy);
    if (params.sortOrder) url.searchParams.set("sortOrder", params.sortOrder);
    if (params.search) url.searchParams.set("search", params.search);
    if (params.filters) {
      Object.entries(params.filters).forEach(([key, value]) => {
        if (value && value !== "all") url.searchParams.set(`filter_${key}`, value);
      });
    }
  }

  // Request options
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url.toString(), options);

    if (!response.ok) {
      // Retry on 5xx errors
      if (response.status >= 500 && retry < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
        return httpRequest<T>({ ...config, retry: retry + 1 });
      }

      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        data: null as T,
        message: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
        errors: errorData.errors || [{ code: `HTTP_${response.status}`, message: response.statusText }],
      };
    }

    const data = await response.json();
    const result: ApiResponse<T> = {
      success: true,
      data: data.data ?? data,
      message: data.message,
      meta: data.meta,
    };

    // Cache GET responses
    if (method === "GET" && useCache) {
      setCache(getCacheKey(method, path, params), result);
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { success: false, data: null as T, message: "Request timed out", errors: [{ code: "TIMEOUT", message: "Request exceeded timeout limit" }] };
    }
    // Retry on network errors
    if (retry < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
      return httpRequest<T>({ ...config, retry: retry + 1 });
    }
    return { success: false, data: null as T, message: "Network error", errors: [{ code: "NETWORK", message: String(error) }] };
  }
}

// ─── API Service Functions ───────────────────────────────────

// Employees
export const employeesApi = {
  list: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/employees", params, cache: true }),
  get: (id: string) => httpRequest<unknown>({ method: "GET", path: `/employees/${encodeURIComponent(id)}`, cache: true }),
  create: (data: unknown) => { clearCache("/employees"); return httpRequest<unknown>({ method: "POST", path: "/employees", body: data }); },
  update: (id: string, data: unknown) => { clearCache("/employees"); return httpRequest<unknown>({ method: "PUT", path: `/employees/${encodeURIComponent(id)}`, body: data }); },
  delete: (id: string) => { clearCache("/employees"); return httpRequest<void>({ method: "DELETE", path: `/employees/${encodeURIComponent(id)}` }); },
  getByDepartment: (dept: string) => httpRequest<unknown[]>({ method: "GET", path: "/employees", params: { filters: { department: dept } }, cache: true }),
  search: (query: string) => httpRequest<unknown[]>({ method: "GET", path: "/employees", params: { search: query } }),
  bulkUpdate: (ids: string[], updates: unknown) => { clearCache("/employees"); return httpRequest<unknown>({ method: "PATCH", path: "/employees/bulk", body: { ids, updates } }); },
};

// Leave Management
export const leaveApi = {
  list: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/leave", params, cache: true }),
  apply: (data: unknown) => { clearCache("/leave"); return httpRequest<unknown>({ method: "POST", path: "/leave", body: data }); },
  approve: (id: string, comments?: string) => { clearCache("/leave"); return httpRequest<unknown>({ method: "POST", path: `/leave/${encodeURIComponent(id)}/approve`, body: { comments } }); },
  reject: (id: string, reason: string) => { clearCache("/leave"); return httpRequest<unknown>({ method: "POST", path: `/leave/${encodeURIComponent(id)}/reject`, body: { reason } }); },
  cancel: (id: string) => { clearCache("/leave"); return httpRequest<unknown>({ method: "POST", path: `/leave/${encodeURIComponent(id)}/cancel` }); },
  getBalance: (employeeId: string) => httpRequest<unknown[]>({ method: "GET", path: `/leave/balance/${encodeURIComponent(employeeId)}`, cache: true }),
  getPending: () => httpRequest<unknown[]>({ method: "GET", path: "/leave", params: { filters: { status: "pending" } } }),
};

// Attendance
export const attendanceApi = {
  list: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/attendance", params, cache: true }),
  clockIn: () => httpRequest<unknown>({ method: "POST", path: "/attendance/clock-in" }),
  clockOut: () => httpRequest<unknown>({ method: "POST", path: "/attendance/clock-out" }),
  getToday: () => httpRequest<unknown[]>({ method: "GET", path: "/attendance/today" }),
  regularize: (data: unknown) => httpRequest<unknown>({ method: "POST", path: "/attendance/regularize", body: data }),
  getMonthly: (month: string, year: number) => httpRequest<unknown[]>({ method: "GET", path: "/attendance/monthly", params: { filters: { month, year: year.toString() } } }),
};

// Payroll
export const payrollApi = {
  list: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/payroll", params, cache: true }),
  process: (month: string, year: number) => { clearCache("/payroll"); return httpRequest<unknown>({ method: "POST", path: "/payroll/process", body: { month, year } }); },
  getPayslip: (employeeId: string, month: string, year: number) => httpRequest<unknown>({ method: "GET", path: `/payroll/payslip/${encodeURIComponent(employeeId)}`, params: { filters: { month, year: year.toString() } } }),
  downloadPayslip: (id: string) => httpRequest<Blob>({ method: "GET", path: `/payroll/payslip/${encodeURIComponent(id)}/download` }),
  lock: (month: string, year: number) => httpRequest<unknown>({ method: "POST", path: "/payroll/lock", body: { month, year } }),
  unlock: (month: string, year: number) => httpRequest<unknown>({ method: "POST", path: "/payroll/unlock", body: { month, year } }),
  generateBankFile: (month: string, year: number) => httpRequest<Blob>({ method: "GET", path: "/payroll/bank-file", params: { filters: { month, year: year.toString() } } }),
};

// Expenses
export const expensesApi = {
  list: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/expenses", params, cache: true }),
  submit: (data: unknown) => { clearCache("/expenses"); return httpRequest<unknown>({ method: "POST", path: "/expenses", body: data }); },
  approve: (id: string) => { clearCache("/expenses"); return httpRequest<unknown>({ method: "POST", path: `/expenses/${encodeURIComponent(id)}/approve` }); },
  reject: (id: string, reason: string) => { clearCache("/expenses"); return httpRequest<unknown>({ method: "POST", path: `/expenses/${encodeURIComponent(id)}/reject`, body: { reason } }); },
  reimburse: (id: string) => { clearCache("/expenses"); return httpRequest<unknown>({ method: "POST", path: `/expenses/${encodeURIComponent(id)}/reimburse` }); },
};

// Recruitment
export const recruitmentApi = {
  listJobs: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/recruitment/jobs", params, cache: true }),
  createJob: (data: unknown) => { clearCache("/recruitment"); return httpRequest<unknown>({ method: "POST", path: "/recruitment/jobs", body: data }); },
  updateJob: (id: string, data: unknown) => { clearCache("/recruitment"); return httpRequest<unknown>({ method: "PUT", path: `/recruitment/jobs/${encodeURIComponent(id)}`, body: data }); },
  listCandidates: (jobId: string, params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: `/recruitment/jobs/${encodeURIComponent(jobId)}/candidates`, params }),
  addCandidate: (jobId: string, data: unknown) => httpRequest<unknown>({ method: "POST", path: `/recruitment/jobs/${encodeURIComponent(jobId)}/candidates`, body: data }),
  updateStage: (candidateId: string, stage: string) => httpRequest<unknown>({ method: "PATCH", path: `/recruitment/candidates/${encodeURIComponent(candidateId)}`, body: { stage } }),
  scheduleInterview: (data: unknown) => httpRequest<unknown>({ method: "POST", path: "/recruitment/interviews", body: data }),
};

// Performance
export const performanceApi = {
  listReviews: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/performance/reviews", params }),
  submitSelfReview: (id: string, data: unknown) => httpRequest<unknown>({ method: "POST", path: `/performance/reviews/${encodeURIComponent(id)}/self`, body: data }),
  submitManagerReview: (id: string, data: unknown) => httpRequest<unknown>({ method: "POST", path: `/performance/reviews/${encodeURIComponent(id)}/manager`, body: data }),
  giveFeedback: (data: unknown) => httpRequest<unknown>({ method: "POST", path: "/performance/feedback", body: data }),
  listGoals: (employeeId: string) => httpRequest<unknown[]>({ method: "GET", path: `/performance/goals/${encodeURIComponent(employeeId)}` }),
  updateGoal: (goalId: string, data: unknown) => httpRequest<unknown>({ method: "PATCH", path: `/performance/goals/${encodeURIComponent(goalId)}`, body: data }),
};

// Helpdesk
export const helpdeskApi = {
  list: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/helpdesk", params, cache: true }),
  create: (data: unknown) => { clearCache("/helpdesk"); return httpRequest<unknown>({ method: "POST", path: "/helpdesk", body: data }); },
  update: (id: string, data: unknown) => { clearCache("/helpdesk"); return httpRequest<unknown>({ method: "PATCH", path: `/helpdesk/${encodeURIComponent(id)}`, body: data }); },
  reply: (id: string, message: string) => httpRequest<unknown>({ method: "POST", path: `/helpdesk/${encodeURIComponent(id)}/reply`, body: { message } }),
  resolve: (id: string) => { clearCache("/helpdesk"); return httpRequest<unknown>({ method: "POST", path: `/helpdesk/${encodeURIComponent(id)}/resolve` }); },
  assign: (id: string, assigneeId: string) => httpRequest<unknown>({ method: "PATCH", path: `/helpdesk/${encodeURIComponent(id)}`, body: { assigneeId } }),
};

// Reports
export const reportsApi = {
  list: () => httpRequest<unknown[]>({ method: "GET", path: "/reports", cache: true }),
  generate: (reportId: string, params: unknown) => httpRequest<Blob>({ method: "POST", path: `/reports/${encodeURIComponent(reportId)}/generate`, body: params }),
  schedule: (data: unknown) => httpRequest<unknown>({ method: "POST", path: "/reports/schedule", body: data }),
  getScheduled: () => httpRequest<unknown[]>({ method: "GET", path: "/reports/scheduled" }),
  deleteScheduled: (id: string) => httpRequest<void>({ method: "DELETE", path: `/reports/scheduled/${encodeURIComponent(id)}` }),
};

// Assets
export const assetsApi = {
  list: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/assets", params, cache: true }),
  create: (data: unknown) => { clearCache("/assets"); return httpRequest<unknown>({ method: "POST", path: "/assets", body: data }); },
  update: (id: string, data: unknown) => { clearCache("/assets"); return httpRequest<unknown>({ method: "PUT", path: `/assets/${encodeURIComponent(id)}`, body: data }); },
  assign: (id: string, employeeId: string) => { clearCache("/assets"); return httpRequest<unknown>({ method: "POST", path: `/assets/${encodeURIComponent(id)}/assign`, body: { employeeId } }); },
  unassign: (id: string) => { clearCache("/assets"); return httpRequest<unknown>({ method: "POST", path: `/assets/${encodeURIComponent(id)}/unassign` }); },
  retire: (id: string) => { clearCache("/assets"); return httpRequest<unknown>({ method: "POST", path: `/assets/${encodeURIComponent(id)}/retire` }); },
};

// Training
export const trainingApi = {
  listCourses: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/training/courses", params, cache: true }),
  createCourse: (data: unknown) => { clearCache("/training"); return httpRequest<unknown>({ method: "POST", path: "/training/courses", body: data }); },
  enroll: (courseId: string) => httpRequest<unknown>({ method: "POST", path: `/training/courses/${encodeURIComponent(courseId)}/enroll` }),
  updateProgress: (enrollmentId: string, progress: number) => httpRequest<unknown>({ method: "PATCH", path: `/training/enrollments/${encodeURIComponent(enrollmentId)}`, body: { progress } }),
  complete: (enrollmentId: string, score: number) => httpRequest<unknown>({ method: "POST", path: `/training/enrollments/${encodeURIComponent(enrollmentId)}/complete`, body: { score } }),
  getCertificates: (employeeId: string) => httpRequest<unknown[]>({ method: "GET", path: `/training/certificates/${encodeURIComponent(employeeId)}` }),
};

// Organization
export const orgApi = {
  getInfo: () => httpRequest<unknown>({ method: "GET", path: "/org", cache: true }),
  updateInfo: (data: unknown) => { clearCache("/org"); return httpRequest<unknown>({ method: "PUT", path: "/org", body: data }); },
  getDepartments: () => httpRequest<unknown[]>({ method: "GET", path: "/org/departments", cache: true }),
  getLocations: () => httpRequest<unknown[]>({ method: "GET", path: "/org/locations", cache: true }),
  getOrgChart: () => httpRequest<unknown>({ method: "GET", path: "/org/chart", cache: true }),
};

// Analytics
export const analyticsApi = {
  getDashboard: () => httpRequest<unknown>({ method: "GET", path: "/analytics/dashboard", cache: true }),
  getHeadcountTrend: (months: number) => httpRequest<unknown[]>({ method: "GET", path: "/analytics/headcount", params: { filters: { months: months.toString() } } }),
  getAttritionTrend: (months: number) => httpRequest<unknown[]>({ method: "GET", path: "/analytics/attrition", params: { filters: { months: months.toString() } } }),
  getCostAnalysis: (months: number) => httpRequest<unknown[]>({ method: "GET", path: "/analytics/cost", params: { filters: { months: months.toString() } } }),
  getDiversityMetrics: () => httpRequest<unknown>({ method: "GET", path: "/analytics/diversity", cache: true }),
  getEngagementScore: () => httpRequest<unknown>({ method: "GET", path: "/analytics/engagement", cache: true }),
};

// Compliance
export const complianceApi = {
  list: () => httpRequest<unknown[]>({ method: "GET", path: "/compliance", cache: true }),
  getAudits: () => httpRequest<unknown[]>({ method: "GET", path: "/compliance/audits" }),
  getTrainingStatus: () => httpRequest<unknown[]>({ method: "GET", path: "/compliance/training" }),
  acknowledgePolicy: (policyId: string) => httpRequest<unknown>({ method: "POST", path: `/compliance/policies/${encodeURIComponent(policyId)}/acknowledge` }),
};

// Notifications  
export const notificationsApi = {
  list: (params?: QueryParams) => httpRequest<unknown[]>({ method: "GET", path: "/notifications", params }),
  markRead: (id: string) => httpRequest<unknown>({ method: "PATCH", path: `/notifications/${encodeURIComponent(id)}`, body: { read: true } }),
  markAllRead: () => httpRequest<unknown>({ method: "POST", path: "/notifications/mark-all-read" }),
  getUnreadCount: () => httpRequest<{ count: number }>({ method: "GET", path: "/notifications/unread-count" }),
  updatePreferences: (prefs: unknown) => httpRequest<unknown>({ method: "PUT", path: "/notifications/preferences", body: prefs }),
};

// Settings
export const settingsApi = {
  get: () => httpRequest<unknown>({ method: "GET", path: "/settings", cache: true }),
  update: (data: unknown) => { clearCache("/settings"); return httpRequest<unknown>({ method: "PUT", path: "/settings", body: data }); },
  getLeavePolicy: () => httpRequest<unknown[]>({ method: "GET", path: "/settings/leave-policy", cache: true }),
  updateLeavePolicy: (data: unknown) => { clearCache("/settings"); return httpRequest<unknown>({ method: "PUT", path: "/settings/leave-policy", body: data }); },
  getAttendancePolicy: () => httpRequest<unknown>({ method: "GET", path: "/settings/attendance-policy", cache: true }),
  getPayrollSettings: () => httpRequest<unknown>({ method: "GET", path: "/settings/payroll", cache: true }),
};
