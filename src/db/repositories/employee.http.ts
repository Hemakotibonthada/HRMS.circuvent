// ═══════════════════════════════════════════════════════════════
// EMPLOYEE REPOSITORY — HTTP implementation (browser)
// ═══════════════════════════════════════════════════════════════
// The client's route to Neon. Postgres cannot be reached from a browser, so
// this calls the API routes that wrap NeonEmployeeRepository.
//
// That indirection is a security improvement rather than a cost: with
// Firestore the browser issued its own queries and the server had no chance to
// authorize them, which is why tenant scoping had to be re-implemented in
// security rules. Here every call passes through a route that verifies the
// caller and derives the organization server-side — the client cannot ask for
// another tenant's data at all.

import {
  NotFoundError,
  RepositoryError,
  type EmployeeCreate,
  type EmployeeRecord,
  type EmployeeRepository,
  type EmployeeUpdate,
  type ListQuery,
  type Page,
  type Unsubscribe,
} from "./types";

const BASE = "/api/employees";

/** Polling interval for subscribe(), in milliseconds. */
const POLL_INTERVAL_MS = 15_000;

function toSearchParams(q: ListQuery = {}): string {
  const params = new URLSearchParams();
  if (q.search) params.set("search", q.search);
  if (q.sortBy) params.set("sortBy", q.sortBy);
  if (q.sortDirection) params.set("sortDirection", q.sortDirection);
  if (q.page) params.set("page", String(q.page));
  if (q.pageSize) params.set("pageSize", String(q.pageSize));
  for (const [key, value] of Object.entries(q.filters ?? {})) {
    if (value === undefined || value === null || value === "" || value === "all") continue;
    params.set(`filter.${key}`, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      // Session cookies are scoped to .circuvent.com; without credentials the
      // route sees an anonymous caller and rejects it.
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
    throw new RepositoryError("Network request failed", 0, cause);
  }

  if (response.status === 404) {
    throw new NotFoundError("Employee", path);
  }

  if (!response.ok) {
    // Error bodies are not guaranteed to be JSON — an edge/proxy failure
    // returns HTML, and parsing it would mask the real status.
    let message = `Request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep the status-based message */
    }
    throw new RepositoryError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export class HttpEmployeeRepository implements EmployeeRepository {
  list(q: ListQuery = {}): Promise<Page<EmployeeRecord>> {
    return request<Page<EmployeeRecord>>(`${BASE}${toSearchParams(q)}`);
  }

  async getById(id: string): Promise<EmployeeRecord | null> {
    try {
      return await request<EmployeeRecord>(`${BASE}/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  }

  create(data: EmployeeCreate): Promise<EmployeeRecord> {
    return request<EmployeeRecord>(BASE, { method: "POST", body: JSON.stringify(data) });
  }

  update(id: string, data: EmployeeUpdate): Promise<EmployeeRecord> {
    return request<EmployeeRecord>(`${BASE}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async remove(id: string): Promise<void> {
    await request<void>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /**
   * Firestore pushed changes over a socket; Postgres has no browser-facing
   * equivalent, so this polls. Two details matter:
   *
   *  - Polling pauses while the tab is hidden. Ninety-two modules each polling
   *    a backgrounded tab is a meaningful, and pointless, load on Neon.
   *  - Overlapping requests are suppressed, so a slow response cannot queue up
   *    a backlog of in-flight fetches.
   */
  subscribe(
    onChange: (items: EmployeeRecord[]) => void,
    q: ListQuery = {},
    onError?: (error: Error) => void,
  ): Unsubscribe {
    let cancelled = false;
    let inFlight = false;
    let delivered = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      inFlight = true;
      try {
        const page = await this.list(q);
        if (!cancelled) {
          onChange(page.items);
          delivered = true;
        }
      } catch (error) {
        console.error("Employee poll failed:", error);
        // Only report while nothing has loaded yet. Callers flip a loading
        // flag on before subscribing, so swallowing this first failure left
        // the page on a skeleton that never resolved. Later failures are
        // transient refreshes over data the user can still see, and the next
        // successful poll heals them silently.
        if (!cancelled && !delivered) {
          onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        inFlight = false;
      }
    };

    const schedule = () => {
      timer = setTimeout(async () => {
        await poll();
        if (!cancelled) schedule();
      }, POLL_INTERVAL_MS);
    };

    // Refresh immediately when the tab regains focus, so a user returning to
    // the page does not stare at data up to one interval stale.
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };

    void poll();
    schedule();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }

  listDirectReports(managerId: string): Promise<EmployeeRecord[]> {
    return request<EmployeeRecord[]>(
      `${BASE}/${encodeURIComponent(managerId)}/direct-reports`
    );
  }

  countByStatus(): Promise<Record<string, number>> {
    return request<Record<string, number>>(`${BASE}/stats/by-status`);
  }
}
