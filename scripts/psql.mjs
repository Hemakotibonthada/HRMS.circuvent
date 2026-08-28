/**
 * Run a SQL statement against the Paystub database from the command line.
 *
 * Every table in this database carries `FORCE ROW LEVEL SECURITY`, so a query
 * run without `app.org_id` set returns zero rows rather than an error. That is
 * indistinguishable from "there is no such data", which has cost real time
 * more than once. This script therefore sets the tenant for the transaction
 * when an org is supplied, and says out loud when it has not.
 *
 *   node scripts/psql.mjs "<sql>" [orgId]
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      // absent file is fine
    }
  }
}

loadEnv();

const sql = process.argv[2];
const orgId = process.argv[3] ?? process.env.PAYSTUB_ORG_ID ?? null;
if (!sql) {
  console.error("usage: node scripts/psql.mjs \"<sql>\" [orgId]");
  process.exit(2);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("begin");
  if (process.env.PSQL_SUPERUSER === "1") {
    // Transaction-scoped escape hatch for administrative reads. Deliberately
    // opt-in per invocation: it lifts tenant isolation for the statement.
    await client.query("select set_config('app.superuser', 'on', true)");
  }
  if (orgId) {
    // Transaction-scoped, never session-scoped: DATABASE_URL is a pooler, and
    // a session-level setting outlives this client on the shared backend.
    await client.query("select set_config('app.org_id', $1, true)", [orgId]);
  } else {
    console.error("[psql] no org id — row level security will hide tenant rows");
  }
  const result = await client.query(sql);
  await client.query("commit");
  if (Array.isArray(result)) {
    for (const r of result) console.log(JSON.stringify(r.rows ?? [], null, 2));
  } else {
    console.log(JSON.stringify(result.rows ?? [], null, 2));
  }
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
