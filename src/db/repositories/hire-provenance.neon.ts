// ═══════════════════════════════════════════════════════════════
// HIRE PROVENANCE — reading what the database knows about a hire
// ═══════════════════════════════════════════════════════════════
// The rule lives in `lib/hire-provenance.ts`, which is pure and testable. This
// is the query that feeds it, kept apart for the same reason every other rule
// module in this codebase is: a rule that can only be exercised against a live
// database is a rule nobody tests.
//
// Reads the candidate's most advanced offer and whether they submitted their
// joining form, both scoped to the caller's organisation by the same tenant
// wrapper every other repository read uses — a candidate id from another
// tenant finds nothing rather than leaking that it exists.

import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { candidates, offers } from "@/db/schema";
import type { HireProvenance } from "@/lib/hire-provenance";

/**
 * Offer statuses in the order they represent progress, most advanced last.
 *
 * A candidate can hold several offers — a revised one supersedes an earlier
 * one, and `hrms.offers` models that with `supersedes_offer_id` — so "does
 * this person have an accepted offer" is a question about the best of them,
 * not the newest. Sorting by creation date alone would let a withdrawn
 * revision hide an acceptance.
 */
const OFFER_PROGRESS: readonly string[] = [
  "withdrawn",
  "expired",
  "declined",
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
];

function mostAdvanced(statuses: readonly string[]): string | null {
  let best: string | null = null;
  let bestRank = -1;
  for (const status of statuses) {
    const rank = OFFER_PROGRESS.indexOf(status);
    if (rank > bestRank) {
      bestRank = rank;
      best = status;
    }
  }
  return best;
}

/**
 * Everything the provenance rule needs about a proposed hire.
 *
 * A candidate id that does not exist in this organisation yields the same
 * shape as one with no offers — no offer, no submitted form — so the rule
 * refuses it without this function having to distinguish "wrong tenant" from
 * "no such candidate". Telling a caller which of those it was would confirm
 * the existence of another tenant's record.
 */
export async function loadHireProvenance(
  ctx: TenantContext,
  input: { candidateId?: string | null; applicationId?: string | null }
): Promise<HireProvenance> {
  const candidateId = input.candidateId?.trim() || null;
  const applicationId = input.applicationId?.trim() || null;

  if (!candidateId) {
    return { candidateId: null, applicationId, offerStatus: null, registrationSubmittedAt: null };
  }

  return withTenant(ctx, async (tx) => {
    const [candidate] = await tx
      .select({ id: candidates.id })
      .from(candidates)
      .where(and(eq(candidates.orgId, ctx.orgId), eq(candidates.id, candidateId)))
      .limit(1);

    if (!candidate) {
      return { candidateId, applicationId, offerStatus: null, registrationSubmittedAt: null };
    }

    const offerRows = await tx
      .select({ status: offers.status })
      .from(offers)
      .where(and(eq(offers.orgId, ctx.orgId), eq(offers.candidateId, candidateId)))
      .orderBy(desc(offers.createdAt));

    // `candidate_registration` is written by ATS with raw SQL and is not in
    // this app's Drizzle schema, so it is read the same way. Scoped through
    // the candidate, which the tenant check above has already established
    // belongs to this organisation.
    //
    // The tagged template is not decoration: `execute` takes an SQL object and
    // calls `getSQL()` on it, so the `{ sql, params }` object this used to pass
    // threw "query.getSQL is not a function" on every call. Because this runs
    // on the create-employee path, that meant every attempt to add an employee
    // failed with a 500 — and it typechecked, because the object was cast
    // through `any` to get past the signature that was telling it not to.
    const registration = await tx.execute(
      sql`SELECT submitted_at FROM hrms.candidate_registration
           WHERE candidate_id = ${candidateId}::uuid LIMIT 1`
    );

    const submittedAt =
      (registration as unknown as { rows?: Array<{ submitted_at?: string | Date | null }> }).rows?.[0]
        ?.submitted_at ?? null;

    return {
      candidateId,
      applicationId,
      offerStatus: mostAdvanced(offerRows.map((o) => String(o.status))),
      registrationSubmittedAt: submittedAt,
    };
  });
}

export { OFFER_PROGRESS, mostAdvanced };
