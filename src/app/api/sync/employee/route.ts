import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import type { EmployeeRecord } from "@/db/repositories/types";

// ═══════════════════════════════════════════════════════════════
// CROSS-APP EMPLOYEE LOOKUP
// ═══════════════════════════════════════════════════════════════
// Lets the other Circuvent apps fetch employee details for login gating and
// profile display. Backed by Postgres; it previously read a Firestore
// collection that no deployment has credentials for.
//
// The response shape is unchanged so existing callers keep working.

function shape(e: EmployeeRecord) {
  return {
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    phone: e.phone,
    department: e.departmentName,
    designation: e.designation,
    joiningDate: e.joinDate,
    status: e.status,
    employmentType: e.employmentType,
    location: e.location,
    reportingManager: e.reportingToName,
  };
}

/** GET /api/sync/employee?email=… or ?uid=… */
export async function GET(req: NextRequest) {
  let ctx;
  try {
    // Scoped to the caller's organisation. The old handler authorised the
    // caller but then searched every employee regardless of tenant.
    ctx = await requireApiContext(req);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");
  const uid = searchParams.get("uid");

  if (!email && !uid) {
    return NextResponse.json(
      { success: false, error: "Provide 'email' or 'uid' query parameter" },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonEmployeeRepository(ctx);

    let employee: EmployeeRecord | null = null;
    if (uid) {
      employee = await repo.getById(uid);
    } else if (email) {
      const needle = email.toLowerCase().trim();
      const page = await repo.list({ search: needle, pageSize: 25 });
      // Exact match after the partial search: "a@x.com" must not resolve to
      // someone whose address merely contains it.
      employee = page.items.find((e) => (e.email ?? "").toLowerCase() === needle) ?? null;
    }

    if (!employee) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, employee: shape(employee) });
  } catch (error) {
    console.error("Employee fetch error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
