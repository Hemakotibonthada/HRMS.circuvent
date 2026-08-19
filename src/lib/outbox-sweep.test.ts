import { describe, expect, it, vi } from "vitest";

import { sweepOutboxes } from "@/lib/outbox-sweep";
import type { DrainResult } from "@/lib/directory-group-outbox";
import type { PaystubDrainResult } from "@/lib/paystub-sync-outbox";
import {
  actionForOutboxRow,
  paystubRetryDelayMinutes,
} from "@/lib/paystub-sync-outbox";
import { retryDelayMinutes } from "@/lib/onboarding-groups";

function paystubResult(over: Partial<PaystubDrainResult> = {}): PaystubDrainResult {
  return { attempted: 0, synced: 0, failed: 0, retired: 0, ...over };
}

function groupResult(over: Partial<DrainResult> = {}): DrainResult {
  return { attempted: 0, joined: 0, failed: 0, ...over };
}

describe("what a sweep does with a row", () => {
  it("attempts a row whose employee is still there", () => {
    expect(actionForOutboxRow({ deletedAt: null })).toEqual({ kind: "attempt" });
  });

  it("retires a row whose employee has been deleted", () => {
    // Without this the row keeps its long-past next-attempt time, is selected
    // by every subsequent sweep, and occupies the batch limit forever while
    // making no progress -- `attemptPaystubEmployeeSync` refuses a deleted
    // employee before recording an attempt, so nothing moves it along.
    const action = actionForOutboxRow({ deletedAt: new Date("2026-01-01T00:00:00Z") });
    expect(action.kind).toBe("retire");
    if (action.kind === "retire") {
      expect(action.reason).toMatch(/deleted in HRMS/i);
    }
  });
});

describe("how long a failed push waits", () => {
  it("doubles with each attempt", () => {
    expect(paystubRetryDelayMinutes(1)).toBe(2);
    expect(paystubRetryDelayMinutes(2)).toBe(4);
    expect(paystubRetryDelayMinutes(3)).toBe(8);
  });

  it("stops doubling, and it is the exponent cap that binds", () => {
    // 2 ** min(n, 10) = 1024 minutes, about 17 hours. Worth asserting the real
    // number rather than the `60 * 24` also written in that expression: that
    // term reads as a daily ceiling but can never be selected, because 1024 is
    // already below 1440. The effective cap is 1024 and always has been.
    expect(paystubRetryDelayMinutes(10)).toBe(1024);
    expect(paystubRetryDelayMinutes(20)).toBe(1024);
    expect(paystubRetryDelayMinutes(500)).toBe(1024);
  });

  it("backs off identically to the group-join outbox", () => {
    // The two outboxes are deliberate twins. A silent divergence is the kind
    // of thing nobody notices until one of them is retrying every minute.
    for (const attempt of [1, 2, 5, 10, 50]) {
      expect(paystubRetryDelayMinutes(attempt)).toBe(retryDelayMinutes(attempt));
    }
  });
});

describe("sweeping every tenant", () => {
  it("drains both outboxes for each organisation", async () => {
    const drainPaystub = vi.fn(async () => paystubResult({ attempted: 2, synced: 2 }));
    const drainGroups = vi.fn(async () => groupResult({ attempted: 1, joined: 1 }));

    const result = await sweepOutboxes(50, {
      listOrgs: async () => ["org-a", "org-b"],
      drainPaystub,
      drainGroups,
    });

    expect(result.organisations).toBe(2);
    expect(drainPaystub).toHaveBeenCalledTimes(2);
    expect(drainGroups).toHaveBeenCalledTimes(2);
    expect(result.totals.paystubSynced).toBe(4);
    expect(result.totals.groupsJoined).toBe(2);
    expect(result.problems).toEqual([]);
  });

  it("passes each organisation its own tenant context", async () => {
    const seen: string[] = [];
    await sweepOutboxes(50, {
      listOrgs: async () => ["org-a", "org-b"],
      drainPaystub: async (ctx) => {
        seen.push(ctx.orgId);
        return paystubResult();
      },
      drainGroups: async () => groupResult(),
    });

    expect(seen).toEqual(["org-a", "org-b"]);
  });

  it("keeps sweeping after one organisation throws, and names the one that did", async () => {
    // A sweep that stops at the first bad tenant leaves the rest un-swept for
    // a day, and the only tenant anybody hears about is the one that broke it.
    const drainPaystub = vi.fn(async (ctx: { orgId: string }) => {
      if (ctx.orgId === "org-bad") throw new Error("connection refused");
      return paystubResult({ attempted: 1, synced: 1 });
    });

    const result = await sweepOutboxes(50, {
      listOrgs: async () => ["org-a", "org-bad", "org-b"],
      drainPaystub,
      drainGroups: async () => groupResult({ joined: 1 }),
    });

    expect(result.totals.paystubSynced).toBe(2);
    expect(result.totals.groupsJoined).toBe(2);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("org-bad");
    expect(result.problems[0]).toContain("connection refused");
  });

  it("reports rather than throws when the organisations cannot be listed", async () => {
    const result = await sweepOutboxes(50, {
      listOrgs: async () => {
        throw new Error("database unreachable");
      },
    });

    expect(result.organisations).toBe(0);
    expect(result.problems[0]).toContain("database unreachable");
  });

  it("counts retired rows separately from failures", async () => {
    // A retired row is not a failure to chase; it is a row that is finished
    // with. Folding the two together would make an outage look like a backlog.
    const result = await sweepOutboxes(50, {
      listOrgs: async () => ["org-a"],
      drainPaystub: async () => paystubResult({ attempted: 1, failed: 1, retired: 3 }),
      drainGroups: async () => groupResult(),
    });

    expect(result.totals.paystubFailed).toBe(1);
    expect(result.totals.paystubRetired).toBe(3);
  });

  it("hands the batch limit down to each drain", async () => {
    const drainPaystub = vi.fn(async () => paystubResult());
    await sweepOutboxes(7, {
      listOrgs: async () => ["org-a"],
      drainPaystub,
      drainGroups: async () => groupResult(),
    });

    expect(drainPaystub).toHaveBeenCalledWith({ orgId: "org-a" }, 7);
  });
});
