// ═══════════════════════════════════════════════════════════════
// API KEYS — authentication for the public API
// ═══════════════════════════════════════════════════════════════
// Integrations cannot use the session cookie: there is no browser and no
// interactive sign-in. They present a long-lived key instead, which changes
// the threat model — a key sits in someone else's configuration file, possibly
// for years.
//
// Consequences reflected here:
//
//  * Only a hash is stored. A database leak must not yield working keys.
//  * Keys carry explicit scopes. An integration that reads the directory has
//    no business running payroll, and a compromised key should not be able to.
//  * A visible prefix is kept so a key can be identified and revoked without
//    anyone having to produce the secret.
//  * Verification is constant-time, so response timing cannot be used to
//    recover a key byte by byte.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

/** Recognisable in logs and support tickets, and greppable in a codebase. */
const KEY_PREFIX = "cvk";
const SECRET_BYTES = 24;

export type ApiScope =
  | "employees:read"
  | "employees:write"
  | "leave:read"
  | "leave:write"
  | "attendance:read"
  | "attendance:write"
  | "payroll:read"
  | "payroll:write"
  | "reports:read"
  | "webhooks:manage";

export const ALL_SCOPES: readonly ApiScope[] = [
  "employees:read",
  "employees:write",
  "leave:read",
  "leave:write",
  "attendance:read",
  "attendance:write",
  "payroll:read",
  "payroll:write",
  "reports:read",
  "webhooks:manage",
];

export interface GeneratedKey {
  /** Shown to the user exactly once. Never stored. */
  plaintext: string;
  /** Stored, and displayed thereafter so the key is identifiable. */
  prefix: string;
  hash: string;
}

/**
 * Mints a key of the form `cvk_live_<32 hex>_<48 hex>`.
 *
 * The middle segment is the public prefix; the last is the secret. Splitting
 * them lets a leaked key be located and revoked from its prefix alone, which
 * secret scanners rely on.
 */
export function generateApiKey(environment: "live" | "test" = "live"): GeneratedKey {
  const publicPart = bytesToHex(randomBytes(16));
  const secret = bytesToHex(randomBytes(SECRET_BYTES));
  const plaintext = `${KEY_PREFIX}_${environment}_${publicPart}_${secret}`;

  return {
    plaintext,
    prefix: `${KEY_PREFIX}_${environment}_${publicPart}`,
    hash: hashApiKey(plaintext),
  };
}

/**
 * SHA-256, not Argon2.
 *
 * A key is 192 bits of uniform randomness with no reuse across sites, so there
 * is no dictionary to attack and nothing for a slow KDF to defend against. It
 * would only add latency to every API call.
 */
export function hashApiKey(plaintext: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(plaintext)));
}

/** The public prefix of a presented key, or null if malformed. */
export function extractPrefix(plaintext: string): string | null {
  const parts = plaintext.split("_");
  if (parts.length !== 4 || parts[0] !== KEY_PREFIX) return null;
  if (parts[1] !== "live" && parts[1] !== "test") return null;
  if (!/^[0-9a-f]{32}$/.test(parts[2]) || !/^[0-9a-f]{48}$/.test(parts[3])) return null;
  return `${parts[0]}_${parts[1]}_${parts[2]}`;
}

/** Constant-time comparison; `===` on hashes leaks a prefix match by timing. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface StoredKey {
  id: string;
  orgId: string;
  keyHash: string;
  scopes: ApiScope[];
  rateLimitPerMinute: number;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}

export type KeyRejection = "malformed" | "not_found" | "revoked" | "expired";

export type VerificationResult =
  | { ok: true; key: StoredKey }
  | { ok: false; reason: KeyRejection };

/**
 * Verifies a presented key against the stored record for its prefix.
 *
 * The caller looks the record up by prefix — an indexed lookup rather than a
 * scan of every key's hash.
 */
export function verifyApiKey(plaintext: string, stored: StoredKey | null): VerificationResult {
  if (!extractPrefix(plaintext)) return { ok: false, reason: "malformed" };
  if (!stored) return { ok: false, reason: "not_found" };

  if (!timingSafeEqualHex(hashApiKey(plaintext), stored.keyHash)) {
    // Reported as not_found: confirming that a prefix exists but the secret is
    // wrong tells an attacker their guess was half right.
    return { ok: false, reason: "not_found" };
  }

  if (stored.revokedAt) return { ok: false, reason: "revoked" };
  if (stored.expiresAt && stored.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, key: stored };
}

/**
 * Whether a key may perform an operation.
 *
 * A write scope does not imply the matching read scope — an integration that
 * only pushes attendance punches has no reason to download the roster, and
 * implying it would quietly widen every key ever issued.
 */
export function hasScope(key: StoredKey, required: ApiScope): boolean {
  return key.scopes.includes(required);
}

export function requireScopes(key: StoredKey, required: ApiScope[]): ApiScope[] {
  return required.filter((scope) => !hasScope(key, scope));
}

/** Reads the key from `Authorization: Bearer` or `X-API-Key`. */
export function extractApiKey(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization) {
    const [scheme, token] = authorization.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token) return token.trim();
  }
  return headers.get("x-api-key")?.trim() || null;
}
