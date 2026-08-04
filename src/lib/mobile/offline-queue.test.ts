// @vitest-environment node
//
// The offline queue holds people's unpaid hours. Its failure modes are: losing
// a punch, sending one twice, retrying something that can never succeed, or
// recording a clock-out for a shift whose clock-in never arrived. Each of
// those is tested here.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OfflineQueue,
  backoffMs,
  classifyResponse,
  isDue,
  type QueueStorage,
  type QueuedOperation,
  type SyncResult,
} from "@/lib/mobile/offline-queue";

class MemoryStorage implements QueueStorage {
  constructor(public operations: QueuedOperation[] = []) {}
  async read() {
    return this.operations.map((o) => ({ ...o }));
  }
  async write(operations: QueuedOperation[]) {
    this.operations = operations.map((o) => ({ ...o }));
  }
}

const T0 = new Date("2026-04-06T06:00:00Z").getTime();

function makeQueue(
  send: (op: QueuedOperation) => Promise<SyncResult>,
  storage = new MemoryStorage(),
  now = () => T0
) {
  return { queue: new OfflineQueue(storage, send, now), storage };
}

describe("enqueue", () => {
  it("records when the action happened, not when it is sent", async () => {
    // A worker who clocked in at 06:00 and regained signal at 14:00 was not
    // eight hours late.
    const { queue } = makeQueue(async () => ({ ok: true }));
    const op = await queue.enqueue(
      "attendance.clock_in",
      {},
      { id: "op-1", occurredAt: "2026-04-06T06:00:00.000Z" }
    );
    expect(op.occurredAt).toBe("2026-04-06T06:00:00.000Z");
  });

  it("ignores a repeat of the same id", async () => {
    // A double-tap or a re-render is not a second punch.
    const { queue, storage } = makeQueue(async () => ({ ok: true }));
    await queue.enqueue("attendance.clock_in", { a: 1 }, { id: "op-1" });
    await queue.enqueue("attendance.clock_in", { a: 2 }, { id: "op-1" });

    expect(storage.operations).toHaveLength(1);
    expect(storage.operations[0].payload).toEqual({ a: 1 });
  });

  it("starts an operation pending with no attempts", async () => {
    const { queue } = makeQueue(async () => ({ ok: true }));
    const op = await queue.enqueue("leave.apply", {}, { id: "op-1" });
    expect(op.status).toBe("pending");
    expect(op.attempts).toBe(0);
  });
});

