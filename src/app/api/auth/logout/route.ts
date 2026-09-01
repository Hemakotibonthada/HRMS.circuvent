import { NextResponse, type NextRequest } from "next/server";
import { revokeSession } from "@/lib/auth/session";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from "@/lib/auth/tokens";
import { logoutUrl, ssoEnabled } from "@/lib/circuvent-sso";

export async function POST(request: NextRequest) {
  let federated = request.nextUrl.searchParams.get("federated") === "1";
  let bodyToken: string | null = null;

  try {
    const body = (await request.json()) as { federated?: unknown; refreshToken?: unknown };
    if (body?.federated === true) federated = true;
    if (typeof body?.refreshToken === "string" && body.refreshToken.trim()) {
      bodyToken = body.refreshToken.trim();
    }
  } catch {
    // No body: cookie-based web logout.
  }

  const token = bodyToken ?? request.cookies.get(REFRESH_COOKIE)?.value;

  if (token) {
    try {
      await revokeSession(token);
    } catch (error) {
      console.error("Session revocation failed during logout:", error);
    }
  }

  const appOrigin =
    process.env.NEXT_PUBLIC_HRMS_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(request.url).origin;

  const response = NextResponse.json({
    ok: true,
    redirectTo: `${appOrigin.replace(/\/+$/, "")}/login`,
    ...(ssoEnabled() && federated
      ? {
          federatedLogoutUrl: logoutUrl(appOrigin),
        }
      : {}),
  });
  response.cookies.set(ACCESS_COOKIE, "", { ...accessCookieOptions(), maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...refreshCookieOptions(), maxAge: 0 });
  return response;
}
