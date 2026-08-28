// ═══════════════════════════════════════════════════════════════
// EXIT PROCESSING — the one place a resignation actually becomes an exit
// ═══════════════════════════════════════════════════════════════
//
// Everything before this file only agrees that somebody is leaving and when:
// `resignation.neon.ts` records the request, the acceptance and the agreed
// last working day. This file is what happens once that day is reached (or
// HR says to treat it as reached): the settlement gets priced and frozen,
// directory group membership is queued for removal, the employee record is
// marked inactive so payroll and Paystub stop treating them as payable, and
// the relieving letter / experience certificate / internship-completion
// certificate the checklist promises actually get generated.
//
// Runs from two places, on purpose:
//   - `processDueExits`, from the daily cron, for the ordinary case: a
//     resignation whose agreed last working day has arrived.
//   - a manual "HR confirms exit" action, for the case notice policy cannot
//     anticipate — someone released early, or a settlement HR wants priced
//     ahead of the actual day so the final payment can be arranged in time.
//     `canAdjustLastWorkingDay` in offboarding-resignation.ts already
//     assumes this path exists (see its own comment) and blocks moving the
//     last working day once it has run.
//
// Because of that second caller, most of this function does *not* gate on
// the last working day having arrived: pricing a settlement and removing
// directory access ahead of the actual day is HR acting deliberately, the
// same way `adjustLastWorkingDay` itself is a deliberate HR action rather
// than something to guard against. The one thing that *is* gated is document
// dispatch — the task this whole path exists for is explicit that a
// relieving letter must never predate the last working day it certifies,
// and that rule has no HR override. A run that arrives before the agreed
// date still freezes the settlement, removes access and inactivates the
// employee, but leaves the documents themselves pending — the resignation
// stays "due" so the next day's cron picks the letters up once the date
// actually arrives. See `isDueForDocuments` below.
//
// `noticeWaived` (see `SettlementCalculationInput` in employee-lifecycle.ts)
// is always left `undefined` here — this codebase has no separate "notice
// paid in lieu" flag anywhere on a resignation, so a shortfall between
// notice owed and notice served is always priced as a recovery from the
// employee, never as a waiver. If a future change needs HR to be able to
// mark a shortfall paid-in-lieu instead of recovered, that is a column on
// `resignations` and a value threaded through here — not a change to
// `settlement.ts`, which already knows how to price either case correctly.
//
// Every side effect is injectable (`ExitProcessingDeps`), mirroring
// `outbox-sweep.ts`'s `deps` parameter for the same reason: the behaviour
// worth proving — that a failed document does not block a succeeded one,
// that running this twice does not re-price a frozen settlement or re-issue
// an already-issued letter — is not provable against a real database, a real
// identity provider and a real document-signing pipeline. Every dependency
// below is a fake in this file's tests; none of them touch any of those.

import { dateKeyInZone } from "@/lib/date-keys";
import { todayKey } from "@/lib/date-keys";
import {
  calculateSettlement,
  daysBetween,
  type SettlementComponents,
} from "@/lib/employee-lifecycle";
import { resolveGroupDomain, autoJoinAddresses } from "@/lib/onboarding-groups";
import {
  queueGroupLeaves,
  drainDueGroupLeaves,
  outstandingGroupLeaves as outstandingGroupLeavesQuery,
  type LeaveDrainResult,
} from "@/lib/directory-group-outbox";
import {
  dispatchLifecycleDocuments,
  type LifecycleDocumentKind,
  type LifecycleDocumentOutcome,
} from "@/lib/intern-documents";
import { withTenant, type TenantContext } from "@/db/client";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import {
  NeonResignationRepository,
  type ExitSettlementInputs,
  type ResignationRecord,
} from "@/db/repositories/resignation.neon";
import { RepositoryError, NotFoundError } from "@/db/repositories/types";
import { activeOrganisationIds } from "@/lib/outbox-sweep";

/** A resignation's own encashment-basis policy is not modelled anywhere yet — see the report this produces for why this is a known gap, not an oversight. */
const LEAVE_ENCASHMENT_BASIS = 26;

/**
 * Which `resignations` column already holds a given document kind's id, so
 * a second run can tell "already issued" from "still owed" without a second
 * source of truth. Returns `undefined` for `joining_letter`, which exit
 * processing never requests — kept in the switch anyway so adding a fifth
 * `LifecycleDocumentKind` one day fails to compile here until this function
 * is taught about it, rather than silently treating the new kind as
 * "already issued".
 */
