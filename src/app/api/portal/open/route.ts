import { NextRequest, NextResponse } from "next/server";
import { verifyRequest, authErrorResponse } from "@/lib/server-auth";
import { currentEmployeeIdentity } from "@/lib/current-employee";
import { HRMS_PORTALS, canEnterPortal, canEnterInternPortal, portalHome, type HrmsPortal } from "@/lib/hrms-portals";

export async function GET(req: NextRequest) {
  try {
    const caller = await verifyRequest(req);
    const raw = req.nextUrl.searchParams.get("portal") ?? "";
    if (!Object.hasOwn(HRMS_PORTALS, raw)) return NextResponse.json({ error: "Unknown portal" }, { status: 400 });
    const portal = raw as HrmsPortal;
    if (!canEnterPortal(portal, caller.role)) return NextResponse.json({ error: "Portal access denied" }, { status: 403 });
    if (portal === "intern" && !canEnterInternPortal(caller.role, null)) {
      const identity = await currentEmployeeIdentity({ orgId: caller.organizationId, userId: caller.uid, email: caller.email });
      if (!canEnterInternPortal(caller.role, identity?.employmentType)) return NextResponse.json({ error: "An intern employment record is required" }, { status: 403 });
    }
    const local = process.env.NODE_ENV !== "production" && (req.nextUrl.hostname === "localhost" || req.nextUrl.hostname === "127.0.0.1" || req.nextUrl.hostname.endsWith(".localhost"));
    const origin = local ? `http://${portal}.localhost${req.nextUrl.port ? `:${req.nextUrl.port}` : ""}` : `https://${HRMS_PORTALS[portal].host}`;
    return NextResponse.redirect(new URL(portalHome(portal), origin));
  } catch (error) {
    const result = authErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
