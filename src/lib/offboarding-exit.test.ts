// The orchestrator that turns an accepted resignation into an actual exit:
// settlement priced and frozen, directory access queued for removal, the
// employee marked inactive, and the relieving letter / experience
// certificate / internship-completion certificate dispatched. Everything
// here runs against fakes, never a database, an identity provider or the
// document pipeline — see the file's own header comment for why (the same
// reason `outbox-sweep.ts`'s tests inject its five collaborators).
//
// Three things matter more than the rest of the coverage in this file,
// because the task this whole path exists for names them explicitly:
//   - a relieving letter must never predate the last working day it
//     certifies, even though settlement and access removal do not wait for it
//   - a failed group removal must show up as outstanding, never as quietly
//     dropped, and must not stop the exit from otherwise completing
//   - running this twice — the cron the day after a manual run, a retried
//     request — must not re-price a frozen settlement or re-issue a letter
//     that already exists

import { describe, expect, it, vi } from "vitest";

import { runExitProcessing, type ExitProcessingDeps } from "@/lib/offboarding-exit";
import type { ExitSettlementInputs, ResignationRecord } from "@/db/repositories/resignation.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import type { LifecycleDocumentKind, LifecycleDocumentOutcome } from "@/lib/intern-documents";
import type { TenantContext } from "@/db/client";

const ctx: TenantContext = { orgId: "org-1", userId: "hr-1" };

function baseResignation(over: Partial<ResignationRecord> = {}): ResignationRecord {
  return {
    id: "res-1",
    employeeId: "emp-1",
    status: "accepted",
    reason: "Relocating for family reasons",
    intendedLastWorkingDay: "2025-01-31",
    agreedLastWorkingDay: "2025-01-31",
    submittedAt: "2025-01-01T00:00:00.000Z",
    acceptedAt: "2025-01-02T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...over,
  };
}

function baseInputs(over: Partial<ExitSettlementInputs> = {}): ExitSettlementInputs {
  return {
    joinDate: "2023-06-01",
    noticePeriodDays: 30,
    monthlyBasicPay: 60_000,
    monthlyGrossPay: 90_000,
    encashableLeaveDays: 8,
    employmentType: "full_time",
    workEmail: "leaver@circuvent.com",
    ...over,
  };
}

/**
 * A minimal stand-in for `resignations` plus everything `runExitProcessing`
 * writes to it, mutated in place by the fakes below exactly the way the real
 * write-once columns behave. This is what makes the idempotency tests
 * meaningful: calling `runExitProcessing` twice against the *same* harness
 * sees the second call's `loadSettlementInputs` return what the first call
 * actually saved, the same way a second HTTP request would read back what an
 * earlier one committed.
 */
function makeHarness(options: {
  resignation?: Partial<ResignationRecord>;
  inputs?: Partial<ExitSettlementInputs>;
  today?: string;
  groupDrain?: { attempted: number; left: number; failed: number };
  outstanding?: Array<{ groupAddress: string; status: string; lastError: string | null }>;
} = {}) {
  let resignation = baseResignation(options.resignation);
  const inputs = baseInputs(options.inputs);

  const queueAndDrainGroupLeaves = vi.fn(async () => options.groupDrain ?? { attempted: 1, left: 1, failed: 0 });
  const outstandingGroupLeaves = vi.fn(async () => options.outstanding ?? []);
  const inactivateEmployee = vi.fn(async () => undefined);
  const dispatchDocuments = vi.fn(
    async (_c: TenantContext, _employeeId: string, kinds: LifecycleDocumentKind[]): Promise<LifecycleDocumentOutcome[]> =>
      kinds.map((kind) => ({ kind, ok: true, documentId: `doc-${kind}` }))
  );
  const saveSettlementSnapshot = vi.fn(async (_c: TenantContext, _id: string, snapshot: ResignationRecord["settlementSnapshot"]) => {
    // First write wins, mirroring `resignation.neon.ts`'s own comment about
    // why: a later call must read back the number an earlier one froze, not
    // overwrite it with whatever it happened to compute a moment later.
    if (!resignation.settlementSnapshot) {
      resignation = { ...resignation, settlementSnapshot: snapshot };
    }
    return resignation;
  });
  const saveDocumentIds = vi.fn(async (_c: TenantContext, _id: string, patch: Record<string, string | undefined>) => {
    resignation = { ...resignation, ...patch };
    return resignation;
  });
  const markExitProcessed = vi.fn(async () => {
    resignation = { ...resignation, exitProcessedAt: "2025-02-01T00:00:00.000Z" };
    return resignation;
  });

  const deps: Partial<ExitProcessingDeps> = {
    loadSettlementInputs: async () => ({ resignation, inputs }),
    saveSettlementSnapshot,
    queueAndDrainGroupLeaves,
    outstandingGroupLeaves,
    inactivateEmployee,
    dispatchDocuments,
    saveDocumentIds,
    markExitProcessed,
    today: () => options.today ?? "2025-02-01",
  };

  return {
    deps,
    getResignation: () => resignation,
    queueAndDrainGroupLeaves,
    outstandingGroupLeaves,
    inactivateEmployee,
    dispatchDocuments,
    saveSettlementSnapshot,
    saveDocumentIds,
    markExitProcessed,
  };
}

