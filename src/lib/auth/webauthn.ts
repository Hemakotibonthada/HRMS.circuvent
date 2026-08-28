// ═══════════════════════════════════════════════════════════════
// WEBAUTHN — the passkey ceremonies, as pure rules
// ═══════════════════════════════════════════════════════════════
//
// There was no passkey support anywhere in this product. This is the half that
// decides whether a ceremony is valid, kept free of HTTP and the database so
// the security-critical comparisons can be tested directly rather than through
// a route.
//
// Passkeys are worth the work here because of what they remove. A password is
// replayable: phished once, it works everywhere until it is changed. A passkey
// is a key pair whose private half never leaves the authenticator, and every
// assertion is a fresh signature over a server-issued challenge — so there is
// nothing for a phishing site to capture and nothing in the database worth
// stealing.
//
// The checks below are not ceremony. Each one closes a specific attack, and
// each is named for the attack rather than the field it inspects, because the
// next person to "simplify" one needs to know what they are removing.

/** Base64url without padding, which is what WebAuthn uses throughout. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface RelyingParty {
  /** The domain the credential is bound to, e.g. "hrms.circuvent.com". */
  id: string;
  name: string;
  /** Origins allowed to complete a ceremony for this RP. */
  origins: string[];
}

export interface StoredCredential {
  credentialId: string;
  publicKey: string;
  /** The authenticator's own counter, for cloning detection. */
  signCount: number;
  transports?: string[];
  userId: string;
}

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

export type Ceremony = "webauthn.create" | "webauthn.get";

export interface Verdict {
  ok: boolean;
  /** Names the attack that was refused, not the field that failed. */
  reason?: string;
}

const OK: Verdict = { ok: true };

/**
 * Compares two strings without leaking how far they matched.
 *
 * A challenge comparison that exits at the first differing byte tells an
 * attacker, by timing, how much of a guess was right — which turns finding a
 * value into a linear search instead of an exhaustive one.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Checks the client data an authenticator signed over.
 *
 * This is where phishing is actually stopped. The browser puts the origin it
 * was really talking to into `clientDataJSON`, and the authenticator signs it —
 * so a site at `hrms.circuvent.com.evil.test` cannot produce an assertion that
 * names our origin, however convincing its page is. Skipping the origin check
 * gives up the single property that makes passkeys unphishable.
 */
export function verifyClientData(
  clientData: ClientData,
  expected: { ceremony: Ceremony; challenge: string; rp: RelyingParty }
): Verdict {
  if (clientData.type !== expected.ceremony) {
    // A registration response replayed into the login endpoint would otherwise
    // be accepted: both are signed, and only this field says which is which.
    return { ok: false, reason: "Wrong ceremony type" };
  }

  if (!constantTimeEquals(clientData.challenge, expected.challenge)) {
    // Without this, any previously captured assertion works forever.
    return { ok: false, reason: "Challenge does not match the one issued" };
  }

  if (!expected.rp.origins.includes(clientData.origin)) {
    return { ok: false, reason: "Origin is not allowed for this relying party" };
  }

  if (clientData.crossOrigin === true) {
    // An assertion produced inside an iframe on someone else's page.
    return { ok: false, reason: "Cross-origin ceremonies are refused" };
  }

  return OK;
}

/** Flags in the authenticator data byte. */
export interface AuthenticatorFlags {
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backedUp: boolean;
  attestedCredentialData: boolean;
}

export function parseFlags(flagByte: number): AuthenticatorFlags {
  return {
    userPresent: (flagByte & 0x01) !== 0,
    userVerified: (flagByte & 0x04) !== 0,
    backupEligible: (flagByte & 0x08) !== 0,
    backedUp: (flagByte & 0x10) !== 0,
    attestedCredentialData: (flagByte & 0x40) !== 0,
  };
}

/**
 * Checks the authenticator's own assertions about what happened.
 *
 * `userVerified` is required rather than optional here. Without it a passkey
 * on an unlocked, stolen phone is a single tap away from somebody's payroll
 * record — user *presence* only means a finger touched the key, not that the
 * person was authenticated. For an HR product holding salaries and statutory
 * identifiers, presence alone is not enough.
 */
