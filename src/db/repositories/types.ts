// ═══════════════════════════════════════════════════════════════
// REPOSITORY CONTRACT
// ═══════════════════════════════════════════════════════════════
// The seam that lets Firestore and Neon run side by side during the migration
// (docs/PLATFORM-ARCHITECTURE.md §3).
//
// Zustand stores and React components depend on these interfaces, never on
// Firestore or Drizzle directly, so switching backends is a config change
// rather than a rewrite of 92 modules.
//
// One asymmetry is unavoidable and shapes the design: Firestore is queried
// from the browser, Postgres cannot be. Every Neon-backed call therefore goes
// through an API route, which is also where authorization and tenant scoping
// belong — the Firestore design had to trust the client to scope its own
// queries.

export type SortDirection = "asc" | "desc";

export interface ListQuery {
  /** Free-text search across the entity's principal display fields. */
  search?: string;
  /** Field name to order by. Implementations reject unknown fields. */
  sortBy?: string;
  sortDirection?: SortDirection;
  /** 1-based. */
  page?: number;
  pageSize?: number;
  filters?: Record<string, string | number | boolean | null | undefined>;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Live updates. Firestore delivers these over `onSnapshot`; Neon has no
 * equivalent push channel from the browser, so its implementation polls. Both
 * return an unsubscribe function, so callers cannot tell the difference.
 */
export type Unsubscribe = () => void;

export interface Repository<T, TCreate = Partial<T>, TUpdate = Partial<T>> {
  list(query?: ListQuery): Promise<Page<T>>;
  getById(id: string): Promise<T | null>;
  create(data: TCreate): Promise<T>;
  update(id: string, data: TUpdate): Promise<T>;
  remove(id: string): Promise<void>;
  subscribe(onChange: (items: T[]) => void, query?: ListQuery): Unsubscribe;
}

/** Thrown when a repository call is rejected; carries an HTTP-shaped status. */
export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly status: number = 500,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export class NotFoundError extends RepositoryError {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`, 404);
    this.name = "NotFoundError";
  }
}

// ─── Employee ────────────────────────────────────────────────

/**
 * The shape the UI consumes. Deliberately backend-neutral: it is neither the
 * Firestore document nor the Drizzle row, so neither backend's quirks leak
 * into components.
 */
export interface EmployeeRecord {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  departmentId?: string;
  departmentName?: string;
  designation: string;
  reportingToId?: string;
  reportingToName?: string;
  employmentType: string;
  status: string;
  joinDate: string;
  exitDate?: string;
  location?: string;
  /** Major currency units for display. Stored as minor units in Postgres. */
  salary?: number;
  currency: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeCreate {
  employeeCode?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  departmentId?: string;
  designation: string;
  reportingToId?: string;
  employmentType?: string;
  status?: string;
  joinDate: string;
  location?: string;
  salary?: number;
}

export type EmployeeUpdate = Partial<EmployeeCreate> & { exitDate?: string };

export interface EmployeeRepository
  extends Repository<EmployeeRecord, EmployeeCreate, EmployeeUpdate> {
  /** Directory lookup used by the org chart and reporting-line pickers. */
  listDirectReports(managerId: string): Promise<EmployeeRecord[]>;
  countByStatus(): Promise<Record<string, number>>;
}

// ─── Leave ───────────────────────────────────────────────────

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequestRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  isHalfDay: boolean;
  halfDayPeriod?: string;
  reason: string;
  status: LeaveStatus;
  appliedAt: string;
  approvedById?: string;
  approvedAt?: string;
  rejectionReason?: string;
  handoverToId?: string;
  organizationId: string;
}

export interface LeaveApply {
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDayPeriod?: "first_half" | "second_half";
  reason: string;
  handoverToId?: string;
  contactDuringLeave?: string;
}

export interface LeaveBalanceRecord {
  employeeId: string;
  year: number;
  leaveType: string;
  opening: number;
  accrued: number;
  used: number;
  pending: number;
  carryForward: number;
  lapsed: number;
  /** opening + accrued + carryForward − used − pending − lapsed. */
  available: number;
}

export interface LeaveRepository
  extends Repository<LeaveRequestRecord, LeaveApply, Partial<LeaveApply>> {
  /**
   * Applies for leave, reserving the days against the balance in the same
   * transaction. Rejects when the balance is insufficient or the dates overlap
   * an existing request.
   */
  apply(data: LeaveApply): Promise<LeaveRequestRecord>;
  approve(id: string, approverId: string): Promise<LeaveRequestRecord>;
  reject(id: string, approverId: string, reason: string): Promise<LeaveRequestRecord>;
  cancel(id: string, reason: string): Promise<LeaveRequestRecord>;
  balances(employeeId: string, year: number): Promise<LeaveBalanceRecord[]>;
  /** Requests awaiting this manager's decision. */
  pendingFor(managerId: string): Promise<LeaveRequestRecord[]>;
}

// ─── Attendance ──────────────────────────────────────────────

export interface AttendanceRecordDto {
  id: string;
  employeeId: string;
  workDate: string;
  clockInAt?: string;
  clockOutAt?: string;
  status: string;
  workedMinutes?: number;
  overtimeMinutes: number;
  lateByMinutes: number;
  earlyLeaveByMinutes: number;
  clockInMethod?: string;
  isWithinGeofence?: boolean;
  isRegularized: boolean;
  organizationId: string;
}

export interface ClockInRequest {
  employeeId: string;
  method: "biometric" | "web" | "mobile" | "manual" | "geo_fence";
  latitude?: number;
  longitude?: number;
  photoUrl?: string;
  ipAddress?: string;
  /** Supplied by tests and back-dated corrections; defaults to now. */
  at?: Date;
}

export interface ClockOutRequest {
  employeeId: string;
  method: "biometric" | "web" | "mobile" | "manual" | "geo_fence";
  latitude?: number;
  longitude?: number;
  at?: Date;
}

export interface AttendanceSummaryDto {
  employeeId: string;
  month: number;
  year: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  halfDays: number;
  leaveDays: number;
  wfhDays: number;
  totalWorkedMinutes: number;
  totalOvertimeMinutes: number;
}

export interface AttendanceRepository
  extends Repository<AttendanceRecordDto, ClockInRequest, Partial<AttendanceRecordDto>> {
  clockIn(request: ClockInRequest): Promise<AttendanceRecordDto>;
  clockOut(request: ClockOutRequest): Promise<AttendanceRecordDto>;
  today(employeeId: string): Promise<AttendanceRecordDto | null>;
  summary(employeeId: string, month: number, year: number): Promise<AttendanceSummaryDto>;
  regularize(id: string, reason: string, approverId: string): Promise<AttendanceRecordDto>;
}

// ─── Payroll ─────────────────────────────────────────────────

export type PayrollRunStatus =
  | "draft"
  | "processing"
  | "processed"
  | "approved"
  | "paid"
  | "on_hold"
  | "error";

export interface PayrollRunRecord {
  id: string;
  periodMonth: number;
  periodYear: number;
  runType: string;
  status: PayrollRunStatus;
  employeeCount: number;
  /** Major currency units for display. */
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  processedById?: string;
  processedAt?: string;
  approvedById?: string;
  approvedAt?: string;
  paidAt?: string;
  organizationId: string;
}

export interface PayrollRecordDto {
  id: string;
  runId: string;
  employeeId: string;
  employeeName?: string;
  workingDays: number;
  presentDays: number;
  lopDays: number;
  gross: number;
  totalDeductions: number;
  netPay: number;
  status: string;
  anomalies: string[];
  payslipUrl?: string;
}

export interface PayrollRepository {
  listRuns(query?: ListQuery): Promise<Page<PayrollRunRecord>>;
  getRun(id: string): Promise<PayrollRunRecord | null>;
  /** Creates a draft run for the period. One regular run per period. */
  createRun(periodMonth: number, periodYear: number, runType?: string): Promise<PayrollRunRecord>;
  /** Computes every employee's payslip for the run and marks it processed. */
  processRun(id: string, processedById: string): Promise<PayrollRunRecord>;
  /**
   * Second-person approval. Rejects when the approver is the processor —
   * enforced by a CHECK constraint as well, so it cannot be bypassed.
   */
  approveRun(id: string, approverId: string): Promise<PayrollRunRecord>;
  markPaid(id: string, transactionRef?: string): Promise<PayrollRunRecord>;
  listRecords(runId: string, query?: ListQuery): Promise<Page<PayrollRecordDto>>;
  /** An employee's own payslip history. */
  payslipsFor(employeeId: string): Promise<PayrollRecordDto[]>;
}