describe("a straightforward exit, processed on or after the last working day", () => {
  it("prices settlement, removes access, inactivates the employee, issues every document, and marks itself done", async () => {
    const h = makeHarness();

    const report = await runExitProcessing(ctx, "res-1", h.deps);

    expect(report.settlementFrozenThisRun).toBe(true);
    expect(report.settlement).toBeTruthy();
    expect(h.inactivateEmployee).toHaveBeenCalledWith(ctx, "emp-1", {
      exitDate: "2025-01-31",
      exitReason: "Relocating for family reasons",
    });
    // Only the all@ address onboarding actually tracked granting -- not the
    // full STANDARD_GROUPS list -- which is the scope decision every caveat
    // in this file exists to keep visible rather than silently assumed.
    expect(h.queueAndDrainGroupLeaves).toHaveBeenCalledWith(ctx, {
      employeeId: "emp-1",
      memberEmail: "leaver@circuvent.com",
      groupAddresses: ["all@circuvent.com"],
    });
    expect(report.documents.dispatched.map((d) => d.kind).sort()).toEqual([
      "experience_certificate",
      "relieving_letter",
    ]);
    expect(report.documents.allIssued).toBe(true);
    expect(report.exitProcessed).toBe(true);
    // Sign-out is a standing limitation, not a symptom of this run -- it must
    // read exactly this way even when nothing else went wrong, or a clean
    // report would be the one time a reader has no reason to notice it.
    expect(report.caveats.some((c) => /sign-out is not suite-wide/i.test(c))).toBe(true);
  });

  it("also requests the internship-completion certificate for an intern", async () => {
    const h = makeHarness({ inputs: { employmentType: "intern" } });

    const report = await runExitProcessing(ctx, "res-1", h.deps);

    expect(report.documents.dispatched.map((d) => d.kind).sort()).toEqual([
      "experience_certificate",
      "internship_completion_certificate",
      "relieving_letter",
    ]);
  });
});

describe("running the same exit twice", () => {
  it("does not re-price a frozen settlement or re-dispatch an already-issued document", async () => {
    const h = makeHarness();

    const first = await runExitProcessing(ctx, "res-1", h.deps);
    const second = await runExitProcessing(ctx, "res-1", h.deps);

    expect(first.settlementFrozenThisRun).toBe(true);
    expect(second.settlementFrozenThisRun).toBe(false);
    expect(second.settlement).toEqual(first.settlement);

    // Once, not twice: a second dispatch would mean a second signed PDF for a
    // certificate that already exists.
    expect(h.dispatchDocuments).toHaveBeenCalledTimes(1);
    expect(second.documents.dispatched).toEqual([]);
    expect(second.documents.allIssued).toBe(true);

    // `markExitProcessed` only ever fires once; the second call finds the
    // flag already set and does not call it again.
    expect(h.markExitProcessed).toHaveBeenCalledTimes(1);
    expect(second.exitProcessed).toBe(true);
  });

  it("reopens rather than duplicates an outstanding group removal on a second run", async () => {
    const h = makeHarness();

    await runExitProcessing(ctx, "res-1", h.deps);
    await runExitProcessing(ctx, "res-1", h.deps);

    // Both calls queue-and-drain; the outbox's own `onConflictDoUpdate`
    // (see `directory-group-outbox.ts`) is what keeps this from inserting a
    // second removal intent per group -- this just proves the orchestrator
    // calls it again rather than skipping it once access looks handled.
    expect(h.queueAndDrainGroupLeaves).toHaveBeenCalledTimes(2);
  });
});

