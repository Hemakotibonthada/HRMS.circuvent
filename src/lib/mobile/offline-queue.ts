// ═══════════════════════════════════════════════════════════════
// OFFLINE SYNC QUEUE
// ═══════════════════════════════════════════════════════════════
// The hard part of an HR mobile app.
//
// Field staff clock in from basements, warehouses and construction sites where
// there is no signal. An attendance app that requires connectivity to record a
// punch is worse than a paper sheet, because the paper sheet works. So the
// punch is recorded locally and reconciled later.
//
// That makes correctness subtle in ways an online-only app never faces:
//
//  * The punch's timestamp is when it happened, not when it synced. A worker
//    who clocked in at 06:00 and regained signal at 14:00 was not eight hours
//    late.
//  * Delivery is at-least-once, so the server may see the same punch twice.
//    Every operation carries a client-generated idempotency key.
//  * Some failures are permanent. Retrying a 400 forever burns battery and
//    never succeeds; the item has to be quarantined for a human to look at.
//  * Order matters within a stream. A clock-out that arrives before its
//    clock-in produces nonsense.
//
// Storage is injected, so this is testable without a device and works with
// AsyncStorage, SQLite or MMKV.

export type OperationKind =
  | "attendance.clock_in"
  | "attendance.clock_out"
  | "leave.apply"
  | "expense.submit"
  | "profile.update";

export type QueueStatus = "pending" | "in_flight" | "failed" | "quarantined";

export interface QueuedOperation {
  /** Client-generated, stable across retries; the server's idempotency key. */
  id: string;
  kind: OperationKind;
  payload: Record<string, unknown>;
  /** When the user performed the action, not when it is sent. */
  occurredAt: string;
  status: QueueStatus;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  /** Operations sharing a key are sent in order relative to each other. */
  streamKey?: string;
}

export interface QueueStorage {
  read(): Promise<QueuedOperation[]>;
  write(operations: QueuedOperation[]): Promise<void>;
}

export interface SyncResult {
  ok: boolean;
  /** Permanent failure: do not retry, quarantine instead. */
  permanent?: boolean;
  error?: string;
}

export type Sender = (operation: QueuedOperation) => Promise<SyncResult>;

/** Attempts before an item is quarantined for manual review. */
const MAX_ATTEMPTS = 8;

/**
 * Cap on queue size.
 *
 * A device offline for weeks must not fill its storage. When the cap is hit
 * the oldest *synced-irrelevant* entries go first; pending work is never
 * silently dropped, because that is someone's unpaid hours.
 */
const MAX_QUEUE_SIZE = 500;

/**
 * Exponential backoff with jitter, in milliseconds.
 *
 * Jitter matters more than usual here: when an office regains connectivity,
 * every device retries at once. Identical backoff turns that into a
 * thundering herd against the API.
 */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(2 ** attempts * 1_000, 5 * 60_000);
  return Math.round(base * (0.5 + random() * 0.5));
}

export function isDue(
  operation: QueuedOperation,
  now: number,
  random: () => number = () => 1
): boolean {
  if (operation.status === "quarantined" || operation.status === "in_flight") return false;
  if (!operation.lastAttemptAt) return true;
  return now - new Date(operation.lastAttemptAt).getTime() >= backoffMs(operation.attempts, random);
}

export class OfflineQueue {
  constructor(
    private readonly storage: QueueStorage,
    private readonly send: Sender,
    private readonly now: () => number = Date.now
  ) {}

  /** Adds an operation, recording when it actually happened. */
  async enqueue(
    kind: OperationKind,
    payload: Record<string, unknown>,
    options: { id: string; occurredAt?: string; streamKey?: string }
  ): Promise<QueuedOperation> {
    const operations = await this.storage.read();

    // The same id twice is a double-tap or a re-render, not a second action.
    const existing = operations.find((o) => o.id === options.id);
    if (existing) return existing;

    const operation: QueuedOperation = {
      id: options.id,
      kind,
      payload,
      occurredAt: options.occurredAt ?? new Date(this.now()).toISOString(),
      status: "pending",
      attempts: 0,
      streamKey: options.streamKey,
    };

    const next = [...operations, operation];
    await this.storage.write(this.trim(next));
    return operation;
  }

