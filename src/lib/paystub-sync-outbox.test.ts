// ═══════════════════════════════════════════════════════════════
// The Paystub sync outbox — queuing side
// ═══════════════════════════════════════════════════════════════
// employee.neon.ts calls queuePaystubEmployeeSync from inside the same
// transaction as every write that changes what Paystub needs to know about
// an employee — create, update, and now updateBankDetails. This is the one
// function all of those call sites share, so it is the right place to prove
// that a queued row is actually queued, rather than re-proving it once per
// caller.
//
// No real database here, matching domain-logic.test.ts's approach to
// repository code: this codebase's Drizzle repositories are not unit-tested
// against a live transaction anywhere, so a fake `tx` that records exactly
// the calls Drizzle's query builder would receive is what makes this testable
// at all without inventing a database-mocking convention this repo does not
// otherwise have.

import { describe, expect, it } from "vitest";
import { paystubEmployeeSyncOutbox } from "@/db/schema/hrms";
import { queuePaystubEmployeeSync } from "@/lib/paystub-sync-outbox";

/**
 * Just enough of a Drizzle transaction's `.insert(...).values(...)
 * .onConflictDoUpdate(...)` chain to record what queuePaystubEmployeeSync
 * asked to be persisted, without a database behind it.
 */
function fakeTx() {
  const calls: {
    table: unknown;
    values?: Record<string, unknown>;
    conflict?: { target: unknown; set: Record<string, unknown> };
  }[] = [];

  const tx = {
    insert(table: unknown) {
      const call: (typeof calls)[number] = { table };
      calls.push(call);
      return {
        values(values: Record<string, unknown>) {
          call.values = values;
          return {
            onConflictDoUpdate(options: { target: unknown; set: Record<string, unknown> }) {
              call.conflict = options;
              return Promise.resolve();
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx, calls };
}

describe("queuePaystubEmployeeSync", () => {
  it("queues a pending row for the employee whose details changed", async () => {
    const { tx, calls } = fakeTx();

    await queuePaystubEmployeeSync(tx, "org-1", "employee-1");

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe(paystubEmployeeSyncOutbox);
    expect(calls[0].values).toMatchObject({
      orgId: "org-1",
      employeeId: "employee-1",
      status: "pending",
    });
  });

  it("targets the composite key that makes one outbox row per employee, not one per attempt", async () => {
    // orgId + employeeId is the conflict target, so a bank-details save that
    // lands while an earlier sync attempt is still pending updates the same
    // row instead of racing a second one for the same employee.
    const { tx, calls } = fakeTx();
    await queuePaystubEmployeeSync(tx, "org-1", "employee-1");

    expect(calls[0].conflict?.target).toEqual([
      paystubEmployeeSyncOutbox.orgId,
      paystubEmployeeSyncOutbox.employeeId,
    ]);
  });

  it("re-queues an existing row as pending, clearing any stale failure rather than keeping it", async () => {
    // A previous push may have left status "failed" with an old lastError.
    // A fresh bank-details save is a new fact worth trying again for, not a
    // reason to keep reporting the last failure forever.
    const { tx, calls } = fakeTx();
    await queuePaystubEmployeeSync(tx, "org-1", "employee-1");

    expect(calls[0].conflict?.set).toMatchObject({ status: "pending", lastError: null });
  });
});