describe("flush", () => {
  it("sends pending operations and removes them once accepted", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const { queue, storage } = makeQueue(send);

    await queue.enqueue("attendance.clock_in", {}, { id: "op-1" });
    await queue.enqueue("attendance.clock_out", {}, { id: "op-2" });

    const result = await queue.flush();

    expect(result.sent).toBe(2);
    expect(storage.operations).toHaveLength(0);
  });

  it("sends oldest first", async () => {
    // A clock-out arriving before its clock-in produces an impossible day.
    const order: string[] = [];
    const { queue } = makeQueue(async (op) => {
      order.push(op.id);
      return { ok: true };
    });

    await queue.enqueue("attendance.clock_out", {}, { id: "later", occurredAt: "2026-04-06T18:00:00Z" });
    await queue.enqueue("attendance.clock_in", {}, { id: "earlier", occurredAt: "2026-04-06T06:00:00Z" });

    await queue.flush();
    expect(order).toEqual(["earlier", "later"]);
  });

  it("keeps a failed operation for retry rather than dropping it", async () => {
    const { queue, storage } = makeQueue(async () => ({ ok: false, error: "offline" }));
    await queue.enqueue("attendance.clock_in", {}, { id: "op-1" });

    const result = await queue.flush();

    expect(result.failed).toBe(1);
    expect(storage.operations).toHaveLength(1);
    expect(storage.operations[0].status).toBe("failed");
    expect(storage.operations[0].lastError).toBe("offline");
  });

  it("treats a thrown sender as transient, not permanent", async () => {
    // A request that threw may never have reached a server, so it must not be
    // quarantined as rejected.
    const { queue, storage } = makeQueue(async () => {
      throw new Error("Network request failed");
    });
    await queue.enqueue("attendance.clock_in", {}, { id: "op-1" });

    await queue.flush();
    expect(storage.operations[0].status).toBe("failed");
  });

  it("quarantines a permanently rejected operation immediately", async () => {
    // Retrying a 400 forever burns battery and never succeeds.
    const send = vi.fn(async () => ({ ok: false, permanent: true, error: "Rejected with 400" }));
    const { queue, storage } = makeQueue(send);
    await queue.enqueue("leave.apply", {}, { id: "op-1" });

    const result = await queue.flush();

    expect(result.quarantined).toBe(1);
    expect(storage.operations[0].status).toBe("quarantined");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("quarantines after the attempt ceiling", async () => {
    const storage = new MemoryStorage([
      {
        id: "op-1",
        kind: "attendance.clock_in",
        payload: {},
        occurredAt: "2026-04-06T06:00:00Z",
        status: "failed",
        attempts: 7,
      },
    ]);
    const { queue } = makeQueue(async () => ({ ok: false, error: "still offline" }), storage);

    const result = await queue.flush(() => 1);

    expect(result.quarantined).toBe(1);
    expect(storage.operations[0].status).toBe("quarantined");
  });

  it("does not retry a quarantined operation", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const storage = new MemoryStorage([
      {
        id: "op-1",
        kind: "leave.apply",
        payload: {},
        occurredAt: "2026-04-06T06:00:00Z",
        status: "quarantined",
        attempts: 8,
      },
    ]);
    const { queue } = makeQueue(send, storage);

    await queue.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("stops a stream after one of its operations fails", async () => {
    // Sending a clock-out whose clock-in failed records an impossible day.
    const attempted: string[] = [];
    const { queue } = makeQueue(async (op) => {
      attempted.push(op.id);
      return { ok: false, error: "offline" };
    });

    await queue.enqueue("attendance.clock_in", {}, { id: "in", occurredAt: "2026-04-06T06:00:00Z", streamKey: "emp-1" });
    await queue.enqueue("attendance.clock_out", {}, { id: "out", occurredAt: "2026-04-06T18:00:00Z", streamKey: "emp-1" });

    await queue.flush();
    expect(attempted).toEqual(["in"]);
  });

  it("keeps other streams moving when one is stuck", async () => {
    // On a shared tablet, one employee's stuck punch must not block everyone.
    const attempted: string[] = [];
    const { queue } = makeQueue(async (op) => {
      attempted.push(op.id);
      return op.streamKey === "emp-1" ? { ok: false, error: "offline" } : { ok: true };
    });

    await queue.enqueue("attendance.clock_in", {}, { id: "a1", occurredAt: "2026-04-06T06:00:00Z", streamKey: "emp-1" });
    await queue.enqueue("attendance.clock_in", {}, { id: "b1", occurredAt: "2026-04-06T06:05:00Z", streamKey: "emp-2" });
    await queue.enqueue("attendance.clock_out", {}, { id: "a2", occurredAt: "2026-04-06T18:00:00Z", streamKey: "emp-1" });

    const result = await queue.flush();

    expect(attempted).toEqual(["a1", "b1"]);
    expect(result.sent).toBe(1);
  });

  it("skips an operation still inside its backoff window", async () => {
    const storage = new MemoryStorage([
      {
        id: "op-1",
        kind: "attendance.clock_in",
        payload: {},
        occurredAt: "2026-04-06T06:00:00Z",
        status: "failed",
        attempts: 3,
        lastAttemptAt: new Date(T0 - 1_000).toISOString(),
      },
    ]);
    const send = vi.fn(async () => ({ ok: true }));
    const { queue } = makeQueue(send, storage);

    await queue.flush(() => 1);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("backoff", () => {
  it("grows exponentially", () => {
    const noJitter = () => 1;
    expect(backoffMs(0, noJitter)).toBe(1_000);
    expect(backoffMs(1, noJitter)).toBe(2_000);
    expect(backoffMs(4, noJitter)).toBe(16_000);
  });

  it("caps so a long outage does not push retries hours away", () => {
    expect(backoffMs(20, () => 1)).toBe(5 * 60_000);
  });

  it("applies jitter, so an office regaining signal does not stampede", () => {
    // Identical backoff across every device turns reconnection into a
    // thundering herd against the API.
    const low = backoffMs(5, () => 0);
    const high = backoffMs(5, () => 1);
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(high / 2 - 1);
  });

  it("treats a never-attempted operation as due", () => {
    const op: QueuedOperation = {
      id: "1",
      kind: "leave.apply",
      payload: {},
      occurredAt: "2026-04-06T06:00:00Z",
      status: "pending",
      attempts: 0,
    };
    expect(isDue(op, T0)).toBe(true);
  });
});

describe("quarantine handling", () => {
  let queue: OfflineQueue;
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage([
      {
        id: "op-1",
        kind: "leave.apply",
        payload: {},
        occurredAt: "2026-04-06T06:00:00Z",
        status: "quarantined",
        attempts: 8,
        lastError: "Rejected with 400",
      },
    ]);
    queue = new OfflineQueue(storage, async () => ({ ok: true }), () => T0);
  });

  it("lists quarantined operations for the user to resolve", async () => {
    const items = await queue.quarantined();
    expect(items).toHaveLength(1);
    expect(items[0].lastError).toBe("Rejected with 400");
  });

  it("returns an operation to the queue with a clean slate on retry", async () => {
    expect(await queue.retryQuarantined("op-1")).toBe(true);
    expect(storage.operations[0].status).toBe("pending");
    expect(storage.operations[0].attempts).toBe(0);
    expect(storage.operations[0].lastError).toBeUndefined();
  });

  it("only discards on an explicit action", async () => {
    expect(await queue.discard("nope")).toBe(false);
    expect(storage.operations).toHaveLength(1);

    expect(await queue.discard("op-1")).toBe(true);
    expect(storage.operations).toHaveLength(0);
  });

  it("never quietly drops quarantined work when trimming", async () => {
    // Quarantined items are unrecorded hours; losing them silently is worse
    // than a full queue.
    const many: QueuedOperation[] = Array.from({ length: 520 }, (_, i) => ({
      id: `q-${i}`,
      kind: "attendance.clock_in" as const,
      payload: {},
      occurredAt: new Date(T0 + i * 1000).toISOString(),
      status: "quarantined" as const,
      attempts: 8,
    }));
    const bigStorage = new MemoryStorage(many);
    const bigQueue = new OfflineQueue(bigStorage, async () => ({ ok: true }), () => T0);

    await bigQueue.enqueue("attendance.clock_in", {}, { id: "new" });

    expect(bigStorage.operations.filter((o) => o.status === "quarantined")).toHaveLength(520);
  });
});

describe("status", () => {
  it("counts each state for the sync indicator", async () => {
    const storage = new MemoryStorage([
      { id: "1", kind: "leave.apply", payload: {}, occurredAt: "", status: "pending", attempts: 0 },
      { id: "2", kind: "leave.apply", payload: {}, occurredAt: "", status: "failed", attempts: 2 },
      { id: "3", kind: "leave.apply", payload: {}, occurredAt: "", status: "quarantined", attempts: 8 },
    ]);
    const queue = new OfflineQueue(storage, async () => ({ ok: true }));

    expect(await queue.status()).toEqual({ pending: 1, failed: 1, quarantined: 1 });
  });
});

describe("classifyResponse", () => {
  it("accepts 2xx", () => {
    expect(classifyResponse(200)).toEqual({ ok: true });
    expect(classifyResponse(201)).toEqual({ ok: true });
    expect(classifyResponse(204)).toEqual({ ok: true });
  });

  it("treats 409 as already recorded, not a failure", () => {
    // The server has seen this idempotency key; the punch exists.
    expect(classifyResponse(409)).toEqual({ ok: true });
  });

  it("retries 429 rather than quarantining it", () => {
    // Rate limiting explicitly asks the client to come back later.
    const result = classifyResponse(429);
    expect(result.ok).toBe(false);
    expect(result.permanent).toBeUndefined();
  });

  it("quarantines other 4xx, which will never succeed as written", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classifyResponse(status).permanent, String(status)).toBe(true);
    }
  });

  it("retries 5xx", () => {
    for (const status of [500, 502, 503, 504]) {
      const result = classifyResponse(status);
      expect(result.ok).toBe(false);
      expect(result.permanent).toBeUndefined();
    }
  });
});
