// ═══════════════════════════════════════════════════════════════
// GET /api/auth/me
// ═══════════════════════════════════════════════════════════════
// The client's source of truth for the current session. Reads the signed
// access token only — no database round-trip — so it is cheap enough for the
// app shell to call on every mount.

import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/auth/tokens";

export async function GET(request: NextRequest) {
  // Bearer first, then the cookie: native clients have no cookie jar, and a
  // caller that presents a token should be judged on it.
  const authorization = request.headers.get("authorization");
  const bearer =
    authorization && /^Bearer /i.test(authorization) ? authorization.slice(7).trim() : null;
  const token = bearer || request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = token ? await verifyAccessToken(token) : null;

  if (!claims) {
    // 401 rather than an empty body, so the client knows to try /refresh
    // instead of concluding the user is signed out.
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: claims.sub,
      orgId: claims.org,
      role: claims.role,
      email: claims.email,
      mfaVerified: claims.mfa ?? false,
    },
    expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
  });
}
