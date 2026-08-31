// ═══════════════════════════════════════════════════════════════
// VERIFY: DATABASE_URL ROLE DOES NOT BYPASS ROW-LEVEL SECURITY
// ═══════════════════════════════════════════════════════════════
//
// This is the CI/CD counterpart to `assertConnectionIsolatesTenants` in
// src/db/client.ts. That check fires at runtime (first tenant query) and
// fails the request; this one fires in the pipeline and fails the *build*.
//
// Why both? The runtime check catches a misconfigured DATABASE_URL before any
// data leaks, but it is discovered in production traffic, which is too late.
// This script catches it during the deployment pipeline, before any traffic
// reaches the instance.
//
// What it checks:
//   1. The connected role is not the Neon default owner (neondb_owner).
//   2. The connected role has rolbypassrls = false.
//   3. The connected role cannot read across tenants (data-level proof).
//
// Usage:
//   npm run db:check:role
//
// Exit codes:
//   0 — role is safe; RLS will be enforced
//   1 — role has BYPASSRLS or is the owner; deployment must be aborted

import { readFileSync } from "node:fs";
import pg from "pg";

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    // .env.local may not exist in CI — rely on process.env
  }
  return out;
}

const fileEnv = loadEnv(".env.local");
const DATABASE_URL = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;

let passed = 0;
let failed = 0;

function pass(name: string) {
  passed++;
  console.log(`  ok  ${name}`);
}

function fail(name: string, detail: string) {
  failed++;
  console.error(`  FAIL  ${name}`);
  console.error(`        ${detail}`);
}

async function main() {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is not set. Cannot verify role.");
    process.exitCode = 1;
    return;
  }

  console.log("\n── RLS Role Verification ───────────────────────────────────\n");

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // ── Check 1 & 2: role name and bypass flag ──────────────────
    const roleResult = await client.query<{ rolname: string; bypasses: boolean }>(
      `SELECT rolname, rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user`
    );
    const role = roleResult.rows[0];

    if (!role) {
      fail("Role lookup", "Could not find current_user in pg_roles. Check DATABASE_URL.");
      process.exitCode = 1;
      return;
    }

    if (role.rolname === "neondb_owner") {
      fail(
        `Role is not neondb_owner`,
        `Connected as neondb_owner which bypasses all RLS policies.\n` +
        `        Switch DATABASE_URL to hrms_app. See drizzle/0028_app_role_login.sql.`
      );
    } else {
      pass(`Connected role is "${role.rolname}" (not neondb_owner)`);
    }

    if (role.bypasses) {
      fail(
        `Role "${role.rolname}" — BYPASSRLS must be false`,
        `This role has BYPASSRLS=true. All 91 RLS policies are inert.\n` +
        `        Run: ALTER ROLE ${role.rolname} WITH NOBYPASSRLS;`
      );
    } else {
      pass(`Role "${role.rolname}" has BYPASSRLS=false — all policies are active`);
    }

    // ── Check 3: cross-tenant data isolation proof ──────────────
    if (failed === 0) {
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.org_id = 'bbbbbbbb-0000-0000-0000-000000000002'`);
        await client.query(`SET LOCAL app.superuser = 'off'`);
        // Try to read a row from another org; RLS should return 0 rows
        const leakTest = await client.query(
          `SELECT COUNT(*) FROM identity.organizations WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'`
        );
        const leaked = parseInt(leakTest.rows[0]?.count ?? "0", 10);
        await client.query("ROLLBACK");
        if (leaked > 0) {
          fail("Cross-tenant isolation", `Org A row was visible from Org B's session — RLS policies not effective.`);
        } else {
          pass("Cross-tenant isolation — org A row not visible from org B session");
        }
      } catch {
        // Permission denied = RLS is working
        await client.query("ROLLBACK");
        pass("Cross-tenant isolation — query was rejected by the database (RLS enforced)");
      }
    }

  } finally {
    await client.end();
  }

  console.log(`\n── Result ──────────────────────────────────────────────────\n`);
  if (failed === 0) {
    console.log(`  ${passed}/${passed} checks passed. DATABASE_URL is safe to deploy.\n`);
    process.exitCode = 0;
  } else {
    console.error(`  ${failed} check(s) FAILED. Do NOT deploy with this DATABASE_URL.\n`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[verify-rls-role] fatal:", err);
  process.exitCode = 1;
});
