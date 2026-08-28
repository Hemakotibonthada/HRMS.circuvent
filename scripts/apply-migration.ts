// Applies a migration file to a database whose ledger is empty.
//
// `drizzle.__drizzle_migrations` on this deployment records nothing, while
// almost every table exists — the schema was pushed rather than migrated. That
// leaves `drizzle-kit migrate` unusable: it would replay all twenty-nine
// migrations against objects that already exist and stop at the first
// collision, having possibly applied half of one.
//
// Meanwhile the newest migration genuinely had not been applied, so
// `hrms.lifecycle_tasks` did not exist and `/api/notifications` answered 500
// for every user — the onboarding and offboarding features with it.
//
// This applies one file statement by statement and tolerates the errors that
// mean "already done", so it converges on the intended schema whatever state
// it starts from. It reports what it skipped rather than staying quiet, since
// a silent skip is how a half-applied migration hides.
//
//   npx tsx scripts/apply-migration.ts drizzle/0027_employee_lifecycle.sql

import "./load-env";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";

const file = process.argv[2];
if (!file) {
  console.log("usage: apply-migration.ts <path to .sql>");
  process.exit(1);
}

/** Errors that mean the object is already in the state we want. */
const BENIGN = [
  "already exists",
  "duplicate key value",
  "duplicate object",
  "is already a member",
];

function statementsOf(contents: string): string[] {
  return contents
    // Drizzle writes this separator; splitting on it keeps DO $$ ... $$ blocks
    // intact, which a naive split on ";" would tear apart.
    .split(/-->\s*statement-breakpoint/)
    .flatMap((chunk) =>
      chunk.includes("$$") ? [chunk] : chunk.split(/;\s*$/m)
    )
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);
}

async function main() {
  const statements = statementsOf(readFileSync(file, "utf8"));
  console.log(`\n${file}: ${statements.length} statements\n`);

  let ran = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const statement of statements) {
    const label = statement.replace(/\s+/g, " ").slice(0, 78);
    try {
      await withTenant({ orgId: "", superuser: true }, async (tx) => {
        await tx.execute(sql.raw(statement));
      });
      ran++;
      console.log(`  ran     ${label}`);
    } catch (error) {
      const message = (error as Error).message;
      const cause = (error as { cause?: Error }).cause?.message ?? "";
      const combined = `${message} ${cause}`.toLowerCase();

      if (BENIGN.some((b) => combined.includes(b))) {
        skipped++;
        console.log(`  skipped ${label}`);
      } else {
        problems.push(`${label}\n      ${(cause || message).slice(0, 200)}`);
        console.log(`  FAILED  ${label}`);
      }
    }
  }

  console.log(`\n${ran} applied, ${skipped} already present, ${problems.length} failed.`);
  if (problems.length > 0) {
    console.log("\nFailures:");
    for (const p of problems) console.log(`  · ${p}`);
    process.exitCode = 1;
  }
  console.log("");
}

main()
  .catch((e) => {
    console.log("ERROR:", (e as Error).message.slice(0, 400));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 200));
