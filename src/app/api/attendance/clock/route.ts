// ═══════════════════════════════════════════════════════════════
// POST /api/attendance/clock
// ═══════════════════════════════════════════════════════════════
// Clock in and out. The employee is always the caller — punching for a
// colleague ("buddy punching") is the classic attendance fraud, so the id
// comes from the token and the body cannot override it.
//
// Geofence validation happens in the repository, on the server. A mobile
// client asserting it is at the office is claiming something it has every
// reason to misreport.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAttendanceRepository } from "@/db/repositories/attendance.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const schema = z.object({
  action: z.enum(["in", "out"]),
  method: z.enum(["biometric", "web", "mobile", "manual", "geo_fence"]).default("web"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // The device's own assessment of its fix. Accepted rather than ignored
  // because the geofence logic treats accuracy as a radius of uncertainty —
  // without it, a reading accurate to half a kilometre is indistinguishable
  // from one accurate to five metres, and both get a yes-or-no answer they
  // do not deserve.
  accuracyMetres: z.number().min(0).max(100_000).optional(),
  capturedAt: z.number().int().min(0).optional(),
  isMocked: z.boolean().optional(),
  photoUrl: z.string().url().max(2048).optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Tight, because a punch is a once-or-twice-daily action. A flood is either
  // a stuck client or someone probing the geofence boundary.
  const limit = checkRateLimit(`clock:${ctx.userId}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { action, method, latitude, longitude, accuracyMetres, capturedAt, isMocked, photoUrl } =
    parsed.data;

  try {
    const repo = new NeonAttendanceRepository(ctx);
    const record =
      action === "in"
        ? await repo.clockIn({
            employeeId: ctx.userId,
            method,
            latitude,
            longitude,
            accuracyMetres,
            capturedAt,
            isMocked,
            photoUrl,
            ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
          })
        : await repo.clockOut({ employeeId: ctx.userId, method, latitude, longitude });

    return NextResponse.json(record, { status: action === "in" ? 201 : 200 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Clock action failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** GET /api/attendance/clock — today's record, for the punch button's state. */
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const { record, fence } = await new NeonAttendanceRepository(ctx).todayWithFence(ctx.userId);
    // 200 with null rather than 404: "not clocked in yet" is the expected
    // state at the start of a day, not an error.
    //
    // The fence goes with it so the app can warn someone standing in the
    // wrong place before they tap, rather than after. Handing the client the
    // boundary does not weaken anything — the punch is validated server-side
    // regardless, and a client determined to lie does not need to be told
    // where the office is to do it.
    return NextResponse.json({ record, fence });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Attendance lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
