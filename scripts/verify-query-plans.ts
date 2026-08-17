// Proves the indexes in 0026 actually change the query plan.
//
// An index that is never chosen is worse than no index: it costs write
// throughput on every insert and storage forever, and it buys nothing. The
// only way to know is to ask the planner, so this loads enough rows for a
// sequential scan to stop being the cheap option and then reads EXPLAIN.
//
// The queries mirror what the repositories actually issue, including the
// `org_id` predicate that row-level security adds to every one of them.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");
const ROWS = 4000;

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

async function applyMigrations(db: PGlite) {
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
}

async function plan(db: PGlite, sql: string): Promise<string> {
  const rows = (await db.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`)).rows;
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

async function main() {
  console.log("Query plans for list endpoints\n");

  const db = new PGlite();
  await applyMigrations(db);

  const org = (
    await db.query<{ id: string }>(
      `INSERT INTO identity.organizations (name, slug) VALUES ('Big', 'big') RETURNING id`
    )
  ).rows[0].id;

  const employee = (
    await db.query<{ id: string }>(
      `INSERT INTO hrms.employees (org_id, employee_code, first_name, last_name, work_email, designation, join_date)
       VALUES ($1, 'E-1', 'Asha', 'Rao', 'asha@big.test', 'Engineer', '2024-01-01') RETURNING id`,
      [org]
    )
  ).rows[0].id;

  // Enough rows that a sequential scan plus a sort is no longer the cheapest
  // plan. A few dozen would tell us nothing — the planner would rightly scan.
  console.log(`  seeding ${ROWS} expense claims…`);
  await db.exec(`
    INSERT INTO hrms.expense_claims
      (org_id, employee_id, claim_number, title, category, total_amount_minor, expense_date, created_at)
    SELECT
      '${org}', '${employee}',
      'EXP-2026-' || lpad(g::text, 6, '0'),
      'Claim ' || g,
      'travel',
      (g * 137) % 500000,
      DATE '2026-01-01' + ((g % 365) || ' days')::interval,
      NOW() - ((g % 900) || ' days')::interval
    FROM generate_series(1, ${ROWS}) g;
  `);

  // Without statistics the planner is guessing, and a plan built on a guess
  // proves nothing about the index.
  await db.exec(`ANALYZE hrms.expense_claims`);

  const listQuery = `
    SELECT id, title, total_amount_minor
    FROM hrms.expense_claims
    WHERE org_id = '${org}'
    ORDER BY created_at DESC
    LIMIT 50
  `;

  const listPlan = await plan(db, listQuery);
  console.log("\n  --- newest-first list ---");
  console.log(
    listPlan
      .split("\n")
      .map((l) => "  " + l)
      .join("\n")
  );

  check(
    "the newest-first list uses an index",
    /Index (Scan|Only Scan)/.test(listPlan),
    listPlan
  );
  check(
    "and no longer sorts the whole tenant to return fifty rows",
    !/\bSort\b/.test(listPlan),
    listPlan
  );

  const rangeQuery = `
    SELECT id FROM hrms.expense_claims
    WHERE org_id = '${org}' AND expense_date BETWEEN '2026-03-01' AND '2026-03-31'
  `;

  const rangePlan = await plan(db, rangeQuery);
  console.log("\n  --- finance date-range export ---");
  console.log(
    rangePlan
      .split("\n")
      .map((l) => "  " + l)
      .join("\n")
  );

  check("the date-range export uses an index", /Index (Scan|Only Scan)/.test(rangePlan), rangePlan);

  // ── The counterfactual ─────────────────────────────────────
  // Dropping the index should send the planner back to a scan and a sort. If
  // it does not, the index was not what changed the plan and the check above
  // was measuring something else.
  await db.exec(`DROP INDEX hrms.expense_claims_org_created_idx`);
  await db.exec(`ANALYZE hrms.expense_claims`);

  const withoutIndex = await plan(db, listQuery);
  console.log("\n  --- same query, index dropped ---");
  console.log(
    withoutIndex
      .split("\n")
      .map((l) => "  " + l)
      .join("\n")
  );

  check(
    "dropping the index brings the sort back, so the index is what removed it",
    /\bSort\b/.test(withoutIndex) || /Seq Scan/.test(withoutIndex),
    withoutIndex
  );

  await db.close();

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Index verification failed:", error);
  process.exit(1);
});
