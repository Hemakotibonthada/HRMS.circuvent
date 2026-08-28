// ═══════════════════════════════════════════════════════════════
// SSO — OIDC authorization code flow with PKCE
// ═══════════════════════════════════════════════════════════════
// Connection routing, authorization URLs, ID token validation and claim
// mapping.
//
// ── On SAML ──────────────────────────────────────────────────
//
// SAML is deliberately NOT implemented here by hand. Verifying a SAML
// assertion means verifying an XML digital signature, and XML signature
// wrapping is a class of vulnerability that has broken almost every
// hand-rolled implementation ever written: the attacker moves the signed
// element elsewhere in the document so the signature still verifies against
// content the parser no longer reads, and the assertion is accepted as
// authentic while saying something entirely different.
//
// Getting that right requires canonicalisation, reference resolution and
// same-document-reference checks that a vetted library already does. When SAML
// is added it must go through such a library (`@node-saml/node-saml` or
// equivalent), with signed assertions required, `wantAssertionsSigned` on, and
// the IdP certificate pinned. A partial implementation would authenticate
// attackers, which is worse than not offering SAML at all.
//
// OIDC below is different: the assertion is a JWT, `jose` verifies it against
// the provider's published JWKS, and the checks that remain are simple
// equality comparisons written out explicitly.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface OidcConnection {
  id: string;
  /** Email domains routed to this provider. */
  domains: string[];
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  scopes: string[];
  /** Maps provider claims onto internal fields. */
  claimMapping?: Record<string, string>;
  /** Creates an account on first successful sign-in. */
  allowJitProvisioning: boolean;
  /** Role given to a JIT-provisioned user. */
  defaultRole: string;
  isActive: boolean;
}

export class SsoError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "SsoError";
  }
}

/**
 * Which connection handles an email address.
 *
 * Matching is on the domain only, and case-insensitively. A user typing
 * `Asha@Example.COM` must reach the same provider as `asha@example.com`, or
 * they get an unexplained failure they cannot work around.
 */
export function connectionForEmail(
  email: string,
  connections: OidcConnection[]
): OidcConnection | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;

  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return null;

  return (
    connections
      .filter((c) => c.isActive)
      .find((c) => c.domains.some((d) => d.trim().toLowerCase() === domain)) ?? null
  );
}

// ─── PKCE ────────────────────────────────────────────────────

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generates a PKCE verifier and its S256 challenge.
 *
 * PKCE is used even though this is a confidential client with a secret.
 * It costs nothing and it closes authorization-code interception: without it,
 * a code leaked through a redirect, a log or browser history can be exchanged
 * by anyone who also has the client credentials.
 */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64Url(bytes);

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** A random value for `state` or `nonce`. */
export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * Builds the URL the browser is sent to.
 *
 * `state` and `nonce` are separate values with separate jobs: `state` is
 * checked on the redirect back to stop cross-site request forgery of the
 * callback, and `nonce` is checked inside the ID token to stop a token
 * obtained elsewhere being replayed here. Reusing one value for both leaves
 * whichever attack the reused value is not being checked against.
 */
export async function buildAuthorizationRequest(
  connection: OidcConnection,
  redirectUri: string,
  loginHint?: string
): Promise<AuthorizationRequest> {
  if (!connection.isActive) {
    throw new SsoError("This single sign-on connection is disabled", 403);
  }
  assertHttps(connection.authorizationEndpoint, "authorization endpoint");
  assertHttps(redirectUri, "redirect URI");

  const { verifier, challenge } = await createPkce();
  const state = randomToken();
  const nonce = randomToken();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: connection.clientId,
    redirect_uri: redirectUri,
    scope: [...new Set(["openid", "email", "profile", ...connection.scopes])].join(" "),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  // Pre-fills the provider's form so the user is not asked for an address they
  // have already typed.
  if (loginHint) params.set("login_hint", loginHint);

  const separator = connection.authorizationEndpoint.includes("?") ? "&" : "?";

  return {
    url: `${connection.authorizationEndpoint}${separator}${params.toString()}`,
    state,
    nonce,
    codeVerifier: verifier,
  };
}

