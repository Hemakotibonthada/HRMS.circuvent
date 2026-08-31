// ═══════════════════════════════════════════════════════════════
// POST /api/auth/backchannel-logout
// ═══════════════════════════════════════════════════════════════
// OpenID Connect back-channel logout. ATS delegates its sessions here too, so
// one endpoint covers both HRMS and ATS browsers.

import { NextResponse, type NextRequest } from "next/server";

import { revokeSessionsForIdpLogout } from "@/lib/auth/session";
import { ssoEnabled, verifyLogoutToken } from "@/lib/circuvent-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!ssoEnabled()) {
    return NextResponse.json({ error: "SSO not configured" }, { status: 503 });
  }

  let logoutToken: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const raw = form.get("logout_token");
    if (typeof raw === "string" && raw.trim()) logoutToken = raw.trim();
  } else {
    try {
      const body = (await request.json()) as { logout_token?: unknown };
      if (typeof body.logout_token === "string" && body.logout_token.trim()) {
        logoutToken = body.logout_token.trim();
      }
    } catch {
      // Fall through.
    }
  }

  if (!logoutToken) {
    return NextResponse.json({ error: "logout_token required" }, { status: 400 });
  }

  try {
    const claims = await verifyLogoutToken(logoutToken);
    await revokeSessionsForIdpLogout(claims);
    return new NextResponse(null, { status: 200 });
  } catch (e) {
    console.error("[backchannel-logout] rejected:", e);
    return NextResponse.json({ error: "Invalid logout token" }, { status: 400 });
  }
}
