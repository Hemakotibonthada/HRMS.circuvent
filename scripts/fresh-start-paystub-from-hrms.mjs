/**
 * Orchestrates a Paystub fresh start followed by an HRMS employee backfill.
 *
 * 1. Paystub: delete payroll runs, records, and employees (keeps legal entities,
 *    pay groups, salary templates).
 * 2. HRMS: push every active employee through the transactional outbox to
 *    POST /api/sync/employees.
 *
 * Prerequisites:
 *   - Paystub/.env.local with production DATABASE_URL and PAYSTUB_ORG_ID
 *   - HRMS/.env.local with CROSS_APP_SYNC_TOKEN and PAYSTUB_SYNC_TENANT_MAP
 *
 *   node scripts/fresh-start-paystub-from-hrms.mjs
 *   node scripts/fresh-start-paystub-from-hrms.mjs --confirm
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const paystubRoot = join(root, "..", "Paystub.circuvent");
const confirm = process.argv.includes("--confirm");

const paystubArgs = ["scripts/fresh-start-from-hrms.mjs"];
if (confirm) paystubArgs.push("--confirm", "--allow-production");

console.log(confirm ? "Running Paystub fresh start…" : "Dry run: Paystub fresh start…");
const paystub = spawnSync("node", paystubArgs, {
  cwd: paystubRoot,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: undefined },
});
if (paystub.status !== 0) process.exit(paystub.status ?? 1);

if (!confirm) {
  console.log("\nDry run complete. Re-run with --confirm to sync employees from HRMS.");
  process.exit(0);
}

console.log("\nSyncing active HRMS employees to Paystub…");
const sync = spawnSync("npx", ["tsx", "scripts/sync-employees-to-paystub.ts", "--confirm"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(sync.status ?? 1);
