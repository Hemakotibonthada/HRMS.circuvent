// ═══════════════════════════════════════════════════════════════
// GET/POST /api/referrals
// ═══════════════════════════════════════════════════════════════
// Any employee may refer someone — that is the point of the scheme — so this
// is not restricted by role. What *is* restricted: seeing other people's
// referrals, and anything touching the bonus.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonReferralRepository } from "@/db/repositories/referral.neon";
import { NeonReferralInviteRepository } from "@/db/repositories/referral-invite.neon";
import { sendInviteEmail } from "@/lib/referral-invite-email";
import { inviteUrl } from "@/lib/referral-invite";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const listSchema = z.object({
  status: z
    .enum([
      "submitted",
      "screening",
      "interviewing",
      "offered",
      "hired",
      "rejected",
      "withdrawn",
      "duplicate",
      "all",
    ])
    .optional(),
  payoutStatus: z
    .enum(["not_eligible", "pending_milestone", "approved", "paid", "forfeited", "all"])
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const submitSchema = z.object({
  candidateName: z.string().trim().min(2, "Enter the candidate's name").max(150),
  candidateEmail: z.string().trim().email("Enter a valid email address").max(320),
  candidatePhone: z.string().trim().max(32).optional(),
  positionTitle: z.string().trim().min(2, "Enter the role").max(150),
  jobId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  resumeUrl: z.string().url().max(2048).optional(),
  recommendation: z.string().trim().max(2000).optional(),
  relationship: z.string().trim().max(120).optional(),
});

const RECRUITER_ROLES = ["owner", "admin", "hr"];

function fail(error: unknown) {
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Referrals API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const parsed = listSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  // An ordinary employee sees their own referrals only. Someone else's
  // referral names a candidate who has not consented to being visible
  // company-wide, and it carries a bonus claim.
  const canSeeAll = RECRUITER_ROLES.includes(ctx.role);
  const requested = searchParams.get("referrerId") ?? undefined;
  const referrerId = canSeeAll ? requested : ctx.userId;

  try {
    const page = await new NeonReferralRepository(ctx).list({
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      filters: {
        status: parsed.data.status,
        payoutStatus: parsed.data.payoutStatus,
        ...(referrerId ? { referrerId } : {}),
      },
    });

    // Bonus figures are stripped for anyone who is not the referrer: what a
    // colleague earned is their business.
    const items = canSeeAll
      ? page.items
      : page.items.map((r) =>
          r.referrerId === ctx.userId ? r : { ...r, bonusAmount: 0, payoutStatus: "not_eligible" as const }
        );

    return NextResponse.json({ ...page, items });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Bulk-submitting referrals is a way to blanket a job board and claim
  // whoever happens to get hired.
  const limit = checkRateLimit(`referral:${ctx.userId}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many referrals submitted. Please wait a moment." },
      { status: 429 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  try {
    // The referrer is always the caller. Accepting it from the body would let
    // someone submit a referral in a colleague's name, or claim credit by
    // putting their own id on someone else's introduction.
    const created = await new NeonReferralRepository(ctx).submit({
      ...parsed.data,
      referrerId: ctx.userId,
    });

    // The invitation is sent after the referral exists, and its failure is
    // recorded rather than raised. A referral that is saved but whose email
    // bounced is a problem a recruiter can see and resend; a referral lost
    // because a mail provider timed out is work the employee has to redo.
    const invite = await issueAndSendInvite(ctx, created, request);

    return NextResponse.json({ ...created, invite }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

/** Mints the candidate's link, emails it, and records how that went. */
async function issueAndSendInvite(
  ctx: Awaited<ReturnType<typeof requireApiContext>>,
  referral: { id: string; candidateEmail: string; candidateName: string; positionTitle: string },
  request: NextRequest
): Promise<{ sent: boolean; error?: string; inviteUrlForLocalTesting?: string }> {
  try {
    const repo = new NeonReferralInviteRepository(ctx);
    const { inviteId, token, expiresAt } = await repo.create(
      referral.id,
      referral.candidateEmail
    );

    // The deployed origin, falling back to the requesting one. A hardcoded
    // localhost here would email an unreachable link from production; a
    // hardcoded production URL would do the reverse in development.
    const baseUrl = process.env.NEXT_PUBLIC_HRMS_URL?.trim() || new URL(request.url).origin;

    const context = await repo.prefill(inviteId).catch(() => null);

    const { error } = await sendInviteEmail({
      to: referral.candidateEmail,
      candidateName: referral.candidateName,
      referrerName: context?.referrerFirstName,
      organizationName: context?.organizationName ?? "our team",
      positionTitle: referral.positionTitle,
      url: inviteUrl(baseUrl, token),
      expiresAt,
    });

    // Recorded either way, so a stalled referral has a visible cause rather
    // than looking like the candidate ignored it.
    await repo.recordDelivery(inviteId, error);

    const url = inviteUrl(baseUrl, token);

    // Outside production, and only when no mail provider is configured, the
    // link is surfaced so the flow can actually be exercised locally. Both
    // conditions are required: in production this must never appear, because
    // the referrer could then open the candidate's link and fill the form in
    // on their behalf — which is precisely the thing the token prevents.
    const devOnly =
      process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY
        ? { inviteUrlForLocalTesting: url }
        : {};

    if (devOnly.inviteUrlForLocalTesting) {
      console.warn(`[referral] no mail provider configured; invite link: ${url}`);
    }

    return { sent: !error, error, ...devOnly };
  } catch (error) {
    // Never fatal to the referral itself.
    console.error("Referral invite could not be issued:", error);
    return { sent: false, error: "The invitation could not be sent" };
  }
}
