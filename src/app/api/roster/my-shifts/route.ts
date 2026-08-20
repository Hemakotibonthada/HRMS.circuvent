// GET /api/roster/my-shifts — the schedule an employee actually cares about.
//
// Published rosters only. Draft rosters change, and someone arranging
// childcare around a shift that later moves has been failed by the software.

import { NextResponse, type NextRequest } from "next/server";
import { NeonRosteringRepository } from "@/db/repositories/rostering.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  const now = new Date();

  const from = searchParams.get("from") ?? addDays(now, -7);
  const to = searchParams.get("to") ?? addDays(now, 28);

  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  }
  if (to < from) {
    return NextResponse.json({ error: "The range ends before it starts" }, { status: 400 });
  }

  const requested = searchParams.get("employeeId");
  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);

  try {
    // ctx.userId is the signing-in account, not the employment record a
    // roster is keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);
    const employeeId = privileged && requested ? requested : self;

    if (!employeeId) {
      return NextResponse.json({ employeeId: null, from, to, shifts: [], totalMinutes: 0 });
    }

    const shifts = await new NeonRosteringRepository(ctx).myShifts(employeeId, from, to);
    return NextResponse.json({
      employeeId,
      from,
      to,
      shifts,
      totalMinutes: shifts.reduce((sum, s) => sum + s.durationMinutes, 0),
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Shift lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
