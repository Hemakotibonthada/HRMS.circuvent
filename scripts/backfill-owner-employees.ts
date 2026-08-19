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
import {
  allHolidays,
  FIXED_HOLIDAYS,
  HOLIDAY_ALIASES,
  MOVABLE_HOLIDAYS,
  SUPPORTED_YEARS,
} from "../src/lib/ap-holidays";

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
    console.log("No missing employee records.\n");
    // Each repair is independent, so an org that needs none of the first still
    // needs the rest checked. Returning here made the whole script a no-op the
    // moment the first step had nothing to do.
    await provisionMissingBalances();
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
  if (missing.length === 0) {
    await provisionMissingReferralPolicies();
    return;
  }

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
  if (orgs.length === 0) {
    await provisionMissingHolidays();
    return;
  }

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

  await provisionMissingHolidays();
}

/**
 * Gives every organisation the fixed-date Andhra Pradesh holidays for 2026 to
 * 2036.
 *
 * Only the dates that are certain: the national gazetted days, the state's own
 * commemorations, and the three-day Sankranti block. Sankranti is solar — it
 * tracks the sun entering Makara and holds to mid-January — which is why it can
 * be written here when Ugadi and Deepavali cannot. The lunisolar and Islamic
 * festivals are not written, because their dates are not knowable here and a
 * wrong holiday is acted on by attendance and payroll — somebody marked absent
 * on a day the office was shut.
 *
 * Idempotent on (org, date, name), so re-running does not duplicate a year and
 * a tenant's own edits to a holiday it already has are left alone.
 */
async function provisionMissingHolidays(): Promise<void> {
  const holidays = allHolidays();

  const orgs = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const r = await tx.execute(sql`
      select o.id::text as org_id, o.name,
             (select count(*)::text from hrms.holidays h
               where h.org_id = o.id and h.year between 2026 and 2036) as existing
        from identity.organizations o
       where o.deleted_at is null
       order by o.created_at
    `);
    return (r.rows ?? r) as unknown as { org_id: string; name: string; existing: string }[];
  });

  const needing = orgs.filter((o) => Number(o.existing) < holidays.length);

  console.log(`${needing.length} organisation(s) missing 2026-2036 holidays\n`);
  if (needing.length === 0) {
    await refreshHolidayDescriptions();
    return;
  }

  for (const org of needing) {
    console.log(`  ${org.name.padEnd(28)} has ${org.existing} of ${holidays.length}`);
  }

  if (!apply) {
    console.log(`\nReport only. Re-run with --apply to create these.\n`);
    await refreshHolidayDescriptions();
    return;
  }

  console.log("");
  let written = 0;

  for (const org of needing) {
    try {
      await withTenant({ orgId: org.org_id, superuser: true }, async (tx) => {
        for (const holiday of holidays) {
          await tx.execute(sql`
            insert into hrms.holidays
              (org_id, name, holiday_date, year, is_optional, description)
            select ${org.org_id}::uuid, ${holiday.name}, ${holiday.date}::date,
                   ${holiday.year}, ${holiday.restricted}, ${holiday.description}
             where not exists (
               select 1 from hrms.holidays h
                where h.org_id = ${org.org_id}::uuid
                  and h.holiday_date = ${holiday.date}::date
                  and h.name = ${holiday.name}
             )
          `);
        }
      });
      written++;
      console.log(`  seeded  ${org.name}`);
    } catch (error) {
      console.log(`  FAILED  ${org.name} — ${(error as Error).message.slice(0, 110)}`);
    }
  }

  console.log(`\n${written} of ${needing.length} organisations given holidays.`);
  console.log(
    `${MOVABLE_HOLIDAYS.length} festival dates per year still have to come from a ` +
      `Telugu panchangam — they are named in src/lib/ap-holidays.ts.\n`
  );

  await refreshHolidayDescriptions();
}

/**
 * Rewrites the description and optional flag of holidays seeded before the
 * calendar was scoped to Andhra Pradesh, and removes days filed twice under two
 * names.
 *
 * The earlier national set used the same names on the same dates, so none of
 * those rows are wrong and none are deleted for their wording — but three of
 * them read "nationally" where the state's own wording belongs, and Ambedkar
 * Jayanti was carried as optional when Andhra Pradesh gazettes it. The two are
 * checked separately because a flag can drift without the text changing.
 *
 * Matched on name and date against the fixed set, so a holiday a tenant added
 * or renamed itself is never touched: rewriting somebody's own calendar entry
 * to tidy up our seeding is a worse error than the stale sentence.
 */
async function refreshHolidayDescriptions(): Promise<void> {
  const stale = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const found: { name: string; rows: string }[] = [];
    for (const h of FIXED_HOLIDAYS) {
      const r = await tx.execute(sql`
        select count(*)::text as rows from hrms.holidays
         where year between ${SUPPORTED_YEARS.first} and ${SUPPORTED_YEARS.last}
           and name = ${h.name}
           and extract(month from holiday_date) = ${h.month}
           and extract(day   from holiday_date) = ${h.day}
           and (description is distinct from ${h.description}
                or is_optional is distinct from ${h.restricted})
      `);
      const rows = ((r.rows ?? r) as unknown as { rows: string }[])[0]?.rows ?? "0";
      if (Number(rows) > 0) found.push({ name: h.name, rows });
    }
    return found;
  });

  console.log(`${stale.length} holiday name(s) needing the Andhra Pradesh wording or flag\n`);
  for (const s of stale) console.log(`  ${s.name.padEnd(30)} ${s.rows} rows`);

  if (!apply) {
    if (stale.length > 0) console.log(`\nReport only. Re-run with --apply to rewrite these.\n`);
    await removeAliasDuplicates();
    return;
  }

  let updated = 0;
  if (stale.length > 0) {
    await withTenant({ orgId: "", superuser: true }, async (tx) => {
      for (const h of FIXED_HOLIDAYS) {
        const r = await tx.execute(sql`
          update hrms.holidays
             set description = ${h.description}, is_optional = ${h.restricted}
           where year between ${SUPPORTED_YEARS.first} and ${SUPPORTED_YEARS.last}
             and name = ${h.name}
             and extract(month from holiday_date) = ${h.month}
             and extract(day   from holiday_date) = ${h.day}
             and (description is distinct from ${h.description}
                  or is_optional is distinct from ${h.restricted})
          returning id
        `);
        updated += ((r.rows ?? r) as unknown[]).length;
      }
    });
    console.log(`\n${updated} row(s) rewritten for Andhra Pradesh.\n`);
  }

  await removeAliasDuplicates();
}