/**
 * Refuses a plaintext endpoint.
 *
 * An authorization code or token travelling over HTTP is readable by anything
 * on the path. localhost is exempted so a developer can run a local provider.
 */
export function assertHttps(url: string, what: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsoError(`The ${what} is not a valid URL`, 400);
  }

  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new SsoError(`The ${what} must use HTTPS`, 400);
  }
}

// ─── Callback validation ─────────────────────────────────────

export interface StoredAuthState {
  state: string;
  nonce: string;
  codeVerifier: string;
  connectionId: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * Validates the redirect back from the provider.
 *
 * Compared in constant time. A short-circuiting comparison on `state` leaks
 * how much of it was correct, and `state` is the only thing standing between
 * the callback and a forged sign-in.
 */
export function validateCallback(
  received: { state?: string; code?: string; error?: string; errorDescription?: string },
  stored: StoredAuthState | null,
  now = Date.now()
): { code: string; nonce: string; codeVerifier: string; connectionId: string } {
  if (received.error) {
    // Surfaced rather than swallowed: "access_denied" means the user cancelled
    // and should be told so, not shown a generic failure.
    throw new SsoError(
      received.errorDescription
        ? `${received.error}: ${received.errorDescription}`
        : received.error,
      400
    );
  }

  if (!stored) throw new SsoError("This sign-in session has expired. Please try again.", 400);
  if (stored.expiresAt <= now) {
    throw new SsoError("This sign-in session has expired. Please try again.", 400);
  }
  if (!received.state || !timingSafeEqual(received.state, stored.state)) {
    throw new SsoError("This sign-in could not be verified. Please try again.", 400);
  }
  if (!received.code) throw new SsoError("The provider returned no authorization code", 400);

  return {
    code: received.code,
    nonce: stored.nonce,
    codeVerifier: stored.codeVerifier,
    connectionId: stored.connectionId,
  };
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── ID token ────────────────────────────────────────────────

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(uri: string) {
  // Cached because createRemoteJWKSet holds its own key cache and rate limit;
  // building a new one per request refetches the key set every sign-in and
  // will eventually be throttled by the provider.
  let existing = jwksCache.get(uri);
  if (!existing) {
    existing = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, existing);
  }
  return existing;
}

/**
 * Verifies an ID token.
 *
 * Signature, issuer, audience and expiry are checked by `jose`. The nonce is
 * checked here because `jose` does not know about it — and without it, a token
 * legitimately issued for a different session of the same application can be
 * replayed into this one.
 */
export async function verifyIdToken(
  idToken: string,
  connection: OidcConnection,
  expectedNonce: string
): Promise<JWTPayload> {
  let payload: JWTPayload;

  try {
    ({ payload } = await jwtVerify(idToken, jwks(connection.jwksUri), {
      issuer: connection.issuer,
      audience: connection.clientId,
      // Providers' clocks drift. Thirty seconds accommodates that without
      // meaningfully widening the window for a stolen token.
      clockTolerance: 30,
    }));
  } catch (e) {
    throw new SsoError(`The provider's response could not be verified: ${(e as Error).message}`, 401);
  }

  if (typeof payload.nonce !== "string" || !timingSafeEqual(payload.nonce, expectedNonce)) {
    throw new SsoError("The provider's response did not match this sign-in attempt", 401);
  }

  return payload;
}

// ─── Claim mapping ───────────────────────────────────────────

export interface SsoIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  displayName?: string;
  groups: string[];
}

/**
 * Maps ID token claims onto an identity.
 *
 * `email_verified` is carried through rather than assumed. A provider that
 * lets a user set an unverified address, matched against an existing account
 * by email, is an account takeover — so the caller can refuse to link on it.
 */
