/**
 * Issues an HRMS API key for a machine consumer (e.g. CV-365).
 *
 * The key is shown ONCE — only its SHA-256 hash is stored, so a lost key
 * cannot be recovered and must be reissued.
 *
 * Usage:
 *   node scripts/issue-api-key.mjs --name "CV-365" --org <uuid> [--scopes employees:read] [--live]
 */
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}

const argv = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i === -1 ? fallback : argv[i + 1];
};

const name = arg("--name");
const orgId = arg("--org");
const scopes = (arg("--scopes", "employees:read") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const env = argv.includes("--live") ? "live" : "test";

if (!name || !orgId) {
  console.error('Usage: node scripts/issue-api-key.mjs --name "CV-365" --org <uuid> [--scopes a,b] [--live]');
  process.exit(1);
}

// Must match extractPrefix()/hashApiKey() in src/lib/api-keys.ts.
const key = `cvk_${env}_${randomBytes(16).toString("hex")}_${randomBytes(24).toString("hex")}`;
const prefix = key.split("_").slice(0, 3).join("_");
const hash = createHash("sha256").update(key).digest("hex");

const sql = neon(process.env.DATABASE_URL);

// RLS (identity.api_keys.tenant_isolation) requires an org context. A
// transaction keeps the SET LOCAL in scope for the INSERT that follows.
const [, org, inserted] = await sql.transaction([
  sql`SELECT set_config('app.superuser', 'on', true)`,
  sql`SELECT id, name FROM identity.organizations WHERE id = ${orgId}::uuid`,
  sql`INSERT INTO identity.api_keys (org_id, name, key_prefix, key_hash, scopes, rate_limit_per_minute)
      VALUES (${orgId}::uuid, ${name}, ${prefix}, ${hash}, ${JSON.stringify(scopes)}::jsonb, 120)
      RETURNING id, created_at`,
]);

if (!org.length) {
  console.error(`No organisation ${orgId}. The key was not issued.`);
  process.exit(1);
}

console.log(`Issued "${name}" for ${org[0].name}`);
console.log(`  id      ${inserted[0].id}`);
console.log(`  scopes  ${scopes.join(", ")}`);
console.log(`\n  ${key}\n`);
console.log("Store it now — it is not recoverable.");
