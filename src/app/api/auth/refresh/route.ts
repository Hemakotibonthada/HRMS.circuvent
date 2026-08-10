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
  ACCESS_TOKEN_TTL_SECONDS,
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
  // Native clients hold the refresh token themselves and send it in the body.
  // Rotation and replay detection below are identical for both transports.
  let bodyToken: string | null = null;
  try {
    const body = (await request.json()) as { refreshToken?: unknown };
    if (typeof body?.refreshToken === "string" && body.refreshToken.trim()) {
      bodyToken = body.refreshToken.trim();
    }
  } catch {
    // No body, or not JSON: a cookie-based web refresh.
  }

  const isNative = bodyToken !== null;
  const token = bodyToken ?? request.cookies.get(REFRESH_COOKIE)?.value;
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
    return clearedResponse(
      result.reason === "reused" ? "Session was invalidated. Please sign in again." : "Session expired",
      401
    );
  }

  const response = NextResponse.json({
    ok: true,
    ...(isNative
      ? {
          tokens: {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          },
        }
      : {}),
  });
  response.cookies.set(ACCESS_COOKIE, result.accessToken, accessCookieOptions());
  response.cookies.set(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  return response;
}
