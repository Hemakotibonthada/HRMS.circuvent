#!/usr/bin/env node
/**
 * Clears the HRMS/ATS database back to a clean state, keeping the real
 * applicants.
 *
 * The instruction was "everything fresh except candidates and applications —
 * those are live users who applied for the job". That keep-set is wider than
 * two tables, because a candidate row on its own is not a candidate: their
 * documents, education, experience and registration answers are all part of
 * what they submitted, and an application is meaningless without the job
 * posting it was made against.
 *
 * So the keep-set is:
 *   · everything candidate_* and application*      — the applicants' own data
 *   · job_postings                                  — applications reference them
 *   · pipeline_stages                               — the board's columns
 *   · departments, locations                        — job_postings reference them
 *   · identity.organizations, users, user_roles     — or nobody can sign in
 *
 * Everything else goes: employees, attendance, leave, payroll, holidays,
 * letters, benefits, referrals, tickets, audit.
 *
 * Deletion order is discovered rather than declared. Passing repeatedly over
 * the remaining tables and keeping whatever succeeds means foreign keys sort
 * themselves out, and a table that can never be emptied is reported instead of
 * silently skipped.
 *
 * `--dry` lists what it would do and touches nothing.
 */

import { neon } from "@neondatabase/serverless";

const dry = process.argv.includes("--dry");
const url = process.env.HRMS_URL;
if (!url) {
  console.error("HRMS_URL is not set.");
  process.exit(1);
}
const sql = neon(url);

/** Kept because it is the applicants' own data, or because they depend on it. */
const KEEP = new Set([
  "hrms.candidates",
  "hrms.candidate_documents",
  "hrms.candidate_education",
  "hrms.candidate_experience",
  "hrms.candidate_credentials",
  "hrms.candidate_sessions",
  "hrms.candidate_login_codes",
  "hrms.candidate_registration",
  "hrms.candidate_registration_education",
  "hrms.candidate_registration_employment",
  "hrms.candidate_registration_references",
  "hrms.applications",
  "hrms.application_events",
  "hrms.application_sources",
  "hrms.job_postings",
  "hrms.pipeline_stages",
  "hrms.departments",
  "hrms.locations",
  "identity.organizations",
  "identity.users",
  "identity.user_roles",
  // Bookkeeping for the migration runner; clearing it would make the next
  // deploy try to re-apply every migration that has already run.
  "hrms.schema_migrations",
  // A live credential, not transactional data. The one row here is CV-365's
  // employee directory key, used yesterday — deleting it would break that
  // integration silently, and nothing in the app would say why.
  "identity.api_keys",
]);

const tables = await sql`
  SELECT table_schema, table_name
    FROM information_schema.tables
   WHERE table_schema IN ('hrms','identity') AND table_type='BASE TABLE'
   ORDER BY table_schema, table_name`;

const targets = [];
for (const t of tables) {
  const key = `${t.table_schema}.${t.table_name}`;
  if (KEEP.has(key)) continue;
  const [{ n }] = await sql.query(`SELECT count(*)::int AS n FROM "${t.table_schema}"."${t.table_name}"`);
  if (n > 0) targets.push({ key, schema: t.table_schema, name: t.table_name, n });
}

if (targets.length === 0) {
  console.log("Nothing to clear.");
  process.exit(0);
}

console.log(`${targets.length} table(s) hold data and are not in the keep-set:\n`);
for (const t of targets) console.log("  " + String(t.n).padStart(6) + "  " + t.key);

if (dry) {
  console.log(`\nDry run — nothing deleted. ${targets.reduce((s, t) => s + t.n, 0)} row(s) would go.`);
  process.exit(0);
}

console.log("\nClearing…");
let remaining = [...targets];
let cleared = 0;

for (let pass = 1; pass <= 12 && remaining.length > 0; pass++) {
  const stillBlocked = [];
  for (const t of remaining) {
    try {
      await sql.query(`DELETE FROM "${t.schema}"."${t.name}"`);
      console.log(`  ok      ${t.key} (${t.n})`);
      cleared += t.n;
    } catch (error) {
      stillBlocked.push({ ...t, lastError: String(error.message ?? error).slice(0, 120) });
    }
  }
  if (stillBlocked.length === remaining.length) {
    // A whole pass with no progress means the rest are genuinely stuck on each
    // other, not merely in the wrong order.
    console.log("\nCould not clear (reported rather than forced):");
    for (const t of stillBlocked) console.log(`  · ${t.key} — ${t.lastError}`);
    break;
  }
  remaining = stillBlocked;
}

console.log(`\n${cleared} row(s) cleared. ${remaining.length} table(s) left.`);

const kept = await sql`SELECT
  (SELECT count(*)::int FROM hrms.candidates)   AS candidates,
  (SELECT count(*)::int FROM hrms.applications) AS applications,
  (SELECT count(*)::int FROM hrms.job_postings) AS job_postings,
  (SELECT count(*)::int FROM hrms.employees)    AS employees`;
console.log("Kept:", JSON.stringify(kept[0]));
