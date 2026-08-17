// ═══════════════════════════════════════════════════════════════
// HRMS API — Employees
// ═══════════════════════════════════════════════════════════════
// Replaces a stub that authenticated the caller and then returned an empty
// array regardless. Now backed by NeonEmployeeRepository under row-level
// security.
//
// Three rules hold for every handler here:
//   1. The organization comes from the verified token, never the request.
//   2. The body is parsed by Zod before it reaches the database.
//   3. Rate limits key on the user, not just the IP, so a whole office behind
//      one NAT is not throttled by a single noisy client.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { canViewOthersSalary } from "@/lib/rbac";

const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  sortBy: z
    .enum(["fullName", "email", "designation", "joinDate", "status", "employeeCode", "createdAt"])
    .optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

const createSchema = z.object({
  employeeCode: z.string().trim().min(1).max(64).optional(),
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: z.string().trim().email("Invalid email address").max(320),
  phone: z.string().trim().max(32).optional(),
  departmentId: z.string().uuid().optional(),
  designation: z.string().trim().min(1, "Designation is required").max(150),
  reportingToId: z.string().uuid().optional(),
  employmentType: z
    .enum(["full_time", "part_time", "contract", "intern", "freelance"])
    .optional(),
  status: z
    .enum(["active", "on_leave", "probation", "notice_period", "terminated", "inactive"])
    .optional(),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "joinDate must be YYYY-MM-DD"),
  location: z.string().trim().max(150).optional(),
  // Rejected rather than silently clamped: a negative or absurd salary is a
  // client bug, and payroll must never quietly accept one.
  salary: z.number().nonnegative().max(1_000_000_000).optional(),
});

/** Filters are namespaced `filter.<field>` so they cannot collide with paging. */
function readFilters(searchParams: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (key.startsWith("filter.")) filters[key.slice("filter.".length)] = value;
  }
  return filters;
}

function errorResponse(error: unknown) {
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // Internal details are logged, not returned — a stack trace in the response
  // body tells an attacker about the schema.
  console.error("Employees API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// GET /api/employees
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr", "manager"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(clientIdentifier(request, ctx.userId), 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonEmployeeRepository(ctx);
    const page = await repo.list({ ...parsed.data, filters: readFilters(searchParams) });

    // The directory is open to managers; the salary column is not. Without
    // this a manager could page through `?pageSize=500` and harvest every
    // colleague's compensation, which is precisely what withholding
    // `payroll.view` from the manager role is meant to prevent.
    if (!canViewOthersSalary(ctx.role)) {
      const withoutOthersPay = page.items.map((employee) => {
        if (employee.id === ctx.userId) return employee;
        const { salary: _salary, ...rest } = employee;
        return rest;
      });
      return NextResponse.json({ ...page, items: withoutOthersPay });
    }

    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/employees
export async function POST(request: NextRequest) {
  let ctx;
  try {
    // Managers can read the directory but must not create employees; that is
    // an HR action with payroll and access-provisioning consequences.
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`create:${clientIdentifier(request, ctx.userId)}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonEmployeeRepository(ctx);
    const created = await repo.create(parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    // A duplicate work email or employee code trips a unique index; that is
    // the caller's mistake, not a server fault.
    const message = error instanceof Error ? error.message : "";
    if (message.includes("duplicate key") || message.includes("unique constraint")) {
      return NextResponse.json(
        { error: "An employee with that email or code already exists" },
        { status: 409 }
      );
    }
    return errorResponse(error);
  }
}
