import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════
// HRMS API — Expense Management
// Submit, approve, reject, reimburse expense claims
// ═══════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const employeeId = searchParams.get("employeeId");
  const page = parseInt(searchParams.get("page") || "1");

  return NextResponse.json({
    data: [],
    summary: { total: 0, pending: 0, approved: 0, reimbursed: 0, totalAmount: 0 },
    pagination: { page, total: 0 },
    filters: { status, category, employeeId },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const required = ["employeeId", "category", "amount", "description", "date"];
    const missing = required.filter((f) => !body[f]);
    if (missing.length > 0) {
      return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 400 });
    }

    if (typeof body.amount !== "number" || body.amount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }

    // Category limits
    const limits: Record<string, number> = {
      travel: 50000, meals: 10000, equipment: 40000,
      software: 50000, training: 25000, books: 5000,
    };
    const limit = limits[body.category];
    if (limit && body.amount > limit) {
      return NextResponse.json({ error: `Amount exceeds ${body.category} limit of ₹${limit.toLocaleString()}` }, { status: 400 });
    }

    const expense = {
      id: `EXP-${Date.now()}`,
      ...body,
      status: body.status || "submitted",
      receipt: body.receipt || false,
      billable: body.billable || false,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({ data: expense, message: "Expense submitted" }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action, approvedBy, reason } = body;

    if (!id || !action) {
      return NextResponse.json({ error: "Missing id or action" }, { status: 400 });
    }

    const validActions = ["approve", "reject", "reimburse"];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: `Invalid action. Must be: ${validActions.join(", ")}` }, { status: 400 });
    }

    const statusMap: Record<string, string> = { approve: "approved", reject: "rejected", reimburse: "reimbursed" };

    return NextResponse.json({
      data: { id, status: statusMap[action], approvedBy, rejectionReason: reason, updatedAt: new Date().toISOString() },
      message: `Expense ${statusMap[action]}`,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
