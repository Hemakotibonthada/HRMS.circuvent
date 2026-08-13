// ═══════════════════════════════════════════════════════════════
// REFERRAL INVITE REPOSITORY
// ═══════════════════════════════════════════════════════════════
// One thing here is unlike every other repository in this codebase, and it is
// worth saying out loud rather than leaving to be discovered.
//
// `resolveByToken` runs with `superuser: true`, which bypasses row-level
// security. That is unavoidable: the caller is an anonymous member of the
// public holding a link, and there is no way to know which tenant they belong
// to until the token has been resolved. Something has to make that first
// lookup without a tenant.
//
// So it is kept to the smallest possible surface:
//
//   - one statement, parameterised, matching on an exact hash;
//   - it returns ids and status only, never candidate data;
//   - every subsequent operation runs under `withTenant` with the org it
//     resolved, so the rest of the flow is as constrained as any other.
//
// The alternative — a policy allowing anonymous reads of the invites table —
// would be a permanently open door rather than a single narrow one.

import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { referralInvites, referrals } from "@/db/schema/talent";
import { RepositoryError } from "./types";
import {
  hashInviteToken,
  inviteState,
  mintInvite,
  type CandidateSubmission,
  type InviteState,
} from "@/lib/referral-invite";

export interface ResolvedInvite {
  inviteId: string;
  orgId: string;
  referralId: string;
  state: InviteState;
}

/** What the public page may show. Deliberately thin — see the route. */
export interface InvitePrefill {
  candidateName: string;
  candidateEmail: string;
  positionTitle: string;
  organizationName: string;
  referrerFirstName?: string;
  state: InviteState;
}

/**
 * Finds an invite by its token, without a tenant context.
 *
 * The only RLS-bypassing read in the application. See the header.
 */
