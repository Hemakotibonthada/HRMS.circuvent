import { NextRequest, NextResponse } from "next/server";
import { verifyRequest, authErrorResponse } from "@/lib/server-auth";

// ═══════════════════════════════════════════════════════════════
// HRMS API — Leave Management
// Leave request CRUD and approval workflow
// ═══════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  try {
    await verifyRequest(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId");
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");

  return NextResponse.json({
    data: [],
    pagination: { page, limit, total: 0, totalPages: 0 },
    filters: { employeeId, status, type },
  });
}

export async function POST(request: NextRequest) {
  try {
    await verifyRequest(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  try {
    const body = await request.json();
    const required = ["employeeId", "leaveType", "startDate", "endDate", "reason"];
    const missing = required.filter((f) => !body[f]);
    if (missing.length > 0) {
      return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 400 });
    }

    const start = new Date(body.startDate);
    const end = new Date(body.endDate);
    if (end < start) {
      return NextResponse.json({ error: "End date must be after start date" }, { status: 400 });
    }

    // Calculate working days
    let days = 0;
    const current = new Date(start);
    while (current <= end) {
      const dow = current.getDay();
      if (dow !== 0 && dow !== 6) days++;
      current.setDate(current.getDate() + 1);
    }
    if (body.halfDay) days = 0.5;

    const leaveRequest = {
      id: `LR-${Date.now()}`,
      ...body,
      totalDays: days,
      status: "pending",
      appliedOn: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({ data: leaveRequest, message: "Leave request submitted" }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await verifyRequest(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  try {
    const body = await request.json();
    const { id, action, approvedBy, reason } = body;

    if (!id || !action) {
      return NextResponse.json({ error: "Missing id or action" }, { status: 400 });
    }

    if (!["approve", "reject", "cancel"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    if (action === "reject" && !reason) {
      return NextResponse.json({ error: "Rejection reason required" }, { status: 400 });
    }

    const statusMap: Record<string, string> = { approve: "approved", reject: "rejected", cancel: "cancelled" };

    return NextResponse.json({
      data: { id, status: statusMap[action], approvedBy, rejectionReason: reason },
      message: `Leave request ${statusMap[action]}`,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
