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
