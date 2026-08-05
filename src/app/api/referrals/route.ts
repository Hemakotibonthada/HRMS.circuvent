// ═══════════════════════════════════════════════════════════════
// GET/POST /api/referrals
// ═══════════════════════════════════════════════════════════════
// Any employee may refer someone — that is the point of the scheme — so this
// is not restricted by role. What *is* restricted: seeing other people's
// referrals, and anything touching the bonus.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonReferralRepository } from "@/db/repositories/referral.neon";
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
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
