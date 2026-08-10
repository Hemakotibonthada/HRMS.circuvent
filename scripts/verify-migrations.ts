// Applies every migration in ./drizzle to an in-memory Postgres (PGlite) and
// asserts that tenant isolation actually holds. Run with: npm run db:verify
//
// This is a real Postgres engine compiled to WASM, so RLS policies, triggers
// and constraints behave exactly as they will on Neon — unlike a mock, it can
// genuinely fail.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";

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

  // 0. Every migration file must be listed in the journal.
  //
  // This script applies whatever it finds on disk, but `drizzle-kit migrate`
  // applies only what the journal names. A hand-written migration that is
  // never added to the journal therefore passes here and silently never runs
  // in production — which is exactly what happened to the scheduling RLS
  // migration before this check existed.
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")
  ) as { entries: { tag: string }[] };

  const journalled = new Set(journal.entries.map((e) => e.tag));
  const unjournalled = loadMigrations()
    .map((m) => m.name.replace(/\.sql$/, ""))
    .filter((tag) => !journalled.has(tag));

  checks.push({
    name: "every migration file is listed in the journal",
    pass: unjournalled.length === 0,
    detail:
      unjournalled.length === 0
        ? "all listed"
        : `missing from _journal.json: ${unjournalled.join(", ")} — these would never run in production`,
  });

  // A tag listed twice makes `drizzle-kit migrate` attempt the same file
  // twice, which fails on the second attempt and leaves the run half-applied.
  // Hand-editing the journal alongside `drizzle-kit generate` is how it
  // happens.
  const tagCounts = new Map<string, number>();
  for (const entry of journal.entries) {
    tagCounts.set(entry.tag, (tagCounts.get(entry.tag) ?? 0) + 1);
  }
  const duplicated = [...tagCounts].filter(([, n]) => n > 1).map(([tag]) => tag);

  checks.push({
    name: "no migration is listed in the journal twice",
    pass: duplicated.length === 0,
    detail:
      duplicated.length === 0 ? "all unique" : `listed more than once: ${duplicated.join(", ")}`,
  });

  // Several migrations are hand-written, because drizzle-kit needs an
  // interactive terminal to resolve rename-versus-replace and has none here.
  // That makes drift possible: the TypeScript schema saying one thing and the
  // migrations another, with the application then querying a column that does
  // not exist. This compares the two directly.
  const declared = new Map<string, Set<string>>();

  for (const value of Object.values(schema)) {
    // `is` is Drizzle's own instanceof, which survives multiple copies of the
    // package in the tree. A duck-typed check here is what made the first
    // version of this match nothing at all.
    if (!is(value, PgTable)) continue;

    const config = getTableConfig(value);
    const qualified = `${config.schema ?? "public"}.${config.name}`;
    declared.set(qualified, new Set(config.columns.map((c) => c.name)));
  }

  const actual = await db.query<{ table_schema: string; table_name: string; column_name: string }>(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema IN ('identity', 'hrms')
  `);

  const built = new Map<string, Set<string>>();
  for (const row of actual.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    built.set(key, (built.get(key) ?? new Set()).add(row.column_name));
  }

  const missingTables: string[] = [];
  const missingColumns: string[] = [];

  for (const [table, columns] of declared) {
    const existing = built.get(table);
    if (!existing) {
      missingTables.push(table);
      continue;
    }
    for (const column of columns) {
      if (!existing.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }

  checks.push({
    name: "every table the TypeScript schema declares exists in the migrations",
    pass: missingTables.length === 0,
    detail:
      missingTables.length === 0
        ? `${declared.size} tables matched`
        : `declared but never created: ${missingTables.join(", ")}`,
  });

  // Guards the guard. If the reflection above ever stops recognising Drizzle
  // tables — a library upgrade changing the internal shape would do it — the
  // two drift checks would pass over an empty set and report success while
  // checking nothing.
  checks.push({
    name: "the drift check actually reflected the schema",
    pass: declared.size >= 50,
    detail:
      declared.size >= 50
        ? `${declared.size} tables reflected, ${[...declared.values()].reduce((n, c) => n + c.size, 0)} columns`
        : `only ${declared.size} tables reflected — the drift check is passing over nothing`,
  });

  checks.push({
    name: "every column the TypeScript schema declares exists in the migrations",
    pass: missingColumns.length === 0,
    detail:
      missingColumns.length === 0
        ? "no drift"
        : `declared but never created: ${missingColumns.join(", ")}`,
  });

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

  // 8. Every org-scoped table must be covered. A table added without RLS
  //    returns every tenant's rows to every caller, and the omission is
  //    invisible until someone notices another company's data.
  await db.exec("RESET ROLE;");
  const uncovered = await db.query<{ table_schema: string; table_name: string }>(`
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name   = c.table_name
     AND t.table_type   = 'BASE TABLE'
    WHERE c.column_name = 'org_id'
      AND c.table_schema IN ('identity', 'hrms')
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = c.table_schema
          AND p.tablename  = c.table_name
          AND p.policyname = 'tenant_isolation'
      )
  `);
  checks.push({
    name: "every org-scoped table has a tenant_isolation policy",
    pass: uncovered.rows.length === 0,
    detail:
      uncovered.rows.length === 0
        ? "all covered"
        : `missing on: ${uncovered.rows.map((r) => `${r.table_schema}.${r.table_name}`).join(", ")}`,
  });

  // 9. A referral bonus must not be approvable by the person who earns it.
  await db.exec(`
    SET app.superuser = 'on';
    SET app.org_id = '${orgA}';
  `);
  const referrer = "44444444-4444-4444-4444-444444444444";

  // Seeded in its own statement. Batching it with the INSERT under test would
  // roll it back when that INSERT is correctly rejected — and every later
  // check would then pass on a foreign-key error rather than on the constraint
  // it claims to be testing.
  await db.exec(`
    INSERT INTO hrms.employees
      (id, org_id, employee_code, first_name, last_name, work_email, designation, join_date)
    VALUES ('${referrer}', '${orgA}', 'CIR-0001', 'Asha', 'Rao', 'asha@example.com', 'Engineer', '2026-01-01')
    ON CONFLICT DO NOTHING;
  `);

  const seededReferrer = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM hrms.employees WHERE id = '${referrer}'`
  );
  checks.push({
    name: "the referral fixture employee exists before the constraint checks",
    pass: seededReferrer.rows[0].count === "1",
    detail: `expected 1, got ${seededReferrer.rows[0].count}`,
  });

  let referralSelfApprovalBlocked = false;
  try {
    await db.exec(`
      INSERT INTO hrms.referrals
        (org_id, referrer_id, candidate_name, candidate_email, position_title, payout_approved_by_id)
      VALUES ('${orgA}', '${referrer}', 'Priya', 'priya@example.com', 'Engineer', '${referrer}')
    `);
  } catch {
    referralSelfApprovalBlocked = true;
  }
  checks.push({
    name: "referral bonus cannot be approved by its referrer",
    pass: referralSelfApprovalBlocked,
    detail: referralSelfApprovalBlocked ? "rejected" : "self-approval was allowed",
  });

  // 10. A bonus marked paid must name the payroll run that paid it, or the
  //     money cannot be traced at reconciliation.
  let paidRequiresRun = false;
  try {
    await db.exec(`
      INSERT INTO hrms.referrals
        (org_id, referrer_id, candidate_name, candidate_email, position_title, payout_status)
      VALUES ('${orgA}', '${referrer}', 'Sam', 'sam@example.com', 'Engineer', 'paid')
    `);
  } catch {
    paidRequiresRun = true;
  }
  checks.push({
    name: "a paid referral bonus must reference a payroll run",
    pass: paidRequiresRun,
    detail: paidRequiresRun ? "rejected" : "paid without a run reference was allowed",
  });

  // 11. A signature must record the hash of what was signed.
  await db.exec(`
    INSERT INTO hrms.generated_documents (id, org_id, title, category)
    VALUES ('55555555-5555-5555-5555-555555555555', '${orgA}', 'Offer', 'offer')
    ON CONFLICT DO NOTHING;
  `);

  let signatureNeedsHash = false;
  try {
    await db.exec(`
      INSERT INTO hrms.document_signatures
        (org_id, document_id, signatory_email, signatory_role, signed_at)
      VALUES ('${orgA}', '55555555-5555-5555-5555-555555555555', 'a@b.com', 'employee', now())
    `);
  } catch {
    signatureNeedsHash = true;
  }
  checks.push({
    name: "a signature must record the document hash it signed",
    pass: signatureNeedsHash,
    detail: signatureNeedsHash ? "rejected" : "signature without a content hash was allowed",
  });

  // 12. Two live assignments for the same person, day and pattern would have
  //     someone believing they owe two shifts at once.
  const patternId = "66666666-6666-6666-6666-666666666666";
  const rosterId = "77777777-7777-7777-7777-777777777777";
  await db.exec(`
    INSERT INTO hrms.shift_patterns (id, org_id, name, code, start_time, end_time)
    VALUES ('${patternId}', '${orgA}', 'Day', 'DAY', '09:00', '17:00')
    ON CONFLICT DO NOTHING;

    INSERT INTO hrms.rosters (id, org_id, name, period_start, period_end)
    VALUES ('${rosterId}', '${orgA}', 'April', '2026-04-01', '2026-04-30')
    ON CONFLICT DO NOTHING;

    INSERT INTO hrms.roster_assignments
      (org_id, roster_id, employee_id, pattern_id, shift_date, starts_at, ends_at, duration_minutes)
    VALUES ('${orgA}', '${rosterId}', '${referrer}', '${patternId}', '2026-04-06',
            '2026-04-06T09:00:00Z', '2026-04-06T17:00:00Z', 420);
  `);

  let doubleBookingBlocked = false;
  try {
    await db.exec(`
      INSERT INTO hrms.roster_assignments
        (org_id, roster_id, employee_id, pattern_id, shift_date, starts_at, ends_at, duration_minutes)
      VALUES ('${orgA}', '${rosterId}', '${referrer}', '${patternId}', '2026-04-06',
              '2026-04-06T09:00:00Z', '2026-04-06T17:00:00Z', 420)
    `);
  } catch {
    doubleBookingBlocked = true;
  }
  checks.push({
    name: "an employee cannot hold two live assignments for the same shift",
    pass: doubleBookingBlocked,
    detail: doubleBookingBlocked ? "rejected" : "a duplicate live assignment was allowed",
  });

  // 13. A swapped-out row must not block the replacement, or a swap could
  //     never be recorded at all.
  let swapHistoryAllowed = true;
  try {
    await db.exec(`
      UPDATE hrms.roster_assignments SET status = 'swapped_out'
      WHERE employee_id = '${referrer}' AND shift_date = '2026-04-06';

      INSERT INTO hrms.roster_assignments
        (org_id, roster_id, employee_id, pattern_id, shift_date, starts_at, ends_at, duration_minutes)
      VALUES ('${orgA}', '${rosterId}', '${referrer}', '${patternId}', '2026-04-06',
              '2026-04-06T09:00:00Z', '2026-04-06T17:00:00Z', 420)
    `);
  } catch (e) {
    swapHistoryAllowed = false;
    console.error(e);
  }
  checks.push({
    name: "a swapped-out assignment does not block its replacement",
    pass: swapHistoryAllowed,
    detail: swapHistoryAllowed ? "allowed" : "the partial index is too broad to record a swap",
  });

  // 14. A shift that ends before it starts would compute negative hours and
  //     flow into pay.
  let backwardsShiftBlocked = false;
  try {
    await db.exec(`
      INSERT INTO hrms.roster_assignments
        (org_id, roster_id, employee_id, pattern_id, shift_date, starts_at, ends_at, duration_minutes)
      VALUES ('${orgA}', '${rosterId}', '${referrer}', '${patternId}', '2026-04-07',
              '2026-04-07T17:00:00Z', '2026-04-07T09:00:00Z', 420)
    `);
  } catch {
    backwardsShiftBlocked = true;
  }
  checks.push({
    name: "a shift cannot end before it starts",
    pass: backwardsShiftBlocked,
    detail: backwardsShiftBlocked ? "rejected" : "a backwards shift was allowed",
  });

  // 15. A roster marked published without a publisher cannot be defended if it
  //     is ever questioned.
  let publishNeedsPublisher = false;
  try {
    await db.exec(`
      INSERT INTO hrms.rosters (org_id, name, period_start, period_end, status)
      VALUES ('${orgA}', 'May', '2026-05-01', '2026-05-31', 'published')
    `);
  } catch {
    publishNeedsPublisher = true;
  }
  checks.push({
    name: "a published roster must record who published it",
    pass: publishNeedsPublisher,
    detail: publishNeedsPublisher ? "rejected" : "publication without a publisher was allowed",
  });

  // 16. Approving your own swap defeats the point of approval.
  let swapSelfApprovalBlocked = false;
  try {
    await db.exec(`
      INSERT INTO hrms.shift_swap_requests
        (org_id, assignment_id, requested_by_id, approved_by_id)
      SELECT '${orgA}', id, '${referrer}', '${referrer}'
      FROM hrms.roster_assignments WHERE shift_date = '2026-04-06' LIMIT 1
    `);
  } catch {
    swapSelfApprovalBlocked = true;
  }
  checks.push({
    name: "a shift swap cannot be approved by its requester",
    pass: swapSelfApprovalBlocked,
    detail: swapSelfApprovalBlocked ? "rejected" : "self-approval was allowed",
  });

  // 17. Zero contracted hours would divide by zero in the fairness sort and
  //     silently exclude someone from every roster.
  let contractedHoursChecked = false;
  try {
    await db.exec(`
      UPDATE hrms.employees SET contracted_hours_per_week = 0 WHERE id = '${referrer}'
    `);
  } catch {
    contractedHoursChecked = true;
  }
  checks.push({
    name: "contracted hours must be greater than zero",
    pass: contractedHoursChecked,
    detail: contractedHoursChecked ? "rejected" : "zero contracted hours was allowed",
  });

  // 18-21. Custom field uniqueness. Enforced by a partial unique index over a
  //        trigger-maintained flag, because an application-level check is racy
  //        — two concurrent requests both pass the SELECT and both insert.
  const uniqueField = "88888888-8888-8888-8888-888888888888";
  const plainField = "99999999-9999-9999-9999-999999999999";
  const entityA = "aaaaaaa1-0000-4000-8000-000000000001";
  const entityB = "aaaaaaa1-0000-4000-8000-000000000002";

  await db.exec(`
    INSERT INTO hrms.custom_field_definitions
      (id, org_id, entity_type, key, label, data_type, is_unique)
    VALUES
      ('${uniqueField}', '${orgA}', 'employee', 'passport_no', 'Passport', 'text', true),
      ('${plainField}',  '${orgA}', 'employee', 'shirt_size',  'Shirt',    'text', false)
    ON CONFLICT DO NOTHING;

    INSERT INTO hrms.custom_field_values
      (org_id, definition_id, entity_type, entity_id, value, value_text)
    VALUES ('${orgA}', '${uniqueField}', 'employee', '${entityA}', '"X123"'::jsonb, 'X123');
  `);

  let duplicateBlocked = false;
  try {
    await db.exec(`
      INSERT INTO hrms.custom_field_values
        (org_id, definition_id, entity_type, entity_id, value, value_text)
      VALUES ('${orgA}', '${uniqueField}', 'employee', '${entityB}', '"X123"'::jsonb, 'X123')
    `);
  } catch {
    duplicateBlocked = true;
  }
  checks.push({
    name: "a unique custom field rejects a duplicate value",
    pass: duplicateBlocked,
    detail: duplicateBlocked ? "rejected" : "the trigger did not stamp is_unique, so the index does not cover it",
  });

  let sharedAllowed = true;
  try {
    await db.exec(`
      INSERT INTO hrms.custom_field_values
        (org_id, definition_id, entity_type, entity_id, value, value_text)
      VALUES
        ('${orgA}', '${plainField}', 'employee', '${entityA}', '"L"'::jsonb, 'L'),
        ('${orgA}', '${plainField}', 'employee', '${entityB}', '"L"'::jsonb, 'L')
    `);
  } catch {
    sharedAllowed = false;
  }
  checks.push({
    name: "a non-unique custom field allows the same value on two records",
    pass: sharedAllowed,
    detail: sharedAllowed ? "allowed" : "the uniqueness index is too broad",
  });

  // Two employees with no passport number are not duplicates of each other.
  let emptiesAllowed = true;
  try {
    await db.exec(`
      INSERT INTO hrms.custom_field_values
        (org_id, definition_id, entity_type, entity_id, value, value_text)
      VALUES
        ('${orgA}', '${uniqueField}', 'employee', 'aaaaaaa1-0000-4000-8000-000000000003', NULL, NULL),
        ('${orgA}', '${uniqueField}', 'employee', 'aaaaaaa1-0000-4000-8000-000000000004', NULL, NULL)
    `);
  } catch {
    emptiesAllowed = false;
  }
  checks.push({
    name: "two records with no value are not treated as duplicates",
    pass: emptiesAllowed,
    detail: emptiesAllowed ? "allowed" : "the index covers null values",
  });

  // Turning uniqueness on must reach rows already stored, or every existing
  // value stays unenforced.
  const laterUnique = "bbbbbbb1-0000-4000-8000-000000000001";
  await db.exec(`
    INSERT INTO hrms.custom_field_definitions
      (id, org_id, entity_type, key, label, data_type, is_unique)
    VALUES ('${laterUnique}', '${orgA}', 'employee', 'locker_no', 'Locker', 'text', false)
    ON CONFLICT DO NOTHING;

    INSERT INTO hrms.custom_field_values
      (org_id, definition_id, entity_type, entity_id, value, value_text)
    VALUES
      ('${orgA}', '${laterUnique}', 'employee', '${entityA}', '"L1"'::jsonb, 'L1'),
      ('${orgA}', '${laterUnique}', 'employee', '${entityB}', '"L2"'::jsonb, 'L2');

    UPDATE hrms.custom_field_definitions SET is_unique = true WHERE id = '${laterUnique}';
  `);

  const propagated = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM hrms.custom_field_values
     WHERE definition_id = '${laterUnique}' AND is_unique`
  );
  checks.push({
    name: "enabling uniqueness propagates to values already stored",
    pass: propagated.rows[0].count === "2",
    detail: `${propagated.rows[0].count} of 2 existing values now covered`,
  });

  // And enabling it on a field whose values are already duplicated must fail
  // rather than leave a constraint that the stored data violates.
  let retroactiveUniqueBlocked = false;
  try {
    await db.exec(
      `UPDATE hrms.custom_field_definitions SET is_unique = true WHERE id = '${plainField}'`
    );
  } catch {
    retroactiveUniqueBlocked = true;
  }
  checks.push({
    name: "uniqueness cannot be enabled on a field whose values already clash",
    pass: retroactiveUniqueBlocked,
    detail: retroactiveUniqueBlocked
      ? "rejected"
      : "the flag was set despite duplicate values already stored",
  });

  // 22. The jsonb placeholders these tables replace must be gone. Two homes
  //     for one concept is how a field is written to one and read from the
  //     other.
  const leftovers = await db.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'custom_fields'
      AND table_schema IN ('identity', 'hrms')
  `);
  checks.push({
    name: "the replaced custom_fields jsonb columns are dropped",
    pass: leftovers.rows.length === 0,
    detail:
      leftovers.rows.length === 0
        ? "removed"
        : `still present on: ${leftovers.rows.map((r) => r.table_name).join(", ")}`,
  });

  // 23-27. Governance. Erasure is the only operation here that destroys data
  //        on purpose, so the database enforces the checks around it rather
  //        than trusting the route to.
  const verifier = "cccccccc-0000-4000-8000-000000000001";
  const approver = "cccccccc-0000-4000-8000-000000000002";

  let approvalNeedsIdentity = false;
  try {
    await db.exec(`
      INSERT INTO hrms.data_subject_requests
        (org_id, request_type, subject_email, due_on, approved_at, approved_by_id)
      VALUES ('${orgA}', 'erasure', 'ex@example.com', '2026-05-01', now(), '${approver}')
    `);
  } catch {
    approvalNeedsIdentity = true;
  }
  checks.push({
    name: "an erasure cannot be approved before identity is verified",
    pass: approvalNeedsIdentity,
    detail: approvalNeedsIdentity ? "rejected" : "approval without identity verification was allowed",
  });

  let separateApprover = false;
  try {
    await db.exec(`
      INSERT INTO hrms.data_subject_requests
        (org_id, request_type, subject_email, due_on,
         identity_verified_at, identity_verified_by_id, approved_at, approved_by_id)
      VALUES ('${orgA}', 'erasure', 'ex2@example.com', '2026-05-01',
              now(), '${verifier}', now(), '${verifier}')
    `);
  } catch {
    separateApprover = true;
  }
  checks.push({
    name: "the same person cannot both verify identity and approve an erasure",
    pass: separateApprover,
    detail: separateApprover ? "rejected" : "single-person erasure approval was allowed",
  });

  let completionNeedsApproval = false;
  try {
    await db.exec(`
      INSERT INTO hrms.data_subject_requests
        (org_id, request_type, subject_email, due_on, completed_at)
      VALUES ('${orgA}', 'erasure', 'ex3@example.com', '2026-05-01', now())
    `);
  } catch {
    completionNeedsApproval = true;
  }
  checks.push({
    name: "an erasure cannot be completed without approval",
    pass: completionNeedsApproval,
    detail: completionNeedsApproval ? "rejected" : "unapproved completion was allowed",
  });

  // The erasure log is the evidence that a destruction was authorised and
  // scoped. A log that can be edited proves nothing.
  await db.exec(`
    INSERT INTO hrms.erasure_log (org_id, entity_type, area, method, basis)
    VALUES ('${orgA}', 'employee', 'profile', 'anonymise', 'Subject request');
  `);

  let erasureLogImmutable = false;
  try {
    await db.exec(`UPDATE hrms.erasure_log SET basis = 'tampered'`);
  } catch {
    erasureLogImmutable = true;
  }
  checks.push({
    name: "the erasure log rejects UPDATE",
    pass: erasureLogImmutable,
    detail: erasureLogImmutable ? "rejected" : "the destruction record is editable",
  });

  let erasureLogUndeletable = false;
  try {
    await db.exec(`DELETE FROM hrms.erasure_log`);
  } catch {
    erasureLogUndeletable = true;
  }
  checks.push({
    name: "the erasure log rejects DELETE",
    pass: erasureLogUndeletable,
    detail: erasureLogUndeletable ? "rejected" : "the destruction record can be removed",
  });

  // A consent row is either a grant or a withdrawal, never both and never
  // neither — "consented at no time" is not a state.
  let consentSingleOutcome = false;
  try {
    await db.exec(`
      INSERT INTO hrms.consent_records (org_id, subject_email, purpose, policy_version)
      VALUES ('${orgA}', 'a@b.com', 'marketing', 1)
    `);
  } catch {
    consentSingleOutcome = true;
  }
  checks.push({
    name: "a consent row must be either a grant or a withdrawal",
    pass: consentSingleOutcome,
    detail: consentSingleOutcome ? "rejected" : "a row that is neither was allowed",
  });

  // A legal hold with no review date is one nobody ever lifts, and an
  // indefinite hold quietly defeats the retention schedule.
  let holdNeedsReview = false;
  try {
    await db.exec(`
      INSERT INTO hrms.legal_holds (org_id, reference, reason, entity_type)
      VALUES ('${orgA}', 'LIT-1', 'Pending tribunal claim', 'employee')
    `);
  } catch {
    holdNeedsReview = true;
  }
  checks.push({
    name: "a legal hold must carry a review date",
    pass: holdNeedsReview,
    detail: holdNeedsReview ? "rejected" : "an indefinite hold was allowed",
  });

  // 28-31. Federation. sso_connections holds client secrets and scim_tokens
  //        holds credentials that can create and disable accounts, so a
  //        missing policy here would let one tenant read another's ability to
  //        authenticate.
  let plaintextEndpointBlocked = false;
  try {
    await db.exec(`
      INSERT INTO identity.sso_connections
        (org_id, name, domains, issuer, client_id, client_secret,
         authorization_endpoint, token_endpoint, jwks_uri)
      VALUES ('${orgA}', 'Insecure', '["example.com"]'::jsonb, 'https://idp.test', 'c', 's',
              'http://idp.test/authorize', 'https://idp.test/token', 'https://idp.test/jwks')
    `);
  } catch {
    plaintextEndpointBlocked = true;
  }
  checks.push({
    name: "an SSO connection cannot use a plaintext endpoint",
    pass: plaintextEndpointBlocked,
    detail: plaintextEndpointBlocked ? "rejected" : "an http:// endpoint was allowed",
  });

  // An active connection routing no domains can never be selected, so it is a
  // configuration someone believes is working and is not.
  let emptyDomainsBlocked = false;
  try {
    await db.exec(`
      INSERT INTO identity.sso_connections
        (org_id, name, domains, issuer, client_id, client_secret,
         authorization_endpoint, token_endpoint, jwks_uri, is_active)
      VALUES ('${orgA}', 'Unrouted', '[]'::jsonb, 'https://idp.test', 'c', 's',
              'https://idp.test/authorize', 'https://idp.test/token', 'https://idp.test/jwks', true)
    `);
  } catch {
    emptyDomainsBlocked = true;
  }
  checks.push({
    name: "an active SSO connection must route at least one domain",
    pass: emptyDomainsBlocked,
    detail: emptyDomainsBlocked ? "rejected" : "an unroutable active connection was allowed",
  });

  await db.exec(`
    INSERT INTO identity.sso_connections
      (id, org_id, name, domains, issuer, client_id, client_secret,
       authorization_endpoint, token_endpoint, jwks_uri)
    VALUES ('dddddddd-0000-4000-8000-000000000001', '${orgA}', 'Works',
            '["example.com"]'::jsonb, 'https://idp.test', 'c', 's',
            'https://idp.test/authorize', 'https://idp.test/token', 'https://idp.test/jwks');
  `);

  // A sign-in attempt that never expires is a replayable credential.
  let longLivedStateBlocked = false;
  try {
    await db.exec(`
      INSERT INTO identity.sso_auth_states
        (org_id, connection_id, state, nonce, code_verifier, redirect_uri, expires_at)
      VALUES ('${orgA}', 'dddddddd-0000-4000-8000-000000000001', 's', 'n', 'v',
              'https://app.test/cb', now() + interval '2 hours')
    `);
  } catch {
    longLivedStateBlocked = true;
  }
  checks.push({
    name: "an SSO sign-in attempt cannot be long-lived",
    pass: longLivedStateBlocked,
    detail: longLivedStateBlocked ? "rejected" : "a two-hour auth state was allowed",
  });

  // Only the hash is stored. A value that is not a SHA-256 digest means
  // something wrote the secret itself into the column.
  let plaintextTokenBlocked = false;
  try {
    await db.exec(`
      INSERT INTO identity.scim_tokens (org_id, name, token_hash, token_prefix)
      VALUES ('${orgA}', 'Okta', 'plaintext-secret-value', 'plain')
    `);
  } catch {
    plaintextTokenBlocked = true;
  }
  checks.push({
    name: "a SCIM token column rejects anything that is not a hash",
    pass: plaintextTokenBlocked,
    detail: plaintextTokenBlocked ? "rejected" : "a plaintext token was stored",
  });

  // The record of what the directory told us to do and when.
  await db.exec(`
    INSERT INTO identity.scim_sync_log (org_id, operation, status_code)
    VALUES ('${orgA}', 'patch', 200);
  `);

  let scimLogImmutable = false;
  try {
    await db.exec(`UPDATE identity.scim_sync_log SET operation = 'tampered'`);
  } catch {
    scimLogImmutable = true;
  }
  checks.push({
    name: "the SCIM sync log rejects UPDATE",
    pass: scimLogImmutable,
    detail: scimLogImmutable ? "rejected" : "the provisioning record is editable",
  });

  // The placeholder SSO tables must be gone, not left beside the real ones.
  const oldSso = await db.query<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'identity'
      AND table_name = 'sso_connections'
      AND column_name IN ('oidc_client_id', 'x509_certificate', 'jit_provisioning')
  `);
  checks.push({
    name: "the placeholder SSO columns are replaced, not duplicated",
    pass: oldSso.rows.length === 0,
    detail:
      oldSso.rows.length === 0
        ? "replaced"
        : `still present: ${oldSso.rows.map((r) => r.column_name).join(", ")}`,
  });

  // 32-36. Helpdesk. An HR desk carries grievances about managers alongside
  //        laptop requests, so the invariants that keep the SLA clock honest
  //        and the confidential tickets out of the wrong hands are enforced
  //        by the database, not only by the repository.
  const slaPolicyId = "eeeeeeee-0000-4000-8000-000000000001";
  await db.exec(`
    INSERT INTO hrms.sla_policies (id, org_id, name, business_hours, is_default)
    VALUES ('${slaPolicyId}', '${orgA}', 'Standard',
            '{"timezone":"Asia/Kolkata","days":{},"holidays":[]}'::jsonb, true);
  `);

  // Two defaults would make ticket creation pick arbitrarily between them, and
  // two identical tickets would get different targets.
  let oneDefaultOnly = false;
  try {
    await db.exec(`
      INSERT INTO hrms.sla_policies (org_id, name, business_hours, is_default)
      VALUES ('${orgA}', 'Rival', '{"timezone":"UTC","days":{},"holidays":[]}'::jsonb, true)
    `);
  } catch {
    oneDefaultOnly = true;
  }
  checks.push({
    name: "only one SLA policy can be the default",
    pass: oneDefaultOnly,
    detail: oneDefaultOnly ? "rejected" : "a second default was allowed",
  });

  const ticketId = "eeeeeeee-0000-4000-8000-000000000002";
  await db.exec(`
    INSERT INTO hrms.tickets
      (id, org_id, reference, subject, body, requester_id, sla_policy_id)
    VALUES ('${ticketId}', '${orgA}', 'HD-ABC234', 'Laptop', 'It is broken',
            '${referrer}', '${slaPolicyId}');
  `);

  // A confidential ticket routed back to the person who raised it defeats the
  // point of it being confidential.
  let selfAssignBlocked = false;
  try {
    await db.exec(`
      INSERT INTO hrms.tickets
        (org_id, reference, subject, body, requester_id, assignee_id, is_confidential)
      VALUES ('${orgA}', 'HD-XYZ789', 'Grievance', 'Details', '${referrer}', '${referrer}', true)
    `);
  } catch {
    selfAssignBlocked = true;
  }
  checks.push({
    name: "a confidential ticket cannot be assigned to its own requester",
    pass: selfAssignBlocked,
    detail: selfAssignBlocked ? "rejected" : "self-assignment of a grievance was allowed",
  });

  // Two open pauses would double-count stopped time and make the SLA clock
  // run backwards relative to the calendar.
  await db.exec(`
    INSERT INTO hrms.ticket_pauses (org_id, ticket_id, paused_at)
    VALUES ('${orgA}', '${ticketId}', now());
  `);

  let onePauseOnly = false;
  try {
    await db.exec(`
      INSERT INTO hrms.ticket_pauses (org_id, ticket_id, paused_at)
      VALUES ('${orgA}', '${ticketId}', now())
    `);
  } catch {
    onePauseOnly = true;
  }
  checks.push({
    name: "a ticket cannot have two open SLA pauses",
    pass: onePauseOnly,
    detail: onePauseOnly ? "rejected" : "stopped time would be double-counted",
  });

  // A grievance investigation reads the event log to establish who knew what
  // and when. An editable history is not evidence.
  await db.exec(`
    INSERT INTO hrms.ticket_events (org_id, ticket_id, event_type)
    VALUES ('${orgA}', '${ticketId}', 'created');
  `);

  let ticketEventsImmutable = false;
  try {
    await db.exec(`UPDATE hrms.ticket_events SET event_type = 'tampered'`);
  } catch {
    ticketEventsImmutable = true;
  }
  checks.push({
    name: "the ticket event log rejects UPDATE",
    pass: ticketEventsImmutable,
    detail: ticketEventsImmutable ? "rejected" : "the investigation trail is editable",
  });

  // A rating outside the scale would break every average silently.
  let ratingRangeChecked = false;
  try {
    await db.exec(
      `UPDATE hrms.tickets SET satisfaction_rating = 7 WHERE id = '${ticketId}'`
    );
  } catch {
    ratingRangeChecked = true;
  }
  checks.push({
    name: "a satisfaction rating must be within the five-point scale",
    pass: ratingRangeChecked,
    detail: ratingRangeChecked ? "rejected" : "an out-of-range rating was allowed",
  });

  // The placeholder tickets table must be gone, not left beside the real one.
  const oldTickets = await db.query<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'hrms' AND table_name = 'tickets'
      AND column_name IN ('ticket_number', 'assigned_to_id', 'sla_due_at')
  `);
  checks.push({
    name: "the placeholder tickets table is replaced, not duplicated",
    pass: oldTickets.rows.length === 0,
    detail:
      oldTickets.rows.length === 0
        ? "replaced"
        : `still present: ${oldTickets.rows.map((r) => r.column_name).join(", ")}`,
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
