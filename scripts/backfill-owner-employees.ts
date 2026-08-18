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
import { DEFAULT_LEAVE_POLICIES, provisionFor, type LeavePolicy } from "../src/lib/leave-provisioning";
import { DEFAULT_REFERRAL_POLICIES } from "../src/lib/referral-rules";

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

  await provisionMissingBalances();
}

/**
 * Gives every employee who has none the leave balances their org's policy says
 * they should have.
 *
 * Creating the employee row was only half the repair. Leave is refused for
 * want of a balance, not for want of an employee, so a backfilled owner could
 * clock in and still could not apply for a day off — "This request was not
 * submitted", with the real reason two layers down.
 *
 * Idempotent, and it never touches an employee who already has balances: a
 * second run must not top somebody's leave back up after they have taken it.
 */
async function provisionMissingBalances(): Promise<void> {
  const year = new Date().getFullYear();

  const missing = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const r = await tx.execute(sql`
      select e.id::text     as employee_id,
             e.org_id::text as org_id,
             e.work_email,
             e.join_date::text as join_date
        from hrms.employees e
       where not exists (
         select 1 from hrms.leave_balances b
          where b.employee_id = e.id and b.year = ${year}
       )
       order by e.created_at
    `);
    return (r.rows ?? r) as unknown as {
      employee_id: string;
      org_id: string;
      work_email: string;
      join_date: string;
    }[];
  });

  console.log(`${missing.length} employee(s) with no ${year} leave balance\n`);
  if (missing.length === 0) return;

  for (const employee of missing) {
    console.log(`  ${employee.work_email}`);
  }

  if (!apply) {
    console.log(`\nReport only. Re-run with --apply to provision these.\n`);
    return;
  }

  console.log("");
  let provisioned = 0;

  for (const employee of missing) {
    try {
      await withTenant({ orgId: employee.org_id, superuser: true }, async (tx) => {
        const configured = await tx.execute(sql`
          select leave_type, label, annual_quota_days, is_pro_rata, carry_forward_limit_days
            from hrms.leave_policies
           where org_id = ${employee.org_id}::uuid and is_active = true
        `);

        const rows = (configured.rows ?? configured) as unknown as Record<string, string>[];

        const policies: LeavePolicy[] =
          rows.length > 0
            ? rows.map((p) => ({
                leaveType: p.leave_type as LeavePolicy["leaveType"],
                label: p.label,
                annualQuotaDays: Number(p.annual_quota_days),
                isProRata: String(p.is_pro_rata) === "true",
                carryForwardLimitDays: Number(p.carry_forward_limit_days ?? 0),
              }))
            : [...DEFAULT_LEAVE_POLICIES];

        const balances = provisionFor({
          policies,
          joinDate: employee.join_date,
          year,
        });

        for (const balance of balances) {
          await tx.execute(sql`
            insert into hrms.leave_balances
              (org_id, employee_id, year, leave_type, opening_days, accrued_days, carry_forward_days)
            values
              (${employee.org_id}::uuid, ${employee.employee_id}::uuid, ${balance.year},
               ${balance.leaveType}, ${String(balance.openingDays)},
               ${String(balance.accruedDays)}, ${String(balance.carryForwardDays)})
            on conflict do nothing
          `);
        }
      });

      provisioned++;
      console.log(`  provisioned  ${employee.work_email}`);
    } catch (error) {
      console.log(`  FAILED       ${employee.work_email} — ${(error as Error).message.slice(0, 110)}`);
    }
  }

  console.log(`\n${provisioned} of ${missing.length} provisioned.\n`);

  await provisionMissingReferralPolicies();
}

/**
 * Gives every organisation that has none a starting set of referral policies.
 *
 * The referral module is complete — a tested state machine, instalment
 * scheduling, duplicate detection, payout eligibility — and every organisation
 * had zero policy rows, so there was no bonus amount for any of it to work
 * from. Referrals could be submitted and none could ever be paid.
 *
 * Never touches an organisation that already has one: these are defaults to
 * start from, and overwriting a tenant's own amounts would change what people
 * are owed.
 */
async function provisionMissingReferralPolicies(): Promise<void> {
  const orgs = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const r = await tx.execute(sql`
      select o.id::text as org_id, o.name
        from identity.organizations o
       where o.deleted_at is null
         and not exists (
           select 1 from hrms.referral_policies p where p.org_id = o.id
         )
       order by o.created_at
    `);
    return (r.rows ?? r) as unknown as { org_id: string; name: string }[];
  });

  console.log(`${orgs.length} organisation(s) with no referral policy\n`);
  if (orgs.length === 0) return;

  for (const org of orgs) console.log(`  ${org.name}`);

  if (!apply) {
    console.log(`\nReport only. Re-run with --apply to create these.\n`);
    return;
  }

  console.log("");
  let created = 0;

  for (const org of orgs) {
    try {
      await withTenant({ orgId: org.org_id, superuser: true }, async (tx) => {
        for (const policy of DEFAULT_REFERRAL_POLICIES) {
          await tx.execute(sql`
            insert into hrms.referral_policies
              (org_id, name, seniority, bonus_amount_minor, qualifying_period_days, instalments)
            values
              (${org.org_id}::uuid, ${policy.name}, ${policy.seniority},
               ${policy.bonusAmountMinor.toString()}::bigint, ${policy.qualifyingPeriodDays},
               ${JSON.stringify(policy.instalments)}::jsonb)
            on conflict do nothing
          `);
        }
      });
      created++;
      console.log(`  created  ${org.name}`);
    } catch (error) {
      console.log(`  FAILED   ${org.name} — ${(error as Error).message.slice(0, 110)}`);
    }
  }

  console.log(`\n${created} of ${orgs.length} organisations given referral policies.\n`);
}

main()
  .catch((e) => {
    console.log("ERROR:", (e as Error).message.slice(0, 400));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 250));
