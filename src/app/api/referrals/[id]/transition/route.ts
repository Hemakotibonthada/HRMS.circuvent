// POST /api/referrals/[id]/transition — move a referral through the pipeline.
// Recruiter-only: stage changes drive bonus eligibility, so the referrer must
// not be able to advance their own referral to `hired`.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonReferralRepository } from "@/db/repositories/referral.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

const schema = z
  .object({
    to: z.enum([
      "screening",
      "interviewing",
      "offered",
      "hired",
      "rejected",
      "withdrawn",
      "duplicate",
    ]),
    note: z.string().trim().max(1000).optional(),
    hiredEmployeeId: z.string().uuid().optional(),
    hiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((v) => v.to !== "rejected" || (v.note && v.note.length >= 3), {
    message: "A reason is required when rejecting a referral",
    path: ["note"],
  })
  .refine((v) => v.to !== "hired" || !!v.hiredEmployeeId, {
    // Without the employee record there is nothing to measure the qualifying
    // period against, so the bonus could never be released.
    message: "Marking a referral hired requires the new employee's id",
    path: ["hiredEmployeeId"],
  });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid referral id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonReferralRepository(ctx);
    const existing = await repo.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "Referral not found" }, { status: 404 });
    }

    // Even a recruiter must not advance a referral they themselves made: the
    // bonus is theirs, and `hired` is what starts the payout clock.
    if (existing.referrerId === ctx.userId) {
      return NextResponse.json(
        { error: "You cannot change the stage of your own referral" },
        { status: 403 }
      );
    }

    const updated = await repo.transition(id, parsed.data.to, ctx.userId, {
      note: parsed.data.note,
      hiredEmployeeId: parsed.data.hiredEmployeeId,
      hiredOn: parsed.data.hiredOn,
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Referral not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Referral transition failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
