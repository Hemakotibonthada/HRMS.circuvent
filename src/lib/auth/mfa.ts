// ═══════════════════════════════════════════════════════════════
// MULTI-FACTOR AUTHENTICATION — TOTP
// ═══════════════════════════════════════════════════════════════
// RFC 6238 time-based codes, compatible with Google Authenticator, Authy and
// 1Password. Enterprise buyers treat MFA on an HR system as a baseline
// requirement, since it holds salary, bank and identity-document data.

import * as OTPAuth from "otpauth";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

const ISSUER = "Circuvent HRMS";
const DIGITS = 6;
const PERIOD_SECONDS = 30;

/**
 * Accept the immediately preceding and following code as well as the current
 * one. Phone clocks drift, and rejecting a code the user can plainly see is a
 * support call; one step either side costs 90 seconds of validity against
 * ~10^6 possibilities, which is still far tighter than the rate limit.
 */
const WINDOW = 1;

export interface TotpEnrolment {
  /**
   * Base32 secret to persist on identity.users.mfa_secret.
   *
   * Encrypt it with `lib/crypto/field-encryption` first — `POST /api/auth/mfa`
   * does. Storing it raw is what this comment used to describe as already
   * happening, and did not.
   */
  secret: string;
  /** otpauth:// URI to render as a QR code. */
  uri: string;
  /** Shown for manual entry when a camera is unavailable. */
  manualEntryKey: string;
}

export function createTotpEnrolment(accountEmail: string): TotpEnrolment {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountEmail,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret,
  });

  return {
    secret: secret.base32,
    uri: totp.toString(),
    // Grouped in fours purely so it can be read aloud or typed without losing
    // one's place.
    manualEntryKey: secret.base32.match(/.{1,4}/g)?.join(" ") ?? secret.base32,
  };
}

export function verifyTotp(secretBase32: string, code: string): boolean {
  if (!secretBase32 || !code) return false;

  // Authenticator apps display "123 456"; users paste it verbatim.
  const normalised = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalised)) return false;

  try {
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      algorithm: "SHA1",
      digits: DIGITS,
      period: PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    // validate() returns the time-step delta, or null when no step in the
    // window matches. Zero is a valid result, so this must not be truthiness.
    return totp.validate({ token: normalised, window: WINDOW }) !== null;
  } catch {
    return false;
  }
}

// ─── Backup codes ────────────────────────────────────────────

const BACKUP_CODE_COUNT = 10;

/**
 * Single-use recovery codes for a lost authenticator device. Without them, a
 * broken phone means an administrator has to disable MFA out of band, which is
 * itself an attack path.
 */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = bytesToHex(randomBytes(5)).toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

/**
 * Backup codes are stored hashed. SHA-256 suffices — unlike a password these
 * are 40 bits of uniform randomness with no reuse across sites, so there is no
 * dictionary to attack.
 */
export function hashBackupCode(code: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(code.replace(/[\s-]/g, "").toUpperCase())));
}

/**
 * Consumes a backup code, returning the remaining hashes when it matches.
 *
 * Returns null on no match. The caller must persist the returned array, since
 * a recovery code that still works after being used is not single-use.
 */
export function consumeBackupCode(
  code: string,
  storedHashes: readonly string[]
): string[] | null {
  const candidate = hashBackupCode(code);
  const index = storedHashes.indexOf(candidate);
  if (index === -1) return null;
  return storedHashes.filter((_, i) => i !== index);
}
