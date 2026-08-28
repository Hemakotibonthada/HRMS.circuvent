import { describe, expect, it, vi } from "vitest";

import { sweepOutboxes } from "@/lib/outbox-sweep";
import type { DrainResult, LeaveDrainResult } from "@/lib/directory-group-outbox";
import type { PaystubDrainResult } from "@/lib/paystub-sync-outbox";
import {
  actionForOutboxRow,
  paystubRetryDelayMinutes,
} from "@/lib/paystub-sync-outbox";
import { retryDelayMinutes } from "@/lib/onboarding-groups";
import type { DocumentPdfDrainResult } from "@/lib/document-pdf-outbox";
import { documentPdfRetryDelayMinutes } from "@/lib/document-pdf-outbox";
import type { MailboxDrainResult } from "@/lib/mailbox-outbox";

function paystubResult(over: Partial<PaystubDrainResult> = {}): PaystubDrainResult {
  return { attempted: 0, synced: 0, failed: 0, retired: 0, ...over };
}

function groupResult(over: Partial<DrainResult> = {}): DrainResult {
  return { attempted: 0, joined: 0, failed: 0, ...over };
}

function groupLeaveResult(over: Partial<LeaveDrainResult> = {}): LeaveDrainResult {
  return { attempted: 0, left: 0, failed: 0, ...over };
}

function documentPdfResult(over: Partial<DocumentPdfDrainResult> = {}): DocumentPdfDrainResult {
  return { attempted: 0, succeeded: 0, failed: 0, ...over };
}

function mailboxResult(over: Partial<MailboxDrainResult> = {}): MailboxDrainResult {
  return { attempted: 0, completed: 0, blocked: 0, failed: 0, ...over };
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

  it("backs off identically to the document PDF storage outbox", () => {
    // A third outbox joined the other two later; it must not quietly pick its
    // own backoff curve just because it lives in a different file.
    for (const attempt of [1, 2, 5, 10, 50]) {
      expect(documentPdfRetryDelayMinutes(attempt)).toBe(paystubRetryDelayMinutes(attempt));
    }
  });
});

