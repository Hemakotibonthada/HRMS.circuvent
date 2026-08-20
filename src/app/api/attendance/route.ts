// GET /api/attendance — attendance history, and /summary for a month's totals.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAttendanceRepository } from "@/db/repositories/attendance.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

const schema = z.object({
  employeeId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().max(32).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
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

  // Attendance is personal data; only managers and above see a colleague's.
  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);

  try {
    // `ctx.userId` is the login, not the employment record — see
    // lib/current-employee.ts. Resolving it is what makes this work for anyone
    // hired through the app rather than only for the two backfilled owners.
    const self = privileged ? null : await currentEmployeeId(ctx);
    const employeeId = privileged ? parsed.data.employeeId : self;

    // An unprivileged caller with no employee record must get nothing, not
    // everything. The filter below is spread conditionally, so letting a null
    // through here would drop the restriction and list the whole organisation.
    if (!privileged && !employeeId) {
      return NextResponse.json({
        items: [],
        total: 0,
        page: parsed.data.page ?? 1,
        pageSize: parsed.data.pageSize ?? 20,
        hasMore: false,
      });
    }

    const page = await new NeonAttendanceRepository(ctx).list({
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      filters: {
        ...(employeeId ? { employeeId } : {}),
        status: parsed.data.status,
        from: parsed.data.from,
        to: parsed.data.to,
      },
    });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Attendance list failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
