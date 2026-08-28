// ═══════════════════════════════════════════════════════════════
// POST /api/auth/logout
// ═══════════════════════════════════════════════════════════════
// Clearing the cookie alone would leave the refresh token valid in the
// database, so anyone who captured it could keep minting access tokens after
// the user believed they had signed out. The server-side session is revoked
// first, and the cookies are cleared even if that fails.

import { NextResponse, type NextRequest } from "next/server";
import { revokeSession } from "@/lib/auth/session";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from "@/lib/auth/tokens";

export async function POST(request: NextRequest) {
  // Native clients hold the refresh token themselves. Without accepting it
  // here a native sign-out would clear local state while leaving a valid
  // 30-day refresh token live on the server — exactly the situation this route
  // exists to prevent.
  let bodyToken: string | null = null;
  try {
    const body = (await request.json()) as { refreshToken?: unknown };
    if (typeof body?.refreshToken === "string" && body.refreshToken.trim()) {
      bodyToken = body.refreshToken.trim();
    }
  } catch {
    // No body: a cookie-based web logout.
  }

  const token = bodyToken ?? request.cookies.get(REFRESH_COOKIE)?.value;

  if (token) {
    try {
      await revokeSession(token);
    } catch (error) {
      // Logging out must always appear to succeed. If revocation failed the
      // token still expires on its own, and refusing to clear the cookies
      // would strand the user in a half-signed-in state.
      console.error("Session revocation failed during logout:", error);
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, "", { ...accessCookieOptions(), maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...refreshCookieOptions(), maxAge: 0 });
  return response;
}
