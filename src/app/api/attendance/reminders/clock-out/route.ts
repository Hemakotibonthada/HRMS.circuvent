// POST /api/attendance/reminders/clock-out
// Dispatches reminder emails to employees who forgot to clock out.

import { NextResponse, type NextRequest } from "next/server";
import { requireApiContext } from "@/lib/api-context";
import { authErrorResponse } from "@/lib/server-auth";
import { sendClockOutReminders } from "@/lib/attendance/clockout-reminder";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Only HR, Admin, Manager, and Owner can trigger mass reminder emails
  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);
  if (!privileged) {
    return NextResponse.json(
      { error: "Insufficient permissions to trigger attendance reminders" },
      { status: 403 }
    );
  }

  try {
    const result = await sendClockOutReminders(ctx);
    return NextResponse.json({
      success: true,
      message: `Checked ${result.checked} open attendance records; sent ${result.reminded} clock-out reminders.`,
      ...result,
    });
  } catch (err) {
    console.error("Failed to send clock-out reminders:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send reminders" },
      { status: 500 }
    );
  }
}