describe("sweeping every tenant", () => {
  it("drains all three outboxes for each organisation", async () => {
    const drainPaystub = vi.fn(async () => paystubResult({ attempted: 2, synced: 2 }));
    const drainGroups = vi.fn(async () => groupResult({ attempted: 1, joined: 1 }));
    const drainDocumentPdfs = vi.fn(async () => documentPdfResult({ attempted: 1, succeeded: 1 }));

    const result = await sweepOutboxes(50, {
      listOrgs: async () => ["org-a", "org-b"],
      drainPaystub,
      drainGroups,
      drainGroupLeaves: async () => groupLeaveResult(),
      drainDocumentPdfs,
      drainMailboxes: async () => mailboxResult(),
    });

    expect(result.organisations).toBe(2);
    expect(drainPaystub).toHaveBeenCalledTimes(2);
    expect(drainGroups).toHaveBeenCalledTimes(2);
    expect(drainDocumentPdfs).toHaveBeenCalledTimes(2);
    expect(result.totals.paystubSynced).toBe(4);
    expect(result.totals.groupsJoined).toBe(2);
    expect(result.totals.documentPdfsStored).toBe(2);
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
      drainGroupLeaves: async () => groupLeaveResult(),
      drainDocumentPdfs: async () => documentPdfResult(),
      drainMailboxes: async () => mailboxResult(),
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
      drainGroupLeaves: async () => groupLeaveResult(),
      drainDocumentPdfs: async () => documentPdfResult(),
      drainMailboxes: async () => mailboxResult(),
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
      drainGroupLeaves: async () => groupLeaveResult(),
      drainDocumentPdfs: async () => documentPdfResult(),
      drainMailboxes: async () => mailboxResult(),
    });

    expect(result.totals.paystubFailed).toBe(1);
    expect(result.totals.paystubRetired).toBe(3);
  });

  it("counts document PDF failures separately from paystub and group failures", async () => {
    // Three independent totals: an R2 outage should read as an R2 problem,
    // not get folded into (or masked by) an unrelated Paystub or directory one.
    const result = await sweepOutboxes(50, {
      listOrgs: async () => ["org-a"],
      drainPaystub: async () => paystubResult(),
      drainGroups: async () => groupResult(),
      drainGroupLeaves: async () => groupLeaveResult(),
      drainDocumentPdfs: async () => documentPdfResult({ attempted: 2, succeeded: 1, failed: 1 }),
      drainMailboxes: async () => mailboxResult(),
    });

    expect(result.totals.documentPdfsStored).toBe(1);
    expect(result.totals.documentPdfsFailed).toBe(1);
    expect(result.totals.paystubFailed).toBe(0);
    expect(result.totals.groupsFailed).toBe(0);
  });

  it("counts a stuck group removal separately from a stuck group join", async () => {
    // This is the totals-level half of the bug the leave outbox exists to
    // close: a leaver's failed removal must show up as its own number, not
    // get absorbed into (or hidden by) the join side's count, or a healthy
    // hiring flow could mask an offboarding one quietly failing every day.
    const result = await sweepOutboxes(50, {
      listOrgs: async () => ["org-a"],
      drainPaystub: async () => paystubResult(),
      drainGroups: async () => groupResult({ attempted: 3, joined: 3 }),
      drainGroupLeaves: async () => groupLeaveResult({ attempted: 2, left: 1, failed: 1 }),
      drainDocumentPdfs: async () => documentPdfResult(),
      drainMailboxes: async () => mailboxResult(),
    });

    expect(result.totals.groupsJoined).toBe(3);
    expect(result.totals.groupsFailed).toBe(0);
    expect(result.totals.groupsLeft).toBe(1);
    expect(result.totals.groupsLeaveFailed).toBe(1);
  });

  it("keeps sweeping the other outboxes and organisations when a group removal drain throws", async () => {
    // The join outbox has an accidental safety net (the next edit to that
    // employee re-drives it); the leave outbox has only this sweep. If a
    // throw here ever took the whole sweep down, a leaver's access would wait
    // not just for the next sweep but for whoever noticed the cron stopped
    // running entirely — which is a slower, quieter version of the exact bug
    // this file exists to close.
    const drainGroupLeaves = vi.fn(async (ctx: { orgId: string }) => {
      if (ctx.orgId === "org-bad") throw new Error("identity provider unreachable");
      return groupLeaveResult({ attempted: 1, left: 1 });
    });

    const result = await sweepOutboxes(50, {
      listOrgs: async () => ["org-a", "org-bad", "org-b"],
      drainPaystub: async () => paystubResult({ attempted: 1, synced: 1 }),
      drainGroups: async () => groupResult(),
      drainGroupLeaves,
      drainDocumentPdfs: async () => documentPdfResult(),
      drainMailboxes: async () => mailboxResult(),
    });

    expect(result.totals.groupsLeft).toBe(2);
    expect(result.totals.paystubSynced).toBe(2);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("org-bad");
    expect(result.problems[0]).toContain("identity provider unreachable");
  });

  it("drains the mailbox outbox for every organisation", async () => {
    // The drain was written and tested before anything called it. A tested
    // drain nobody invokes is a queue that fills and never empties, and the
    // symptom -- a former intern still carrying "cvi-" months later -- looks
    // like a rule that was never implemented rather than one that never ran.
    const drainMailboxes = vi.fn(async () => mailboxResult({ attempted: 1, completed: 1 }));

    const result = await sweepOutboxes(50, {
      listOrgs: async () => ["org-a", "org-b"],
      drainPaystub: async () => paystubResult(),
      drainGroups: async () => groupResult(),
      drainGroupLeaves: async () => groupLeaveResult(),
      drainDocumentPdfs: async () => documentPdfResult(),
      drainMailboxes,
    });

    expect(drainMailboxes).toHaveBeenCalledTimes(2);
    expect(drainMailboxes).toHaveBeenCalledWith({ orgId: "org-a" }, 50);
    expect(result.totals.mailboxesMoved).toBe(2);
  });

  it("counts a blocked mailbox move apart from a failed one", async () => {
    // "No mail server configured" is a fact somebody should read once, not an
    // error somebody should chase every day. Folding the two together would
    // make a deployment that provisions mailboxes elsewhere look permanently
    // broken, and would hide a genuine mail-server failure inside that noise.
    const result = await sweepOutboxes(50, {
      listOrgs: async () => ["org-a"],
      drainPaystub: async () => paystubResult(),
      drainGroups: async () => groupResult(),
      drainGroupLeaves: async () => groupLeaveResult(),
      drainDocumentPdfs: async () => documentPdfResult(),
      drainMailboxes: async () => mailboxResult({ attempted: 3, completed: 1, blocked: 1, failed: 1 }),
    });

    expect(result.totals.mailboxesMoved).toBe(1);
    expect(result.totals.mailboxesBlocked).toBe(1);
    expect(result.totals.mailboxesFailed).toBe(1);
  });

  it("keeps sweeping the other organisations when a mailbox drain throws", async () => {
    const drainMailboxes = vi.fn(async (ctx: { orgId: string }) => {
      if (ctx.orgId === "org-bad") throw new Error("mail server unreachable");
      return mailboxResult({ attempted: 1, completed: 1 });
    });

    const result = await sweepOutboxes(50, {
      listOrgs: async () => ["org-a", "org-bad", "org-b"],
      drainPaystub: async () => paystubResult(),
      drainGroups: async () => groupResult(),
      drainGroupLeaves: async () => groupLeaveResult(),
      drainDocumentPdfs: async () => documentPdfResult(),
      drainMailboxes,
    });

    expect(result.totals.mailboxesMoved).toBe(2);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("org-bad");
  });

  it("hands the batch limit down to each drain", async () => {
    const drainPaystub = vi.fn(async () => paystubResult());
    const drainDocumentPdfs = vi.fn(async () => documentPdfResult());
    await sweepOutboxes(7, {
      listOrgs: async () => ["org-a"],
      drainPaystub,
      drainGroups: async () => groupResult(),
      drainGroupLeaves: async () => groupLeaveResult(),
      drainDocumentPdfs,
      drainMailboxes: async () => mailboxResult(),
    });

    expect(drainPaystub).toHaveBeenCalledWith({ orgId: "org-a" }, 7);
    expect(drainDocumentPdfs).toHaveBeenCalledWith({ orgId: "org-a" }, 7);
  });
});

