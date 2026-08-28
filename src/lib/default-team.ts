// ═══════════════════════════════════════════════════════════════
// THE TEAM EVERYBODY IS IN
// ═══════════════════════════════════════════════════════════════
//
// An employee could be created with no department, and most were. That is not
// a cosmetic gap: "who is away today" and "whose birthday is it" are answered
// by looking at the people around somebody, and a person attached to nothing
// is around nobody. They opened the Team tab and read "No team yet", which is
// true and useless — they plainly do have colleagues.
//
// So every hire lands somewhere. A named department if HR chose one, and this
// one if they did not, rather than null. The organisation is itself a team
// before it is anything else, and being in it is the honest default.
//
// It is a real department rather than a magic null-means-everyone rule,
// because everything else — the directory, the org chart, reporting, payroll
// cost centres — already understands departments, and a special case that only
// one feature knows about is a special case the next feature will get wrong.

import { and, eq } from "drizzle-orm";
import type { withTenant } from "@/db/client";
import { departments } from "@/db/schema/hrms";

/** A Drizzle transaction, as the repositories name it. */
type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** Code for the fallback department. Stable, so it can be found again. */
export const DEFAULT_TEAM_CODE = "GENERAL";

/** What it is called. Deliberately not "Unassigned" — see below. */
export const DEFAULT_TEAM_NAME = "General";

/**
 * The organisation's default team, created on first use.
 *
 * Named "General" and not "Unassigned", "Default" or "None". Whatever goes
 * here is what somebody sees next to their own name on their profile and in
 * the staff directory, and being told you are Unassigned on your first day is
 * a small unkindness the product does not need to commit. It is also what
 * appears on letters generated from the employee record.
 *
 * Idempotent: several hires landing at once must not create several. The
 * unique index on (org_id, code) is the real guarantee — this only avoids
 * relying on the error path for the ordinary case.
 */
export async function defaultTeamId(tx: Tx, orgId: string): Promise<string> {
  const find = async () =>
    (
      await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.orgId, orgId), eq(departments.code, DEFAULT_TEAM_CODE)))
        .limit(1)
    )[0];

  const existing = await find();
  if (existing) return existing.id;

  const [created] = await tx
    .insert(departments)
    .values({
      orgId,
      name: DEFAULT_TEAM_NAME,
      code: DEFAULT_TEAM_CODE,
      description:
        "Everyone starts here. Move people into a named team as the " +
        "organisation grows — nobody has to be moved out of this one first.",
    })
    .onConflictDoNothing()
    .returning({ id: departments.id });

  if (created) return created.id;

  // Lost the race. The other transaction's row is the one to use.
  const raced = await find();
  if (!raced) throw new Error("Could not find or create the default team");
  return raced.id;
}
