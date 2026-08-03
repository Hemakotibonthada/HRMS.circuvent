import { NextRequest, NextResponse } from "next/server";
import {
  adminDb,
  requireUserOrService,
  authErrorResponse,
} from "@/lib/server-auth";

// ═══════════════════════════════════════════════════════════════
// CROSS-APP EMPLOYEE SYNC API
// Allows CV-365 and Mail.circuvent to fetch/validate employee
// data from the HRMS system. Used for login gating and profile sync.
// ═══════════════════════════════════════════════════════════════

// ─── GET: Fetch employee by email or uid ─────────────────────
// Usage: GET /api/sync/employee?email=user@company.com
//    or: GET /api/sync/employee?uid=abc123

export async function GET(req: NextRequest) {
  try {
    await requireUserOrService(req);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");
    const uid = searchParams.get("uid");

    if (!email && !uid) {
      return NextResponse.json(
        { success: false, error: "Provide 'email' or 'uid' query parameter" },
        { status: 400 }
      );
    }

    const db = adminDb("hrms-circuvent");

    if (uid) {
      const snap = await db.collection("employees").doc(uid).get();
      if (!snap.exists) {
        return NextResponse.json(
          { success: false, error: "Employee not found" },
          { status: 404 }
        );
      }
      const data = snap.data()!;
      return NextResponse.json({
        success: true,
        employee: {
          id: snap.id,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          department: data.department,
          designation: data.designation,
          joiningDate: data.joiningDate,
          status: data.status,
          employmentType: data.employmentType,
          location: data.location,
          reportingManager: data.reportingManager,
        },
      });
    }

    // Search by email
    const snap = await db.collection("employees").where("email", "==", email).get();

    if (snap.empty) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    const empDoc = snap.docs[0];
    const data = empDoc.data();

    return NextResponse.json({
      success: true,
      employee: {
        id: empDoc.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        department: data.department,
        designation: data.designation,
        joiningDate: data.joiningDate,
        status: data.status,
        employmentType: data.employmentType,
        location: data.location,
        reportingManager: data.reportingManager,
      },
    });
  } catch (error) {
    console.error("Employee fetch error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