function documentIdField(
  kind: LifecycleDocumentKind
):
  | "relievingLetterDocumentId"
  | "experienceCertificateDocumentId"
  | "internshipCompletionDocumentId"
  | undefined {
  switch (kind) {
    case "relieving_letter":
      return "relievingLetterDocumentId";
    case "experience_certificate":
      return "experienceCertificateDocumentId";
    case "internship_completion_certificate":
      return "internshipCompletionDocumentId";
    case "joining_letter":
      return undefined;
  }
}

function isDocumentIssued(resignation: ResignationRecord, kind: LifecycleDocumentKind): boolean {
  const field = documentIdField(kind);
  return field ? resignation[field] != null : true;
}

/** The document kinds this exit calls for — mirrors the delete-button leaver path in employee.neon.ts's `remove()` exactly, so the two routes to "somebody has left" issue the same paperwork. */
function candidateDocumentKinds(employmentType: string): LifecycleDocumentKind[] {
  return employmentType === "intern"
    ? ["internship_completion_certificate", "experience_certificate", "relieving_letter"]
    : ["experience_certificate", "relieving_letter"];
}

export interface ExitProcessingDeps {
  loadSettlementInputs(
    ctx: TenantContext,
    resignationId: string
  ): Promise<{ resignation: ResignationRecord; inputs: ExitSettlementInputs } | null>;
  saveSettlementSnapshot(
    ctx: TenantContext,
    resignationId: string,
    snapshot: SettlementComponents
  ): Promise<ResignationRecord>;
  /** Queues a leave-outbox row per group inside a transaction, then attempts delivery immediately — same two-step shape `remove()` uses. */
  queueAndDrainGroupLeaves(
    ctx: TenantContext,
    input: { employeeId: string; memberEmail: string; groupAddresses: string[] }
  ): Promise<LeaveDrainResult>;
  outstandingGroupLeaves(
    ctx: TenantContext,
    employeeId: string
  ): Promise<Array<{ groupAddress: string; status: string; lastError: string | null }>>;
  inactivateEmployee(
    ctx: TenantContext,
    employeeId: string,
    patch: { exitDate: string; exitReason: string }
  ): Promise<void>;
  dispatchDocuments(
    ctx: TenantContext,
    employeeId: string,
    kinds: LifecycleDocumentKind[],
    generatedById: string | undefined
  ): Promise<LifecycleDocumentOutcome[]>;
  saveDocumentIds(
    ctx: TenantContext,
    resignationId: string,
    patch: {
      relievingLetterDocumentId?: string;
      experienceCertificateDocumentId?: string;
      internshipCompletionDocumentId?: string;
    }
  ): Promise<ResignationRecord>;
  markExitProcessed(ctx: TenantContext, resignationId: string): Promise<ResignationRecord>;
  /** Today's date key — injectable so a test can put "today" on either side of an agreed last working day without waiting for a real one. */
  today(): string;
}

const defaultDeps: ExitProcessingDeps = {
  loadSettlementInputs: (ctx, id) => new NeonResignationRepository(ctx).loadSettlementInputs(id),
  saveSettlementSnapshot: (ctx, id, snapshot) =>
    new NeonResignationRepository(ctx).saveSettlementSnapshot(id, snapshot),
  queueAndDrainGroupLeaves: async (ctx, input) => {
    await withTenant(ctx, (tx) =>
      queueGroupLeaves(tx, {
        orgId: ctx.orgId,
        employeeId: input.employeeId,
        memberEmail: input.memberEmail,
        groupAddresses: input.groupAddresses,
      })
    );
    return drainDueGroupLeaves(ctx);
  },
  outstandingGroupLeaves: (ctx, employeeId) => outstandingGroupLeavesQuery(ctx, employeeId),
  inactivateEmployee: async (ctx, employeeId, patch) => {
    await new NeonEmployeeRepository(ctx).update(employeeId, {
      status: "inactive",
      exitDate: patch.exitDate,
      exitReason: patch.exitReason,
    });
  },
  dispatchDocuments: (ctx, employeeId, kinds, generatedById) =>
    dispatchLifecycleDocuments(ctx, employeeId, kinds, generatedById),
  saveDocumentIds: (ctx, id, patch) => new NeonResignationRepository(ctx).saveDocumentIds(id, patch),
  markExitProcessed: (ctx, id) => new NeonResignationRepository(ctx).markExitProcessed(id),
  today: () => todayKey(),
};

