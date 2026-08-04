// GET /api/v1/leave — public API. Read-only: approving leave is a decision
// with employment consequences and belongs to a person, not an integration.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLeaveRepository } from "@/db/repositories/leave.neon";
import { RepositoryError } from "@/db/repositories/types";
import { ApiKeyError, apiVersionHeaders, requireApiKey } from "@/lib/api-v1-context";

const schema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  leaveType: z.string().max(32).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireApiKey(request, ["leave:read"]);

    const { searchParams } = new URL(request.url);
    const parsed = schema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: parsed.error.issues[0]?.message ?? "Invalid query",
            field: parsed.error.issues[0]?.path.join("."),
          },
        },
        { status: 400, headers: apiVersionHeaders() }
      );
    }

    const { page, pageSize, ...filters } = parsed.data;
    const result = await new NeonLeaveRepository(ctx).list({ page, pageSize, filters });

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
    console.error("v1 leave failure:", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "Something went wrong" } },
      { status: 500, headers: apiVersionHeaders() }
    );
  }
}
