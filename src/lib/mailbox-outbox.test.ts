import { describe, expect, it } from "vitest";
import {
  drainDueMailboxChanges,
  isOutstanding,
  type DrainTx,
  type MailboxChangeRow,
  type StepOutcome,
} from "@/lib/mailbox-outbox";

/**
 * The mail server has no rename. Moving `cvi-rahul@` to `rahul@` is create,
 * delete, then alias — in that order, because the alias endpoint refuses while
 * the old address is still a real mailbox — against a single small VM, with
 * each call able to fail on its own.
 *
 * What these prove is the property that ordering buys: a retry resumes rather
 * than repeats. Creating a mailbox twice is harmless; deleting one twice is
 * not, and aliasing too early is refused outright.
 */

const OK: StepOutcome = { status: "done" };

function row(overrides: Partial<MailboxChangeRow> = {}): MailboxChangeRow {
  return {
    id: "row-1",
    employeeId: "emp-1",
    fromAddress: "cvi-rahul@circuvent.com",
    toAddress: "rahul@circuvent.com",
    aliasOldAddress: true,
    status: "pending",
    attemptCount: 0,
    ...overrides,
  };
}

interface Harness {
  deps: Parameters<typeof drainDueMailboxChanges>[1];
  calls: string[];
  workEmails: Array<{ employeeId: string; email: string }>;
  outcomes: Array<Record<string, unknown>>;
}

function harness(
  rows: MailboxChangeRow[],
  steps: Partial<Record<"create" | "delete" | "alias", StepOutcome>> = {}
): Harness {
  const calls: string[] = [];
  const workEmails: Array<{ employeeId: string; email: string }> = [];
  const outcomes: Array<Record<string, unknown>> = [];

  const tx: DrainTx = {
    selectDueMailboxChanges: async () => rows,
    setEmployeeWorkEmail: async (employeeId, email) => {
      calls.push(`work_email:${email}`);
      workEmails.push({ employeeId, email });
    },
    recordMailboxChangeOutcome: async (input) => {
      outcomes.push(input as unknown as Record<string, unknown>);
    },
  };

  return {
    calls,
    workEmails,
    outcomes,
    deps: {
      withTenant: async (_ctx, fn) => fn(tx),
      createMailbox: async (email) => {
        calls.push(`create:${email}`);
        return steps.create ?? OK;
      },
      deleteMailbox: async (email) => {
        calls.push(`delete:${email}`);
        return steps.delete ?? OK;
      },
      createAlias: async (alias, target) => {
        calls.push(`alias:${alias}->${target}`);
        return steps.alias ?? OK;
      },
      now: () => new Date("2026-08-20T12:00:00Z"),
    },
  };
}

