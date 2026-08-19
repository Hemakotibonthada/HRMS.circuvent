// ═══════════════════════════════════════════════════════════════
// SESSION TOKENS — access JWT + rotating refresh token
// ═══════════════════════════════════════════════════════════════
// Two tokens with different jobs:
//
//   access   short-lived (15 min) JWT carrying sub, org, role. Signed, so edge
//            middleware can authorise a request without touching the database.
//            Not revocable, which is why it expires quickly.
//   refresh  opaque, 30 days, stored only as a hash in identity.sessions.
//            Revocable, and rotated on every use.
//
// The cookie is scoped to .circuvent.com so one sign-in covers hrms., work.,
// ats., mail. and office. — real SSO across the suite, which the current
// per-app Firebase Auth only approximates.
//
// Rotation also gives replay detection: a refresh token is single-use, so if
// an old one is presented again it was either stolen or replayed, and the
// whole session family is revoked.

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const ACCESS_COOKIE = "cv_access";
export const REFRESH_COOKIE = "cv_refresh";

const ISSUER = "https://circuvent.com";
const AUDIENCE = "circuvent-suite";

export type AppId = "hrms" | "cv365" | "ats" | "mail" | "office" | "website";

export interface AccessClaims extends JWTPayload {
  /** User id. */
  sub: string;
  org: string;
  role: string;
  email?: string;
  /**
   * Display name, so /api/auth/me can name the person without a database read.
   *
   * Carried in the token for the same reason `email` is: the session endpoint
   * is called on every app mount and is deliberately free of round-trips. The
   * cost is that a rename only shows after the next sign-in, which is a fair
   * trade for a label. Without it the apps had no name at all — the Android
   * profile card rendered a blank line and the greeting fell back to the part
   * of the email before the @, so it said "Hello, priya".
   */
  name?: string;
  /** Session id, so a refresh can find its family without another lookup. */
  sid: string;
  /** True once TOTP has been satisfied for this session. */
  mfa?: boolean;
}

function secret(): Uint8Array {
  const value = process.env.AUTH_JWT_SECRET;
  if (!value || value.length < 32) {
    // A short or missing secret makes every token forgeable. Refusing to start
    // is far better than issuing signatures anyone can reproduce.
    throw new Error(
      "AUTH_JWT_SECRET must be set to at least 32 characters. Generate one with: openssl rand -hex 32"
    );
  }
  return new TextEncoder().encode(value);
}

export async function signAccessToken(
  claims: Omit<AccessClaims, "iat" | "exp" | "iss" | "aud">
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret());
}

/**
 * Verifies an access token.
 *
 * Returns null on any failure rather than throwing: an expired token is a
 * normal event on every request after 15 minutes, not an exception, and the
 * caller's next step is the same regardless of why it failed.
 */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });

    // A token missing org or role would sail through jwtVerify and then be
    // used to scope a query to `undefined`.
    if (typeof payload.sub !== "string" || typeof payload.org !== "string") return null;
    if (typeof payload.role !== "string" || typeof payload.sid !== "string") return null;

    return payload as AccessClaims;
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are stored hashed so a database dump cannot be replayed as a
 * valid session. SHA-256 is right here, unlike for passwords: the token is
 * already 256 bits of entropy, so there is nothing to brute-force and a slow
 * KDF would only add latency to every refresh.
 */
export function hashRefreshToken(token: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
  domain?: string;
}

/**
 * Cookie attributes for the session cookies.
 *
 * httpOnly    keeps the token out of reach of any XSS on the page.
 * sameSite    lax, not strict, so following a link from Mail into HRMS keeps
 *             the user signed in; the tokens are never used for cross-site
 *             form posts.
 * domain      .circuvent.com in production so every app shares the session.
 *             Unset in development, where the host is localhost and a domain
 *             attribute would stop the cookie being set at all.
 */
export function cookieOptions(maxAge: number): CookieOptions {
  const isProd = process.env.NODE_ENV === "production";
  const domain = process.env.AUTH_COOKIE_DOMAIN ?? (isProd ? ".circuvent.com" : undefined);

  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge,
    ...(domain ? { domain } : {}),
  };
}

export const accessCookieOptions = () => cookieOptions(ACCESS_TOKEN_TTL_SECONDS);
export const refreshCookieOptions = () => cookieOptions(REFRESH_TOKEN_TTL_SECONDS);

/** Expiry for a newly issued refresh token. */
export function refreshTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}