export async function resolveByToken(token: string): Promise<ResolvedInvite | null> {
  const tokenHash = hashInviteToken(token);

  return withTenant({ orgId: "", superuser: true }, async (tx) => {
    const rows = await tx
      .select({
        id: referralInvites.id,
        orgId: referralInvites.orgId,
        referralId: referralInvites.referralId,
        expiresAt: referralInvites.expiresAt,
        submittedAt: referralInvites.submittedAt,
        revokedAt: referralInvites.revokedAt,
      })
      .from(referralInvites)
      .where(eq(referralInvites.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      inviteId: row.id,
      orgId: row.orgId,
      referralId: row.referralId,
      state: inviteState({
        tokenHash,
        expiresAt: row.expiresAt.toISOString(),
        submittedAt: row.submittedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
      }),
    };
  });
}

export class NeonReferralInviteRepository {
  constructor(private readonly ctx: TenantContext) {}

  /**
   * Creates an invite, replacing any live one.
   *
   * Revoking first is not tidiness: a partial unique index rejects a second
   * live invite for the same referral, and two usable links would mean the
   * second submission silently replaced the first with no way for the
   * candidate to know which the company read.
   */
  async create(
    referralId: string,
    sentToEmail: string,
    reason = "Replaced by a newer invitation"
  ): Promise<{ inviteId: string; token: string; expiresAt: string }> {
    const minted = mintInvite();

    return withTenant(this.ctx, async (tx) => {
      const referral = await tx
        .select({ id: referrals.id })
        .from(referrals)
        .where(eq(referrals.id, referralId))
        .limit(1);

      if (!referral[0]) throw new RepositoryError("Referral not found", 404);

      await tx
        .update(referralInvites)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(
          and(
            eq(referralInvites.referralId, referralId),
            isNull(referralInvites.submittedAt),
            isNull(referralInvites.revokedAt)
          )
        );

      const inserted = await tx
        .insert(referralInvites)
        .values({
          orgId: this.ctx.orgId,
          referralId,
          tokenHash: minted.tokenHash,
          sentToEmail,
          expiresAt: new Date(minted.expiresAt),
        })
        .returning({ id: referralInvites.id });

      const inviteId = inserted[0]?.id;
      if (!inviteId) throw new RepositoryError("Could not create the invitation", 500);

      // The plaintext token is returned to the caller once, to be emailed, and
      // is never persisted. If the send fails there is nothing to recover — a
      // new invite is minted instead, which is the correct outcome anyway.
      return { inviteId, token: minted.token, expiresAt: minted.expiresAt };
    });
  }

  /** Records the outcome of the send, so a bounce explains a stalled referral. */
  async recordDelivery(inviteId: string, error?: string): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      await tx
        .update(referralInvites)
        .set({ sentAt: new Date(), deliveryError: error ?? null })
        .where(eq(referralInvites.id, inviteId));
    });
  }

  /** The little the public page is allowed to know. */
  async prefill(inviteId: string): Promise<InvitePrefill | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx.execute<{
        candidate_name: string;
        candidate_email: string;
        position_title: string;
        organization_name: string;
        referrer_name: string | null;
        expires_at: Date;
        submitted_at: Date | null;
        revoked_at: Date | null;
      }>(sql`
        SELECT r.candidate_name,
               r.candidate_email,
               r.position_title,
               o.name        AS organization_name,
               e.first_name  AS referrer_name,
               i.expires_at,
               i.submitted_at,
               i.revoked_at
          FROM hrms.referral_invites i
          JOIN hrms.referrals r ON r.id = i.referral_id
          JOIN identity.organizations o ON o.id = i.org_id
          LEFT JOIN hrms.employees e ON e.id = r.referrer_id
         WHERE i.id = ${inviteId}
         LIMIT 1
      `);

      const row = rows.rows[0];
      if (!row) return null;

      return {
        candidateName: row.candidate_name,
        candidateEmail: row.candidate_email,
        positionTitle: row.position_title,
        organizationName: row.organization_name,
        referrerFirstName: row.referrer_name ?? undefined,
        state: inviteState({
          tokenHash: "",
          expiresAt: new Date(row.expires_at).toISOString(),
          submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
          revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
        }),
      };
    });
  }

  /**
   * Records the candidate's own account of themselves.
   *
   * The whole thing is one transaction. A submission stored without the
   * referral being updated, or the reverse, leaves a recruiter looking at
   * stale details next to a "completed" invite and no way to tell which is
   * true.
   */
  async submit(
    inviteId: string,
    submission: CandidateSubmission,
    fromIp?: string
  ): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      const now = new Date();

      // Guarded on the current state as well as the id: two submissions racing
      // would otherwise both pass an earlier read and the second would be
      // rejected only by the trigger, as a 500 rather than a clear message.
      const updated = await tx
        .update(referralInvites)
        .set({
          submittedAt: now,
          consentGivenAt: now,
          submission,
          submittedFromIp: fromIp ?? null,
        })
        .where(
          and(
            eq(referralInvites.id, inviteId),
            isNull(referralInvites.submittedAt),
            isNull(referralInvites.revokedAt)
          )
        )
        .returning({ referralId: referralInvites.referralId });

      const row = updated[0];
      if (!row) {
        throw new RepositoryError("This link has already been used or is no longer active", 409);
      }

      // The candidate's own details take precedence over what the referrer
      // typed on their behalf: the referrer was guessing at a phone number and
      // a job title, and this person is not.
      await tx
        .update(referrals)
        .set({
          candidateName: submission.fullName,
          candidateEmail: submission.email,
          candidatePhone: submission.phone ?? null,
          resumeUrl: submission.resumeUrl ?? null,
          updatedAt: now,
        })
        .where(eq(referrals.id, row.referralId));
    });
  }

  async revoke(inviteId: string, reason: string): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      await tx
        .update(referralInvites)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(and(eq(referralInvites.id, inviteId), isNull(referralInvites.submittedAt)));
    });
  }
}
