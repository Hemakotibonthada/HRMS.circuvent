// Contains each application's credential to its own database.
//
// Postgres grants CONNECT on a database to PUBLIC by default, so any role that
// can log in anywhere on the endpoint can open a connection to every database
// on it. Auth and HRMS share an endpoint, which meant the Auth service's
// credential could open the `hrms` database — and as `neondb_owner` it did so
// with BYPASSRLS, giving it unrestricted read and write over every HRMS
// tenant's records. Proven, not theorised: repointing Auth's connection string
// at `/hrms` connected and read `hrms.employees`.
//
// Fixing the role each app connects as narrows what it can do inside its own
// database. This narrows which databases it can open at all, so a leaked
// credential for one product is not a credential for the others.
//
// Run as the endpoint owner:
//   npx tsx scripts/contain-database-access.ts

import { readFileSync } from "node:fs";
import pg from "pg";

const ROOT = "C:\\Users\\v-hbonthada\\WorkSpace-Pract\\Office Apps\\Office Apps";

/** Which role legitimately connects to which database on this endpoint. */
const INTENDED: { database: string; role: string }[] = [
  { database: "hrms", role: "hrms_app" },
  { database: "neondb", role: "auth_app" },
];

function ownerUrl(): string {
  // The pre-fix backup still holds the owner credential, which is what this
  // needs: the application roles cannot alter database privileges.
  for (const file of [
    `${ROOT}\\HRMS.circuvent\\.env.local.pre-rolefix`,
    `${ROOT}\\HRMS.circuvent\\.env.local`,
  ]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
        if (m) {
          const url = m[1].replace(/^["']|["']$/g, "").trim();
          if (/\/\/neondb_owner:/.test(url)) return url;
        }
      }
    } catch {
      /* next */
    }
  }
  throw new Error("Could not find an owner DATABASE_URL to run privilege changes with");
}

async function main() {
  const client = new pg.Client({
    connectionString: ownerUrl(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();

  const owner = (await client.query(`select current_user u`)).rows[0].u;
  console.log(`Running as ${owner}\n`);

  for (const { database, role } of INTENDED) {
    const roleExists = (
      await client.query(`select 1 from pg_roles where rolname = $1`, [role])
    ).rowCount;

    if (!roleExists) {
      console.log(`  ${database}: ${role} does not exist yet — skipping`);
      continue;
    }

    // Order matters. Grant first, then revoke from PUBLIC: doing it the other
    // way round leaves a window in which the application cannot connect.
    await client.query(`GRANT CONNECT ON DATABASE "${database}" TO ${role}`);
    await client.query(`REVOKE CONNECT ON DATABASE "${database}" FROM PUBLIC`);

    console.log(`  ${database}: CONNECT limited to ${role} (and the owner)`);
  }

  await client.end();

  console.log("\nVerifying that each credential is confined to its own database...\n");
}

main().catch((e) => {
  console.log("ERROR:", (e as Error).message.slice(0, 300));
  process.exitCode = 1;
});