export function verifyAuthenticatorData(
  input: {
    rpIdHash: string;
    flags: AuthenticatorFlags;
    signCount: number;
  },
  expected: {
    rpIdHash: string;
    requireUserVerification?: boolean;
    previousSignCount?: number;
  }
): Verdict {
  if (!constantTimeEquals(input.rpIdHash, expected.rpIdHash)) {
    // The credential belongs to a different domain.
    return { ok: false, reason: "Credential is bound to a different domain" };
  }

  if (!input.flags.userPresent) {
    return { ok: false, reason: "The authenticator reported no user present" };
  }

  if ((expected.requireUserVerification ?? true) && !input.flags.userVerified) {
    return { ok: false, reason: "This account requires biometric or PIN verification" };
  }

  // Cloning detection.
  //
  // An authenticator that reports counters increments one on every assertion.
  // A counter that goes backwards or repeats means two things are answering
  // for one credential — which is what a cloned key looks like.
  //
  // Zero is exempt: platform authenticators backed by iCloud Keychain and
  // Google Password Manager legitimately always report zero, because the
  // credential is designed to exist on several of your devices at once.
  // Treating that as cloning would reject every modern passkey.
  if (expected.previousSignCount !== undefined) {
    const both = input.signCount !== 0 || expected.previousSignCount !== 0;
    if (both && input.signCount <= expected.previousSignCount) {
      return { ok: false, reason: "This credential may have been cloned" };
    }
  }

  return OK;
}

export interface RegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout: number;
  attestation: "none";
  excludeCredentials: { type: "public-key"; id: string; transports?: string[] }[];
  authenticatorSelection: {
    residentKey: "required";
    userVerification: "required";
  };
}

/**
 * The options a client needs to create a passkey.
 *
 * `attestation: "none"` on purpose. Attestation identifies the make and model
 * of the authenticator, which this product has no policy about — asking for it
 * would collect hardware identifiers we do not use and, on Apple platforms,
 * shows the user an extra consent prompt for no benefit.
 *
 * `excludeCredentials` carries what the user already has, so an authenticator
 * that already holds a passkey for this account declines rather than silently
 * creating a second one the user then has to guess between.
 */
export function registrationOptions(input: {
  challenge: string;
  rp: RelyingParty;
  user: { id: string; email: string; displayName?: string };
  existing: StoredCredential[];
  timeoutMs?: number;
}): RegistrationOptions {
  return {
    challenge: input.challenge,
    rp: { id: input.rp.id, name: input.rp.name },
    user: {
      id: input.user.id,
      name: input.user.email,
      displayName: input.user.displayName?.trim() || input.user.email,
    },
    // ES256 first, then RS256. Both are required of conforming authenticators;
    // listing ES256 first gets the smaller, faster signature where there is a
    // choice.
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    timeout: input.timeoutMs ?? 60_000,
    attestation: "none",
    excludeCredentials: input.existing.map((c) => ({
      type: "public-key",
      id: c.credentialId,
      transports: c.transports,
    })),
    authenticatorSelection: {
      // A discoverable credential, so the user can sign in without typing an
      // email first — which is the whole point on a phone.
      residentKey: "required",
      userVerification: "required",
    },
  };
}

export interface AuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: "required";
  allowCredentials: { type: "public-key"; id: string; transports?: string[] }[];
}

/**
 * The options a client needs to use a passkey.
 *
 * `allowCredentials` is left empty deliberately. Naming the credentials an
 * account holds would answer "does this email exist here" to anyone who asks,
 * and the whole point of a discoverable credential is that the authenticator
 * already knows which key belongs to this site.
 */
export function authenticationOptions(input: {
  challenge: string;
  rp: RelyingParty;
  timeoutMs?: number;
}): AuthenticationOptions {
  return {
    challenge: input.challenge,
    rpId: input.rp.id,
    timeout: input.timeoutMs ?? 60_000,
    userVerification: "required",
    allowCredentials: [],
  };
}

export interface PendingChallenge {
  challenge: string;
  ceremony: Ceremony;
  /** Milliseconds since the epoch. */
  issuedAt: number;
  userId?: string;
}

/**
 * Whether a challenge is still usable.
 *
 * Challenges are single-use and short-lived, which is what stops a captured
 * ceremony being replayed later. The window matches the `timeout` handed to
 * the client, plus a little slack for a slow authenticator — a user who has to
 * fetch their security key from a drawer should not be told to start again.
 */
export function challengeIsFresh(
  pending: PendingChallenge,
  now: number,
  ttlMs = 90_000
): boolean {
  const age = now - pending.issuedAt;
  return age >= 0 && age <= ttlMs;
}
