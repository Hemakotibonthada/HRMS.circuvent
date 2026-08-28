// ═══════════════════════════════════════════════════════════════
// SMOKE TEST — the real stack, against the real database
// ═══════════════════════════════════════════════════════════════
//
// `db:verify` proves the rules in PGlite. This proves the application's own
// client, repositories and tenant scoping work against the database the
// deployment actually uses, as the role it actually connects as.
//
// That distinction has already cost this project once: ninety-one correct
// policies and seventy-five passing isolation tests, while `DATABASE_URL`
// pointed at a role with BYPASSRLS and every query returned every tenant's
// rows. Nothing that ran in CI could have noticed.
//
//   npm run db:smoke

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";

// Loaded before the client is used. The import below is static, but
// `connectionString()` reads DATABASE_URL lazily on first connection, so
// setting it here is early enough.
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

import { withTenant } from "../src/db/client";

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
  console.log("\nApplication stack against the live database\n");

  // Which tenants exist, read with the escape the migrations use.
  const orgs = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const r = await tx.execute(
      sql`select id::text as id, name from identity.organizations order by created_at`
    );
    return (r.rows ?? r) as { id: string; name: string }[];
  });

  console.log(`  ${orgs.length} organisation(s): ${orgs.map((o) => o.name).join(", ")}\n`);
  check("the client can open a connection at all", orgs.length >= 0);

  if (orgs.length === 0) {
    console.log("\n  No organisations; nothing further to exercise.");
    return;
  }

  const org = orgs[0];

  // ── Reads go through withTenant and stay in one tenant ─────
  const counts = await withTenant({ orgId: org.id }, async (tx) => {
    const r = await tx.execute(sql`
      select
        (select count(*)::text from hrms.employees)          as employees,
        (select count(*)::text from hrms.departments)        as departments,
        (select count(*)::text from hrms.document_templates) as templates,
        (select count(*)::text from hrms.leave_requests)     as leave_requests
    `);
    return ((r.rows ?? r) as Record<string, string>[])[0];
  });

  console.log(
    `  as ${org.name}: employees=${counts.employees} departments=${counts.departments} ` +
      `templates=${counts.templates} leave=${counts.leave_requests}`
  );
  check("a tenant-scoped read succeeds through withTenant", counts !== undefined);

  // ── The guard refuses an unscoped call ─────────────────────
  let refused = false;
  try {
    await withTenant({ orgId: "" }, async (tx) => tx.execute(sql`select 1`));
  } catch {
    refused = true;
  }
  check("an unscoped call is refused rather than run", refused);

  // ── A write lands, and is visible only to its own tenant ───
  const probeCode = `SMOKE${Date.now().toString().slice(-6)}`;

  const inserted = await withTenant({ orgId: org.id }, async (tx) => {
    const r = await tx.execute(sql`
      insert into hrms.departments (org_id, name, code)
      values (${org.id}::uuid, 'Smoke probe', ${probeCode})
      returning id::text as id
    `);
    return ((r.rows ?? r) as { id: string }[])[0].id;
  });

  check("a write through the application client persists", Boolean(inserted));

  if (orgs.length > 1) {
    const other = orgs[1];
    const seen = await withTenant({ orgId: other.id }, async (tx) => {
      const r = await tx.execute(
        sql`select count(*)::text as n from hrms.departments where id = ${inserted}::uuid`
      );
      return ((r.rows ?? r) as { n: string }[])[0].n;
    });
    check("and is invisible to another tenant", seen === "0", `saw ${seen}`);
  }

  // Clean up.
  await withTenant({ orgId: org.id }, async (tx) => {
    await tx.execute(sql`delete from hrms.departments where id = ${inserted}::uuid`);
  });

  const gone = await withTenant({ orgId: org.id }, async (tx) => {
    const r = await tx.execute(
      sql`select count(*)::text as n from hrms.departments where id = ${inserted}::uuid`
    );
    return ((r.rows ?? r) as { n: string }[])[0].n;
  });
  check("and can be removed again", gone === "0");

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.log("ERROR:", (e as Error).message.slice(0, 400));
    process.exitCode = 1;
  })
  .finally(() => {
    // The pool keeps the process alive otherwise.
    setTimeout(() => process.exit(process.exitCode ?? 0), 250);
  });
