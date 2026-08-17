// ═══════════════════════════════════════════════════════════════
// DOCUMENT RULES — templating, hashing and the signing envelope
// ═══════════════════════════════════════════════════════════════
// Offer letters, contracts, warnings, relieving letters. Pure, so it tests
// without a database.
//
// Two things here are load-bearing rather than convenient:
//
// 1. Rendering refuses on a missing token instead of substituting a blank. A
//    contract that says "Your salary will be " is worse than no contract, and
//    it will be signed before anyone notices.
//
// 2. Every signature records the hash of what was signed. Without it a
//    signature proves only that someone clicked a button, not what they
//    agreed to — and an unprovable signature is not worth collecting.

export interface TemplateDefinition {
  id: string;
  name: string;
  category: string;
  body: string;
  requiredTokens: string[];
  requiresSignature: boolean;
  /** Ordered roles that must sign, e.g. ["employee", "hr"]. */
  signatoryRoles: string[];
  version: number;
}

export type TokenValues = Record<string, string | number | null | undefined>;

// Matches {{ token.path }} with optional surrounding whitespace.
const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Every distinct token a template body references. */
export function extractTokens(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

export interface RenderResult {
  body: string;
  /** Tokens the template used that the caller supplied no value for. */
  missing: string[];
}

/**
 * Substitutes token values into a template body.
 *
 * Values are HTML-escaped. A candidate whose name contains an angle bracket,
 * or a "reason for termination" field pasted from elsewhere, must not be able
 * to inject markup into a document that is then rendered as HTML and signed.
 *
 * Missing tokens are reported, never silently blanked. Rendering a contract
 * with an empty salary is worse than refusing to render it.
 */
export function render(body: string, values: TokenValues): RenderResult {
  const missing: string[] = [];

  const rendered = body.replace(TOKEN_PATTERN, (_match, token: string) => {
    const value = values[token];

    if (value === undefined || value === null || value === "") {
      missing.push(token);
      // Left in place so a document rendered for preview shows exactly which
      // field is unresolved rather than a suspicious gap.
      return `{{${token}}}`;
    }

    return escapeHtml(String(value));
  });

  return { body: rendered, missing: [...new Set(missing)].sort() };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string; missing: string[] };

/**
 * Checks a template can be rendered before a generation run starts.
 *
 * Catching this up front matters for bulk generation: discovering on document
 400 that a token is unresolvable leaves 399 half-correct letters already sent.
 */
export function validateTemplate(
  template: TemplateDefinition,
  values: TokenValues,
  options: { optional?: readonly string[] } = {}
): ValidationResult {
  const optional = new Set(options.optional ?? []);
  const used = extractTokens(template.body);

  const missing = used.filter((token) => {
    if (optional.has(token)) return false;
    const value = values[token];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    return {
      valid: false,
      reason: `${missing.length} token${missing.length === 1 ? "" : "s"} could not be resolved`,
      missing,
    };
  }

  if (template.requiresSignature && template.signatoryRoles.length === 0) {
    return {
      valid: false,
      reason: "This template requires a signature but names no signatories",
      missing: [],
    };
  }

  return { valid: true };
}

// ─── Hashing ─────────────────────────────────────────────────

/**
 * SHA-256 of a document body, as lowercase hex.
 *
 * Web Crypto rather than node:crypto so the same function works in the edge
 * runtime, where a signing link is verified.
 */
export async function hashContent(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(normaliseForHash(body));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Line endings are normalised before hashing.
 *
 * Otherwise a document stored on Windows and re-read on Linux hashes
 * differently and every signature on it appears tampered with.
 */
function normaliseForHash(body: string): string {
  return body.replace(/\r\n/g, "\n");
}

/** Whether a document still matches what was signed. */
export async function verifyIntegrity(
  body: string,
  signedHash: string
): Promise<{ intact: boolean; currentHash: string }> {
  const currentHash = await hashContent(body);
  return { intact: currentHash === signedHash, currentHash };
}

// ─── Signing envelope ────────────────────────────────────────

export type EnvelopeStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "partially_signed"
  | "completed"
  | "declined"
  | "expired"
  | "voided";

export interface SignatureSlot {
  signatoryEmail: string;
  signatoryRole: string;
  sequence: number;
  viewedAt?: string;
  signedAt?: string;
  declinedAt?: string;
}

/**
 * The envelope's status, derived from its signature slots.
 *
 * Derived rather than stored-and-updated: a status column maintained by hand
 * drifts out of step with the rows it summarises, and the first time anyone
 * notices is when a fully signed contract still shows as awaiting signature.
 */
export function envelopeStatus(
  slots: SignatureSlot[],
  options: { sentAt?: string; expiresAt?: string; voidedReason?: string; now: string }
): EnvelopeStatus {
  if (options.voidedReason) return "voided";
  if (slots.some((s) => s.declinedAt)) return "declined";

  const signed = slots.filter((s) => s.signedAt);
  if (slots.length > 0 && signed.length === slots.length) return "completed";

  // Checked after completion: a document everybody signed before the deadline
  // is complete, not expired.
  if (options.expiresAt && options.expiresAt <= options.now) return "expired";

  if (!options.sentAt) return "draft";
  if (signed.length > 0) return "partially_signed";
  if (slots.some((s) => s.viewedAt)) return "viewed";

  return "sent";
}

export type SignVerdict =
  | { allowed: true; slot: SignatureSlot }
  | { allowed: false; reason: string };

/**
 * Whether a given signatory may sign right now.
 *
 * Order is enforced. A countersignature collected before the first party has
 * signed is evidence of nothing: the counterparty attested to a document the
 * other side had not yet agreed to.
 */
export function canSign(
  slots: SignatureSlot[],
  signatoryEmail: string,
  options: { sentAt?: string; expiresAt?: string; voidedReason?: string; now: string }
): SignVerdict {
  const status = envelopeStatus(slots, options);

  if (status === "voided") return { allowed: false, reason: "This document has been voided" };
  if (status === "declined") return { allowed: false, reason: "This document was declined" };
  if (status === "expired") return { allowed: false, reason: "This signing request has expired" };
  if (status === "completed") {
    return { allowed: false, reason: "This document is already fully signed" };
  }
  if (status === "draft") {
    return { allowed: false, reason: "This document has not been sent for signature" };
  }

  const email = signatoryEmail.trim().toLowerCase();
  const slot = slots.find((s) => s.signatoryEmail.trim().toLowerCase() === email);

  if (!slot) return { allowed: false, reason: "You are not a signatory on this document" };
  if (slot.signedAt) return { allowed: false, reason: "You have already signed this document" };

  const blocking = slots
    .filter((s) => s.sequence < slot.sequence)
    .filter((s) => !s.signedAt);

  if (blocking.length > 0) {
    const waitingOn = blocking.sort((a, b) => a.sequence - b.sequence)[0];
    return {
      allowed: false,
      reason: `Waiting for the ${waitingOn.signatoryRole} to sign first`,
    };
  }

  return { allowed: true, slot };
}

/** The signatories whose turn it currently is. */
export function pendingSignatories(slots: SignatureSlot[]): SignatureSlot[] {
  const unsigned = slots.filter((s) => !s.signedAt && !s.declinedAt);
  if (unsigned.length === 0) return [];

  const nextSequence = Math.min(...unsigned.map((s) => s.sequence));
  return unsigned.filter((s) => s.sequence === nextSequence);
}

/**
 * Builds signature slots from a template's roles.
 *
 * Sequence comes from position in `signatoryRoles`. Two roles at the same
 * sequence would let either sign first, which defeats the ordering the
 * template author expressed by listing them in an order.
 */
export function buildSlots(
  signatoryRoles: string[],
  recipients: Record<string, { email: string; name?: string }>
): { signatoryRole: string; signatoryEmail: string; signatoryName?: string; sequence: number }[] {
  return signatoryRoles.map((role, index) => {
    const recipient = recipients[role];
    if (!recipient?.email) {
      throw new Error(`No recipient given for the "${role}" signatory`);
    }
    return {
      signatoryRole: role,
      signatoryEmail: recipient.email.trim().toLowerCase(),
      signatoryName: recipient.name,
      sequence: index + 1,
    };
  });
}

// ─── Access tokens ───────────────────────────────────────────

/**
 * A single-use signing token and its hash.
 *
 * Only the hash is stored. A leaked database must not hand over working
 * signing links for every outstanding contract.
 */
export async function createAccessToken(): Promise<{ token: string; hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { token, hash: await hashToken(token) };
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time comparison of two hex hashes.
 *
 * A short-circuiting `===` leaks how much of a token was correct through
 * timing, which is enough to recover one byte at a time.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
