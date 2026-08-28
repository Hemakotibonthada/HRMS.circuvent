// ═══════════════════════════════════════════════════════════════
// REPOSITORY CONTRACT
// ═══════════════════════════════════════════════════════════════
// The seam between the application and Postgres.
//
// Zustand stores and React components depend on these interfaces, never on
// Drizzle directly, so the storage layer can change without rewriting 92
// modules.
//
// One constraint shapes the design: Postgres cannot be queried from the
// browser. Every call therefore goes through an API route, which is also
// where authorization and tenant scoping belong — a design that lets the
// client scope its own queries is a design that trusts the client.

import type { MinorUnits } from "@/lib/money/minor";

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
  /**
   * Live updates. `onError` is called when a refresh fails *before* any data
   * has been delivered — a failure after the first successful load is treated
   * as transient, because the caller is still showing the last good list and
   * replacing it with an error screen would be a downgrade.
   *
   * Implementations that cannot fail (or cannot report it) may omit it, but
   * a caller that sets a loading flag before subscribing MUST pass one, or
   * that flag never clears on failure.
   */
  subscribe(
    onChange: (items: T[]) => void,
    query?: ListQuery,
    onError?: (error: Error) => void,
  ): Unsubscribe;
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
  /**
   * Free-text reason recorded at exit (e.g. "resignation", "termination").
   * `paystub-client.ts` already forwards this to Paystub's sync endpoint,
   * which uses it to decide the settlement reason category — but until the
   * leaver path wired a write path here, nothing ever set it, so every
   * synced exit arrived at Paystub with no reason at all.
   */
  exitReason?: string;
  /**
   * Expected last day of an internship. Undefined for permanent staff, and
   * for an intern whose end date has not been set yet. `joinDate` already
   * covers "internship start" for every employment type, so this is the
   * only date an intern record needs that a permanent one does not — it is
   * what the interns page counts down and the reminder sweep watches.
   */
  internshipEndDate?: string;
  /**
   * The employee code this record was hired under, kept once
   * `convertToPermanent()` has replaced it with a new CV- code. Undefined
   * for anyone who has never converted. Without this, a payslip or signed
   * letter issued under the old CVI- code would reference a number that no
   * longer resolves to anyone once the conversion overwrote it.
   */
  previousEmployeeCode?: string;
  /** When `employeeCode` last changed because of a conversion. Undefined for anyone who has never converted. */
  codeChangedAt?: string;
  location?: string;
  personalEmail?: string;
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
  phone?: string | null;
  departmentId?: string | null;
  designation: string;
  reportingToId?: string | null;
  employmentType?: string;
  status?: string;
  joinDate: string;
  location?: string | null;
  salary?: number | null;
}

export type EmployeeUpdate = Partial<EmployeeCreate> & {
  exitDate?: string | null;
  exitReason?: string | null;
};

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
  /**
   * opening + accrued + carryForward — what was granted, before deductions.
   *
   * The denominator the apps show as "5 of 12 days". It was never sent, and
   * the Android client declared it with a default of 0, so kotlinx.serialization
   * filled the gap silently and every balance read "5 of 0 days".
   */
  entitled: number;
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
  /** "inside" | "probably_inside" | "uncertain" — how firm the above is. */
  geofenceConfidence?: string;
  /** Accepted, but a human should look at where this punch came from. */
  requiresLocationReview: boolean;
  isRegularized: boolean;
  organizationId: string;
}

export interface ClockInRequest {
  employeeId: string;
  method: "biometric" | "web" | "mobile" | "manual" | "geo_fence";
  latitude?: number;
  longitude?: number;
  /** Reported GPS accuracy radius in metres, when the device supplies one. */
  accuracyMetres?: number;
  /** Epoch ms the fix was taken; distinguishes a fresh fix from a cached one. */
  capturedAt?: number;
  /** Android's mock-provider flag. Absent on iOS, so absence proves nothing. */
  isMocked?: boolean;
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
  /**
   * Major currency units, as a float, for displaying one value.
   *
   * Do not add these together. Use the `*Minor` fields below and
   * `sumMinor` from `@/lib/money/minor`, which is exact.
   */
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  /**
   * The same amounts as exact whole paise, carried as strings because JSON
   * has no bigint. These are the authoritative values — the floats above are
   * derived from them.
   */
  totalGrossMinor: MinorUnits;
  totalDeductionsMinor: MinorUnits;
  totalNetMinor: MinorUnits;
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
  /**
   * The period this payslip is for.
   *
   * Optional because a record read on its own does not carry it — the period
   * lives on the run. Populated by `payslipsFor`, which already joins the run
   * to filter on its status. Without it a payslip list is a column of amounts
   * with no way to tell which month each belongs to.
   */
  periodMonth?: number;
  periodYear?: number;
  workingDays: number;
  presentDays: number;
  lopDays: number;
  /**
   * Major units, as a float, for displaying one value.
   *
   * Storage is bigint minor units precisely because floats lose money. These
   * are the converted values: safe to print, never safe to sum or compare for
   * equality. The `*Minor` fields below carry the exact amounts, so a total
   * no longer requires asking the server — `sumMinor` from
   * `@/lib/money/minor` adds them without losing a paise.
   */
  gross: number;
  totalDeductions: number;
  netPay: number;
  /** The same amounts as exact whole paise. Authoritative. */
  grossMinor: MinorUnits;
  totalDeductionsMinor: MinorUnits;
  netPayMinor: MinorUnits;
  status: string;
  anomalies: string[];
  payslipUrl?: string;
}

// ─── Expenses ────────────────────────────────────────────────

/** One line on a claim. Amounts are exact paise. */
export interface ExpenseLineItemDto {
  description: string;
  amountMinor: MinorUnits;
  category?: string;
}

/**
 * Where a claim has got to.
 *
 * Wider than the `approval_status` column, because reimbursement is recorded
 * by a timestamp rather than a status — a paid claim is still `approved` in
 * the database. Anything asking "what can happen next" needs this, not the
 * column.
 */
export type ExpenseStageDto = "pending" | "approved" | "rejected" | "cancelled" | "reimbursed";

export interface ExpenseClaimRecord {
  id: string;
  claimNumber: string;
  employeeId: string;
  employeeName?: string;
  title: string;
  category: string;
  expenseDate: string;
  description?: string;
  lineItems: ExpenseLineItemDto[];
  receipts: string[];
  anomalies: string[];

  status: string;
  stage: ExpenseStageDto;

  /** Major units for display. Do not sum these — use the `*Minor` fields. */
  amount: number;
  approvedAmount?: number;
  /** Exact paise, as strings. Authoritative. */
  amountMinor: MinorUnits;
  approvedAmountMinor?: MinorUnits;
  currency: string;

  approvedById?: string;
  approvedAt?: string;
  rejectionReason?: string;
  reimbursedAt?: string;
  createdAt: string;
}

export interface ExpenseSubmission {
  employeeId: string;
  title: string;
  category: string;
  expenseDate: string;
  lineItems: ExpenseLineItemDto[];
  description?: string;
  receipts?: string[];
  currency?: string;
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
