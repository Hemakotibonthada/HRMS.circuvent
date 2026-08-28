// ═══════════════════════════════════════════════════════════════
// SYNC
// ═══════════════════════════════════════════════════════════════
// Owns the offline queue and decides when to drain it.
//
// This exists because the alternative shipped briefly and was a lie: the
// clock-in screen caught OfflineError and told the user "this will be sent as
// soon as you have a connection" while queueing nothing at all. A false
// reassurance about attendance is worse than an error message, because the
// person stops worrying about a punch that was never recorded and only finds
// out when the payslip is short.
//
// The queue is drained on three events, all of them cheap:
//
//   - returning to the foreground, which is when connectivity usually comes
//     back and when the user is watching;
//   - a timer, for the case where the app stays open through a tunnel;
//   - immediately after enqueueing, so that a punch made with a working
//     connection is sent now rather than in thirty seconds.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  ApiError,
  OfflineError,
  OfflineQueue,
  classifyResponse,
  type OperationKind,
  type QueuedOperation,
} from "./contracts";
import { SqliteQueueStorage } from "./sqlite-queue-storage";
import { useSession } from "./session";

/** Endpoint and method for each kind of queued work. */
const ROUTES: Record<OperationKind, { path: string; method: "POST" | "PATCH" }> = {
  "attendance.clock_in": { path: "/api/attendance/clock", method: "POST" },
  "attendance.clock_out": { path: "/api/attendance/clock", method: "POST" },
  "leave.apply": { path: "/api/leave", method: "POST" },
  "expense.submit": { path: "/api/expenses", method: "POST" },
  "profile.update": { path: "/api/employees/me", method: "PATCH" },
};

export type SubmitOutcome = "sent" | "queued" | "quarantined";

interface SyncValue {
  /** Queues work and tries to send it immediately. */
  submit(
    kind: OperationKind,
    payload: Record<string, unknown>,
    options: { id: string; streamKey?: string }
  ): Promise<SubmitOutcome>;
  pending: QueuedOperation[];
  quarantined: QueuedOperation[];
  flush(): Promise<void>;
  /** Puts a refused operation back in the queue after the user asks. */
  retry(id: string): Promise<void>;
  /** Throws a refused operation away. Only ever an explicit user action. */
  discard(id: string): Promise<void>;
  syncing: boolean;
}

const SyncContext = createContext<SyncValue | null>(null);

/** How often to retry while the app is open. */
const POLL_MS = 30_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const { api, status } = useSession();
  const [pending, setPending] = useState<QueuedOperation[]>([]);
  const [quarantined, setQuarantined] = useState<QueuedOperation[]>([]);
  const [syncing, setSyncing] = useState(false);

  const storage = useMemo(() => new SqliteQueueStorage(), []);

  const queue = useMemo(
    () =>
      new OfflineQueue(storage, async (operation) => {
        const route = ROUTES[operation.kind];
        try {
          if (route.method === "PATCH") {
            await api.patch(route.path, operation.payload);
          } else {
            // The operation id is the idempotency key. A punch that was sent
            // but whose response was lost must not become two punches when
            // the retry lands.
            await api.post(route.path, operation.payload, operation.id);
          }
          return { ok: true };
        } catch (error) {
          if (error instanceof OfflineError) {
            // Still offline. Not a failure of this operation — retrying is
            // the right thing and the attempt should not count against it.
            return { ok: false, error: "offline" };
          }
          if (error instanceof ApiError) {
            // classifyResponse decides retry-vs-quarantine from the status:
            // a 409 means the server already has it, a 422 means it will
            // never be accepted, a 500 is worth retrying.
            return classifyResponse(error.status);
          }
          return { ok: false, error: "unknown" };
        }
      }),
    [storage, api]
  );

  const refreshCounts = useCallback(async () => {
    setPending(await queue.pending());
    setQuarantined(await queue.quarantined());
  }, [queue]);

  // Guards against two drains overlapping — a foreground event and the timer
  // firing together would otherwise send the same operation twice.
  const draining = useRef(false);

  const flush = useCallback(async () => {
    if (draining.current || status !== "signed_in") return;
    draining.current = true;
    setSyncing(true);
    try {
      await queue.flush();
      await refreshCounts();
    } finally {
      draining.current = false;
      setSyncing(false);
    }
  }, [queue, refreshCounts, status]);

  const submit = useCallback(
    async (
      kind: OperationKind,
      payload: Record<string, unknown>,
      options: { id: string; streamKey?: string }
    ): Promise<SubmitOutcome> => {
      // Written down first, always. Attempting the network first and only
      // queueing on failure loses the action if the app is killed mid-request
      // — which is exactly what happens when someone locks their phone and
      // puts it in a pocket.
      await queue.enqueue(kind, payload, options);
      await refreshCounts();

      await flush();
      await refreshCounts();

      // Asked of the queue rather than inferred from `pending`, which
      // excludes quarantined work and would report a permanently rejected
      // punch as a successful one.
      return queue.outcomeOf(options.id);
    },
    [queue, refreshCounts, flush]
  );

  useEffect(() => {
    if (status !== "signed_in") return;

    void flush();

    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") void flush();
    });
    const timer = setInterval(() => void flush(), POLL_MS);

    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [status, flush]);

  const retry = useCallback(
    async (id: string) => {
      await queue.retryQuarantined(id);
      await refreshCounts();
      await flush();
      await refreshCounts();
    },
    [queue, refreshCounts, flush]
  );

  const discard = useCallback(
    async (id: string) => {
      await queue.discard(id);
      await refreshCounts();
    },
    [queue, refreshCounts]
  );

  const value = useMemo(
    () => ({ submit, pending, quarantined, flush, retry, discard, syncing }),
    [submit, pending, quarantined, flush, retry, discard, syncing]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  const sync = useContext(SyncContext);
  if (!sync) throw new Error("useSync must be used inside a SyncProvider");
  return sync;
}
