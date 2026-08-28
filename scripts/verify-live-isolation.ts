// ═══════════════════════════════════════════════════════════════
// VERIFY: THE LIVE CONNECTION ACTUALLY ISOLATES TENANTS
// ═══════════════════════════════════════════════════════════════
//
// `db:verify` proves the RLS policies are correct by running them in PGlite as
// a role that does not bypass RLS. That is a real proof of the policies, and
// it is not a proof of the deployment: it says nothing about the role
// `DATABASE_URL` actually names.
//
// The distinction is not academic. This repository shipped ninety-one correct
// policies, seventy-five passing isolation tests, and a `DATABASE_URL` pointing
// at the database owner — a role with BYPASSRLS. Every policy was inert. Two
// organisations shared the database and either could read the other's payroll.
//
// So this script asks the only question that matters in production: connect as
// whoever we really connect as, plant a row in one tenant, ask as another, and
// see whether it comes back.
//
// It is not part of `npm run verify`, because it needs a live database that CI
// does not have. Run it against every environment before it serves traffic.
//
//   npm run db:verify:live

import { readFileSync } from "node:fs";
import pg from "pg";

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    // Not every environment keeps a file; the process env is checked below.
  }
  return out;
}

const fileEnv = loadEnv(".env.local");
const DATABASE_URL = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  if (!DATABASE_URL) {
    console.log("DATABASE_URL is not set; nothing to verify.");
    process.exitCode = 1;
    return;
  }

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const role = (
    await client.query<{ rolname: string; bypasses: boolean }>(
      `select rolname, rolbypassrls as bypasses from pg_roles where rolname = current_user`
    )
  ).rows[0];

  console.log(`\nConnected as ${role.rolname}\n`);

  // The property, stated directly. Everything below is the same thing proven
  // by experiment, but this is the line an operator can act on.
  check(
    "the connected role does not bypass row-level security",
    !role.bypasses,
    `${role.rolname} has BYPASSRLS, so every policy is inert`
  );

  const policies = (
    await client.query<{ n: string }>(
      `select count(*)::text as n from pg_policies where schemaname = 'hrms'`
    )
  ).rows[0].n;
  check("tenant isolation policies are present", Number(policies) > 0, `found ${policies}`);

  const unprotected = await client.query<{ relname: string }>(
    `select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'hrms'
        and c.relkind = 'r'
        and c.relrowsecurity = false
        and exists (
          select 1 from information_schema.columns col
           where col.table_schema = 'hrms'
             and col.table_name = c.relname
             and col.column_name = 'org_id'
        )
      order by c.relname`
  );
  check(
    "every table holding tenant rows has RLS enabled",
    unprotected.rows.length === 0,
    unprotected.rows.map((r) => r.relname).join(", ")
  );

  // ── Proven by experiment ───────────────────────────────────
  //
  // Setup and teardown need to see across tenants, which is precisely what the
  // application role must not do. They run with `app.superuser` on — the same
  // escape the migration scripts use — and it is turned off again before the
  // read that actually matters. If listing organisations came back short
  // without that, the test would silently skip and report a pass.
  await client.query(`select set_config('app.superuser', 'on', false)`);

  const orgs = (
    await client.query<{ id: string; name: string }>(
      `select id, name from identity.organizations order by created_at limit 2`
    )
  ).rows;

  if (orgs.length < 2) {
    await client.query(`select set_config('app.superuser', 'off', false)`);
    console.log(`\n  (only ${orgs.length} organisation; cross-tenant read not exercised)`);
  } else {
    const [a, b] = orgs;
    let planted: string | undefined;

    try {
      planted = (
        await client.query<{ id: string }>(
          `insert into hrms.departments (org_id, name, code)
           values ($1, 'ISOLATION PROBE', 'ZZPROBE') returning id`,
          [a.id]
        )
      ).rows[0].id;

      // Drop the escape, then ask as the other tenant. This is the question.
      await client.query(`select set_config('app.superuser', 'off', false)`);
      await client.query(`select set_config('app.org_id', $1, false)`, [b.id]);

      const seen = (
        await client.query<{ n: string }>(
          `select count(*)::text as n from hrms.departments where id = $1`,
          [planted]
        )
      ).rows[0].n;

      check("one tenant cannot read another's row by id", seen === "0", `saw ${seen}`);

      const spread = (
        await client.query<{ orgs: string }>(
          `select count(distinct org_id)::text as orgs from hrms.departments`
        )
      ).rows[0].orgs;

      check(
        "an unqualified select cannot span organisations",
        spread === "0" || spread === "1",
        `saw rows from ${spread} organisations`
      );

      const leakedEmployees = (
        await client.query<{ orgs: string }>(
          `select count(distinct org_id)::text as orgs from hrms.employees`
        )
      ).rows[0].orgs;

      check(
        "employee records cannot span organisations",
        leakedEmployees === "0" || leakedEmployees === "1",
        `saw employees from ${leakedEmployees} organisations`
      );
    } finally {
      await client.query(`select set_config('app.org_id', '', false)`);
      if (planted) {
        await client.query(`select set_config('app.superuser', 'on', false)`);
        await client.query(`delete from hrms.departments where id = $1`, [planted]);
        await client.query(`select set_config('app.superuser', 'off', false)`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed.`);

  if (failed > 0) {
    console.log(
      `\nTo fix: connect as a role without BYPASSRLS. This database has "hrms_app"\n` +
        `for exactly that; drizzle/0028_app_role_login.sql grants it LOGIN and the\n` +
        `privileges it needs. Set a password, point DATABASE_URL at it, re-run this.\n`
    );
    process.exitCode = 1;
  }

  await client.end();
}

main().catch((error) => {
  console.log("ERROR:", (error as Error).message.slice(0, 400));
  process.exitCode = 1;
});
