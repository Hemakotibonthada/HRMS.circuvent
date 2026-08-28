// ═══════════════════════════════════════════════════════════════
// GET/POST /api/public/referral/[token]
// ═══════════════════════════════════════════════════════════════
// The one endpoint in this application that anybody on the internet can reach
// and have write to a tenant's data. Everything about it is shaped by that.
//
//  - The token is the entire credential. 256 bits, matched against a stored
//    hash, and resolved before anything else happens.
//  - It discloses almost nothing. The referrer may have mistyped the address,
//    in which case a stranger is reading this: they get the role, the company
//    and the name the referrer used, because without those the page cannot ask
//    "is this you?" — and nothing else.
//  - Rate limited by IP. A 256-bit token cannot be guessed, but an endpoint
//    that answers unlimited requests is still a free amplifier.
//  - A made-up token always gets the same answer. The specific state —
//    expired, already used — is disclosed only once the hash has matched a
//    real row, so probing learns nothing.

import { NextResponse, type NextRequest } from "next/server";
import {
  NeonReferralInviteRepository,
  resolveByToken,
} from "@/db/repositories/referral-invite.neon";
import { RepositoryError } from "@/db/repositories/types";
import { checkRateLimit, clientIdentifier } from "@/lib/api-context";
import {
  looksLikeInviteToken,
  messageForState,
  normaliseSubmission,
  validateSubmission,
  type CandidateSubmission,
} from "@/lib/referral-invite";

/** One body for every kind of "this link is no good". */
function notUsable() {
  return NextResponse.json(
    { error: "This link is not valid. Ask the person who referred you to send a new one." },
    { status: 404 }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limit = checkRateLimit(`referral-invite:${clientIdentifier(request)}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
  }

  const { token } = await params;

  // Cheap shape check first, so a crawler probing paths costs a regex rather
  // than a database round-trip. Not the security control; the hash lookup is.
  if (!looksLikeInviteToken(token)) return notUsable();

  let resolved;
  try {
    resolved = await resolveByToken(token);
  } catch (error) {
    console.error("Referral invite lookup failed:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (!resolved) return notUsable();

  const repo = new NeonReferralInviteRepository({ orgId: resolved.orgId });
  const prefill = await repo.prefill(resolved.inviteId);
  if (!prefill) return notUsable();

  if (resolved.state !== "pending") {
    // Safe to be specific now: the hash matched a real row, so this is the
    // person who was sent the link, and "expired" is far more useful to them
    // than "not valid".
    return NextResponse.json(
      { state: resolved.state, message: messageForState(resolved.state) },
      { status: 410 }
    );
  }

  return NextResponse.json({
    state: "pending",
    // Only what the page needs to ask "is this you, and is this the role?".
    candidateName: prefill.candidateName,
    candidateEmail: prefill.candidateEmail,
    positionTitle: prefill.positionTitle,
    organizationName: prefill.organizationName,
    referrerFirstName: prefill.referrerFirstName,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  // Tighter than the read. This is a write, and nobody legitimately sends it
  // more than a handful of times.
  const limit = checkRateLimit(`referral-submit:${clientIdentifier(request)}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment." }, { status: 429 });
  }

  const { token } = await params;
  if (!looksLikeInviteToken(token)) return notUsable();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  let resolved;
  try {
    resolved = await resolveByToken(token);
  } catch (error) {
    console.error("Referral invite lookup failed:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (!resolved) return notUsable();

  if (resolved.state !== "pending") {
    return NextResponse.json(
      { state: resolved.state, message: messageForState(resolved.state) },
      { status: 410 }
    );
  }

  // Validated here regardless of what the page checked. The page is not the
  // thing making this request — anyone holding the link can send any body.
  const input = raw as Partial<CandidateSubmission>;
  const errors = validateSubmission(input);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Please check the form", fields: errors }, { status: 400 });
  }

  const submission = normaliseSubmission(input as CandidateSubmission);

  try {
    const repo = new NeonReferralInviteRepository({ orgId: resolved.orgId });
    await repo.submit(
      resolved.inviteId,
      submission,
      // Kept for provenance and for answering a subject access request. Never
      // used for an access decision.
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    );
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Referral submission failed:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
