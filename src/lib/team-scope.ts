import { and, eq, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { employees, locations } from "@/db/schema/hrms";
import { DEFAULT_TIMEZONE } from "@/lib/date-keys";

/**
 * Who counts as somebody's team.
 *
 * Extracted because two screens now ask the question — who is away, and who is
 * in — and a manager shown five people on one and seven on the other would have
 * no way to tell which was wrong. The rule belongs in one place or it drifts.
 *
 * `ctx.userId` is the identity account and `employees.id` is the employee row;
 * they are different UUIDs joined by `employees.user_id`. Comparing them
 * directly matches nobody, which is what the pulse route used to do.
 */
export interface TeamAnchor {
  id: string;
  reportingToId: string | null;
  departmentId: string | null;
  /**
   * The zone the caller's working day is measured in.
   *
   * Carried because "today" is not a global fact. Attendance rows are stamped
   * with the work date in the employee's *location's* zone, so asking for the
   * UTC date returns yesterday's attendance for every Indian org between
   * midnight and 05:30 — which reads as the entire team failing to turn up.
   */
  timezone: string;
}

/** The caller's own employee row, or null when the account has no employee. */
export async function teamAnchor(
  tx: { select: (...args: never[]) => never } | any,
  userId: string
): Promise<TeamAnchor | null> {
  const [me] = await tx
    .select({
      id: employees.id,
      reportingToId: employees.reportingToId,
      departmentId: employees.departmentId,
      timezone: locations.timezone,
    })
    .from(employees)
    .leftJoin(locations, eq(locations.id, employees.locationId))
    .where(eq(employees.userId, userId))
    .limit(1);

  if (!me) return null;
  return { ...me, timezone: me.timezone ?? DEFAULT_TIMEZONE };
}

/**
 * The predicate selecting an active team around [me], including [me].
 *
 * Peers share a manager; reports report to me. Somebody with neither — a first
 * hire, or anyone HR has not put a reporting line on yet — falls back to their
 * department, because they do have colleagues and being told "no team yet"
 * while sitting next to four of them is plainly wrong.
 *
 * The department fallback applies *only* without a reporting line. Somebody who
 * has a manager gets their actual team, not everybody sharing a department,
 * which in a large one is hundreds of people and no longer answers the
 * question.
 */
export function teamPredicate(me: TeamAnchor): SQL | undefined {
  return and(
    eq(employees.status, "active"),
    or(
      eq(employees.reportingToId, me.id),
      me.reportingToId ? eq(employees.reportingToId, me.reportingToId) : undefined,
      me.reportingToId ? eq(employees.id, me.reportingToId) : undefined,
      !me.reportingToId && me.departmentId
        ? eq(employees.departmentId, me.departmentId)
        : undefined,
      eq(employees.id, me.id)
    )
  );
}
