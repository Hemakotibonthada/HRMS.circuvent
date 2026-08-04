// ═══════════════════════════════════════════════════════════════
// GET/POST /api/v1/employees — public API
// ═══════════════════════════════════════════════════════════════
// Authenticated by API key and scope rather than by session role. Read and
// write are separate scopes: an integration that syncs the directory into a
// help desk has no reason to be able to create employees.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { RepositoryError } from "@/db/repositories/types";
import { ApiKeyError, apiVersionHeaders, requireApiKey } from "@/lib/api-v1-context";

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z
    .enum(["active", "on_leave", "probation", "notice_period", "terminated", "inactive"])
    .optional(),
  departmentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  // Lower than the session API's 500: a public consumer paginating politely is
  // preferable to one pulling the whole tenant in a single call.
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const createSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(32).optional(),
  departmentId: z.string().uuid().optional(),
  designation: z.string().trim().min(1).max(150),
  employmentType: z
    .enum(["full_time", "part_time", "contract", "intern", "freelance"])
    .optional(),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeCode: z.string().trim().max(64).optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof ApiKeyError) {
    return NextResponse.json(
      {
        error: { code: error.status === 429 ? "rate_limited" : "unauthorized", message: error.message },
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
  console.error("v1 employees failure:", error);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong" } },
    { status: 500, headers: apiVersionHeaders() }
  );
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireApiKey(request, ["employees:read"]);

    const { searchParams } = new URL(request.url);
    const parsed = listSchema.safeParse(Object.fromEntries(searchParams));
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

    const { search, status, departmentId, page, pageSize } = parsed.data;
    const result = await new NeonEmployeeRepository(ctx).list({
      search,
      page,
      pageSize,
      filters: { status, departmentId },
    });

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
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiKey(request, ["employees:write"]);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Body is not valid JSON" } },
        { status: 400, headers: apiVersionHeaders() }
      );
    }

    const parsed = createSchema.safeParse(raw);
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

    const created = await new NeonEmployeeRepository(ctx).create(parsed.data);
    return NextResponse.json({ data: created }, { status: 201, headers: apiVersionHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("duplicate key") || message.includes("unique constraint")) {
      return NextResponse.json(
        {
          error: {
            code: "conflict",
            message: "An employee with that email or code already exists",
          },
        },
        { status: 409, headers: apiVersionHeaders() }
      );
    }
    return errorResponse(error);
  }
}
