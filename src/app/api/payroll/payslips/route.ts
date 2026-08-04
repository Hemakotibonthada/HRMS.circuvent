// GET /api/payroll/payslips — an employee's own payslip history.
//
// The repository restricts this to approved and paid runs. A draft or
// processed run is still being corrected, and showing an employee a figure
// that later changes is worse than showing nothing.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonPayrollRepository } from "@/db/repositories/payroll.neon";
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

  const requested = new URL(request.url).searchParams.get("employeeId") ?? undefined;

  // Salary is the most sensitive field in the product. Managers are excluded
  // deliberately: a reporting line is not authority to see someone's pay.
  const privileged = ["owner", "admin", "hr"].includes(ctx.role);
  if (requested && requested !== ctx.userId && !privileged) {
    return NextResponse.json(
      { error: "You can only view your own payslips" },
      { status: 403 }
    );
  }

  const employeeId = privileged && requested ? requested : ctx.userId;
  if (!z.string().uuid().safeParse(employeeId).success) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  try {
    const payslips = await new NeonPayrollRepository(ctx).payslipsFor(employeeId);
    return NextResponse.json({ employeeId, payslips });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Payslip lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
