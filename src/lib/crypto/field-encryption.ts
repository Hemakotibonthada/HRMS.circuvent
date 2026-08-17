// ═══════════════════════════════════════════════════════════════
// FIELD ENCRYPTION AT REST
// ═══════════════════════════════════════════════════════════════
// AES-256-GCM for the handful of columns that hold something a database dump
// must not reveal: TOTP secrets, bank details, Aadhaar and PAN numbers, and
// SSO client secrets.
//
// This exists because three separate places in the codebase already *claimed*
// it existed — `docs/DEPLOYMENT.md` listed an `ENCRYPTION_KEY`, the schema
// comment on `identity.users.mfa_secret` said "encrypted at rest", and
// `TotpEnrolment.secret` said "to persist (encrypted)". None of it was true:
// the variable was read nowhere and every column was plaintext. A false
// security claim is worse than a missing feature, because it stops anyone
// applying the control that is actually needed.
//
// GCM rather than CBC because it authenticates: a tampered ciphertext fails
// to decrypt instead of yielding plausible garbage. A random 96-bit IV per
// encryption, which is what GCM requires — reusing an IV under the same key
// leaks the XOR of two plaintexts and, worse, the authentication subkey.
//
// The consequence of a random IV is that the same input encrypts differently
// every time, so an encrypted column cannot be searched, indexed or given a
// unique constraint. That is fine for every field here — none is queried by
// value, and none carries an index — but it is the reason a blind index would
// be needed before encrypting anything that is.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** `enc.v1.<keyId>.<iv>.<ciphertext+tag>`, each part base64url. */
const PREFIX = "enc.v1.";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

interface Key {
  id: string;
  material: Buffer;
}

/**
 * Short fingerprint of a key, so a ciphertext records which key made it.
 *
 * Without this, rotation is guesswork: you would have to try every key on
 * every row and treat failure as "wrong key" — which is indistinguishable
 * from "corrupted row", exactly when you least want the ambiguity.
 */
function fingerprint(material: Buffer): string {
  return createHash("sha256").update(material).digest("hex").slice(0, 8);
}

function parseKey(value: string, variable: string): Key {
  const material = Buffer.from(value.trim(), "base64");
  if (material.length !== KEY_BYTES) {
    throw new Error(
      `${variable} must be exactly ${KEY_BYTES} bytes of base64 (got ${material.length}). ` +
        "Generate one with: openssl rand -base64 32"
    );
  }
  return { id: fingerprint(material), material };
}

/**
 * The key new writes are encrypted with.
 *
 * Read lazily rather than at module load, matching `secret()` in
 * `auth/tokens.ts`: a module that throws on import takes the whole process
 * down at build time, when the variable is legitimately absent.
 */
function currentKey(): Key {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) {
    throw new Error(
      "ENCRYPTION_KEY must be set to encrypt data at rest. " +
        "Generate one with: openssl rand -base64 32"
    );
  }
  return parseKey(value, "ENCRYPTION_KEY");
}

/**
 * Keys that may still appear on stored rows.
 *
 * `ENCRYPTION_KEY_PREVIOUS` is a comma-separated list of retired keys, kept
 * decrypt-only so a rotation does not have to happen simultaneously with a
 * rewrite of every encrypted row.
 */
function decryptionKeys(): Key[] {
  const keys = [currentKey()];

  const previous = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (previous) {
    for (const entry of previous.split(",")) {
      if (entry.trim()) keys.push(parseKey(entry, "ENCRYPTION_KEY_PREVIOUS"));
    }
  }

  return keys;
}

/** Whether a stored value is already an envelope this module produced. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** True when a key is configured, without throwing. For health checks. */
export function encryptionConfigured(): boolean {
  try {
    currentKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypts a value for storage. */
export function encryptField(plaintext: string): string {
  const key = currentKey();
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key.material, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return `${PREFIX}${key.id}.${iv.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

/**
 * Decrypts a stored value.
 *
 * A value without the envelope prefix is returned unchanged. That is
 * deliberate, and it is what makes this deployable against a live database:
 * rows written before encryption existed keep working, and the backfill
 * rewrites them separately. Only this module's own writes produce ciphertext,
 * so a plaintext row means "not yet migrated", never "an attacker downgraded
 * it".
 */
export function decryptField(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const [, , keyId, ivPart, payloadPart] = stored.split(".");
  if (!keyId || !ivPart || !payloadPart) {
    throw new Error("Encrypted value is malformed");
  }

  const key = decryptionKeys().find((candidate) => candidate.id === keyId);
  if (!key) {
    // Naming the fingerprint makes this diagnosable: it says which key is
    // missing rather than leaving an operator to guess which rotation broke.
    throw new Error(
      `No key matching fingerprint ${keyId}. ` +
        "Add the retired key to ENCRYPTION_KEY_PREVIOUS to read rows it encrypted."
    );
  }

  const iv = Buffer.from(ivPart, "base64url");
  const payload = Buffer.from(payloadPart, "base64url");
  if (payload.length < TAG_BYTES) throw new Error("Encrypted value is truncated");

  const tag = payload.subarray(payload.length - TAG_BYTES);
  const ciphertext = payload.subarray(0, payload.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key.material, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Null-tolerant wrappers, since every one of these columns is nullable. */
export function encryptNullable(plaintext: string | null | undefined): string | null {
  return plaintext === null || plaintext === undefined || plaintext === ""
    ? null
    : encryptField(plaintext);
}

export function decryptNullable(stored: string | null | undefined): string | null {
  return stored === null || stored === undefined || stored === "" ? null : decryptField(stored);
}

/**
 * Whether a stored value should be rewritten — either still plaintext, or
 * encrypted under a key that is no longer current. Drives the backfill.
 */
export function needsReEncryption(stored: string | null | undefined): boolean {
  if (stored === null || stored === undefined || stored === "") return false;
  if (!isEncrypted(stored)) return true;
  return stored.split(".")[2] !== currentKey().id;
}
