// ═══════════════════════════════════════════════════════════════
// Who is the caller, as an employee?
// ═══════════════════════════════════════════════════════════════
//
// There are two identifiers for a person here and they are not the same thing:
//
//   identity.users.id   the account that signs in     — `ctx.userId`
//   hrms.employees.id   the employment record         — what every HR table
//                                                       keys its rows by
//
// They are joined by `hrms.employees.user_id`. An employee can exist with no
// account (a new hire before their first login, a contractor who never gets
// one), and an account can exist with no employee record (the billing and
// abuse mailboxes in the live tenant are exactly this).
//
// Much of the API used `ctx.userId` directly as an employee id. That worked
// only by accident: `scripts/backfill-owner-employees.ts` inserts the owner's
// employee row with `id` *forced* to the user's id, so for those two accounts
// the two identifiers happen to coincide. Every employee hired through the
// application's own `POST /api/employees` gets a fresh `employees.id` and no
// `user_id` at all, and for them the comparison matched nothing — clocking in
// answered "Employee <uuid> not found", and leave, payslips, expenses, tax
// declarations and the rest quietly returned an empty list belonging to
// nobody.
//
// Resolving through `user_id` is correct for both: the backfilled rows set
// `user_id` as well as `id`. The `employees.id` arm of the lookup is kept as a
// fallback for any historic row where `user_id` was never populated, so this
// change cannot take away access that used to work.

import { and, eq, isNull, or } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import { users } from "@/db/schema/identity";

/**
 * The minimum needed to resolve a person: which tenant, and which account.
 * Narrower than `ApiContext` so that `/api/auth/me`, which works from token
 * claims alone and never builds a full context, can use this too.
 */
export interface EmployeeLookupContext {
  orgId: string;
  userId: string;
}

/** Raised when the caller has an account but no employment record. */
export class NoEmployeeRecordError extends Error {
  readonly status = 404;
  constructor(userId: string) {
    super(
      "Your account is not linked to an employee record, so this action has " +
        "nothing to act on. Ask your HR administrator to link them."
    );
    this.name = "NoEmployeeRecordError";
    this.userId = userId;
  }
  readonly userId: string;
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * The caller's employee id, or null when the account has no employee record.
 *
 * Pass `tx` when already inside a transaction — opening a second one for a
 * single lookup doubles the round trips on every request that needs it.
 */
export async function currentEmployeeId(
  ctx: EmployeeLookupContext,
  tx?: Tx
): Promise<string | null> {
  const run = async (t: Tx) => {
    const rows = await t
      .select({ id: employees.id, userId: employees.userId })
      .from(employees)
      .where(
        and(
          or(eq(employees.userId, ctx.userId), eq(employees.id, ctx.userId)),
          isNull(employees.deletedAt)
        )
      )
      .limit(2);

    if (rows.length === 0) return null;
    // Prefer the explicit link. Both arms resolving to different rows would
    // mean an id collision across two random UUIDs, but preferring `user_id`
    // costs nothing and makes the intent unambiguous.
    return (rows.find((r) => r.userId === ctx.userId) ?? rows[0]).id;
  };

  return tx ? run(tx) : withTenant(ctx, run);
}

/** As {@link currentEmployeeId}, but refuses rather than returning null. */
export async function requireCurrentEmployeeId(
  ctx: EmployeeLookupContext,
  tx?: Tx
): Promise<string> {
  const id = await currentEmployeeId(ctx, tx);
  if (!id) throw new NoEmployeeRecordError(ctx.userId);
  return id;
}

/**
 * The caller's employee id, the code a human would quote, and their photograph.
 *
 * The identity card and any screen that says "this is you" want the code, not
 * a UUID: nobody reads a UUID out to payroll or to the person on the gate.
 *
 * The photograph falls back from the employment record to the account. The
 * suite's other apps write the account's avatar, and somebody who has set a
 * picture once should not have to set it again here to be recognised.
 */
export async function currentEmployeeIdentity(
  ctx: EmployeeLookupContext,
  tx?: Tx
): Promise<{ id: string; employeeCode: string; avatarUrl: string | null } | null> {
  const run = async (t: Tx) => {
    const rows = await t
      .select({
        id: employees.id,
        userId: employees.userId,
        employeeCode: employees.employeeCode,
        avatarUrl: employees.avatarUrl,
      })
      .from(employees)
      .where(
        and(
          or(eq(employees.userId, ctx.userId), eq(employees.id, ctx.userId)),
          isNull(employees.deletedAt)
        )
      )
      .limit(2);

    if (rows.length === 0) return null;
    const row = rows.find((r) => r.userId === ctx.userId) ?? rows[0];

    let avatarUrl = row.avatarUrl;
    if (!avatarUrl) {
      const [account] = await t
        .select({ avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1);
      avatarUrl = account?.avatarUrl ?? null;
    }

    return { id: row.id, employeeCode: row.employeeCode, avatarUrl };
  };

  return tx ? run(tx) : withTenant(ctx, run);
}
