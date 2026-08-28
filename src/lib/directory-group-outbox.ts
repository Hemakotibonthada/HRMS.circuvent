// ═══════════════════════════════════════════════════════════════
// DIRECTORY GROUP JOIN / LEAVE — durable intent, best-effort delivery
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
//
// ── Why the leave side is not "call removeGroupMember and move on" ──
// The join half of this file has an accidental safety net: if the HTTP call
// fails, the row sits as `pending` and the *next* unrelated edit to that
// employee (a title change, a department move, anything) happens to run
// through code that touches groups again. A leaver gets no such edit —
// nobody opens an ex-employee's record again once they are gone — so a
// failed removal with no independent re-drive would simply never happen.
// That is the exact bug this whole migration exists to close: an ex-employee
// silently still on `all@circuvent.com`, still reading internal mail, months
// after their last working day. `directory_group_leave_outbox` is a second
// outbox with the same retry shape as the join side, and it is `outbox-sweep`
// — not "the next time somebody edits this person" — that drains it.

import { and, eq, lte, or, isNull, sql } from "drizzle-orm";

import { withTenant, type TenantContext } from "@/db/client";
import { directoryGroupJoinOutbox, directoryGroupLeaveOutbox } from "@/db/schema/hrms";
import { addGroupMember, removeGroupMember } from "@/lib/directory-sdk";
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

export interface QueueGroupLeaveInput {
  orgId: string;
  employeeId: string;
  memberEmail: string;
  groupAddresses: readonly string[];
}

/**
 * Records the intent to remove somebody from each group, inside the exit
 * caller's transaction — mirrors `queueGroupJoins` exactly, including
 * reopening a row that previously failed rather than inserting a duplicate.
 *
 * Idempotent by design: exit processing calling this twice (a retried
 * request, or the cron safety net finding a resignation the manual
 * confirmation already handled) reopens the same pending-or-succeeded row
 * instead of piling up a second removal intent per group.
 */
export async function queueGroupLeaves(tx: TenantTx, input: QueueGroupLeaveInput): Promise<void> {
  if (input.groupAddresses.length === 0) return;
  const now = new Date();
  const memberEmail = input.memberEmail.trim().toLowerCase();

  for (const groupAddress of input.groupAddresses) {
    await tx
      .insert(directoryGroupLeaveOutbox)
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
          directoryGroupLeaveOutbox.orgId,
          directoryGroupLeaveOutbox.employeeId,
          directoryGroupLeaveOutbox.groupAddress,
        ],
        set: {
          // A succeeded row stays succeeded — re-queuing a removal that
          // already happened would re-attempt it forever on every re-run of
          // exit processing. `leftAt` is what says it is done.
          status: sql`CASE WHEN ${directoryGroupLeaveOutbox.leftAt} IS NULL THEN 'pending' ELSE ${directoryGroupLeaveOutbox.status} END`,
          memberEmail,
          nextAttemptAt: now,
          lastError: null,
          updatedAt: now,
        },
      });
  }
}

export interface LeaveDrainResult {
  attempted: number;
  left: number;
  failed: number;
}

/**
 * Attempts every group removal that is due, and records what happened.
 *
 * Called immediately after exit processing commits, and again from the
 * scheduled sweep — the sweep is the one that matters here, since it is the
 * only thing that ever looks at a leaver's outbox row again. A failure is
 * recorded with a backoff rather than thrown, same as the join side: one
 * unreachable group must not stop the others, and whoever confirmed the exit
 * is not the person who can fix the identity provider being down.
 */
export async function drainDueGroupLeaves(ctx: TenantContext, limit = 50): Promise<LeaveDrainResult> {
  const now = new Date();

  const due = await withTenant(ctx, async (tx) =>
    tx
      .select()
      .from(directoryGroupLeaveOutbox)
      .where(
        and(
          eq(directoryGroupLeaveOutbox.orgId, ctx.orgId),
          eq(directoryGroupLeaveOutbox.status, "pending"),
          or(
            isNull(directoryGroupLeaveOutbox.nextAttemptAt),
            lte(directoryGroupLeaveOutbox.nextAttemptAt, now)
          )
        )
      )
      .limit(limit)
  );

  let left = 0;
  let failed = 0;

  for (const row of due) {
    const result = await removeGroupMember(row.groupAddress, row.memberEmail);
    const attemptCount = row.attemptCount + 1;
    const at = new Date();

    await withTenant(ctx, async (tx) => {
      if (result.ok) {
        await tx
          .update(directoryGroupLeaveOutbox)
          .set({
            status: "succeeded",
            leftAt: at,
            lastAttemptAt: at,
            attemptCount,
            lastError: null,
            nextAttemptAt: null,
            updatedAt: at,
          })
          .where(eq(directoryGroupLeaveOutbox.id, row.id));
      } else {
        await tx
          .update(directoryGroupLeaveOutbox)
          .set({
            status: "pending",
            lastAttemptAt: at,
            attemptCount,
            lastError: result.error ?? "Unknown error",
            nextAttemptAt: new Date(at.getTime() + retryDelayMinutes(attemptCount) * 60_000),
            updatedAt: at,
          })
          .where(eq(directoryGroupLeaveOutbox.id, row.id));
      }
    });

    if (result.ok) left++;
    else failed++;
  }

  return { attempted: due.length, left, failed };
}

/**
 * Every group leave still outstanding for an employee — used to report what
 * could not be revoked rather than assuming a queued removal succeeded. Exit
 * processing calls this right after queuing, so a caller that needs to tell
 * HR "these groups are still pending" can do so in the same request, without
 * waiting for a sweep that may not run for hours.
 */
export async function outstandingGroupLeaves(
  ctx: TenantContext,
  employeeId: string
): Promise<Array<{ groupAddress: string; status: string; lastError: string | null }>> {
  const rows = await withTenant(ctx, async (tx) =>
    tx
      .select({
        groupAddress: directoryGroupLeaveOutbox.groupAddress,
        status: directoryGroupLeaveOutbox.status,
        lastError: directoryGroupLeaveOutbox.lastError,
      })
      .from(directoryGroupLeaveOutbox)
      .where(
        and(
          eq(directoryGroupLeaveOutbox.orgId, ctx.orgId),
          eq(directoryGroupLeaveOutbox.employeeId, employeeId)
        )
      )
  );
  return rows.filter((row) => row.status !== "succeeded");
}