  /**
   * Drops the oldest resolved entries when over the cap.
   *
   * Quarantined items are kept: they represent work that never reached the
   * server and needs a human decision. Discarding them would lose someone's
   * hours silently, which is the one outcome worse than a full queue.
   */
  private trim(operations: QueuedOperation[]): QueuedOperation[] {
    if (operations.length <= MAX_QUEUE_SIZE) return operations;

    const keep = operations.filter((o) => o.status !== "failed");
    const droppable = operations
      .filter((o) => o.status === "failed")
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    const room = Math.max(0, MAX_QUEUE_SIZE - keep.length);
    return [...keep, ...droppable.slice(droppable.length - room)].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt)
    );
  }

  async pending(): Promise<QueuedOperation[]> {
    const operations = await this.storage.read();
    return operations.filter((o) => o.status === "pending" || o.status === "failed");
  }

  async quarantined(): Promise<QueuedOperation[]> {
    const operations = await this.storage.read();
    return operations.filter((o) => o.status === "quarantined");
  }

  /**
   * Sends everything that is due.
   *
   * Operations are processed oldest-first. Within a stream, a failure stops
   * that stream — sending a clock-out after its clock-in failed would record
   * an impossible day — but other streams keep going, so one employee's stuck
   * punch does not block a shared tablet's other users.
   */
  async flush(random: () => number = Math.random): Promise<{
    sent: number;
    failed: number;
    quarantined: number;
  }> {
    const operations = await this.storage.read();
    const now = this.now();

    const due = operations
      .filter((o) => isDue(o, now, random))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    let sent = 0;
    let failed = 0;
    let quarantined = 0;
    const blockedStreams = new Set<string>();
    const resolved = new Set<string>();

    for (const operation of due) {
      if (operation.streamKey && blockedStreams.has(operation.streamKey)) continue;

      let result: SyncResult;
      try {
        result = await this.send(operation);
      } catch (error) {
        // A sender that throws is treated as a transient network failure, not
        // a permanent rejection — the request may never have reached a server.
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }

      const attempts = operation.attempts + 1;

      if (result.ok) {
        resolved.add(operation.id);
        sent++;
        continue;
      }

      const isQuarantine = result.permanent || attempts >= MAX_ATTEMPTS;
      operation.status = isQuarantine ? "quarantined" : "failed";
      operation.attempts = attempts;
      operation.lastAttemptAt = new Date(now).toISOString();
      operation.lastError = result.error;

      if (isQuarantine) quarantined++;
      else failed++;

      if (operation.streamKey) blockedStreams.add(operation.streamKey);
    }

    // Successful operations are removed rather than marked done: the queue is
    // a to-do list, not a history, and history lives on the server.
    await this.storage.write(operations.filter((o) => !resolved.has(o.id)));

    return { sent, failed, quarantined };
  }

  /**
   * What became of a submitted operation.
   *
   * Successful operations are deleted, so absence means sent. That is a
   * conclusion worth stating in one place rather than re-deriving at each
   * call site: the obvious version — "is it still in `pending()`?" — reports
   * a *quarantined* operation as sent, because `pending()` deliberately
   * excludes quarantined work. The caller then tells someone their clock-in
   * was recorded when it was permanently rejected, which is the one thing an
   * attendance app must never say.
   */
  async outcomeOf(id: string): Promise<"sent" | "queued" | "quarantined"> {
    const operations = await this.storage.read();
    const operation = operations.find((o) => o.id === id);

    if (!operation) return "sent";
    return operation.status === "quarantined" ? "quarantined" : "queued";
  }

  /** Returns a quarantined operation to the queue after the user retries it. */
  async retryQuarantined(id: string): Promise<boolean> {
    const operations = await this.storage.read();
    const operation = operations.find((o) => o.id === id && o.status === "quarantined");
    if (!operation) return false;

    operation.status = "pending";
    operation.attempts = 0;
    operation.lastAttemptAt = undefined;
    operation.lastError = undefined;

    await this.storage.write(operations);
    return true;
  }

  /** Discards a quarantined operation. Only ever driven by an explicit action. */
  async discard(id: string): Promise<boolean> {
    const operations = await this.storage.read();
    const next = operations.filter((o) => !(o.id === id && o.status === "quarantined"));
    if (next.length === operations.length) return false;

    await this.storage.write(next);
    return true;
  }

  /** Counts for the sync indicator in the app shell. */
  async status(): Promise<{ pending: number; failed: number; quarantined: number }> {
    const operations = await this.storage.read();
    return {
      pending: operations.filter((o) => o.status === "pending").length,
      failed: operations.filter((o) => o.status === "failed").length,
      quarantined: operations.filter((o) => o.status === "quarantined").length,
    };
  }
}

/**
 * Classifies an HTTP response for retry purposes.
 *
 * The distinction that matters: 4xx means the request will never succeed as
 * written, so retrying wastes battery and hides the problem. 5xx and network
 * errors are worth retrying. 429 is the exception among 4xx — it explicitly
 * asks the client to come back later. 409 is treated as success because the
 * server has already recorded this idempotency key.
 */
export function classifyResponse(status: number): SyncResult {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 409) return { ok: true };
  if (status === 429) return { ok: false, error: "Rate limited" };
  if (status >= 400 && status < 500) {
    return { ok: false, permanent: true, error: `Rejected with ${status}` };
  }
  return { ok: false, error: `Server error ${status}` };
}
