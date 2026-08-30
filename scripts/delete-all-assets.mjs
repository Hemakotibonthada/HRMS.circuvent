#!/usr/bin/env node
/**
 * Delete every row in hrms.assets (and cascaded children).
 * Requires owner/superuser DATABASE_URL.
 *
 *   node scripts/delete-all-assets.mjs [--dry-run]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");

function loadEnv() {
  const path = resolve(__dirname, "../.env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv();

async function main() {
  const url =
    process.env.MIGRATE_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL or MIGRATE_DATABASE_URL is not set");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.superuser', 'on', true)");
    await client.query("SELECT set_config('hrms.asset_cascade_delete', 'on', true)");

    const { rows } = await client.query(
      `SELECT id::text, asset_tag, name, state FROM hrms.assets ORDER BY asset_tag`
    );
    console.log(`Found ${rows.length} asset(s)`);
    for (const row of rows) {
      console.log(`  ${row.asset_tag}  ${row.name}  (${row.state})`);
    }

    if (dryRun) {
      await client.query("ROLLBACK");
      console.log("\nDry run — nothing deleted.");
      return;
    }

    if (!rows.length) {
      await client.query("ROLLBACK");
      console.log("Nothing to delete.");
      return;
    }

    const deleted = await client.query(`DELETE FROM hrms.assets RETURNING id::text`);
    await client.query("COMMIT");
    console.log(`\nDeleted ${deleted.rowCount} asset(s).`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
