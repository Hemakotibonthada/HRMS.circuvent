import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import type { EmployeeRecord } from "@/db/repositories/types";

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE VALIDATION API
// Called by CV-365 during login to verify the user is an active
// employee before allowing access.
// ═══════════════════════════════════════════════════════════════
// Backed by Postgres. This previously queried a Firestore `employees`
// collection, which had two problems: it needed Firebase Admin credentials no
// deployment has, and it matched on email alone with no organisation scope, so
// the same address in any tenant would have validated.

/** Statuses that count as a working employee. */
const ACTIVE = new Set(["active", "probation"]);

function shape(e: EmployeeRecord) {
  return {
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    displayName: e.fullName || `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
    email: e.email,
    department: e.departmentName,
    designation: e.designation,
    joiningDate: e.joinDate,
    status: e.status,
    location: e.location,
    reportingManager: e.reportingToName,
  };
}

/**
 * Finds one employee by email within the caller's organisation.
 *
 * The repository scopes every query to the tenant on the verified token, so an
 * address belonging to another organisation simply is not found. The exact
 * comparison after the search matters: `search` is a partial match, and
 * "a@x.com" must not validate someone whose address merely contains it.
 */
async function findByEmail(
  repo: NeonEmployeeRepository,
  email: string
): Promise<EmployeeRecord | null> {
  const needle = email.toLowerCase().trim();
  const page = await repo.list({ search: needle, pageSize: 25 });
  return page.items.find((e) => (e.email ?? "").toLowerCase() === needle) ?? null;
}

async function validate(req: NextRequest, email: string | null) {
  let ctx;
  try {
    ctx = await requireApiContext(req, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!email) {
    return NextResponse.json({ valid: false, error: "Email is required" }, { status: 400 });
  }

  try {
    const employee = await findByEmail(new NeonEmployeeRepository(ctx), email);

    if (!employee) {
      return NextResponse.json({
        valid: false,
        error: "No employee record found for this email",
      });
    }

    if (!ACTIVE.has((employee.status ?? "").toLowerCase())) {
      return NextResponse.json({
        valid: false,
        error: `Employee account is ${employee.status || "inactive"}. Contact HR.`,
        status: employee.status,
      });
    }

    return NextResponse.json({ valid: true, employee: shape(employee) });
  } catch (error) {
    console.error("Employee validation error:", error);
    return NextResponse.json(
      { valid: false, error: "Validation service unavailable" },
      { status: 500 }
    );
  }
}

/** POST /api/auth/validate-employee — body: { email } */
export async function POST(req: NextRequest) {
  let email: string | null = null;
  try {
    const body = (await req.json()) as { email?: unknown };
    email = typeof body?.email === "string" ? body.email : null;
  } catch {
    return NextResponse.json(
      { valid: false, error: "Request body is not valid JSON" },
      { status: 400 }
    );
  }
  return validate(req, email);
}

/** GET /api/auth/validate-employee?email=… */
export async function GET(req: NextRequest) {
  return validate(req, new URL(req.url).searchParams.get("email"));
}
