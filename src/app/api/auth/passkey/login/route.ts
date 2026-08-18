// POST /api/auth/passkey/login — sign in with a passkey.
//
// GET returns options, POST verifies an assertion and mints a session.
//
// This route is reachable without a session, so it is written to answer the
// same way whatever is wrong. A response that distinguished "no such
// credential" from "bad signature" would turn the endpoint into an oracle for
// which authenticators are enrolled here.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { webauthnCredentials, users } from "@/db/schema/identity";
import { checkRateLimit } from "@/lib/api-context";
import { authenticationOptions } from "@/lib/auth/webauthn";
import {
  consumeChallenge,
  issueChallenge,
  parseResponse,
  relyingParty,
  verifyResponse,
  verifySignature,
} from "@/lib/auth/passkey-ceremony";
import { signInWithSso } from "@/lib/auth/session";
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from "@/lib/auth/tokens";

const bodySchema = z.object({
  credentialId: z.string().min(1).max(1024),
  clientDataJSON: z.string().min(1).max(8192),
  authenticatorData: z.string().min(1).max(8192),
  signature: z.string().min(1).max(4096),
  userHandle: z.string().max(1024).optional(),
});

/** One message for every failure, so nothing can be probed. */
const refused = () =>
  NextResponse.json({ error: "That passkey could not be used to sign in" }, { status: 401 });

export async function GET() {
  return NextResponse.json(
    authenticationOptions({ challenge: issueChallenge("webauthn.get"), rp: relyingParty() })
  );
}

export async function POST(request: NextRequest) {
  // Keyed on the credential rather than the caller, because there is no
  // authenticated caller yet and an IP is shared by a whole office.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(raw);
  if (!parsedBody.success) return refused();

  const limit = checkRateLimit(`passkey-login:${parsedBody.data.credentialId}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const parsed = parseResponse(parsedBody.data);
  if (!parsed) return refused();

  const pending = consumeChallenge(parsed.clientData.challenge, "webauthn.get");
  if (!pending) return refused();

  // Credential ids are globally unique and this lookup happens before any
  // tenant is known, so it runs with the superuser escape — the same one the
  // migrations use — rather than guessing an org.
  const stored = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const rows = await tx
      .select({
        id: webauthnCredentials.id,
        userId: webauthnCredentials.userId,
        orgId: webauthnCredentials.orgId,
        publicKey: webauthnCredentials.publicKey,
        signCount: webauthnCredentials.signCount,
        email: users.email,
      })
      .from(webauthnCredentials)
      .innerJoin(users, eq(users.id, webauthnCredentials.userId))
      .where(eq(webauthnCredentials.credentialId, parsedBody.data.credentialId))
      .limit(1);
    return rows[0];
  });

  if (!stored) return refused();

  const verdict = verifyResponse(parsed, {
    ceremony: "webauthn.get",
    challenge: pending.challenge,
    rp: relyingParty(),
    previousSignCount: stored.signCount,
  });
  if (!verdict.ok) return refused();

  const signatureValid = await verifySignature({
    publicKey: stored.publicKey,
    signature: parsedBody.data.signature,
    authenticatorData: parsed.authenticatorData,
    clientDataHash: parsed.clientDataHash,
  });
  if (!signatureValid) return refused();

  // Counter first, and only forward. Writing it after the session is minted
  // would leave a window in which a replayed assertion still passes the
  // cloning check.
  await withTenant({ orgId: stored.orgId, superuser: true }, async (tx) => {
    await tx
      .update(webauthnCredentials)
      .set({
        signCount: sql`greatest(${webauthnCredentials.signCount}, ${parsed.signCount})`,
        lastUsedAt: new Date(),
      })
      .where(eq(webauthnCredentials.id, stored.id));
  });

  // The passkey has proven who this is; the session is minted the same way an
  // SSO sign-in mints one, so roles and provisioning behave identically.
  const result = await signInWithSso({
    email: stored.email,
    app: "hrms",
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
    deviceName: "Passkey",
  });

  if (!result.ok) return refused();

  const wantsTokens =
    (raw as { client?: unknown })?.client === "native" ||
    request.headers.get("x-circuvent-client") === "native";

  const response = NextResponse.json({
    user: result.user,
    ...(wantsTokens
      ? {
          tokens: {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          },
        }
      : {}),
  });

  response.cookies.set(ACCESS_COOKIE, result.accessToken, accessCookieOptions());
  response.cookies.set(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  return response;
}
