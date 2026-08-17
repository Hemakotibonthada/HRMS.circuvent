// ═══════════════════════════════════════════════════════════════
// NEON DATABASE CLIENT
// ═══════════════════════════════════════════════════════════════
// Two drivers, deliberately:
//
//   neon-http  — one HTTP round-trip per query, works on the Vercel edge
//                runtime. Used for the majority of reads. It cannot hold a
//                transaction open, so it cannot carry a session GUC.
//   node-pg    — a real pooled TCP connection. Required for transactions and
//                therefore for anything relying on row-level security, since
//                `SET LOCAL app.org_id` only survives inside a transaction.
//
// Tenant isolation lives in the database (RLS policies read
// `current_setting('app.org_id')`), which is stronger than the Firestore
// approach in src/lib/tenant.ts where a forgotten `where` clause silently read
// across tenants.

import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

import * as schema from "./schema";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Fail loudly at first use. Silently falling back to a default connection
    // is how the hardcoded Firebase credentials problem started.
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and point it at your Neon branch."
    );
  }
  return url;
}

// ─── Edge / serverless read client ───────────────────────────

let httpDb: ReturnType<typeof drizzleHttp<typeof schema>> | undefined;

/**
 * Stateless HTTP client. Fast and edge-compatible, but it cannot open a
 * transaction, so it cannot set the tenant GUC — use it only for queries that
 * are already explicitly scoped, or for genuinely global tables.
 */
export function edgeDb() {
  if (!httpDb) {
    httpDb = drizzleHttp(neon(connectionString()), { schema, casing: "snake_case" });
  }
  return httpDb;
}

// ─── Pooled client ───────────────────────────────────────────

const globalForDb = globalThis as unknown as { _pgPool?: Pool };

function pool(): Pool {
  // Next.js dev server hot-reloads modules; without this the pool leaks a new
  // set of connections on every reload and exhausts the Neon connection limit.
  if (!globalForDb._pgPool) {
    globalForDb._pgPool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForDb._pgPool;
}

let nodeDb: NodePgDatabase<typeof schema> | undefined;

/** Pooled client. Supports transactions and therefore RLS. */
export function db(): NodePgDatabase<typeof schema> {
  if (!nodeDb) {
    nodeDb = drizzleNode(pool(), { schema, casing: "snake_case" });
  }
  return nodeDb;
}

// ─── Tenant-scoped execution ─────────────────────────────────

export interface TenantContext {
  orgId: string;
  userId?: string;
  /** Bypasses RLS. Only for platform administration and migrations. */
  superuser?: boolean;
}

/**
 * Refuses to run tenant-scoped queries on a connection that ignores RLS.
 *
 * Every policy in this database is written as
 * `app_is_superuser() OR org_id = app_current_org()`, and there are ninety-one
 * of them. None of that has any effect if the connected role has
 * `rolbypassrls`, which Postgres grants to a database owner: the policies are
 * still there, `\d` still lists them, the migrations still apply, and every
 * query silently returns every tenant's rows.
 *
 * That was the state of this deployment. `hrms_app` existed with
 * `rolbypassrls = false`, exactly as designed, but had never been granted
 * LOGIN — so the only role that could actually connect was `neondb_owner`, and
 * `DATABASE_URL` pointed at it. Two organisations shared the database and
 * either could read the other's payroll. Nothing in the test suite could have
 * caught it: the isolation tests run against PGlite as a role that does not
 * bypass RLS, so they proved the policies correct while production ran without
 * them.
 *
 * The check is one query, taken once per pool and memoised, and it fails
 * closed. An HR product holding salaries and Aadhaar numbers should stop
 * rather than serve one tenant another's records.
 *
 * `ALLOW_RLS_BYPASS=true` is the escape hatch for a genuinely single-tenant
 * deployment or for running migrations. It has to be set deliberately, which
 * is the point — the previous behaviour was the same risk taken by accident.
 */
let isolationCheck: Promise<void> | undefined;

async function assertConnectionIsolatesTenants(): Promise<void> {
  if (process.env.ALLOW_RLS_BYPASS === "true") return;

  const result = await pool().query<{ rolname: string; bypasses: boolean }>(
    `select rolname, rolbypassrls as bypasses
       from pg_roles
      where rolname = current_user`
  );

  const role = result.rows[0];
  if (!role || !role.bypasses) return;

  throw new Error(
    `Refusing to serve tenant data: the database role "${role.rolname}" has ` +
      `BYPASSRLS, so all ${"91"} row-level security policies are inert and every ` +
      `query returns every tenant's rows.\n\n` +
      `Connect as a role that does not bypass RLS. This database already has ` +
      `"hrms_app" for that purpose; it needs LOGIN and a password:\n` +
      `  ALTER ROLE hrms_app WITH LOGIN PASSWORD '<secret>';\n` +
      `then point DATABASE_URL at it. See drizzle/0028_app_role_login.sql.\n\n` +
      `If this really is a single-tenant deployment, set ALLOW_RLS_BYPASS=true.`
  );
}

/**
 * Runs `fn` inside a transaction whose tenant GUC is set, so every RLS policy
 * evaluates against this organization.
 *
 * `SET LOCAL` is scoped to the transaction and is reset automatically when it
 * ends, which matters because the connection returns to a shared pool
 * afterwards — a plain `SET` would leak one tenant's context into the next
 * request that borrowed the same connection.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0]) => Promise<T>
): Promise<T> {
  if (!ctx.orgId && !ctx.superuser) {
    throw new Error("withTenant requires an orgId; refusing to query across tenants");
  }

  // Memoised, so this costs one query per process rather than one per request.
  // A rejected promise is cleared so a transient failure does not permanently
  // poison the pool.
  //
  // Skipped for a superuser context, which is the explicit administrative path
  // — migrations, seeding, cross-tenant maintenance — and already bypasses the
  // policies by design through `app_is_superuser()`. Applying the check here
  // too made `apply-migration.ts` fail on every statement: DDL has to run as
  // the owner, and the owner is precisely the role the guard exists to reject
  // for tenant traffic. The guard protects tenant-scoped queries, which is
  // what it claims to do and all it should do.
  if (!ctx.superuser) {
    if (!isolationCheck) {
      isolationCheck = assertConnectionIsolatesTenants().catch((error) => {
        isolationCheck = undefined;
        throw error;
      });
    }
    await isolationCheck;
  }

  return db().transaction(async (tx) => {
    // Parameterised via set_config rather than string interpolation, so an
    // attacker-controlled orgId cannot inject SQL into the GUC statement.
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId ?? ""}, true),
                 set_config('app.user_id', ${ctx.userId ?? ""}, true),
                 set_config('app.superuser', ${ctx.superuser ? "on" : "off"}, true)`
    );
    return fn(tx);
  });
}

export { schema };
export type Database = NodePgDatabase<typeof schema>;