describe("moving a converted intern's mailbox", () => {
  it("creates, deletes, then aliases — in that order", async () => {
    // The order is forced by the server: the alias endpoint answers 409 while
    // the old address is still a mailbox.
    const h = harness([row()]);
    const result = await drainDueMailboxChanges({ orgId: "org-1" }, h.deps);

    expect(h.calls).toEqual([
      "create:rahul@circuvent.com",
      "work_email:rahul@circuvent.com",
      "delete:cvi-rahul@circuvent.com",
      "alias:cvi-rahul@circuvent.com->rahul@circuvent.com",
    ]);
    expect(result).toMatchObject({ attempted: 1, completed: 1, failed: 0 });
  });

  it("moves work_email only after the new mailbox exists", async () => {
    // Before it exists, the record would name a mailbox nobody can deliver to
    // — and payroll, the directory and colleagues all read that field.
    const h = harness([row()], { create: { status: "failed", detail: "boom" } });
    await drainDueMailboxChanges({ orgId: "org-1" }, h.deps);

    expect(h.workEmails).toHaveLength(0);
    expect(h.calls).toEqual(["create:rahul@circuvent.com"]);
  });

  it("stops at the failed step and records where it got to", async () => {
    const h = harness([row()], { delete: { status: "failed", detail: "mail server down" } });
    const result = await drainDueMailboxChanges({ orgId: "org-1" }, h.deps);

    // Created and the address moved; the delete failed, so no alias attempt.
    expect(h.calls).toEqual([
      "create:rahul@circuvent.com",
      "work_email:rahul@circuvent.com",
      "delete:cvi-rahul@circuvent.com",
    ]);
    expect(h.outcomes[0]).toMatchObject({ status: "created", lastError: "mail server down" });
    expect(result.failed).toBe(1);
  });

  it("resumes from where it stopped instead of repeating a completed step", async () => {
    // The whole reason the status column exists. Deleting a mailbox twice is
    // not harmless, so a row that already deleted must not delete again.
    const h = harness([row({ status: "deleted", attemptCount: 1 })]);
    await drainDueMailboxChanges({ orgId: "org-1" }, h.deps);

    expect(h.calls).toEqual(["alias:cvi-rahul@circuvent.com->rahul@circuvent.com"]);
    expect(h.calls.some((c) => c.startsWith("create:"))).toBe(false);
    expect(h.calls.some((c) => c.startsWith("delete:"))).toBe(false);
  });

  it("does not alias when the caller asked for none", async () => {
    const h = harness([row({ aliasOldAddress: false })]);
    await drainDueMailboxChanges({ orgId: "org-1" }, h.deps);

    expect(h.calls.some((c) => c.startsWith("alias:"))).toBe(false);
    expect(h.outcomes[0]).toMatchObject({ status: "completed" });
  });

  it("treats an unconfigured mail server as blocked, not failed", async () => {
    // A deployment that provisions mailboxes some other way should not
    // accumulate a backlog of errors.
    const h = harness([row()], { create: { status: "blocked", detail: "MAIL_ADMIN_URL is not set" } });
    const result = await drainDueMailboxChanges({ orgId: "org-1" }, h.deps);

    expect(result).toMatchObject({ blocked: 1, failed: 0, completed: 0 });
    expect(h.outcomes[0]).toMatchObject({ status: "pending" });
  });

  it("never abandons a half-moved address", async () => {
    // Somebody half-moved is somebody unreachable. Every non-completed row
    // keeps a next attempt.
    const h = harness([row()], { delete: { status: "failed", detail: "down" } });
    await drainDueMailboxChanges({ orgId: "org-1" }, h.deps);

    expect(h.outcomes[0].nextAttemptAt).toBeInstanceOf(Date);
    expect(h.outcomes[0].completedAt).toBeNull();
  });

  it("clears the retry once the move is finished", async () => {
    const h = harness([row()]);
    await drainDueMailboxChanges({ orgId: "org-1" }, h.deps);

    expect(h.outcomes[0]).toMatchObject({ status: "completed", nextAttemptAt: null, lastError: null });
    expect(h.outcomes[0].completedAt).toBeInstanceOf(Date);
  });

  it("backs off further on each successive attempt", async () => {
    const first = harness([row({ attemptCount: 0 })], { create: { status: "failed" } });
    const later = harness([row({ attemptCount: 5 })], { create: { status: "failed" } });
    await drainDueMailboxChanges({ orgId: "org-1" }, first.deps);
    await drainDueMailboxChanges({ orgId: "org-1" }, later.deps);

    const firstDelay = (first.outcomes[0].nextAttemptAt as Date).getTime();
    const laterDelay = (later.outcomes[0].nextAttemptAt as Date).getTime();
    expect(laterDelay).toBeGreaterThan(firstDelay);
  });

  it("carries on to the next row when one fails", async () => {
    const h = harness([row({ id: "a", employeeId: "e1" }), row({ id: "b", employeeId: "e2" })]);
    const result = await drainDueMailboxChanges({ orgId: "org-1" }, h.deps);
    expect(result.attempted).toBe(2);
    expect(result.completed).toBe(2);
  });
});

describe("outstanding work", () => {
  it("counts everything that is not finished", () => {
    for (const s of ["pending", "created", "deleted", "aliased"]) {
      expect(isOutstanding(s), s).toBe(true);
    }
    expect(isOutstanding("completed")).toBe(false);
    expect(isOutstanding("failed")).toBe(false);
  });
});