export interface ExitProcessingReport {
  resignationId: string;
  employeeId: string;
  agreedLastWorkingDay: string;
  settlement: SettlementComponents;
  /** True only if this call computed and froze the snapshot; false if it was already frozen from an earlier run. */
  settlementFrozenThisRun: boolean;
  groupLeaves: {
    attempted: number;
    left: number;
    failed: number;
    /** What `saveDocumentIds`-style "report, don't assume" looks like for access instead of paperwork — every group not yet confirmed removed, however it got there. */
    outstanding: Array<{ groupAddress: string; status: string; lastError: string | null }>;
  };
  documents: {
    /** Only the kinds actually dispatched this run — already-issued kinds from a prior run are not repeated here. */
    dispatched: LifecycleDocumentOutcome[];
    /** Set when documents exist for this employee but the last working day has not arrived yet, so none were attempted. */
    withheldReason?: string;
    /** True once every applicable document kind has a real, issued document — from this run, an earlier one, or both. */
    allIssued: boolean;
  };
  /** True once settlement + access removal + inactivation + every document is done and `exitProcessedAt` is (or already was) set. */
  exitProcessed: boolean;
  /** Everything a human reading this report should know before treating the exit as fully clean — see the file header for why session sign-out is always in this list. */
  caveats: string[];
}

/**
 * Prices, revokes and documents one accepted resignation. Safe to call
 * repeatedly for the same resignation — by the cron, by a retried request,
 * by HR pressing "process exit" a second time after fixing a broken
 * template — because every write it makes is one of this codebase's
 * existing write-once idioms: `saveSettlementSnapshot` only writes if unset,
 * `saveDocumentIds` only writes a column that is still null, `queueGroupLeaves`
 * reopens rather than duplicates, and `markExitProcessed` only sets the flag
 * once. A second call re-does no pricing and re-issues no document; it only
 * finishes whatever the first call left outstanding.
 */
