// GET /api/leave/balances — an employee's leave entitlement for a year.
// Balances drive what someone can apply for, so an employee reads their own
// and managers upward read anyone's.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLeaveRepository } from "@/db/repositories/leave.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

const schema = z.object({
  employeeId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const parsed = schema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);
  const year = parsed.data.year ?? new Date().getFullYear();

  try {
    // ctx.userId is the signing-in account, not the employment record leave
    // balances are keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);
    const employeeId = privileged ? parsed.data.employeeId ?? self : self;

    if (!employeeId) {
      return NextResponse.json({ employeeId: null, year, balances: [] });
    }

    const balances = await new NeonLeaveRepository(ctx).balances(employeeId, year);
    return NextResponse.json({ employeeId, year, balances });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Leave balance lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
