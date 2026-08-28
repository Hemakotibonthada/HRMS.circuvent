// POST /api/referrals/[id]/payout — approve a referral bonus for payment.
//
// Approval does not move money. It marks the bonus ready for the next payroll
// run, which is where it becomes taxable income on a payslip. Paying outside
// payroll would leave it untaxed and invisible to the employee's records.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonReferralRepository } from "@/db/repositories/referral.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    // Releasing money is not a recruiting action; HR and above only.
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid referral id" }, { status: 400 });
  }

  try {
    // The repository refuses self-approval and re-checks that the hire is
    // still employed, forfeiting the bonus if they have left.
    const updated = await new NeonReferralRepository(ctx).approvePayout(id, ctx.userId);
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Referral not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Referral payout approval failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
