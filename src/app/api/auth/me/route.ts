// ═══════════════════════════════════════════════════════════════
// GET /api/auth/me
// ═══════════════════════════════════════════════════════════════
// The client's source of truth for the current session. Reads the signed
// access token only — no database round-trip — so it is cheap enough for the
// app shell to call on every mount. The name travels in the token for that
// reason; see AccessClaims.name.

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

  // Names are split rather than sent whole because both apps show a given name
  // on its own — "Hello, Priya" — and splitting once here beats each client
  // inventing its own rule. Same convention registration uses when it creates
  // the founder's employee record: first word, then the rest.
  const displayName = (claims.name ?? "").trim();
  const [firstName = "", ...restOfName] = displayName ? displayName.split(/\s+/) : [];

  return NextResponse.json({
    user: {
      id: claims.sub,
      orgId: claims.org,
      // The mobile clients read `organizationId`. Sent under both names because
      // renaming the field would break every build already installed.
      organizationId: claims.org,
      // An employee id equal to the user id is this app's current convention —
      // the routes pass `ctx.userId` straight through where an employee id is
      // wanted, and registration writes the employee row with the user's id to
      // match. Sent explicitly so a client does not have to know that.
      employeeId: claims.sub,
      role: claims.role,
      email: claims.email,
      displayName,
      firstName,
      lastName: restOfName.join(" "),
      mfaVerified: claims.mfa ?? false,
    },
    expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
  });
}
