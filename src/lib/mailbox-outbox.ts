// ═══════════════════════════════════════════════════════════════
// MAILBOX CHANGES — queuing the move an intern's address needs
// ═══════════════════════════════════════════════════════════════
// Companion to `directory-group-outbox.ts`, and deliberately the same shape:
// a `queue*` that runs inside the caller's transaction, and a drain that the
// cron sweep calls. Same idiom, same retry columns, so somebody reading one
// already understands the other.
//
// ── What this carries, and why it is not done inline ──
// The mail server exposes no rename. A Maildir path is derived from the
// address, so moving `cvi-rahul@` to `rahul@` is three separate calls to a
// single small VM — create the new mailbox, delete the old one, then alias the
// old address to the new — and the alias endpoint refuses while the old
// address is still a real mailbox, so the order is forced. Any one of them can
// fail. Performing that during a conversion request would leave the employee
// half-moved with nothing recording where the sequence stopped.

import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employees, mailboxChangeOutbox } from "@/db/schema";
import { createAlias, createMailbox, deleteMailbox } from "@/lib/mail-admin-client";
import { planMailConversion } from "@/lib/mail-identity";

/** The transaction handle the caller is already inside. */
type TenantTx = {
  insert: (table: typeof mailboxChangeOutbox) => {
    values: (v: Record<string, unknown>) => {
      onConflictDoNothing: (c: { target: unknown }) => Promise<unknown>;
    };
  };
};

export type MailboxChangeReason = "intern_converted";

export interface QueueMailboxChangeInput {
  orgId: string;
  employeeId: string;
  /** The address as it stands on the employee record right now. */
  currentEmail: string | null | undefined;
  reason: MailboxChangeReason;
}

/**
 * Records that this employee's mailbox needs to move, if it does.
 *
 * Returns the planned move, or null when there is nothing to do — which is the
 * ordinary case, not a failure. Conversion does not know in advance how
 * somebody was hired: a person taken on permanently, or an intern whose
 * address was never issued on the company domain, simply has no move to make.
 *
 * Conflicts are ignored rather than raised. The conversion that calls this is
 * idempotent under a row lock, and a retried request must not fail merely
 * because it already queued the same move.
 */
export async function queueMailboxChange(
  tx: TenantTx,
  input: QueueMailboxChangeInput
): Promise<{ from: string; to: string } | null> {
  const plan = planMailConversion(String(input.currentEmail ?? ""));
  if (!plan) return null;

  try {
    await tx
      .insert(mailboxChangeOutbox)
      .values({
        orgId: input.orgId,
        employeeId: input.employeeId,
        fromAddress: plan.from,
        toAddress: plan.to,
        reason: input.reason,
        aliasOldAddress: plan.aliasOldAddress,
        status: "pending",
        nextAttemptAt: new Date(),
      })
      .onConflictDoNothing({
        target: [mailboxChangeOutbox.orgId, mailboxChangeOutbox.employeeId, mailboxChangeOutbox.toAddress],
      });
  } catch (error) {
    /*
     * Fail loudly, and say what to do about it.
     *
     * The alternative — catching this and carrying on — is the exact failure
     * this codebase keeps finding elsewhere: an operation that reports success
     * having silently skipped its work. Converting an intern without moving
     * their mailbox is precisely the bug this outbox exists to fix, so
     * completing the conversion while quietly dropping the mail change would
     * reintroduce it while looking fixed.
     *
     * Phrased like `convertToPermanent`'s own check on
     * `hrms.next_employee_code`, which reports the same class of problem the
     * same way.
     */
    if (isMissingRelation(error)) {
      throw new Error(
        "hrms.mailbox_change_outbox does not exist; migration 0043 has not been applied. " +
          "An intern cannot be converted until it is, because their mailbox would keep the " +
          '"cvi-" prefix with nothing recording that it needs to move. Applying it needs the ' +
          "schema owner's credentials — the application role has USAGE but not CREATE on hrms."
      );
    }
    throw error;
  }

  return { from: plan.from, to: plan.to };
}

/** Postgres 42P01 — the table is not there. */
function isMissingRelation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = (("cause" in error && error.cause) || error) as { code?: unknown };
  return candidate?.code === "42P01";
}

/**
 * The statuses a queued move passes through.
 *
 * Named rather than left as loose strings because the drain resumes from
 * whichever one it finds, and a typo would silently repeat a step that has
 * already happened — creating a mailbox twice is harmless, deleting one twice
 * is not.
 */
export const MAILBOX_CHANGE_STATUSES = [
  "pending",
  "created",
  "deleted",
  "aliased",
  "completed",
  "failed",
] as const;

export type MailboxChangeStatus = (typeof MAILBOX_CHANGE_STATUSES)[number];

/** Whether a queued move still has work outstanding. */
export function isOutstanding(status: string): boolean {
  return status !== "completed" && status !== "failed";
}

