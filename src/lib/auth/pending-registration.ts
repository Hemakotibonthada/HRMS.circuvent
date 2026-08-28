// ═══════════════════════════════════════════════════════════════
// PENDING REGISTRATION
// ═══════════════════════════════════════════════════════════════
//
// Registering used to create the organisation, the owner account, its leave
// policies, document templates, holiday calendar and the founder's employee
// record straight from the form — before anybody had shown they could read
// mail at the address they typed. Anyone could stand up a tenant named after
// a company they have nothing to do with, against an address belonging to
// somebody else, and the real owner of that address would only learn about it
// if the product later mailed them.
//
// So the tenant is no longer created until the address answers. This module
// holds the parts of that worth testing without a database: how the code is
// generated, how it is stored, and when an attempt should stop being allowed.
//
// ── Why a hash, and why the address is in it ──
// The code is stored hashed for the same reason a password is: a database
// dump must not hand over working sign-ups. The address is folded into the
// hash so a code is only valid for the registration it was issued for —
// otherwise six digits observed anywhere would be six digits usable
// everywhere, and a six-digit space is small enough that this matters.

import { randomInt } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** How long a code is worth trying. */
export const REGISTRATION_CODE_TTL_MINUTES = 15;

/**
 * How many wrong guesses a single code tolerates before it is dead.
 *
 * Six digits is a million combinations, which sounds ample until it is
 * divided by an attacker who can post as fast as the network allows. The
 * per-address rate limit slows that down; this is what makes a code
 * unguessable rather than merely slow to guess, because the code itself
 * expires after a handful of misses and a new one has to be requested.
 */
export const MAX_VERIFICATION_ATTEMPTS = 5;

/**
 * A six-digit code, from a cryptographically secure source.
 *
 * `randomInt` rather than `Math.random()`: this is the only thing standing
 * between a stranger and an organisation created in somebody else's name, and
 * `Math.random()` is predictable from prior output. Padded rather than
 * range-shifted so that every value from 000000 to 999999 is equally likely —
 * generating in 100000..999999 to avoid the padding would quietly throw away
 * a tenth of the space.
 */
export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * The stored form of a code.
 *
 * Bound to the address, so a code issued for one registration cannot complete
 * another. Normalised the same way the address itself is, so a difference in
 * case can never make a correct code look wrong.
 */
export function hashVerificationCode(email: string, code: string): string {
  const material = `${email.trim().toLowerCase()}:${code.trim()}`;
  return bytesToHex(sha256(new TextEncoder().encode(material)));
}

export interface PendingRegistration {
  name: string;
  company: string;
  passwordHash: string;
  attempts: number;
}

/** What `auth_tokens.metadata` carries between the two halves of sign-up. */
export function toPendingMetadata(input: {
  name: string;
  company: string;
  passwordHash: string;
}): PendingRegistration {
  return { ...input, attempts: 0 };
}

/**
 * Reads back what was stored, refusing anything that is not a whole pending
 * registration.
 *
 * A half-populated row would otherwise provision an organisation with an
 * empty name, or an owner with no password hash — an account nobody can sign
 * into and a tenant nobody can identify.
 */
export function readPendingMetadata(value: unknown): PendingRegistration | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.name !== "string" ||
    typeof v.company !== "string" ||
    typeof v.passwordHash !== "string" ||
    !v.name.trim() ||
    !v.company.trim() ||
    !v.passwordHash
  ) {
    return null;
  }
  const attempts = typeof v.attempts === "number" && v.attempts >= 0 ? v.attempts : 0;
  return { name: v.name, company: v.company, passwordHash: v.passwordHash, attempts };
}

export type VerificationOutcome =
  | { ok: true }
  | { ok: false; reason: "expired" | "consumed" | "too_many_attempts" | "wrong_code" };

/**
 * Whether a submitted code should be accepted.
 *
 * Kept pure and separate from the route so each refusal can be tested for
 * directly. The order matters: an expired or already-used token is refused
 * before the code is compared, so a correct code presented too late is never
 * treated as a wrong guess and never burns an attempt.
 */
export function checkVerification(input: {
  storedHash: string;
  submittedHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  now?: Date;
}): VerificationOutcome {
  const now = input.now ?? new Date();
  if (input.consumedAt) return { ok: false, reason: "consumed" };
  if (input.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (input.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }
  if (input.storedHash !== input.submittedHash) return { ok: false, reason: "wrong_code" };
  return { ok: true };
}

/** URL-safe organisation slug, uniquified by the caller on collision. */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "org"
  );
}