export async function runExitProcessing(
  ctx: TenantContext,
  resignationId: string,
  deps: Partial<ExitProcessingDeps> = {}
): Promise<ExitProcessingReport> {
  const merged: ExitProcessingDeps = { ...defaultDeps, ...deps };

  const loaded = await merged.loadSettlementInputs(ctx, resignationId);
  if (!loaded) throw new NotFoundError("Resignation", resignationId);
  const { resignation, inputs } = loaded;

  if (resignation.status !== "accepted" || !resignation.agreedLastWorkingDay) {
    throw new RepositoryError(
      `Resignation ${resignationId} cannot be exit-processed: it is ${resignation.status} and has no agreed last working day yet`,
      409
    );
  }
  const agreedLastWorkingDay = resignation.agreedLastWorkingDay;

  // ── Settlement: price once, freeze forever ──
  let settlement: SettlementComponents;
  let settlementFrozenThisRun = false;
  if (resignation.settlementSnapshot) {
    settlement = resignation.settlementSnapshot;
  } else {
    // Anchored on submission, not acceptance — the same anchor
    // `computeAgreedLastWorkingDay` uses for the policy minimum, so "notice
    // served" and "notice owed" are measured from the same starting point.
    // Deliberately not clamped to zero: see `daysBetween`'s own comment for
    // why a last working day that somehow precedes the submission date must
    // surface as a visibly wrong number rather than read as notice fully
    // served.
    const submittedAtKey = dateKeyInZone(new Date(resignation.submittedAt));
    const noticeServedDays = daysBetween(submittedAtKey, agreedLastWorkingDay);

    const computed = calculateSettlement({
      joinDate: inputs.joinDate,
      exitDate: agreedLastWorkingDay,
      // Hardcoded, not `resignation.reason`: that field is the employee's
      // free-text explanation ("better opportunity", "relocating"), not one
      // of settlement.ts's six accounting categories, and this whole file
      // only ever runs off the resignation path.
      reason: "resignation",
      monthlyBasicPay: inputs.monthlyBasicPay,
      monthlyGrossPay: inputs.monthlyGrossPay,
      noticePeriodDays: inputs.noticePeriodDays,
      noticeServedDays,
      // See the file header: this codebase has nowhere to record "notice
      // waived", so a shortfall is always priced as recoverable.
      noticeWaived: undefined,
      encashableLeaveDays: inputs.encashableLeaveDays,
      leaveEncashmentBasis: LEAVE_ENCASHMENT_BASIS,
    });

    const saved = await merged.saveSettlementSnapshot(ctx, resignationId, computed);
    // Read back rather than trusting `computed`: if a concurrent call (a
    // retried request racing the cron, say) froze first, `saveSettlementSnapshot`
    // silently kept its snapshot instead of overwriting it, and this run must
    // report the number that actually got frozen, not the one it happened to
    // compute a moment too late.
    settlement = saved.settlementSnapshot ?? computed;
    settlementFrozenThisRun = true;
  }

  // ── Access removal: queue, attempt, report what is left ──
  // No last-working-day gate here — see the file header for why an early
  // HR-confirmed exit removes access immediately rather than waiting.
  const groupAddresses = autoJoinAddresses(resolveGroupDomain(inputs.workEmail));
  const groupDrain = await merged.queueAndDrainGroupLeaves(ctx, {
    employeeId: resignation.employeeId,
    memberEmail: inputs.workEmail,
    groupAddresses,
  });
  const outstanding = await merged.outstandingGroupLeaves(ctx, resignation.employeeId);

  // ── Inactivation: stop payroll and Paystub treating this person as payable ──
  // Must commit before document dispatch: `dispatchLifecycleDocuments` reads
  // `employee.exitDate` / `exitReason` straight off the employee record for
  // the relieving-letter and internship-completion tokens, falling back to
  // today's date if `exitDate` is not set yet. Dispatching first would print
  // the wrong last working day on a certificate that exists specifically to
  // state it correctly.
  await merged.inactivateEmployee(ctx, resignation.employeeId, {
    exitDate: agreedLastWorkingDay,
    exitReason: resignation.reason,
  });

  // ── Documents: gated on the last working day, unlike everything above ──
  const candidateKinds = candidateDocumentKinds(inputs.employmentType);
  const pendingKinds = candidateKinds.filter((kind) => !isDocumentIssued(resignation, kind));
  const isDueForDocuments = merged.today() >= agreedLastWorkingDay;

  let dispatched: LifecycleDocumentOutcome[] = [];
  let withheldReason: string | undefined;

  if (pendingKinds.length > 0 && !isDueForDocuments) {
    withheldReason =
      `The last working day (${agreedLastWorkingDay}) has not arrived yet; the relieving letter, ` +
      `experience certificate and any internship-completion certificate are only issued on or after it. ` +
      `Settlement and access removal for this exit were still processed now, at HR's request.`;
  } else if (pendingKinds.length > 0) {
    dispatched = await merged.dispatchDocuments(ctx, resignation.employeeId, pendingKinds, ctx.userId);
    const patch: {
      relievingLetterDocumentId?: string;
      experienceCertificateDocumentId?: string;
      internshipCompletionDocumentId?: string;
    } = {};
    for (const outcome of dispatched) {
      if (!outcome.ok || !outcome.documentId) continue;
      const field = documentIdField(outcome.kind);
      if (field) patch[field] = outcome.documentId;
    }
    if (Object.keys(patch).length > 0) {
      await merged.saveDocumentIds(ctx, resignationId, patch);
    }
  }

  const allIssued = candidateKinds.every(
    (kind) => isDocumentIssued(resignation, kind) || dispatched.some((o) => o.kind === kind && o.ok)
  );

  // ── Mark processed only when there is nothing left to retry ──
  // Deliberately independent of `groupDrain`/`outstanding`: a stuck group
  // removal already has its own permanent retry path (the leave outbox row
  // survives with a backoff, and `outbox-sweep.ts`'s daily sweep — not this
  // flag — is what keeps trying it), so coupling `exitProcessed` to it would
  // only duplicate that retry, not add one. Document dispatch has no such
  // independent mechanism — nothing else in this codebase ever looks at a
  // resignation again to retry a failed or withheld letter — so it is
  // `exitProcessed` staying false that gives it one: `listDueForExit` keeps
  // returning this row, and tomorrow's cron calls this function again. That
  // is the exact shape the task warns against being repeated: something
  // that silently never happens again because nobody touches the record.
  // This is how document dispatch avoids it.
  let exitProcessed = resignation.exitProcessedAt != null;
  if (!exitProcessed && allIssued) {
    await merged.markExitProcessed(ctx, resignationId);
    exitProcessed = true;
  }

  const caveats: string[] = [];
  if (outstanding.length > 0) {
    caveats.push(
      `${outstanding.length} directory group membership(s) could not be confirmed removed yet ` +
        `(${outstanding.map((g) => `${g.groupAddress}: ${g.lastError ?? "pending"}`).join("; ")}). ` +
        `The daily outbox sweep will keep retrying until they succeed — this is not reported as done.`
    );
  }
  caveats.push(
    `Directory group removal covers only the auto-joined "all@" address that onboarding tracked ` +
      `granting. A manual addition to people@, managers@ or any other group leaves no record here ` +
      `to reverse and must be checked by hand.`
  );
  const failedDocuments = dispatched.filter((o) => !o.ok);
  if (failedDocuments.length > 0) {
    caveats.push(
      `${failedDocuments.length} document(s) could not be issued this run ` +
        `(${failedDocuments.map((o) => `${o.kind}: ${o.error}`).join("; ")}). ` +
        `Exit processing is not marked complete, so this will be retried rather than left stuck.`
    );
  }
  if (withheldReason) caveats.push(withheldReason);
  // Always present, not conditional on anything above: this is a standing
  // limitation of the suite, not an outcome of this particular run, and the
  // task is explicit that implying instant access loss would be worse than
  // saying nothing. Sign-out is not suite-wide today — removing directory
  // group membership stops *new* access grants and group-addressed mail, but
  // an already-issued session or access token for this person may still be
  // honoured by another app until it expires on its own.
  caveats.push(
    `Sign-out is not suite-wide: this exit removes directory group membership and marks the ` +
      `employee inactive, but does not revoke an already-issued session or access token anywhere in ` +
      `the suite. A token issued before this run may still be honoured elsewhere until it expires.`
  );

  return {
    resignationId,
    employeeId: resignation.employeeId,
    agreedLastWorkingDay,
    settlement,
    settlementFrozenThisRun,
    groupLeaves: {
      attempted: groupDrain.attempted,
      left: groupDrain.left,
      failed: groupDrain.failed,
      outstanding,
    },
    documents: {
      dispatched,
      withheldReason,
      allIssued,
    },
    exitProcessed,
    caveats,
  };
}

