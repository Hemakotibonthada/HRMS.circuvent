// ═══════════════════════════════════════════════════════════════
// POST /api/auth/refresh
// ═══════════════════════════════════════════════════════════════
// Exchanges the refresh cookie for a fresh access token, rotating the refresh
// token in the process.
//
// On any failure the cookies are actively cleared. Leaving a dead refresh
// token in the browser makes the client retry forever against an endpoint that
// can never succeed.

import { NextResponse, type NextRequest } from "next/server";
import { refreshSession } from "@/lib/auth/session";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from "@/lib/auth/tokens";

function clearedResponse(error: string, status: number) {
  const response = NextResponse.json({ error }, { status });
  response.cookies.set(ACCESS_COOKIE, "", { ...accessCookieOptions(), maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...refreshCookieOptions(), maxAge: 0 });
  return response;
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!token) return clearedResponse("Not signed in", 401);

  let result;
  try {
    result = await refreshSession(token);
  } catch (error) {
    // A database outage is not the client's fault and must not sign them out;
    // the cookies are left intact so a retry can succeed.
    console.error("Session refresh failed:", error);
    return NextResponse.json({ error: "Session refresh unavailable" }, { status: 503 });
  }

  if (!result.ok) {
    // "reused" means the token had already been rotated — stolen or replayed.
    // refreshSession has already revoked the whole family; the user must sign
    // in again.
    const status = result.reason === "reused" ? 401 : 401;
    return clearedResponse(
      result.reason === "reused" ? "Session was invalidated. Please sign in again." : "Session expired",
      status
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, result.accessToken, accessCookieOptions());
  response.cookies.set(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  return response;
}
