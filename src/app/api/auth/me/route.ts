// ═══════════════════════════════════════════════════════════════
// GET /api/auth/me
// ═══════════════════════════════════════════════════════════════
// The client's source of truth for the current session. Reads the signed
// access token only — no database round-trip — so it is cheap enough for the
// app shell to call on every mount. The name travels in the token for that
// reason; see AccessClaims.name.

import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/auth/tokens";
import { accountPortalUrl } from "@/lib/account-portal";
import { currentEmployeeIdentity } from "@/lib/current-employee";

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

  // One indexed lookup, on a route the shell calls at mount. It buys the
  // difference between an employment record and a login: `claims.sub` was sent
  // here as the employee id on the assumption that the two are always equal,
  // which holds only for accounts the owner-backfill script created. Everyone
  // hired through the app got somebody else's idea of their identity — and the
  // clients use this value to decide whether a request is their own, which is
  // the check that stops a manager approving their own leave.
  //
  // A failure here degrades to null rather than failing the whole session:
  // being unable to name your employee record is not a reason to be signed out.
  let identity: { id: string; employeeCode: string; avatarUrl: string | null } | null = null;
  try {
    identity = await currentEmployeeIdentity({
      orgId: claims.org,
      userId: claims.sub,
      email: claims.email,
    });
  } catch (error) {
    console.error("Could not resolve the employee record for the session:", error);
  }

  let avatarUrl = identity?.avatarUrl ?? null;
  if (!avatarUrl && claims.sub && /^[0-9a-f-]{36}$/i.test(claims.sub)) {
    avatarUrl = `${accountPortalUrl()}/api/profile/avatar/${claims.sub}`;
  }

  return NextResponse.json({
    user: {
      id: claims.sub,
      orgId: claims.org,
      // The mobile clients read `organizationId`. Sent under both names because
      // renaming the field would break every build already installed.
      organizationId: claims.org,
      // Null when the account has no employment record — service mailboxes are
      // the usual case. Null is honest; the account id was not.
      employeeId: identity?.id ?? null,
      // What a person actually quotes to HR or reads off a badge.
      employeeCode: identity?.employeeCode ?? null,
      // Sent with the session so a face appears the moment somebody signs in,
      // rather than after a second call every screen would have to make.
      // Falls back from the employment record to the account, because the
      // suite's other apps write the account's picture and somebody who set
      // one once should not have to set it again to be recognised here.
      avatarUrl,
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
