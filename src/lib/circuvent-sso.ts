/**
 * Relying-party helper for Circuvent single sign-on.
 *
 * Copy this file into each app (Mail, CV-365, HRMS, ATS). It is deliberately
 * dependency-light -- only `jose` -- so it drops into any of them unchanged.
 *
 * The app never holds a signing secret. It fetches the issuer's public keys and
 * verifies with those, which means a compromised app cannot mint tokens for the
 * rest of the suite.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { AppId } from "@/lib/auth/tokens";

const ISSUER = (process.env.AUTH_ISSUER ?? "https://myaccount.circuvent.com").replace(
  /\/+$/,
  ""
);

/**
 * `createRemoteJWKSet` caches the key set and refetches on an unknown `kid`,
 * so a key rotation at the issuer needs no redeploy here.
 */
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

export interface CircuventClaims extends JWTPayload {
  sub: string;
  email: string;
  name: string;
  given_name?: string;
  family_name?: string;
  /** Profile picture, served by the identity provider. */
  picture?: string;
  /** The role held in *this* app, not a global one. */
  role: string;
  /** What the role allows here. */
  permissions?: string[];
  /** Every app the person may open, for drawing a launcher. */
  apps?: { id: string; name: string; url: string | null }[];
  sid?: string;
  amr?: string[];
  acr?: string;
}

export interface SsoConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export function ssoConfig(): SsoConfig {
  const clientId = process.env.SSO_CLIENT_ID;
  const redirectUri = process.env.SSO_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error("SSO_CLIENT_ID and SSO_REDIRECT_URI must be configured");
  }
  return {
    clientId,
    clientSecret: process.env.SSO_CLIENT_SECRET,
    redirectUri,
  };
}

/**
 * Whether this deployment can talk to the identity provider yet.
 *
 * Single sign-on is opt-in per environment so the app can ship with the wiring
 * in place before auth.circuvent.com resolves, rather than the two having to
 * land in the same breath.
 */
export function ssoEnabled(): boolean {
  return Boolean(process.env.SSO_CLIENT_ID && process.env.SSO_REDIRECT_URI);
}

// ─────────────────────────────────────────────────────────────
// PKCE
// ─────────────────────────────────────────────────────────────

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return randomBytes(16).toString("base64url");
}

/** Builds the URL that starts a sign-in. */
export function authorizeUrl(input: {
  state: string;
  codeChallenge: string;
  nonce?: string;
  scope?: string;
  prompt?: "none";
}): string {
  const { clientId, redirectUri } = ssoConfig();
  const url = new URL(`${ISSUER}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    input.scope ?? "openid profile email offline_access"
  );
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.nonce) url.searchParams.set("nonce", input.nonce);
  if (input.prompt) url.searchParams.set("prompt", input.prompt);
  return url.toString();
}

export interface TokenSet {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

async function postToken(body: URLSearchParams): Promise<TokenSet> {
  const { clientId, clientSecret } = ssoConfig();
  body.set("client_id", clientId);
  if (clientSecret) body.set("client_secret", clientSecret);

  const res = await fetch(`${ISSUER}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description ?? data.error ?? "Token request failed");
  }
  return data as TokenSet;
}

export function exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
  const { redirectUri } = ssoConfig();
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    })
  );
}

export function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  );
}

/** Verifies a token this issuer signed and returns its claims. */
export async function verifyToken(token: string): Promise<CircuventClaims> {
  const { clientId } = ssoConfig();
  const { payload } = await jwtVerify(token, jwks, {
    issuer: ISSUER,
    audience: clientId,
  });
  return payload as CircuventClaims;
}

/**
 * Reads the live profile from the issuer.
 *
 * Prefer this over the token claims when freshness matters -- a picture changed
 * a moment ago in another app is reflected here immediately, whereas the claims
 * are only as new as the last token.
 */
export async function fetchUserInfo(accessToken: string): Promise<CircuventClaims> {
  const res = await fetch(`${ISSUER}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Could not read the profile");
  return (await res.json()) as CircuventClaims;
}

/**
 * Where the browser may be sent once a handshake finishes.
 *
 * Apps that mint no tokens of their own -- ATS -- delegate sign-in here and
 * rely on the `.circuvent.com` cookie, so this route has to be able to hand
 * control back to another origin. An unchecked target is an open redirect, so
 * it is matched against the suite rather than merely parsed.
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  if (target.protocol !== "https:") return null;
  const host = target.hostname.toLowerCase();
  if (host !== "circuvent.com" && !host.endsWith(".circuvent.com")) return null;
  return target.toString();
}

/** Apps that may delegate their sign-in to this service. */
export const DELEGATABLE_APPS = [
  "hrms",
  "ats",
  "office",
  "cv365",
  "mail",
  "share",
] as const;

/**
 * Which app the person is entering.
 *
 * Anything unrecognised falls back to HRMS rather than being trusted, since
 * this value decides the role written into a shared session cookie.
 */
export function requestedApp(raw: string | null | undefined): AppId {
  return (DELEGATABLE_APPS as readonly string[]).includes(raw ?? "")
    ? (raw as AppId)
    : "hrms";
}

export function logoutUrl(postLogoutRedirectUri: string): string {
  const { clientId } = ssoConfig();
  const url = new URL(`${ISSUER}/logout`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
  return url.toString();
}

export function idpAssertedMfa(claims: Pick<CircuventClaims, "amr" | "acr">): boolean {
  if (claims.acr === "mfa") return true;
  const amr = claims.amr;
  return Array.isArray(amr) && amr.includes("mfa");
}

export async function verifyLogoutToken(
  logoutToken: string
): Promise<{ sub: string; sid?: string }> {
  const { clientId } = ssoConfig();
  const { payload } = await jwtVerify(logoutToken, jwks, {
    issuer: ISSUER,
    audience: clientId,
  });
  if (payload.nonce) throw new Error("Logout token must not carry a nonce");
  const events = payload.events as Record<string, unknown> | undefined;
  if (!events || !("http://schemas.openid.net/event/backchannel-logout" in events)) {
    throw new Error("Not a back-channel logout token");
  }
  const sub = payload.sub;
  if (!sub || typeof sub !== "string") throw new Error("Logout token missing sub");
  const sid = typeof payload.sid === "string" ? payload.sid : undefined;
  return { sub, sid };
}

export const issuerUrl = ISSUER;
