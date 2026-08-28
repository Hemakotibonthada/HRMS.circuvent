// GET /api/referrals/stats — scheme health and the referrer leaderboard.
// Aggregated in SQL; the previous page pulled every referral into the browser
// and counted there.

import { NextResponse, type NextRequest } from "next/server";
import { NeonReferralRepository } from "@/db/repositories/referral.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const stats = await new NeonReferralRepository(ctx).stats();

    // The leaderboard is deliberately visible to everyone — recognition is
    // most of what makes a referral scheme work — but the money totals are
    // not, so they are withheld from ordinary employees.
    if (!["owner", "admin", "hr"].includes(ctx.role)) {
      const { bonusPaid: _paid, bonusPending: _pending, ...visible } = stats;
      return NextResponse.json(visible);
    }

    return NextResponse.json(stats);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Referral stats failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