export function mapClaims(
  payload: JWTPayload,
  mapping: Record<string, string> = {}
): SsoIdentity {
  const read = (internal: string, ...defaults: string[]): unknown => {
    const claim = mapping[internal];
    if (claim && payload[claim] !== undefined) return payload[claim];
    for (const key of defaults) {
      if (payload[key] !== undefined) return payload[key];
    }
    return undefined;
  };

  const subject = payload.sub;
  if (typeof subject !== "string" || !subject) {
    throw new SsoError("The provider's response carried no subject", 401);
  }

  const email = String(read("email", "email", "preferred_username", "upn") ?? "")
    .trim()
    .toLowerCase();

  if (!email.includes("@")) {
    throw new SsoError("The provider's response carried no email address", 401);
  }

  let firstName = String(read("firstName", "given_name") ?? "").trim();
  let lastName = String(read("lastName", "family_name") ?? "").trim();
  const displayName = asText(read("displayName", "name"));

  if (!firstName && !lastName && displayName) {
    const parts = displayName.split(/\s+/).filter(Boolean);
    firstName = parts[0] ?? "";
    lastName = parts.slice(1).join(" ");
  }

  // Falling back to the local part beats storing an empty name: the account
  // still needs to be findable by a human.
  if (!firstName) firstName = email.slice(0, email.indexOf("@"));

  const rawGroups = read("groups", "groups", "roles");
  const groups = Array.isArray(rawGroups)
    ? rawGroups.map((g) => String(g)).filter(Boolean)
    : typeof rawGroups === "string"
      ? rawGroups.split(",").map((g) => g.trim()).filter(Boolean)
      : [];

  return {
    subject,
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    firstName,
    lastName,
    displayName,
    groups,
  };
}

function asText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

export type LinkVerdict =
  | { action: "sign_in"; userId: string }
  | { action: "provision" }
  | { action: "refuse"; reason: string };

/**
 * Decides what to do with a verified identity.
 *
 * The rule that matters: an existing local account is only linked to an SSO
 * identity when the provider says the address is verified. Otherwise anyone
 * able to set an arbitrary email at any federated provider could sign in as an
 * existing user of this system.
 */
export function decideLink(
  identity: SsoIdentity,
  existing: { userId: string; ssoSubject?: string; emailDomain: string } | null,
  connection: OidcConnection
): LinkVerdict {
  if (existing?.ssoSubject) {
    // Already linked. The subject is the stable identifier; an email change at
    // the provider must not silently point the login at a different account.
    if (!timingSafeEqual(existing.ssoSubject, identity.subject)) {
      return {
        action: "refuse",
        reason: "This email is already linked to a different single sign-on identity",
      };
    }
    return { action: "sign_in", userId: existing.userId };
  }

  if (existing) {
    if (!identity.emailVerified) {
      return {
        action: "refuse",
        reason:
          "Your identity provider has not verified this email address, so it cannot be linked to an existing account",
      };
    }
    return { action: "sign_in", userId: existing.userId };
  }

  if (!connection.allowJitProvisioning) {
    return {
      action: "refuse",
      reason: "There is no account for this address, and automatic account creation is off",
    };
  }

  if (!identity.emailVerified) {
    return {
      action: "refuse",
      reason: "Your identity provider has not verified this email address",
    };
  }

  return { action: "provision" };
}

/** Maps provider groups onto an internal role. */
export function roleFromGroups(
  groups: string[],
  groupRoleMap: Record<string, string>,
  fallback: string
): string {
  const normalised = new Map(
    Object.entries(groupRoleMap).map(([group, role]) => [group.toLowerCase(), role])
  );

  // Most privileged wins. A user in both "hr" and "admin" groups getting the
  // lesser of the two would be a confusing, silent downgrade.
  const precedence = ["owner", "admin", "hr", "manager", "employee"];

  const matched = groups
    .map((g) => normalised.get(g.trim().toLowerCase()))
    .filter((r): r is string => Boolean(r));

  if (matched.length === 0) return fallback;

  return matched.sort(
    (a, b) =>
      indexOrLast(precedence, a) - indexOrLast(precedence, b)
  )[0];
}

function indexOrLast(list: string[], value: string): number {
  const index = list.indexOf(value);
  return index === -1 ? list.length : index;
}
