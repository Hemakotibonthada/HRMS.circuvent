// GET /api/benefits/plans — plans available to the caller, eligibility resolved.
//
// Resolved server-side rather than returning every plan and letting the client
// filter: a plan someone cannot elect should not appear as a choice they can
// make and then have refused.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonBenefitsRepository } from "@/db/repositories/benefits.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const requested = new URL(request.url).searchParams.get("employeeId") ?? undefined;
  // Benefits elections reveal family structure and health choices, so an
  // ordinary employee sees only their own.
  const privileged = ["owner", "admin", "hr"].includes(ctx.role);

  try {
    // ctx.userId is the signing-in account, not the employment record a plan
    // eligibility check is keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);
    const employeeId = privileged && requested ? requested : self;

    if (!employeeId) {
      return NextResponse.json({ plans: [] });
    }

    if (!z.string().uuid().safeParse(employeeId).success) {
      return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const plans = await new NeonBenefitsRepository(ctx).availablePlans(employeeId, today);
    return NextResponse.json({ plans });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Benefit plans lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
