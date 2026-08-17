// ═══════════════════════════════════════════════════════════════
// BACKFILL — an employee record for every user who has none
// ═══════════════════════════════════════════════════════════════
//
// Registration created a user and no employee row. Every employee-facing
// feature resolves the caller to an employee — clocking in, leave, payslips,
// attendance — so the person who signed each company up could administer it
// and could not use it. `/api/attendance/clock` answered 404, which the mobile
// app rendered as an ordinary "Not clocked in" card and the web rendered as an
// empty state.
//
// Registration now creates the row, but that only helps organisations
// registered from here on. This repairs the ones that already exist.
//
// Idempotent: a user who already has an employee record is skipped, matched on
// `user_id` and on the id itself, so running it twice is harmless.
//
//   npm run db:backfill:employees            report only
//   npm run db:backfill:employees -- --apply write

import "./load-env";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";

const apply = process.argv.includes("--apply");

interface Orphan {
  user_id: string;
  org_id: string;
  org_name: string;
  email: string;
  display_name: string | null;
  employee_count: string;
}

async function main() {
  const orphans = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const r = await tx.execute(sql`
      select u.id::text     as user_id,
             u.org_id::text as org_id,
             o.name         as org_name,
             u.email,
             u.display_name,
             (select count(*)::text from hrms.employees e where e.org_id = u.org_id)
               as employee_count
        from identity.users u
        join identity.organizations o on o.id = u.org_id
       where u.deleted_at is null
         and o.deleted_at is null
         and not exists (
           select 1 from hrms.employees e
            where e.user_id = u.id or e.id = u.id
         )
       order by o.created_at, u.created_at
    `);
    return (r.rows ?? r) as unknown as Orphan[];
  });

  console.log(`\n${orphans.length} user(s) with no employee record\n`);

  if (orphans.length === 0) {
    console.log("Nothing to do.\n");
    return;
  }

  for (const orphan of orphans) {
    console.log(`  ${orphan.org_name.padEnd(28)} ${orphan.email}`);
  }

  if (!apply) {
    console.log(`\nReport only. Re-run with --apply to create these records.\n`);
    return;
  }

  console.log("");
  let created = 0;

  for (const orphan of orphans) {
    const name = (orphan.display_name ?? orphan.email.split("@")[0]).trim();
    const [first, ...rest] = name.split(/\s+/);

    try {
      await withTenant({ orgId: orphan.org_id, superuser: true }, async (tx) => {
        // Numbered from what the organisation already has, so a backfill into
        // a populated org does not collide with an existing code.
        const next = Number(orphan.employee_count) + 1;
        const code = `EMP-${String(next).padStart(4, "0")}`;

        await tx.execute(sql`
          insert into hrms.employees
            (id, org_id, user_id, employee_code, first_name, last_name,
             work_email, designation, join_date, status)
          values
            (${orphan.user_id}::uuid, ${orphan.org_id}::uuid, ${orphan.user_id}::uuid,
             ${code}, ${first || name}, ${rest.join(" ") || "-"},
             ${orphan.email}, 'Owner', current_date, 'active')
          on conflict do nothing
        `);
      });

      created++;
      console.log(`  created  ${orphan.email}`);
    } catch (error) {
      console.log(`  FAILED   ${orphan.email} — ${(error as Error).message.slice(0, 120)}`);
    }
  }

  console.log(`\n${created} of ${orphans.length} created.\n`);
}

main()
  .catch((e) => {
    console.log("ERROR:", (e as Error).message.slice(0, 400));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 250));