/**
 * Removes a holiday that duplicates another on the same day under a different
 * name — "Dr Ambedkar Jayanti" beside "Ambedkar Jayanti".
 *
 * Only an alias listed in HOLIDAY_ALIASES is removed, and only when the
 * canonical row already exists on that date for that organisation, so the day
 * itself is never lost. A name nobody has claimed as an alias is left alone
 * even if it shares a date, because two genuinely different observances can
 * fall together.
 */
async function removeAliasDuplicates(): Promise<void> {
  const dupes = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const found: { alias: string; canonical: string; rows: string }[] = [];
    for (const [alias, canonical] of Object.entries(HOLIDAY_ALIASES)) {
      const r = await tx.execute(sql`
        select count(*)::text as rows from hrms.holidays a
         where a.name = ${alias}
           and exists (
             select 1 from hrms.holidays c
              where c.org_id = a.org_id
                and c.holiday_date = a.holiday_date
                and c.name = ${canonical}
           )
      `);
      const rows = ((r.rows ?? r) as unknown as { rows: string }[])[0]?.rows ?? "0";
      if (Number(rows) > 0) found.push({ alias, canonical, rows });
    }
    return found;
  });

  console.log(`${dupes.length} day(s) listed twice under two names\n`);
  if (dupes.length === 0) {
    await canonicaliseHolidayNames();
    return;
  }

  for (const d of dupes) {
    console.log(`  ${d.alias.padEnd(30)} duplicates ${d.canonical} (${d.rows})`);
  }

  if (!apply) {
    console.log(`\nReport only. Re-run with --apply to remove the duplicates.\n`);
    await canonicaliseHolidayNames();
    return;
  }

  let removed = 0;
  await withTenant({ orgId: "", superuser: true }, async (tx) => {
    for (const { alias, canonical } of dupes) {
      const r = await tx.execute(sql`
        delete from hrms.holidays a
         where a.name = ${alias}
           and exists (
             select 1 from hrms.holidays c
              where c.org_id = a.org_id
                and c.holiday_date = a.holiday_date
                and c.name = ${canonical}
           )
        returning a.id
      `);
      removed += ((r.rows ?? r) as unknown[]).length;
    }
  });

  console.log(`\n${removed} duplicate row(s) removed.\n`);
  await canonicaliseHolidayNames();
}

/**
 * Renames a holiday carried under a north-Indian name to the Telugu one the
 * state uses — "Dussehra" to "Dasara", "Diwali" to "Deepavali".
 *
 * The date is not touched. An earlier seeding wrote the right days under the
 * wrong regional names, and those days are real: deleting them to tidy the
 * naming would take away a holiday somebody has already planned around, which
 * is far worse than an unfamiliar label. Only rows with no canonical row on the
 * same date are renamed — the duplicate case is removed above instead, since
 * renaming there would collide.
 */
async function canonicaliseHolidayNames(): Promise<void> {
  const renameable = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const found: { alias: string; canonical: string; rows: string }[] = [];
    for (const [alias, canonical] of Object.entries(HOLIDAY_ALIASES)) {
      const r = await tx.execute(sql`
        select count(*)::text as rows from hrms.holidays a
         where a.name = ${alias}
           and not exists (
             select 1 from hrms.holidays c
              where c.org_id = a.org_id
                and c.holiday_date = a.holiday_date
                and c.name = ${canonical}
           )
      `);
      const rows = ((r.rows ?? r) as unknown as { rows: string }[])[0]?.rows ?? "0";
      if (Number(rows) > 0) found.push({ alias, canonical, rows });
    }
    return found;
  });

  console.log(`${renameable.length} holiday name(s) not using the Telugu name\n`);
  if (renameable.length === 0) return;

  for (const r of renameable) {
    console.log(`  ${r.alias.padEnd(30)} should read ${r.canonical} (${r.rows})`);
  }

  if (!apply) {
    console.log(`\nReport only. Re-run with --apply to rename these.\n`);
    return;
  }

  let renamed = 0;
  await withTenant({ orgId: "", superuser: true }, async (tx) => {
    for (const { alias, canonical } of renameable) {
      const r = await tx.execute(sql`
        update hrms.holidays a
           set name = ${canonical}
         where a.name = ${alias}
           and not exists (
             select 1 from hrms.holidays c
              where c.org_id = a.org_id
                and c.holiday_date = a.holiday_date
                and c.name = ${canonical}
           )
        returning a.id
      `);
      renamed += ((r.rows ?? r) as unknown[]).length;
    }
  });

  console.log(`\n${renamed} holiday(s) renamed to the Telugu name.\n`);
}

main()
  .catch((e) => {
    console.log("ERROR:", (e as Error).message.slice(0, 400));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 250));
