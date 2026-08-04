// ═══════════════════════════════════════════════════════════════
// PASSWORD HASHING — Argon2id
// ═══════════════════════════════════════════════════════════════
// Replaces Firebase Auth's password handling. Firebase hashes cannot be
// verified outside Firebase, so imported accounts carry `must_reset_password`
// and set a new one on first sign-in (docs/PLATFORM-ARCHITECTURE.md §3).
//
// Argon2id rather than bcrypt because it is memory-hard: an attacker with GPUs
// cannot parallelise it nearly as cheaply. Parameters follow the OWASP
// Password Storage Cheat Sheet minimum (19 MiB, t=2, p=1), which also fits
// inside a Vercel function's memory budget.
//
// The implementation is @noble/hashes — pure TypeScript, so it runs unchanged
// on Node, the edge runtime and in tests, unlike native argon2 bindings that
// need a per-platform build.

import { argon2idAsync } from "@noble/hashes/argon2.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

const MEMORY_KIB = 19_456; // 19 MiB
const TIME_COST = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const ALGORITHM = "argon2id";
const VERSION = 19;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/=+$/, "");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/**
 * Hashes a password into PHC string format:
 *
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 *
 * The parameters travel with the hash, so raising the cost later does not
 * invalidate existing passwords — old hashes keep verifying with their own
 * settings and are rehashed on the next successful sign-in.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Password must not be empty");

  const salt = randomBytes(SALT_BYTES);
  const hash = await argon2idAsync(new TextEncoder().encode(password), salt, {
    m: MEMORY_KIB,
    t: TIME_COST,
    p: PARALLELISM,
    dkLen: HASH_BYTES,
  });

  return `$${ALGORITHM}$v=${VERSION}$m=${MEMORY_KIB},t=${TIME_COST},p=${PARALLELISM}$${toBase64(salt)}$${toBase64(hash)}`;
}

interface ParsedHash {
  memory: number;
  time: number;
  parallelism: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function parse(encoded: string): ParsedHash | null {
  const parts = encoded.split("$");
  // ["", "argon2id", "v=19", "m=...,t=...,p=...", salt, hash]
  if (parts.length !== 6 || parts[1] !== ALGORITHM) return null;

  const params = Object.fromEntries(
    parts[3].split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, Number(v)];
    })
  );
  if (!params.m || !params.t || !params.p) return null;

  try {
    return {
      memory: params.m,
      time: params.t,
      parallelism: params.p,
      salt: fromBase64(parts[4]),
      hash: fromBase64(parts[5]),
    };
  } catch {
    return null;
  }
}

/** Constant-time comparison; `===` on hashes leaks length and prefix by timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parse(encoded);
  // A malformed or absent hash must fail, never throw — a stored-value problem
  // should not become a 500 that tells an attacker "no such user" as distinct
  // from "wrong password".
  if (!parsed || !password) return false;

  const candidate = await argon2idAsync(new TextEncoder().encode(password), parsed.salt, {
    m: parsed.memory,
    t: parsed.time,
    p: parsed.parallelism,
    dkLen: parsed.hash.length,
  });

  return timingSafeEqual(candidate, parsed.hash);
}

/** True when a stored hash predates the current cost settings. */
export function needsRehash(encoded: string): boolean {
  const parsed = parse(encoded);
  if (!parsed) return true;
  return (
    parsed.memory < MEMORY_KIB || parsed.time < TIME_COST || parsed.parallelism !== PARALLELISM
  );
}

/**
 * A real hash to verify against when the account does not exist.
 *
 * Returning immediately for an unknown email makes sign-in measurably faster
 * for non-users than for real ones, turning the login form into an
 * account-enumeration oracle. Callers hash against this instead.
 */
export const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function fakeVerify(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

/** Opaque, high-entropy token for refresh cookies, invites and resets. */
export function generateToken(bytes = 32): string {
  return bytesToHex(randomBytes(bytes));
}
