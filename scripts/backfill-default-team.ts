/**
 * Puts every employee who has no department into the organisation's default
 * team.
 *
 *   npx tsx scripts/backfill-default-team.ts          # report only
 *   npx tsx scripts/backfill-default-team.ts --apply
 *
 * New hires land in a team automatically. Everybody hired before that was
 * added is still attached to nothing, and a person attached to nothing is
 * around nobody: "who is away today" and "whose birthday is it" are answered by
 * looking at the people around somebody, so they open the Team tab and are told
 * they have no colleagues while sitting next to four of them.
 *
 * Only rows with a genuinely absent department are touched. Somebody HR
 * deliberately put in Engineering stays in Engineering — this is a floor, not a
 * reassignment.
 *
 * Dry by default, like every other script here that changes people's records.
 */
import "./load-env";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { employees } from "../src/db/schema/hrms";
import { organizations } from "../src/db/schema/identity";
import { defaultTeamId, DEFAULT_TEAM_NAME } from "../src/lib/default-team";

const apply = process.argv.includes("--apply");

/** Any organisation, only to open a connection for the cross-tenant read. */
const SWEEP_ORG = "00000000-0000-0000-0000-000000000000";

async function main() {
  const orgs = await withTenant({ orgId: SWEEP_ORG, superuser: true }, async (tx) =>
    tx.select({ id: organizations.id, name: organizations.name }).from(organizations)
  );

  let total = 0;

  for (const org of orgs) {
    const orphans = await withTenant({ orgId: org.id, superuser: true }, async (tx) =>
      tx
        .select({ id: employees.id, code: employees.employeeCode })
        .from(employees)
        .where(and(isNull(employees.departmentId), isNull(employees.deletedAt)))
    );

    if (orphans.length === 0) continue;

    console.log(`${org.name}: ${orphans.length} without a team`);
    for (const person of orphans) console.log(`   ${person.code}`);
    total += orphans.length;

    if (!apply) continue;

    await withTenant({ orgId: org.id, superuser: true }, async (tx) => {
      const teamId = await defaultTeamId(tx, org.id);
      for (const person of orphans) {
        await tx
          .update(employees)
          .set({ departmentId: teamId, updatedAt: new Date() })
          .where(eq(employees.id, person.id));
      }
    });
    console.log(`   moved into ${DEFAULT_TEAM_NAME}`);
  }

  if (total === 0) {
    console.log("Everybody already has a team.");
    return;
  }

  console.log(
    apply
      ? `\n${total} employee(s) moved into their organisation's default team.`
      : `\n${total} employee(s) have no team. Re-run with --apply to move them.`
  );
}

main().catch((e) => {
  console.error("BACKFILL FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
