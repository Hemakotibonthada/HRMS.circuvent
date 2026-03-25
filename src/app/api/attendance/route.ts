import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════
// HRMS API — Attendance Management
// Clock in/out, attendance records, regularization
// ═══════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
  const employeeId = searchParams.get("employeeId");
  const department = searchParams.get("department");

  return NextResponse.json({
    data: [],
    summary: {
      date,
      totalEmployees: 0,
      present: 0,
      absent: 0,
      late: 0,
      onLeave: 0,
      wfh: 0,
      attendanceRate: 0,
    },
    filters: { date, employeeId, department },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, action } = body;

    if (!employeeId || !action) {
      return NextResponse.json({ error: "Missing employeeId or action" }, { status: 400 });
    }

    if (!["clock_in", "clock_out"].includes(action)) {
      return NextResponse.json({ error: "Action must be clock_in or clock_out" }, { status: 400 });
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    const dateStr = now.toISOString().split("T")[0];

    // Determine if late (after 9:15 AM)
    const isLate = action === "clock_in" && (now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 15));
    const lateMinutes = isLate ? (now.getHours() - 9) * 60 + now.getMinutes() - 15 : 0;

    const record = {
      id: `ATT-${Date.now()}`,
      employeeId,
      date: dateStr,
      ...(action === "clock_in" ? {
        clockIn: timeStr,
        status: isLate ? "late" : "present",
        lateMinutes: isLate ? lateMinutes : 0,
      } : {
        clockOut: timeStr,
      }),
      method: body.method || "web",
      location: body.location || "Office",
      ipAddress: request.headers.get("x-forwarded-for") || "unknown",
      createdAt: now.toISOString(),
    };

    return NextResponse.json({
      data: record,
      message: action === "clock_in" ? "Clocked in successfully" : "Clocked out successfully",
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
