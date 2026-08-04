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
