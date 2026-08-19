// ═══════════════════════════════════════════════════════════════
// DIRECTORY GROUP JOIN — durable intent, best-effort delivery
// ═══════════════════════════════════════════════════════════════
//
// Groups live at the identity provider. Onboarding has to write to it, and a
// hire must not fail because auth.circuvent.com is unreachable — the same
// trade `paystub-sync-outbox.ts` makes, and this deliberately mirrors it
// rather than inventing a second shape for the same problem.
//
// The row is written inside the hire's transaction, so the intent is as
// durable as the employee. The HTTP call happens after it commits, because a
// network round trip inside a database transaction holds a connection open for
// as long as somebody else's server takes to answer.

import { and, eq, lte, or, isNull, sql } from "drizzle-orm";

import { withTenant, type TenantContext } from "@/db/client";
import { directoryGroupJoinOutbox } from "@/db/schema/hrms";
import { addGroupMember } from "@/lib/directory-sdk";
import { retryDelayMinutes } from "@/lib/onboarding-groups";

type TenantTx = Parameters<Parameters<typeof withTenant>[1]>[0];

export interface QueueGroupJoinInput {
  orgId: string;
  employeeId: string;
  memberEmail: string;
  groupAddresses: readonly string[];
}

/**
 * Records the intent to add somebody to each group, inside the caller's
 * transaction.
 *
 * Re-running onboarding reopens the same row rather than queuing a second
 * join: the unique index is on (org, employee, group), and a row that had
 * failed is set back to pending so the next sweep tries it again.
 */
export async function queueGroupJoins(tx: TenantTx, input: QueueGroupJoinInput): Promise<void> {
  if (input.groupAddresses.length === 0) return;
  const now = new Date();
  const memberEmail = input.memberEmail.trim().toLowerCase();

  for (const groupAddress of input.groupAddresses) {
    await tx
      .insert(directoryGroupJoinOutbox)
      .values({
        orgId: input.orgId,
        employeeId: input.employeeId,
        groupAddress: groupAddress.trim().toLowerCase(),
        memberEmail,
        status: "pending",
        nextAttemptAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          directoryGroupJoinOutbox.orgId,
          directoryGroupJoinOutbox.employeeId,
          directoryGroupJoinOutbox.groupAddress,
        ],
        set: {
          // A succeeded row stays succeeded — re-queuing a join that already
          // happened would re-attempt it forever on every edit to the
          // employee. `joinedAt` is what says it is done.
          status: sql`CASE WHEN ${directoryGroupJoinOutbox.joinedAt} IS NULL THEN 'pending' ELSE ${directoryGroupJoinOutbox.status} END`,
          memberEmail,
          nextAttemptAt: now,
          lastError: null,
          updatedAt: now,
        },
      });
  }
}

export interface DrainResult {
  attempted: number;
  joined: number;
  failed: number;
}

/**
 * Attempts every join that is due, and records what happened.
 *
 * Called immediately after a hire commits — so the common case is instant —
 * and again from a scheduled sweep, which is what actually recovers an outage.
 * A failure is recorded with a backoff rather than thrown: one unreachable
 * group must not stop the others, and the caller of a hire is not the person
 * who can fix the identity provider.
 */
export async function drainDueGroupJoins(ctx: TenantContext, limit = 50): Promise<DrainResult> {
  const now = new Date();

  const due = await withTenant(ctx, async (tx) =>
    tx
      .select()
      .from(directoryGroupJoinOutbox)
      .where(
        and(
          eq(directoryGroupJoinOutbox.orgId, ctx.orgId),
          eq(directoryGroupJoinOutbox.status, "pending"),
          or(
            isNull(directoryGroupJoinOutbox.nextAttemptAt),
            lte(directoryGroupJoinOutbox.nextAttemptAt, now)
          )
        )
      )
      .limit(limit)
  );

  let joined = 0;
  let failed = 0;

  for (const row of due) {
    const result = await addGroupMember(row.groupAddress, row.memberEmail);
    const attemptCount = row.attemptCount + 1;
    const at = new Date();

    await withTenant(ctx, async (tx) => {
      if (result.ok) {
        await tx
          .update(directoryGroupJoinOutbox)
          .set({
            status: "succeeded",
            joinedAt: at,
            lastAttemptAt: at,
            attemptCount,
            lastError: null,
            nextAttemptAt: null,
            updatedAt: at,
          })
          .where(eq(directoryGroupJoinOutbox.id, row.id));
      } else {
        await tx
          .update(directoryGroupJoinOutbox)
          .set({
            status: "pending",
            lastAttemptAt: at,
            attemptCount,
            lastError: result.error ?? "Unknown error",
            nextAttemptAt: new Date(at.getTime() + retryDelayMinutes(attemptCount) * 60_000),
            updatedAt: at,
          })
          .where(eq(directoryGroupJoinOutbox.id, row.id));
      }
    });

    if (result.ok) joined++;
    else failed++;
  }

  return { attempted: due.length, joined, failed };
}