export interface ExitSweepOrgResult {
  orgId: string;
  due: number;
  results: ExitProcessingReport[];
}

export interface ExitSweepResult {
  organisations: number;
  orgs: ExitSweepOrgResult[];
  totals: {
    due: number;
    processed: number;
    fullyProcessed: number;
  };
  /** One entry per resignation or tenant that could not be processed at all, naming which. */
  problems: string[];
}

export interface ExitSweepDeps extends Partial<ExitProcessingDeps> {
  listOrgs?: () => Promise<string[]>;
  listDueForExit?: (ctx: TenantContext, limit: number) => Promise<ResignationRecord[]>;
}

/**
 * The cron's entry point: every organisation, every resignation whose agreed
 * last working day has arrived and is not yet fully processed. Mirrors
 * `sweepOutboxes` in outbox-sweep.ts exactly — one tenant's exception, or one
 * resignation's exception, is recorded in `problems` and the rest still run,
 * because a sweep that stops at the first bad row would leave every leaver
 * after it un-swept for a day without saying so.
 */
export async function processDueExits(
  limitPerOrg = 50,
  deps: ExitSweepDeps = {}
): Promise<ExitSweepResult> {
  const { listOrgs, listDueForExit, ...processingDeps } = deps;
  const resolvedListOrgs = listOrgs ?? activeOrganisationIds;
  const resolvedListDue =
    listDueForExit ?? ((ctx: TenantContext, limit: number) => new NeonResignationRepository(ctx).listDueForExit(limit));

  const result: ExitSweepResult = {
    organisations: 0,
    orgs: [],
    totals: { due: 0, processed: 0, fullyProcessed: 0 },
    problems: [],
  };

  let orgIds: string[];
  try {
    orgIds = await resolvedListOrgs();
  } catch (error) {
    result.problems.push(`Could not list organisations: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
  result.organisations = orgIds.length;

  for (const orgId of orgIds) {
    const ctx: TenantContext = { orgId };
    let due: ResignationRecord[];
    try {
      due = await resolvedListDue(ctx, limitPerOrg);
    } catch (error) {
      result.problems.push(`${orgId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const results: ExitProcessingReport[] = [];
    for (const resignation of due) {
      try {
        const report = await runExitProcessing(ctx, resignation.id, processingDeps);
        results.push(report);
        result.totals.processed++;
        if (report.exitProcessed) result.totals.fullyProcessed++;
      } catch (error) {
        // One resignation failing to process — a template misconfigured for
        // this org, a transient database error — must not stop the rest of
        // this org's leavers, the same reason `dispatchOne` in
        // intern-documents.ts catches per document rather than per batch.
        result.problems.push(
          `${orgId}/${resignation.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    result.orgs.push({ orgId, due: due.length, results });
    result.totals.due += due.length;
  }

  return result;
}
