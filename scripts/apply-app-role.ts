// Grants the application role LOGIN, gives it the privileges it needs, and
// repoints .env.local at it.
//
// Run once per environment, as the database owner:
//   npx tsx scripts/apply-app-role.ts
//
// The password is generated here and written only to .env.local, which is
// gitignored. It is never printed in full and never committed — a credential
// in a repository is its own incident.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import pg from "pg";

const ENV_FILE = process.argv[2] ?? ".env.local";
const APP_ROLE = process.argv[3] ?? "hrms_app";

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

async function main() {
  const env = loadEnv(ENV_FILE);
  const ownerUrl = env.DATABASE_URL;

  if (!ownerUrl) {
    console.log(`No DATABASE_URL in ${ENV_FILE}`);
    process.exitCode = 1;
    return;
  }

  const parsed = /^postgres(?:ql)?:\/\/([^:]+):([^@]*)@([^/]+)\/([^?]+)(\?.*)?$/.exec(ownerUrl);
  if (!parsed) {
    console.log("DATABASE_URL could not be parsed");
    process.exitCode = 1;
    return;
  }

  const [, currentRole, , host, database, query = ""] = parsed;
  console.log(`Connected string names role "${currentRole}" on ${database}`);

  if (currentRole === APP_ROLE) {
    console.log(`Already using ${APP_ROLE}; nothing to do.`);
    return;
  }

  const client = new pg.Client({ connectionString: ownerUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Base64 contains characters that must be percent-encoded inside a URL, and
  // a password that breaks the connection string is a confusing failure. Hex
  // avoids the question entirely.
  const password = randomBytes(24).toString("hex");

  const schemas = (
    await client.query<{ nspname: string }>(
      `select nspname from pg_namespace
        where nspname in ('hrms','identity','payroll','public')
        order by nspname`
    )
  ).rows.map((r) => r.nspname);

  console.log(`Schemas to grant on: ${schemas.join(", ")}`);

  const exists = (
    await client.query(`select 1 from pg_roles where rolname = $1`, [APP_ROLE])
  ).rowCount;

  if (!exists) {
    console.log(`Creating role ${APP_ROLE}`);
    await client.query(`CREATE ROLE ${APP_ROLE} NOLOGIN NOBYPASSRLS`);
  }

  await client.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN NOBYPASSRLS PASSWORD '${password}'`);
  console.log(`${APP_ROLE}: LOGIN granted, NOBYPASSRLS asserted, password set`);

  for (const schema of schemas) {
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${APP_ROLE}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${APP_ROLE}`
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${APP_ROLE}`
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
         GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`
    );
  }
  console.log("Grants applied");

  // The policies call these; without EXECUTE every query errors instead of
  // returning the wrong rows, which is at least loud, but still broken.
  for (const fn of ["app_current_org()", "app_is_superuser()"]) {
    try {
      await client.query(`GRANT EXECUTE ON FUNCTION ${fn} TO ${APP_ROLE}`);
    } catch {
      console.log(`  (no function ${fn} in this database)`);
    }
  }

  await client.end();

  // ── Repoint the environment file ───────────────────────────
  const newUrl = `postgresql://${APP_ROLE}:${password}@${host}/${database}${query}`;
  const contents = readFileSync(ENV_FILE, "utf8");

  const updated = contents.includes("DATABASE_URL=")
    ? contents.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${newUrl}`)
    : `${contents.trimEnd()}\nDATABASE_URL=${newUrl}\n`;

  writeFileSync(ENV_FILE, updated);
  console.log(`${ENV_FILE} now points at ${APP_ROLE} (password hidden)`);

  // ── Prove it ───────────────────────────────────────────────
  const verify = new pg.Client({ connectionString: newUrl, ssl: { rejectUnauthorized: false } });
  await verify.connect();
  const check = (
    await verify.query<{ u: string; b: boolean }>(
      `select current_user u, (select rolbypassrls from pg_roles where rolname = current_user) b`
    )
  ).rows[0];
  await verify.end();

  console.log(`\nVerified: connects as ${check.u}, bypassrls=${check.b}`);
  if (check.b) {
    console.log("STILL BYPASSING RLS — do not deploy this.");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.log("ERROR:", (e as Error).message.slice(0, 400));
  process.exitCode = 1;
});
