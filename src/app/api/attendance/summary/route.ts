// GET /api/attendance/summary — a month's totals, aggregated in SQL.
// The Firestore path pulled every record for the month into the browser and
// counted there, which does not survive a few thousand employees.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAttendanceRepository } from "@/db/repositories/attendance.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

const schema = z.object({
  employeeId: z.string().uuid().optional(),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "month and year are required" },
      { status: 400 }
    );
  }

  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);
  const employeeId = privileged ? parsed.data.employeeId ?? ctx.userId : ctx.userId;

  try {
    const summary = await new NeonAttendanceRepository(ctx).summary(
      employeeId,
      parsed.data.month,
      parsed.data.year
    );
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Attendance summary failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