/**
 * The next status after a step succeeds.
 *
 * Written as a table rather than a chain of ifs because the whole point of
 * the status column is that a retry resumes rather than repeats: creating a
 * mailbox twice is harmless, deleting one twice is not, and aliasing an
 * address that is still a mailbox is refused outright.
 */
const NEXT_STATUS: Readonly<Record<string, MailboxChangeStatus>> = {
  pending: "created",
  created: "deleted",
  deleted: "aliased",
  aliased: "completed",
};

export interface MailboxDrainResult {
  attempted: number;
  completed: number;
  blocked: number;
  failed: number;
}

/**
 * Carries out every mailbox move that is due.
 *
 * The three steps, in the only order the mail server permits:
 *
 *   1. create the new address, so nothing is lost if the run stops here;
 *   2. delete the old mailbox, which frees the address for aliasing;
 *   3. alias the old address to the new, so mail sent by people who have not
 *      heard still arrives.
 *
 * `employees.work_email` moves only after step 1 has succeeded — not when the
 * change is queued. An HRMS record naming a mailbox that does not exist is
 * worse than one still naming the old address, because payroll, the directory
 * and colleagues all read it and would all be wrong.
 *
 * A `blocked` outcome (no mail server configured) is recorded and left
 * pending without counting as a failure, so a deployment that provisions
 * mailboxes some other way does not accumulate a backlog of errors.
 *
 * NOTE: stored mail is not moved. The Maildir belongs to the old address and
 * the server exposes no way to migrate it; the alias means new mail arrives,
 * and the old mailbox's contents remain on the box for an administrator to
 * move with `doveadm`. Stated here because a caller could otherwise assume
 * six months of correspondence followed the address, and it does not.
 */
export async function drainDueMailboxChanges(
  ctx: { orgId: string },
  deps: {
    withTenant: <T>(ctx: { orgId: string }, fn: (tx: DrainTx) => Promise<T>) => Promise<T>;
    createMailbox: (email: string) => Promise<StepOutcome>;
    deleteMailbox: (email: string) => Promise<StepOutcome>;
    createAlias: (alias: string, target: string) => Promise<StepOutcome>;
    now?: () => Date;
  },
  limit = 25
): Promise<MailboxDrainResult> {
  const now = deps.now ?? (() => new Date());
  const at = now();

  const due = await deps.withTenant(ctx, (tx) => tx.selectDueMailboxChanges(ctx.orgId, at, limit));

  let completed = 0;
  let blocked = 0;
  let failed = 0;

  for (const row of due) {
    let status = row.status as MailboxChangeStatus;
    let outcome: StepOutcome = { status: "done" };

    // Each iteration advances at most one step, and only from where this row
    // actually is, so a resumed row never repeats a completed step.
    while (isOutstanding(status) && outcome.status === "done") {
      outcome = await runStep(status, row, deps);
      if (outcome.status !== "done") break;

      const next = NEXT_STATUS[status];
      if (!next) break;
      status = next;

      // The address on the employee record moves as soon as the new mailbox
      // exists — that is the `pending → created` transition, not a later one.
      // Moving it any earlier names a mailbox that does not exist; moving it
      // later leaves the record pointing at an address that has just been
      // deleted, and both make the person unreachable to everybody who reads
      // that field.
      if (next === "created") {
        await deps.withTenant(ctx, (tx) => tx.setEmployeeWorkEmail(row.employeeId, row.toAddress));
      }
    }

    const attemptCount = row.attemptCount + 1;
    const finishedAt = now();

    await deps.withTenant(ctx, (tx) =>
      tx.recordMailboxChangeOutcome({
        id: row.id,
        status,
        attemptCount,
        lastAttemptAt: finishedAt,
        lastError: outcome.status === "done" ? null : (outcome.detail ?? "Unknown error"),
        completedAt: status === "completed" ? finishedAt : null,
        // A blocked row is retried on the ordinary schedule; a failed one
        // backs off. Neither is abandoned: an address half-moved is somebody
        // unreachable, and giving up on it silently is the one outcome that
        // must not happen.
        nextAttemptAt:
          status === "completed"
            ? null
            : new Date(finishedAt.getTime() + retryDelayMinutes(attemptCount) * 60_000),
      })
    );

    if (status === "completed") completed++;
    else if (outcome.status === "blocked") blocked++;
    else failed++;
  }

  return { attempted: due.length, completed, blocked, failed };
}

async function runStep(
  status: MailboxChangeStatus,
  row: MailboxChangeRow,
  deps: {
    createMailbox: (email: string) => Promise<StepOutcome>;
    deleteMailbox: (email: string) => Promise<StepOutcome>;
    createAlias: (alias: string, target: string) => Promise<StepOutcome>;
  }
): Promise<StepOutcome> {
  switch (status) {
    case "pending":
      return deps.createMailbox(row.toAddress);
    case "created":
      return deps.deleteMailbox(row.fromAddress);
    case "deleted":
      // Skipped rather than refused when the caller asked for no alias: an
      // address nobody will write to again does not need one.
      return row.aliasOldAddress
        ? deps.createAlias(row.fromAddress, row.toAddress)
        : { status: "done" };
    default:
      return { status: "done" };
  }
}

