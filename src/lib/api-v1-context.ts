// ═══════════════════════════════════════════════════════════════
// PUBLIC API CONTEXT — API key authentication
// ═══════════════════════════════════════════════════════════════
// Authentication for /api/v1/*, which integrations call. Distinct from
// src/lib/api-context.ts, which authenticates a browser session.
//
// The difference matters. A session belongs to a person with a role; an API
// key belongs to a system with scopes. Reusing the role model would mean
// giving an integration a human's whole permission set to let it read the
// directory, which is exactly the over-permissioning that makes a leaked key
// catastrophic.

import type { NextRequest } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { apiKeys } from "@/db/schema/identity";
import {
  extractApiKey,
  extractPrefix,
  requireScopes,
  verifyApiKey,
  type ApiScope,
  type StoredKey,
} from "@/lib/api-keys";
import { checkRateLimit } from "@/lib/api-context";

export interface ApiKeyContext {
  orgId: string;
  keyId: string;
  scopes: ApiScope[];
  /** Present so repositories can be constructed with a tenant context. */
  superuser?: false;
}

export class ApiKeyError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 429,
    readonly missingScopes?: ApiScope[]
  ) {
    super(message);
    this.name = "ApiKeyError";
  }
}

/**
 * Authenticates and authorises a public API request.
 *
 * The key is located by its public prefix — an indexed lookup — and only then
 * compared by hash. Scanning every key's hash would be both slow and a timing
 * side channel.
 */
export async function requireApiKey(
  request: NextRequest,
  scopes: ApiScope[]
): Promise<ApiKeyContext> {
  const presented = extractApiKey(request.headers);
  if (!presented) {
    throw new ApiKeyError(
      "Provide an API key as `Authorization: Bearer <key>` or `X-API-Key`",
      401
    );
  }

  const prefix = extractPrefix(presented);
  if (!prefix) throw new ApiKeyError("Malformed API key", 401);

  // Read as superuser: the organization is the result of this lookup, so it
  // cannot be known beforehand to scope the query.
  const record = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const rows = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)))
      .limit(1);
    return rows[0] ?? null;
  });

  const stored: StoredKey | null = record
    ? {
        id: record.id,
        orgId: record.orgId,
        keyHash: record.keyHash,
        scopes: (record.scopes as ApiScope[]) ?? [],
        rateLimitPerMinute: record.rateLimitPerMinute,
        expiresAt: record.expiresAt,
        revokedAt: record.revokedAt,
      }
    : null;

  const result = verifyApiKey(presented, stored);
  if (!result.ok) {
    // Every rejection reads the same to the caller. Distinguishing "revoked"
    // from "no such key" confirms that a key once existed.
    const message =
      result.reason === "expired" ? "This API key has expired" : "Invalid API key";
    throw new ApiKeyError(message, 401);
  }

  const missing = requireScopes(result.key, scopes);
  if (missing.length > 0) {
    // Named explicitly: unlike authentication failures, an integrator needs to
    // know which scope to add, and the key is already proven genuine.
    throw new ApiKeyError(
      `This key is missing the required scope(s): ${missing.join(", ")}`,
      403,
      missing
    );
  }

  const limit = checkRateLimit(
    `apikey:${result.key.id}`,
    result.key.rateLimitPerMinute,
    60_000
  );
  if (!limit.allowed) {
    throw new ApiKeyError("Rate limit exceeded for this API key", 429);
  }

  // Best-effort usage stamp for the key-management UI. Deliberately not
  // awaited into the critical path — a failed bookkeeping write must not
  // reject an otherwise valid request.
  void withTenant({ orgId: result.key.orgId, superuser: true }, async (tx) => {
    await tx
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(apiKeys.id, result.key.id));
  }).catch(() => {});

  return { orgId: result.key.orgId, keyId: result.key.id, scopes: result.key.scopes };
}

/** Response headers every v1 route returns, for client-side diagnostics. */
export function apiVersionHeaders(): Record<string, string> {
  return {
    "x-api-version": "2026-04-01",
    // Integrations should not cache tenant data at a shared proxy.
    "cache-control": "private, no-store",
  };
}
