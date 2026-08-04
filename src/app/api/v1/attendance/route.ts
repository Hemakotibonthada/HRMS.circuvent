// GET/POST /api/v1/attendance — public API.
//
// POST exists because biometric terminals and turnstiles are the main
// integration that needs to write: they push punches from hardware that has no
// browser session. It uses the `manual` method deliberately, so a punch
// arriving over the API is distinguishable in the audit trail from one a
// person made in the app.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAttendanceRepository } from "@/db/repositories/attendance.neon";
import { RepositoryError } from "@/db/repositories/types";
import { ApiKeyError, apiVersionHeaders, requireApiKey } from "@/lib/api-v1-context";

const listSchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.string().max(32).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const punchSchema = z.object({
  employeeId: z.string().uuid(),
  action: z.enum(["in", "out"]),
  // Accepted so a terminal that buffered punches during a network outage can
  // submit them with their real times rather than the time they reconnected.
  at: z.string().datetime().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

function fail(error: unknown, label: string) {
  if (error instanceof ApiKeyError) {
    return NextResponse.json(
      {
        error: {
          code: error.status === 429 ? "rate_limited" : "unauthorized",
          message: error.message,
        },
        ...(error.missingScopes ? { missingScopes: error.missingScopes } : {}),
      },
      { status: error.status, headers: apiVersionHeaders() }
    );
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: error.message } },
      { status: error.status, headers: apiVersionHeaders() }
    );
  }
  console.error(`${label} failure:`, error);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong" } },
    { status: 500, headers: apiVersionHeaders() }
  );
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireApiKey(request, ["attendance:read"]);

    const { searchParams } = new URL(request.url);
    const parsed = listSchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Invalid query" } },
        { status: 400, headers: apiVersionHeaders() }
      );
    }

    const { page, pageSize, ...filters } = parsed.data;
    const result = await new NeonAttendanceRepository(ctx).list({ page, pageSize, filters });

    return NextResponse.json(
      {
        data: result.items,
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          hasMore: result.hasMore,
        },
      },
      { headers: apiVersionHeaders() }
    );
  } catch (error) {
    return fail(error, "v1 attendance list");
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiKey(request, ["attendance:write"]);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Body is not valid JSON" } },
        { status: 400, headers: apiVersionHeaders() }
      );
    }

    const parsed = punchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: "validation_failed", message: "One or more fields are invalid" },
          issues: parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400, headers: apiVersionHeaders() }
      );
    }

    const { employeeId, action, at, latitude, longitude } = parsed.data;
    const timestamp = at ? new Date(at) : undefined;

    // A buffered punch may be old, but one from the future is a clock problem
    // on the terminal and would corrupt the day's totals.
    if (timestamp && timestamp.getTime() > Date.now() + 60_000) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "`at` cannot be in the future" } },
        { status: 400, headers: apiVersionHeaders() }
      );
    }

    const repo = new NeonAttendanceRepository(ctx);
    const record =
      action === "in"
        ? await repo.clockIn({ employeeId, method: "manual", latitude, longitude, at: timestamp })
        : await repo.clockOut({ employeeId, method: "manual", latitude, longitude, at: timestamp });

    return NextResponse.json(
      { data: record },
      { status: action === "in" ? 201 : 200, headers: apiVersionHeaders() }
    );
  } catch (error) {
    return fail(error, "v1 attendance punch");
  }
}