/**
 * Backoff between attempts, in minutes.
 *
 * The same shape `directory-group-outbox.ts` uses, so an operator reading one
 * outbox's retry pattern already understands the other's.
 */
function retryDelayMinutes(attemptCount: number): number {
  return Math.min(60, 2 ** Math.max(0, attemptCount - 1));
}

/**
 * The drain, bound to the real database and the real mail server.
 *
 * `drainDueMailboxChanges` takes its collaborators as arguments so the
 * sequencing can be proved without a Postgres and a mail VM; this is the one
 * place that supplies the real ones. It exists so the cron sweep has something
 * to call — a tested drain that nothing invokes is a queue that fills up and
 * never empties, and a mailbox move that never happens leaves a former intern
 * carrying "cvi-" indefinitely.
 */
export async function drainMailboxChanges(
  ctx: { orgId: string },
  limit = 25
): Promise<MailboxDrainResult> {
  return drainDueMailboxChanges(
    ctx,
    {
      withTenant: (tenantCtx, fn) =>
        withTenant(tenantCtx, (tx) => fn(tenantTx(tx as unknown as PgTx, tenantCtx.orgId))),
      createMailbox: (email) => createMailbox(email),
      deleteMailbox: (email) => deleteMailbox(email),
      createAlias: (alias, target) => createAlias(alias, target),
    },
    limit
  );
}

/** Minimal shape of the drizzle transaction handle the adapter below uses. */
type PgTx = {
  select: (fields?: Record<string, unknown>) => any;
  update: (table: unknown) => any;
};

/**
 * Translates the drain's four named operations into drizzle calls.
 *
 * The `org_id` predicate is repeated even though row-level security already
 * enforces it. RLS is the guarantee; the predicate is the statement of intent,
 * and it is what keeps this correct if the drain is ever run on a connection
 * that turns out not to be tenant-bound — which has happened in this codebase
 * more than once.
 */
function tenantTx(tx: PgTx, orgId: string): DrainTx {
  return {
    async selectDueMailboxChanges(scopedOrgId, now, limit) {
      const rows = await tx
        .select()
        .from(mailboxChangeOutbox)
        .where(
          and(
            eq(mailboxChangeOutbox.orgId, scopedOrgId),
            inArray(mailboxChangeOutbox.status, OUTSTANDING_STATUSES),
            or(
              isNull(mailboxChangeOutbox.nextAttemptAt),
              lte(mailboxChangeOutbox.nextAttemptAt, now)
            )
          )
        )
        .limit(limit);

      return rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        employeeId: String(row.employeeId),
        fromAddress: String(row.fromAddress),
        toAddress: String(row.toAddress),
        aliasOldAddress: row.aliasOldAddress !== false,
        status: String(row.status),
        attemptCount: Number(row.attemptCount ?? 0),
      }));
    },

    async setEmployeeWorkEmail(employeeId, email) {
      await tx
        .update(employees)
        .set({ workEmail: email, updatedAt: new Date() })
        .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId)));
    },

    async recordMailboxChangeOutcome(input) {
      await tx
        .update(mailboxChangeOutbox)
        .set({
          status: input.status,
          attemptCount: input.attemptCount,
          lastAttemptAt: input.lastAttemptAt,
          lastError: input.lastError,
          completedAt: input.completedAt,
          nextAttemptAt: input.nextAttemptAt,
          updatedAt: new Date(),
        })
        .where(and(eq(mailboxChangeOutbox.id, input.id), eq(mailboxChangeOutbox.orgId, orgId)));
    },
  };
}

/**
 * The statuses a drain picks up.
 *
 * Derived from the status list rather than written out again, so a status
 * added to `MAILBOX_CHANGE_STATUSES` cannot be forgotten here and silently
 * stall every row that reaches it.
 */
const OUTSTANDING_STATUSES = MAILBOX_CHANGE_STATUSES.filter((status) =>
  isOutstanding(status)
) as unknown as string[];

export interface StepOutcome {
  status: "done" | "blocked" | "failed";
  detail?: string;
}

export interface MailboxChangeRow {
  id: string;
  employeeId: string;
  fromAddress: string;
  toAddress: string;
  aliasOldAddress: boolean;
  status: string;
  attemptCount: number;
}

/** The database operations the drain needs, named so it can be tested without one. */
export interface DrainTx {  selectDueMailboxChanges: (orgId: string, now: Date, limit: number) => Promise<MailboxChangeRow[]>;
  setEmployeeWorkEmail: (employeeId: string, email: string) => Promise<void>;
  recordMailboxChangeOutcome: (input: {
    id: string;
    status: string;
    attemptCount: number;
    lastAttemptAt: Date;
    lastError: string | null;
    completedAt: Date | null;
    nextAttemptAt: Date | null;
  }) => Promise<void>;
}

