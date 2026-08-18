// POST /api/auth/passkey/register — enrol a passkey.
//
// Two calls: GET returns the options the authenticator needs, POST verifies
// what it produced. Both require an existing session — a passkey is added to
// an account you are already signed in to, never used to claim one.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { webauthnCredentials } from "@/db/schema/identity";
import { requireApiContext, checkRateLimit } from "@/lib/api-context";
import { authErrorResponse } from "@/lib/server-auth";
import { registrationOptions } from "@/lib/auth/webauthn";
import {
  consumeChallenge,
  issueChallenge,
  parseResponse,
  relyingParty,
  verifyResponse,
} from "@/lib/auth/passkey-ceremony";

const bodySchema = z.object({
  credentialId: z.string().min(1).max(1024),
  clientDataJSON: z.string().min(1).max(8192),
  authenticatorData: z.string().min(1).max(8192),
  publicKey: z.string().min(1).max(4096),
  transports: z.array(z.string().max(32)).max(8).optional(),
  label: z.string().trim().max(80).optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const rp = relyingParty();

  const existing = await withTenant(ctx, async (tx) =>
    tx
      .select({
        credentialId: webauthnCredentials.credentialId,
        publicKey: webauthnCredentials.publicKey,
        signCount: webauthnCredentials.signCount,
        transports: webauthnCredentials.transports,
        userId: webauthnCredentials.userId,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, ctx.userId))
  );

  const challenge = issueChallenge("webauthn.create", ctx.userId);

  return NextResponse.json(
    registrationOptions({
      challenge,
      rp,
      user: { id: ctx.userId, email: ctx.email ?? "", displayName: ctx.email ?? undefined },
      existing: existing.map((c) => ({
        credentialId: c.credentialId,
        publicKey: c.publicKey,
        signCount: c.signCount,
        transports: (c.transports as string[]) ?? [],
        userId: c.userId,
      })),
    })
  );
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`passkey-register:${ctx.userId}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(raw);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: parsedBody.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const parsed = parseResponse(parsedBody.data);
  if (!parsed) {
    return NextResponse.json({ error: "That response could not be read" }, { status: 400 });
  }

  // Single use, and only a challenge this server issued for this ceremony.
  const pending = consumeChallenge(parsed.clientData.challenge, "webauthn.create");
  if (!pending || pending.userId !== ctx.userId) {
    return NextResponse.json(
      { error: "That registration has expired. Please try again." },
      { status: 400 }
    );
  }

  const verdict = verifyResponse(parsed, {
    ceremony: "webauthn.create",
    challenge: pending.challenge,
    rp: relyingParty(),
  });

  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  try {
    await withTenant(ctx, async (tx) => {
      await tx.insert(webauthnCredentials).values({
        userId: ctx.userId,
        orgId: ctx.orgId,
        credentialId: parsedBody.data.credentialId,
        publicKey: parsedBody.data.publicKey,
        signCount: parsed.signCount,
        transports: parsedBody.data.transports ?? [],
        label: parsedBody.data.label ?? "Passkey",
        backedUp: parsed.flags.backedUp,
      });
    });
  } catch {
    // The unique index on credential_id is global, so this means the
    // authenticator already registered here — for this account or another.
    // Saying which would answer a question the caller has no right to ask.
    return NextResponse.json(
      { error: "That authenticator is already registered" },
      { status: 409 }
    );
  }

  return NextResponse.json({ registered: true }, { status: 201 });
}
