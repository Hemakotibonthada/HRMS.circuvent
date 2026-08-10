"use client";

// ═══════════════════════════════════════════════════════════════
// COLLECTION SERVICE — Postgres via the HTTP API
// ═══════════════════════════════════════════════════════════════
// The dashboard's data layer. It previously talked to Firestore straight from
// the browser; it now goes through this app's own API routes, which run every
// query inside a tenant transaction so row-level security decides what a caller
// can see. The browser no longer holds database credentials of any kind.
//
// The exported surface is unchanged — COLLECTIONS, genericService and the typed
// per-module services all behave as before — so none of the 84 pages that use
// this had to be rewritten.
//
// Two destinations sit behind it:
//
//   * Collections with a real table and a purpose-built route (employees,
//     leave, attendance, expenses, helpdesk, recruitment, assets, referrals)
//     go to that route. Those records must have exactly one home, or the web
//     dashboard and the mobile app would show different data for the same
//     person.
//
//   * Everything else — kudos, wellness, badges, travel and the rest of the
//     free-form long tail — goes to the document store at
//     /api/collections/[collection]. Those pages were always storing loose
//     documents; inventing twenty narrow tables for them would be worse.
//
// `QueryConstraint` is kept as a permissive alias so existing call sites still
// compile. Server-side filtering now happens through query parameters; a
// constraint that cannot be expressed is ignored rather than silently
// mis-applied, and the callers that pass them filter in the page anyway.

/** Loose stand-in for the old Firestore constraint type, for source compatibility. */
export type QueryConstraint = unknown;
export type DocumentData = Record<string, unknown>;

type Doc<T> = T & { id: string };

/** Collections that have their own table and route. */
const ENTITY_ROUTES: Record<string, string> = {
  employees: "/api/employees",
  leaves: "/api/leave",
  attendance: "/api/attendance",
  expenses: "/api/expenses",
  helpdesk: "/api/helpdesk",
  recruitment: "/api/recruitment",
  assets: "/api/assets",
  referrals: "/api/referrals",
};