describe("a last working day that has not arrived yet", () => {
  it("still prices settlement and removes access, but withholds every document", async () => {
    const h = makeHarness({ today: "2025-01-15" });

    const report = await runExitProcessing(ctx, "res-1", h.deps);

    expect(report.settlementFrozenThisRun).toBe(true);
    expect(h.inactivateEmployee).toHaveBeenCalledTimes(1);
    expect(h.queueAndDrainGroupLeaves).toHaveBeenCalledTimes(1);

    expect(h.dispatchDocuments).not.toHaveBeenCalled();
    expect(report.documents.dispatched).toEqual([]);
    expect(report.documents.allIssued).toBe(false);
    expect(report.documents.withheldReason).toMatch(/2025-01-31/);
    // Not done: a relieving letter dated before the day it certifies is the
    // exact error the task calls out, so nothing here may report the exit as
    // finished while a document is still owed.
    expect(report.exitProcessed).toBe(false);
  });

  it("issues the withheld documents once tomorrow's cron runs past the last working day", async () => {
    // Proves the withholding is actually resumable, not just described as
    // such in a comment: the resignation stays "due" (`exitProcessedAt`
    // unset) specifically so the next sweep picks it up and finishes it.
    const h = makeHarness({ today: "2025-01-15" });
    const early = await runExitProcessing(ctx, "res-1", h.deps);
    expect(early.exitProcessed).toBe(false);

    h.deps.today = () => "2025-02-01";
    const late = await runExitProcessing(ctx, "res-1", h.deps);

    expect(h.dispatchDocuments).toHaveBeenCalledTimes(1);
    expect(late.documents.allIssued).toBe(true);
    expect(late.exitProcessed).toBe(true);
    // Settlement was already frozen on the first, early call -- the second
    // one must not have re-priced it just because it did more work overall.
    expect(late.settlementFrozenThisRun).toBe(false);
  });
});

describe("a group removal that fails", () => {
  it("reports it as outstanding, keeps it out of 'done', but does not block the rest of the exit", async () => {
    const h = makeHarness({
      groupDrain: { attempted: 1, left: 0, failed: 1 },
      outstanding: [{ groupAddress: "all@circuvent.com", status: "pending", lastError: "upstream down" }],
    });

    const report = await runExitProcessing(ctx, "res-1", h.deps);

    expect(report.groupLeaves.failed).toBe(1);
    expect(report.groupLeaves.outstanding).toEqual([
      { groupAddress: "all@circuvent.com", status: "pending", lastError: "upstream down" },
    ]);
    expect(
      report.caveats.some((c) => c.includes("1 directory group membership") && /not reported as done/i.test(c))
    ).toBe(true);

    // Deliberate: `exitProcessed` tracks documents, not group removal, because
    // a stuck removal already has its own permanent retry path -- the daily
    // outbox sweep -- so nothing here should invent a second one that only
    // duplicates it (see the file header on `offboarding-exit.ts`).
    expect(report.exitProcessed).toBe(true);
  });
});

describe("a resignation that is not ready to be exit-processed", () => {
  it("refuses one that has not been accepted yet", async () => {
    const h = makeHarness({ resignation: { status: "submitted", agreedLastWorkingDay: undefined } });

    await expect(runExitProcessing(ctx, "res-1", h.deps)).rejects.toThrow(RepositoryError);
    await expect(runExitProcessing(ctx, "res-1", h.deps)).rejects.toMatchObject({ status: 409 });
  });

  it("throws NotFoundError when the resignation does not exist", async () => {
    const deps: Partial<ExitProcessingDeps> = { loadSettlementInputs: async () => null };

    await expect(runExitProcessing(ctx, "missing", deps)).rejects.toThrow(NotFoundError);
  });
});
