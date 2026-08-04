// Applies every migration in ./drizzle to an in-memory Postgres (PGlite) and
// asserts that tenant isolation actually holds. Run with: npm run db:verify
//
// This is a real Postgres engine compiled to WASM, so RLS policies, triggers
// and constraints behave exactly as they will on Neon — unlike a mock, it can
// genuinely fail.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

/**
 * drizzle-kit separates statements with `--> statement-breakpoint`, but
 * splitting on it would break the DO $$ ... $$ blocks in the RLS migration,
 * which contain semicolons. PGlite's exec() runs a multi-statement string in
 * one go and handles dollar-quoting correctly, so the file is passed through
 * whole.
 */
function loadMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8").replaceAll(
        "--> statement-breakpoint",
        ""
      ),
    }));
}

async function main() {
  const db = new PGlite();
  let failed = false;

  for (const { name, sql } of loadMigrations()) {
    try {
      await db.exec(sql);
      console.log(`  ok    ${name}`);
    } catch (err) {
      failed = true;
      console.error(`  FAIL  ${name}`);
      console.error(`        ${(err as Error).message}`);
    }
  }

  if (failed) {
    console.error("\nMigrations did not apply cleanly.");
    process.exit(1);
  }

  console.log("\nMigrations applied. Verifying tenant isolation…");

  const orgA = "11111111-1111-1111-1111-111111111111";
  const orgB = "22222222-2222-2222-2222-222222222222";

  // Seeding has to bypass RLS, which is what the superuser escape hatch in
  // withTenant() is for.
  await db.exec(`
    SET app.superuser = 'on';
    INSERT INTO identity.organizations (id, name, slug) VALUES
      ('${orgA}', 'Alpha Corp', 'alpha'),
      ('${orgB}', 'Beta Corp',  'beta');
    INSERT INTO hrms.departments (org_id, name, code) VALUES
      ('${orgA}', 'Engineering', 'ENG'),
      ('${orgB}', 'Engineering', 'ENG');
    SET app.superuser = 'off';
  `);

  // A Postgres superuser bypasses RLS unconditionally — FORCE ROW LEVEL
  // SECURITY only covers the table *owner*. PGlite connects as a superuser, so
  // the rest of this script switches to the unprivileged application role.
  // Production does the same: Neon's DATABASE_URL must point at hrms_app, not
  // at the owner role that ran the migrations.
  const policyCount = await db.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM pg_policies WHERE policyname = 'tenant_isolation'"
  );
  console.log(`  ${policyCount.rows[0].count} tenant_isolation policies created`);

  await db.exec("SET ROLE hrms_app;");

  const checks: { name: string; pass: boolean; detail: string }[] = [];

  // 1. Scoping to one org must hide the other's rows.
  await db.exec(`SET app.org_id = '${orgA}';`);
  const scoped = await db.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM hrms.departments"
  );
  checks.push({
    name: "org A sees only its own departments",
    pass: scoped.rows[0].count === "1",
    detail: `expected 1, got ${scoped.rows[0].count}`,
  });

  // 2. An unfiltered query — the exact mistake Firestore could not prevent —
  //    must still not cross tenants.
  const leak = await db.query<{ org_id: string }>("SELECT org_id FROM hrms.departments");
  checks.push({
    name: "unfiltered SELECT cannot read another tenant",
    pass: leak.rows.every((r) => r.org_id === orgA),
    detail: `returned org_ids: ${[...new Set(leak.rows.map((r) => r.org_id))].join(", ")}`,
  });

  // 3. Writing a row belonging to another org must be rejected by WITH CHECK.
  let insertBlocked = false;
  try {
    await db.exec(
      `INSERT INTO hrms.departments (org_id, name, code) VALUES ('${orgB}', 'Sneaky', 'SNK')`
    );
  } catch {
    insertBlocked = true;
  }
  checks.push({
    name: "cannot INSERT a row into another tenant",
    pass: insertBlocked,
    detail: insertBlocked ? "rejected" : "INSERT was allowed — RLS WITH CHECK is not working",
  });

  // 4. With no tenant set, app_current_org() is NULL and nothing matches.
  await db.exec("SET app.org_id = '';");
  const noTenant = await db.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM hrms.departments"
  );
  checks.push({
    name: "no tenant context returns no rows",
    pass: noTenant.rows[0].count === "0",
    detail: `expected 0, got ${noTenant.rows[0].count}`,
  });

  // 5. The audit trail must reject rewriting history.
  await db.exec(`
    RESET ROLE;
    SET app.superuser = 'on';
    SET app.org_id = '${orgA}';
    INSERT INTO identity.audit_log (org_id, app, action, entity_type, hash)
      VALUES ('${orgA}', 'hrms', 'employee.created', 'employee', 'seed');
    SET app.superuser = 'off';
    SET ROLE hrms_app;
  `);
  let auditImmutable = false;
  try {
    await db.exec("UPDATE identity.audit_log SET action = 'tampered'");
  } catch {
    auditImmutable = true;
  }
  checks.push({
    name: "audit log rejects UPDATE",
    pass: auditImmutable,
    detail: auditImmutable ? "rejected" : "UPDATE succeeded — audit trail is mutable",
  });

  // 6. The chain trigger must replace the supplied hash with a computed one.
  const chained = await db.query<{ hash: string }>(
    "SELECT hash FROM identity.audit_log LIMIT 1"
  );
  checks.push({
    name: "audit log hash is computed by the chain trigger",
    pass: chained.rows[0]?.hash !== "seed" && chained.rows[0]?.hash?.length === 64,
    detail: `hash = ${chained.rows[0]?.hash?.slice(0, 16)}…`,
  });

  // 7. Maker-checker on payroll must be enforced by the database.
  let makerCheckerEnforced = false;
  const sameUser = "33333333-3333-3333-3333-333333333333";
  try {
    await db.exec(`
      INSERT INTO hrms.payroll_runs
        (org_id, period_month, period_year, processed_by_id, approved_by_id)
      VALUES ('${orgA}', 4, 2026, '${sameUser}', '${sameUser}')
    `);
  } catch {
    makerCheckerEnforced = true;
  }
  checks.push({
    name: "payroll cannot be approved by its processor",
    pass: makerCheckerEnforced,
    detail: makerCheckerEnforced ? "rejected" : "same-user approval was allowed",
  });

  console.log("");
  for (const c of checks) {
    console.log(`  ${c.pass ? "ok   " : "FAIL "} ${c.name}${c.pass ? "" : ` — ${c.detail}`}`);
  }

  const failures = checks.filter((c) => !c.pass).length;
  console.log("");
  if (failures > 0) {
    console.error(`${failures} of ${checks.length} isolation checks failed.`);
    process.exit(1);
  }
  console.log(`All ${checks.length} isolation checks passed.`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
