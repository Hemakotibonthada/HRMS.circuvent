import { NextRequest, NextResponse } from "next/server";
import { adminDb, requireRole, authErrorResponse } from "@/lib/server-auth";

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE VALIDATION API
// Called by CV-365 during login to verify the user is an active
// employee in the HRMS system before allowing access.
// ═══════════════════════════════════════════════════════════════

// ─── POST: Validate employee by email ────────────────────────
// Body: { "email": "user@company.com" }
// Returns: { valid: true, employee: {...} } or { valid: false }

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  try {
    const body = await req.json();
    const email = body?.email;

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { valid: false, error: "Email is required" },
        { status: 400 }
      );
    }

    const db = adminDb("hrms-circuvent");
    const snap = await db
      .collection("employees")
      .where("email", "==", email.toLowerCase().trim())
      .get();

    if (snap.empty) {
      return NextResponse.json({
        valid: false,
        error: "No employee record found for this email",
      });
    }

    const empDoc = snap.docs[0];
    const data = empDoc.data();

    // Check if the employee is active
    const activeStatuses = ["active", "probation"];
    const isActive = activeStatuses.includes(data.status || "");

    if (!isActive) {
      return NextResponse.json({
        valid: false,
        error: `Employee account is ${data.status || "inactive"}. Contact HR.`,
        status: data.status,
      });
    }

    return NextResponse.json({
      valid: true,
      employee: {
        id: empDoc.id,
        firstName: data.firstName,
        lastName: data.lastName,
        displayName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
        email: data.email,
        department: data.department,
        designation: data.designation,
        joiningDate: data.joiningDate,
        status: data.status,
        location: data.location,
        reportingManager: data.reportingManager,
      },
    });
  } catch (error) {
    console.error("Employee validation error:", error);
    return NextResponse.json(
      { valid: false, error: "Validation service unavailable" },
      { status: 500 }
    );
  }
}

// ─── GET: Quick validation check ─────────────────────────────
// Usage: GET /api/auth/validate-employee?email=user@company.com

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json(
        { valid: false, error: "Email query parameter required" },
        { status: 400 }
      );
    }

    const db = adminDb("hrms-circuvent");
    const snap = await db
      .collection("employees")
      .where("email", "==", email.toLowerCase().trim())
      .get();

    if (snap.empty) {
      return NextResponse.json({ valid: false });
    }

    const data = snap.docs[0].data();
    const activeStatuses = ["active", "probation"];

    return NextResponse.json({
      valid: activeStatuses.includes(data.status || ""),
      status: data.status,
      department: data.department,
      designation: data.designation,
    });
  } catch {
    return NextResponse.json(
      { valid: false, error: "Service unavailable" },
      { status: 500 }
    );
  }
}