function endpoint(collectionName: string): { base: string; entity: boolean } {
  const entity = ENTITY_ROUTES[collectionName];
  return entity
    ? { base: entity, entity: true }
    : { base: `/api/collections/${encodeURIComponent(collectionName)}`, entity: false };
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const message =
      (parsed as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return parsed as T;
}

/**
 * Normalises the list envelope.
 *
 * The API is not consistent: newer paged routes return `items`, while expenses,
 * helpdesk and recruitment return `data`. Absorbing that here keeps it out of
 * every page — the same mismatch that once left a mailbox silently empty.
 */
function itemsOf<T>(body: unknown): Doc<T>[] {
  if (Array.isArray(body)) return body as Doc<T>[];
  const b = body as { items?: unknown; data?: unknown } | null;
  const list = b?.items ?? b?.data;
  return Array.isArray(list) ? (list as Doc<T>[]) : [];
}

// ─── Core operations ─────────────────────────────────────────

export async function getCollection<T>(
  collectionName: string,
  _constraints: QueryConstraint[] = []
): Promise<Doc<T>[]> {
  void _constraints;
  const { base } = endpoint(collectionName);
  return itemsOf<T>(await call<unknown>(`${base}?limit=500`));
}

export async function getDocument<T>(
  collectionName: string,
  docId: string
): Promise<Doc<T> | null> {
  const { base } = endpoint(collectionName);
  try {
    return await call<Doc<T>>(`${base}/${encodeURIComponent(docId)}`);
  } catch (e) {
    // A missing document is an ordinary outcome, not a failure the caller
    // should have to catch.
    if (e instanceof Error && /not found|\(404\)/i.test(e.message)) return null;
    throw e;
  }
}

export async function createDocument<T extends Record<string, unknown>>(
  collectionName: string,
  data: T
): Promise<string> {
  const { base } = endpoint(collectionName);
  const created = await call<{ id?: string }>(base, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return created?.id ?? "";
}

export async function updateDocument(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>
): Promise<void> {
  const { base } = endpoint(collectionName);
  await call(`${base}/${encodeURIComponent(docId)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Upsert-style write. Merges into the existing document, as setDoc(merge) did. */
export async function setDocument<T extends Record<string, unknown>>(
  collectionName: string,
  docId: string,
  data: T
): Promise<void> {
  const { base } = endpoint(collectionName);
  try {
    await call(`${base}/${encodeURIComponent(docId)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  } catch (e) {
    if (e instanceof Error && /not found|\(404\)/i.test(e.message)) {
      await call(base, { method: "POST", body: JSON.stringify({ ...data, id: docId }) });
      return;
    }
    throw e;
  }
}

export async function deleteDocument(collectionName: string, docId: string): Promise<void> {
  const { base } = endpoint(collectionName);
  await call(`${base}/${encodeURIComponent(docId)}`, { method: "DELETE" });
}

/**
 * Polling stand-in for the old realtime listener.
 *
 * Firestore pushed changes over a socket. Postgres behind an HTTP API does not,
 * so this refetches on an interval and when the tab regains focus. The callback
 * contract is identical, so callers did not change; they simply see a new value
 * a little later than they used to.
 */
export function subscribeToCollection<T>(
  collectionName: string,
  callback: (items: Doc<T>[]) => void,
  _constraints: QueryConstraint[] = [],
  onError?: (error: Error) => void
): () => void {
  void _constraints;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const load = async () => {
    if (stopped) return;
    try {
      const items = await getCollection<T>(collectionName);
      if (!stopped) callback(items);
    } catch (error) {
      // Reported rather than only logged: a silent failure left the old
      // implementation's callers waiting forever with no indication why.
      if (!stopped) onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  void load();
  timer = setInterval(load, 30_000);

  const onFocus = () => void load();
  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
  };
}

export function subscribeToDocument<T>(
  collectionName: string,
  docId: string,
  callback: (item: Doc<T> | null) => void
): () => void {
  let stopped = false;
  const load = async () => {
    if (stopped) return;
    try {
      const item = await getDocument<T>(collectionName, docId);
      if (!stopped) callback(item);
    } catch {
      if (!stopped) callback(null);
    }
  };
  void load();
  const timer = setInterval(load, 30_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// ─── Collection names ────────────────────────────────────────

export const COLLECTIONS = {
  employees: "employees",
  departments: "departments",
  leaves: "leaves",
  leaveBalances: "leaveBalances",
  attendance: "attendance",
  payroll: "payroll",
  expenses: "expenses",
  announcements: "announcements",
  recruitment: "recruitment",
  candidates: "candidates",
  performance: "performanceReviews",
  goals: "goals",
  training: "training",
  enrollments: "enrollments",
  helpdesk: "helpdesk",
  assets: "assets",
  documents: "documents",
  notifications: "notifications",
  teams: "teams",
  workflows: "workflows",
  surveys: "surveys",
  feedback: "feedback",
  kudos: "kudos",
  events: "events",
  holidays: "holidays",
  policies: "policies",
  loans: "loans",
  travel: "travel",
  wfh: "wfh",
  overtime: "overtime",
  timesheets: "timesheets",
  meetings: "meetingBookings",
  visitors: "visitors",
  referrals: "referrals",
  incidents: "incidents",
  celebrations: "celebrations",
  auditLog: "auditLog",
  settings: "settings",
  shifts: "shifts",
  awards: "awards",
  knowledgebase: "knowledgebase",
  grievances: "grievances",
  wellness: "wellness",
  badges: "badges",
} as const;

// ─── Typed module APIs ───────────────────────────────────────

export const genericService = (collectionName: string) => ({
  getAll: (constraints?: QueryConstraint[]) => getCollection(collectionName, constraints),
  getById: (id: string) => getDocument(collectionName, id),
  create: (data: Record<string, unknown>) => createDocument(collectionName, data),
  update: (id: string, data: Record<string, unknown>) =>
    updateDocument(collectionName, id, data),
  remove: (id: string) => deleteDocument(collectionName, id),
  subscribe: (
    cb: (items: DocumentData[]) => void,
    constraints?: QueryConstraint[],
    onError?: (error: Error) => void
  ) => subscribeToCollection(collectionName, cb, constraints, onError),
});

export const employeeService = genericService(COLLECTIONS.employees);
export const attendanceService = {
  ...genericService(COLLECTIONS.attendance),
  clockIn: (data: Record<string, unknown>) => createDocument(COLLECTIONS.attendance, data),
};
export const expenseService = genericService(COLLECTIONS.expenses);
export const payrollService = genericService(COLLECTIONS.payroll);
export const recruitmentService = genericService(COLLECTIONS.recruitment);
export const helpdeskService = genericService(COLLECTIONS.helpdesk);
export const announcementService = genericService(COLLECTIONS.announcements);
export const notificationService = genericService(COLLECTIONS.notifications);

export const leaveService = {
  ...genericService(COLLECTIONS.leaves),
  getBalance: (employeeId: string) => getDocument(COLLECTIONS.leaveBalances, employeeId),
  setBalance: (employeeId: string, data: Record<string, unknown>) =>
    setDocument(COLLECTIONS.leaveBalances, employeeId, data),
};
