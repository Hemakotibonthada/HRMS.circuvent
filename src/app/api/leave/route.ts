// ═══════════════════════════════════════════════════════════════
// HRMS API — leave requests
// ═══════════════════════════════════════════════════════════════
// Replaces a stub that returned `data: []`.
//
// The rule that shapes both handlers: an employee may act on their own leave
// and nobody else's. The employee id is taken from the token for ordinary
// users and only accepted from the body for HR and admins, who legitimately
// apply on someone's behalf.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLeaveRepository } from "@/db/repositories/leave.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, NoEmployeeRecordError } from "@/lib/current-employee";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";

const LEAVE_TYPES = [
  "casual",
  "sick",
  "earned",
  "maternity",
  "paternity",
  "compensatory",
  "unpaid",
  "bereavement",
  "wfh",
  "marriage",
  "study",
] as const;

const applySchema = z.object({
  employeeId: z.string().uuid().optional(),
  leaveType: z.enum(LEAVE_TYPES),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
  isHalfDay: z.boolean().optional(),
  halfDayPeriod: z.enum(["first_half", "second_half"]).optional(),
  reason: z.string().trim().min(3, "Give a reason").max(1000),
  handoverToId: z.string().uuid().optional(),
  contactDuringLeave: z.string().trim().max(64).optional(),
});

const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  sortBy: z.enum(["startDate", "appliedAt", "status", "totalDays"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
});

const PRIVILEGED = ["owner", "admin", "hr", "manager"];

function fail(error: unknown) {
  if (error instanceof NoEmployeeRecordError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Leave API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
  const parsed = listSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  // An ordinary employee sees only their own requests, whatever they ask for.
  // Scoping this in the handler rather than trusting a query parameter is the
  // whole point of routing through the server.
  const privileged = PRIVILEGED.includes(ctx.role);
  const requestedEmployee = searchParams.get("employeeId") ?? undefined;

  try {
    // ctx.userId is the signing-in account, not the employment record a
    // leave request is keyed by — see lib/current-employee.ts.
    const self = privileged ? null : await currentEmployeeId(ctx);
    const employeeId = privileged ? requestedEmployee : self;

    // An unprivileged caller with no employee record must get nothing, not
    // everything. The filter below is spread conditionally, so letting a null
    // through here would drop the restriction and list the whole organisation.
    if (!privileged && !employeeId) {
      return NextResponse.json({
        items: [],
        total: 0,
        page: parsed.data.page ?? 1,
        pageSize: parsed.data.pageSize ?? 50,
        hasMore: false,
      });
    }

    const repo = new NeonLeaveRepository(ctx);
    const page = await repo.list({
      ...parsed.data,
      filters: {
        ...(employeeId ? { employeeId } : {}),
        status: searchParams.get("status") ?? undefined,
        leaveType: searchParams.get("leaveType") ?? undefined,
        from: searchParams.get("from") ?? undefined,
        to: searchParams.get("to") ?? undefined,
      },
    });
    return NextResponse.json(page);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`leave:${clientIdentifier(request, ctx.userId)}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = applySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: describeIssues(toFieldIssues(parsed.error)),
        issues: toFieldIssues(parsed.error),
      },
      { status: 400 }
    );
  }

  // Applying for someone else is an HR action. Silently rewriting the id to
  // the caller would hide the attempt; refusing it makes the boundary explicit.
  // ctx.userId is the signing-in account, not the employment record a leave
  // request is keyed by — see lib/current-employee.ts.
  const self = await currentEmployeeId(ctx);
  const target = parsed.data.employeeId ?? self;
  if (target !== self && !["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json(
      { error: "You can only apply for your own leave" },
      { status: 403 }
    );
  }

  try {
    if (!target) {
      throw new NoEmployeeRecordError(ctx.userId);
    }

    const repo = new NeonLeaveRepository(ctx);
    const created = await repo.apply({ ...parsed.data, employeeId: target });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
