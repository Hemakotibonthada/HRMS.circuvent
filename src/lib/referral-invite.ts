// ═══════════════════════════════════════════════════════════════
// REFERRAL INVITES
// ═══════════════════════════════════════════════════════════════
// When an employee refers someone, that person gets an email with a link to
// fill in their own details. This module is the rules for that link.
//
// The link is the awkward part of the feature, and worth being explicit about:
// it is an **unauthenticated write into a tenant's data**. Nobody holding it
// has an account, has agreed to anything, or can be asked to prove who they
// are — the whole point is that they are outside the company. So the token has
// to carry all of the authority, and none of the trust.
//
// What follows from that:
//
//   - 256 bits of randomness. A guessable link is an open write endpoint on
//     someone else's database.
//   - Stored as a SHA-256 hash, never in plaintext, exactly like a refresh
//     token. Anyone who reads the invites table gets nothing usable; a
//     database backup is not a set of live links.
//   - It expires. A referral link that works forever is a permanent
//     unauthenticated endpoint that nobody remembers exists.
//   - One successful submission. Afterwards the link is spent, so a forwarded
//     email cannot be used to overwrite what the candidate wrote.
//   - It reveals as little as possible. The referrer may have mistyped the
//     address, in which case a stranger is holding this link.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** How long an invite stays usable. */
export const INVITE_TTL_DAYS = 14;

export type InviteState = "pending" | "submitted" | "expired" | "revoked";

export interface InviteRow {
  tokenHash: string;
  expiresAt: string;
  submittedAt?: string | null;
  revokedAt?: string | null;
}

export interface MintedInvite {
  /** Goes in the email link. Never stored. */
  token: string;
  /** Goes in the database. Never emailed. */
  tokenHash: string;
  expiresAt: string;
}

/**
 * Base64url without padding.
 *
 * The token travels in a URL, so `+`, `/` and `=` are all wrong: they get
 * percent-encoded by some mail clients and not others, and a link that works
 * in Gmail and breaks in Outlook is a support ticket nobody can reproduce.
 */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Creates a new invite token.
 *
 * `crypto.getRandomValues` rather than `Math.random`: the latter is seeded
 * predictably and is not a secret source. This token is the only thing
 * standing between a stranger and a write into someone's ATS.
 */
export function mintInvite(
  now: Date = new Date(),
  ttlDays: number = INVITE_TTL_DAYS,
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes
): MintedInvite {
  const token = base64url(randomBytes(32));
  const expires = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: expires.toISOString(),
  };
}

function defaultRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** SHA-256 hex. The same shape the refresh-token store uses. */
export function hashInviteToken(token: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

/**
 * Whether a token could possibly be one of ours.
 *
 * Checked before hitting the database so that obvious rubbish — a truncated
 * link, a crawler probing paths — costs a string comparison instead of a
 * query. It is not a security control; the hash lookup is.
 */
export function looksLikeInviteToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * The state of an invite.
 *
 * Order matters. Revoked beats everything: an invite withdrawn because the
 * referral was a mistake must not become usable again, and must not report
 * itself as merely expired. Submitted beats expired so that someone returning
 * to a link they already used is told it is done rather than told it timed
 * out, which would make them think their details were lost.
 */
export function inviteState(row: InviteRow, now: Date = new Date()): InviteState {
  if (row.revokedAt) return "revoked";
  if (row.submittedAt) return "submitted";
  if (new Date(row.expiresAt).getTime() <= now.getTime()) return "expired";
  return "pending";
}

export function isUsable(row: InviteRow, now: Date = new Date()): boolean {
  return inviteState(row, now) === "pending";
}

/** What to tell someone who cannot use the link. Never says why in detail. */
export function messageForState(state: InviteState): string {
  switch (state) {
    case "submitted":
      return "You have already sent your details. There is nothing more to do — the hiring team will be in touch.";
    case "expired":
      return "This link has expired. Ask the person who referred you to send a new one.";
    case "revoked":
      return "This link is no longer active. Ask the person who referred you to send a new one.";
    case "pending":
      return "";
  }
}

// ─── The candidate's submission ──────────────────────────────

export interface CandidateSubmission {
  fullName: string;
  email: string;
  phone?: string;
  currentEmployer?: string;
  currentTitle?: string;
  totalExperienceYears?: number;
  noticePeriodDays?: number;
  currentCtcMinor?: number;
  expectedCtcMinor?: number;
  linkedinUrl?: string;
  resumeUrl?: string;
  coverNote?: string;
  /** Explicit, and required. See below. */
  consentToProcess: boolean;
}

export type SubmissionField = keyof CandidateSubmission;

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

/**
 * Validates what the candidate typed.
 *
 * Re-validated on the server regardless of what the page checked, because the
 * page is not the thing making the request — this endpoint is reachable by
 * anyone holding the link, with any body they like.
 *
 * The consent check is not paperwork. This is unsolicited processing of an
 * outsider's personal data: they did not create an account and never agreed to
 * a privacy policy, and the referrer volunteered their address on their
 * behalf. An explicit, unticked-by-default confirmation is the only lawful
 * basis this flow has, and `governance.ts` already records consent for
 * everyone else.
 */
export function validateSubmission(
  input: Partial<CandidateSubmission>
): Partial<Record<SubmissionField, string>> {
  const errors: Partial<Record<SubmissionField, string>> = {};

  const name = input.fullName?.trim() ?? "";
  if (name.length < 2) errors.fullName = "Enter your full name";
  else if (name.length > 150) errors.fullName = "That name is too long";

  const email = input.email?.trim() ?? "";
  // Deliberately permissive. Strict email regexes reject valid addresses —
  // apostrophes, plus-addressing, new TLDs — and the only real test is whether
  // the message arrives.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address";
  } else if (email.length > 320) {
    errors.email = "That email address is too long";
  }

  if (input.phone !== undefined && input.phone.trim().length > 0) {
    // Digits, spaces and the usual punctuation. Not a format check: phone
    // numbering plans differ by country and rejecting a valid foreign number
    // is worse than storing an odd-looking one.
    if (!/^[+()\d\s-]{6,32}$/.test(input.phone.trim())) {
      errors.phone = "Enter a phone number we can reach you on";
    }
  }

  if (input.totalExperienceYears !== undefined) {
    const years = input.totalExperienceYears;
    if (!Number.isFinite(years) || years < 0 || years > 60) {
      errors.totalExperienceYears = "Enter your experience in years";
    }
  }

  if (input.noticePeriodDays !== undefined) {
    const days = input.noticePeriodDays;
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      errors.noticePeriodDays = "Enter your notice period in days";
    }
  }

  for (const field of ["currentCtcMinor", "expectedCtcMinor"] as const) {
    const value = input[field];
    if (value === undefined) continue;
    // Minor units, and an integer: a fractional paisa is not a thing, and
    // accepting one here would put a float into a bigint column.
    if (!Number.isInteger(value) || value < 0 || value > 100_000_000_000) {
      errors[field] = "Enter an amount in whole rupees";
    }
  }

  for (const field of ["linkedinUrl", "resumeUrl"] as const) {
    const value = input[field];
    if (value === undefined || value.trim().length === 0) continue;
    if (!URL_PATTERN.test(value.trim()) || value.length > 2048) {
      errors[field] = "Enter a full link, starting with https://";
    }
  }

  if (input.coverNote !== undefined && input.coverNote.length > 4000) {
    errors.coverNote = "Please keep this under 4000 characters";
  }

  if (input.consentToProcess !== true) {
    errors.consentToProcess =
      "Please confirm you are happy for us to store these details before sending them";
  }

  return errors;
}

/** Trims and drops empty optionals, so blank strings do not reach the database. */
export function normaliseSubmission(input: CandidateSubmission): CandidateSubmission {
  const text = (value?: string) => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  };

  return {
    fullName: input.fullName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: text(input.phone),
    currentEmployer: text(input.currentEmployer),
    currentTitle: text(input.currentTitle),
    totalExperienceYears: input.totalExperienceYears,
    noticePeriodDays: input.noticePeriodDays,
    currentCtcMinor: input.currentCtcMinor,
    expectedCtcMinor: input.expectedCtcMinor,
    linkedinUrl: text(input.linkedinUrl),
    resumeUrl: text(input.resumeUrl),
    coverNote: text(input.coverNote),
    consentToProcess: input.consentToProcess,
  };
}

/**
 * Builds the link that goes in the email.
 *
 * The token is a path segment, not a query parameter. Query strings are logged
 * by proxies and analytics far more readily than paths, and referrer headers
 * have historically leaked them to third-party assets on the page.
 */
export function inviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/refer/${token}`;
}
