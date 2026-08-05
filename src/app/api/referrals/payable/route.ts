// GET /api/referrals/payable — bonuses whose qualifying period has elapsed.
//
// The work queue for whoever releases referral bonuses. Run as a report rather
// than paid automatically: an automatic payout on a date has no way to notice
// that the hire resigned last week.

import { NextResponse, type NextRequest } from "next/server";
import { NeonReferralRepository } from "@/db/repositories/referral.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const repo = new NeonReferralRepository(ctx);
    const [payable, approved] = await Promise.all([
      repo.findPayable(),
      repo.pendingPayouts(),
    ]);

    return NextResponse.json({
      // Milestone reached, still needs a human to approve.
      awaitingApproval: payable,
      // Approved and waiting for the next payroll run to pick them up.
      awaitingPayroll: approved.map((p) => ({
        referralId: p.referralId,
        employeeId: p.employeeId,
        amount: Number(p.amountMinor) / 100,
      })),
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Payable referrals lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
