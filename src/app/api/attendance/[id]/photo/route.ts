// GET /api/attendance/[id]/photo?direction=in — the punch photograph itself.
//
// The bytes are streamed through this route rather than handed out as a signed
// object-store URL. A signed URL is a bearer token for somebody's face that
// keeps working after they leave, after the retention period passes, and after
// the image is deleted from the bucket — and it is not revocable once it has
// been pasted into a chat. Proxying costs a round trip and keeps every access
// subject to the same check.
//
// Who can look: the employee whose face it is, and the roles that already see
// attendance for payroll and disputes. Nobody else, including their peers.

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { attendancePolicies, attendancePunchPhotos } from "@/db/schema/attendance";
import { attendanceRecords } from "@/db/schema/hrms";
import { DEFAULT_RETENTION_DAYS, selfieExpired } from "@/lib/attendance-selfie";
import { getObjectBytes } from "@/lib/storage/object-store";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

const CAN_VIEW_OTHERS = new Set(["owner", "admin", "hr", "manager"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const direction = new URL(request.url).searchParams.get("direction") === "out" ? "out" : "in";

  const limit = checkRateLimit(clientIdentifier(request, ctx.userId), 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const found = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const rows = await tx
        .select({
          employeeId: attendanceRecords.employeeId,
          objectKey: attendancePunchPhotos.objectKey,
          takenAt: attendancePunchPhotos.takenAt,
        })
        .from(attendanceRecords)
        .leftJoin(
          attendancePunchPhotos,
          and(
            eq(attendancePunchPhotos.attendanceRecordId, attendanceRecords.id),
            eq(attendancePunchPhotos.direction, direction)
          )
        )
        .where(and(eq(attendanceRecords.id, id), eq(attendanceRecords.orgId, ctx.orgId)))
        .limit(1);

      if (!rows[0]) return null;

      const policy = await tx
        .select({ retention: attendancePolicies.selfieRetentionDays })
        .from(attendancePolicies)
        .where(eq(attendancePolicies.orgId, ctx.orgId))
        .limit(1);

      // ctx.userId is the signing-in account, not the employment record the
      // punch is keyed by — see lib/current-employee.ts. Resolved inside the
      // same transaction so an unresolvable caller never gets treated as a
      // match against someone else's photograph.
      const self = await currentEmployeeId(ctx, tx);

      return {
        record: rows[0],
        retention: policy[0]?.retention ?? DEFAULT_RETENTION_DAYS,
        self,
      };
    });

    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { record, retention, self } = found;
    const own = self !== null && record.employeeId === self;
    if (!own && !CAN_VIEW_OTHERS.has(ctx.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const key = record.objectKey;
    const takenAt = record.takenAt;
    if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Refused once past retention even if the purge has not run yet. The
    // promise made to the employee was that it stops being visible after N
    // days, not that a job would get round to it.
    if (takenAt && selfieExpired(takenAt, retention, new Date())) {
      return NextResponse.json(
        { error: "That photograph has passed its retention period and is no longer available" },
        { status: 410 }
      );
    }

    const bytes = await getObjectBytes(key);
    const contentType = key.endsWith(".webp") ? "image/webp" : "image/jpeg";

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        // Private, and short. This is somebody's face; it should not sit in a
        // shared cache, and a stale copy must not outlive a deletion by long.
        "Cache-Control": "private, max-age=60, must-revalidate",
        "Content-Disposition": "inline",
        // The image is displayed, never interpreted.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    console.error("Punch photograph lookup failed:", error);
    return NextResponse.json({ error: "That photograph could not be loaded" }, { status: 502 });
  }
}
