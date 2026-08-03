import { NextRequest, NextResponse } from "next/server";
import { requireRole, authErrorResponse } from "@/lib/server-auth";

// ═══════════════════════════════════════════════════════════════
// HRMS API — Employee Operations
// CRUD operations for employee management
// ═══════════════════════════════════════════════════════════════

// GET /api/employees — List employees
export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["owner", "admin", "hr", "manager"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  const { searchParams } = new URL(request.url);
  const department = searchParams.get("department");
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");

  // In production, this would query Firestore
  // For now, return empty array with pagination metadata
  return NextResponse.json({
    data: [],
    pagination: {
      page,
      limit,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    },
    filters: {
      department: department || "all",
      status: status || "all",
      search: search || "",
    },
  });
}

// POST /api/employees — Create employee
export async function POST(request: NextRequest) {
  try {
    await requireRole(request, ["owner", "admin", "hr", "manager"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  try {
    const body = await request.json();

    // Validate required fields
    const requiredFields = ["firstName", "lastName", "email", "department", "designation"];
    const missing = requiredFields.filter((f) => !body[f]);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // In production, save to Firestore
    const employee = {
      id: `EMP-${Date.now()}`,
      employeeId: `EMP${Math.floor(Math.random() * 9000) + 1000}`,
      ...body,
      status: body.status || "active",
      joinDate: body.joinDate || new Date().toISOString().split("T")[0],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ data: employee, message: "Employee created successfully" }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
