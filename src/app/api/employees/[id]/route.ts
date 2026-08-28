// ═══════════════════════════════════════════════════════════════
// HRMS API — single employee
// ═══════════════════════════════════════════════════════════════
// Row-level security means a request for another tenant's employee simply
// finds nothing, so these handlers return 404 rather than 403 — confirming
// that an id exists in a different organization would itself leak information.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { canViewOthersSalary } from "@/lib/rbac";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";

const updateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().max(32).nullable().optional(),
    departmentId: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((val) => (!val || val === "none" ? null : val))
      .pipe(z.string().uuid().nullable().optional()),
    designation: z.string().trim().min(1).max(150),
    reportingToId: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((val) => (!val || val === "org" || val === "none" ? null : val))
      .pipe(z.string().uuid().nullable().optional()),
    employmentType: z.enum(["full_time", "part_time", "contract", "intern", "freelance"]),
    status: z.enum([
      "active",
      "on_leave",
      "probation",
      "notice_period",
      "terminated",
      "inactive",
    ]),
    joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    salary: z.number().nonnegative().max(1_000_000_000).nullable().optional(),
  })
  .partial()
  // An empty PATCH is almost always a client bug; accepting it would bump
  // updated_at and write a misleading audit entry for a no-op.
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

const paramsSchema = z.object({ id: z.string().uuid("Invalid employee id") });

function fail(error: unknown) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Employee API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr", "manager", "employee"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  try {
    const employee = await new NeonEmployeeRepository(ctx).getById(parsed.data.id);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Directory access is not salary access. Managers hold `employees.view`
    // but deliberately not `payroll.view`, so they get the record without the
    // pay — the same rule `direct-reports` already applies. An ordinary
    // employee still sees their own salary.
    const ownRecord = employee.id === ctx.userId;
    if (!ownRecord && !canViewOthersSalary(ctx.role)) {
      const { salary: _salary, ...publicFields } = employee;
      return NextResponse.json(publicFields);
    }

    return NextResponse.json(employee);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`update:${clientIdentifier(request, ctx.userId)}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const idResult = paramsSchema.safeParse(await params);
  if (!idResult.success) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  // Self-reporting would make the org chart recurse forever.
  if (parsed.data.reportingToId === idResult.data.id) {
    return NextResponse.json(
      { error: "An employee cannot report to themselves" },
      { status: 400 }
    );
  }

  try {
    const updated = await new NeonEmployeeRepository(ctx).update(idResult.data.id, parsed.data);
    return NextResponse.json(updated);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  let ctx;
  try {
    // Deletion removes someone from payroll and revokes their access; admins
    // only, matching employees.delete in src/lib/rbac.ts.
    ctx = await requireApiContext(request, ["owner", "admin"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  try {
    await new NeonEmployeeRepository(ctx).remove(parsed.data.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return fail(error);
  }
}
