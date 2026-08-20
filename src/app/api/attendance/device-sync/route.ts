// ═══════════════════════════════════════════════════════════════
// POST /api/attendance/device-sync
// ═══════════════════════════════════════════════════════════════
// Pulls a site's daily register from the attendance device control plane
// (`@/lib/attendance/device-client`) and reconciles it into
// `attendanceRecords` (`@/lib/attendance/device-sync`). This is the manual
// trigger an HR admin can call after fixing a terminal or badge problem
// without waiting for the next scheduled run; the same underlying sync is
// also run automatically once a day from `/api/cron`.
//
// Gated to `owner | admin | hr`, not the wider `regularisation` approver list
// (which also allows `manager`, because approving one direct report's single
// day is a bounded action). A device import writes attendance for every
// employee at a site in one call — that blast radius puts it with the other
// organisation-wide administrative actions (the holiday calendar, payroll
// runs), not with a manager's scoped approval.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireApiContext } from "@/lib/api-context";
import { authErrorResponse } from "@/lib/server-auth";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";
import { defaultSyncRange, resolveSiteId, syncDeviceAttendanceForOrg } from "@/lib/attendance/device-sync";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const syncSchema = z.object({
  /** Falls back to `ATTENDANCE_DEVICE_SITE_MAP[orgId]` when omitted. */
  siteId: z.number().int().positive().optional(),
  from: z.string().regex(DATE_RE, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(DATE_RE, "to must be YYYY-MM-DD").optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // An empty body is the expected shape for "sync now with the defaults", so
  // it is treated as `{}` rather than a 400 — only text that was supplied and
  // is not valid JSON is rejected.
  let raw: unknown = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = syncSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  const siteId = resolveSiteId(ctx.orgId, parsed.data.siteId ?? null);
  if (siteId === null) {
    return NextResponse.json(
      {
        error:
          "No device site is configured for this organisation. Pass `siteId` explicitly, or set " +
          "ATTENDANCE_DEVICE_SITE_MAP so this organisation resolves one automatically.",
      },
      { status: 400 }
    );
  }

  try {
    let { from, to } = parsed.data;
    if (!from || !to) {
      const defaults = await defaultSyncRange(ctx);
      from = from ?? defaults.from;
      to = to ?? defaults.to;
    }

    if (from > to) {
      return NextResponse.json({ error: "`from` must not be after `to`." }, { status: 400 });
    }

    const summary = await syncDeviceAttendanceForOrg(ctx, { siteId, from, to });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Device attendance sync failed:", error);
    return NextResponse.json({ error: "Could not sync device attendance" }, { status: 500 });
  }
}
