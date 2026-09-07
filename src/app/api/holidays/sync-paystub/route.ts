import { NextResponse, type NextRequest } from "next/server";
import { requireApiContext } from "@/lib/api-context";
import { authErrorResponse } from "@/lib/server-auth";
import { syncHolidaysToPaystub } from "@/lib/sync/paystub-holiday-sync";

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  let body: { weekendDays?: number[] } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    // optional body
  }

  const result = await syncHolidaysToPaystub(ctx, { weekendDays: body.weekendDays });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: `Synchronized ${result.syncedCount} holidays to Paystub`,
    syncedCount: result.syncedCount,
    weekendDays: result.weekendDays,
  });
}
