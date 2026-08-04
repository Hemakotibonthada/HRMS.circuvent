// ═══════════════════════════════════════════════════════════════
// EDGE MIDDLEWARE — route protection
// ═══════════════════════════════════════════════════════════════
// Authentication currently happens in <AuthGuard>, a client component. That
// means the dashboard bundle is served to anyone who asks and only then
// redirects — the guard is a UX affordance, not a security control, and
// anything it renders before the redirect has already left the server.
//
// This moves the decision to the edge, before any page code runs. It verifies
// the signed access token only: no database round-trip, so it costs a
// signature check rather than a query on every request.
//
// Authorization still belongs downstream. Middleware answers "is this a valid
// session", API routes and RLS answer "may this person see this row".

import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from "@/lib/auth/tokens";
import { canAccessModule, type Role } from "@/lib/rbac";

/** Routes reachable without a session cookie. */
const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/careers",
  "/privacy",
  "/terms",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/health",
  // The public API authenticates by API key, not by session, and every /api/v1
  // handler calls requireApiKey before touching data. Passing it through here
  // is what lets an integration with no browser use it at all — it is not an
  // exemption from authentication.
  "/api/v1",
];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** First path segment of a dashboard route, which is the module id in rbac.ts. */
function moduleFor(pathname: string): string | null {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment ?? null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = token ? await verifyAccessToken(token) : null;

  if (!claims) {
    // An expired access token with a refresh cookie present is the normal
    // state every 15 minutes, not a sign-out. The client is told to refresh
    // rather than being bounced to the login screen mid-session.
    const canRefresh = !!request.cookies.get(REFRESH_COOKIE)?.value;

    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: canRefresh ? "Access token expired" : "Not signed in" },
        { status: 401, headers: canRefresh ? { "x-session-refresh": "1" } : undefined }
      );
    }

    const login = new URL("/login", request.url);
    // Preserved so the user lands where they were going, not on a generic
    // dashboard, after signing in.
    login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  // Coarse module gate mirroring MODULE_PERMISSION_MAP. It stops an employee
  // loading the payroll bundle at all; the API routes still enforce the real
  // check, since middleware cannot be trusted for row-level decisions.
  const moduleId = moduleFor(pathname);
  if (moduleId && !pathname.startsWith("/api/")) {
    const role = claims.role as Role;
    const known = ["admin", "hr", "manager", "employee"].includes(role);
    if (known && !canAccessModule(role, moduleId)) {
      return NextResponse.redirect(new URL("/dashboard?denied=" + moduleId, request.url));
    }
  }

  // Identity is forwarded to route handlers so they do not each re-verify the
  // token. These are set on the *outgoing* request, so a client cannot forge
  // them: any inbound value is overwritten here.
  const headers = new Headers(request.headers);
  headers.set("x-user-id", claims.sub);
  headers.set("x-org-id", claims.org);
  headers.set("x-user-role", claims.role);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static assets and image optimisation are excluded: running a signature
  // check on every icon request costs latency for no benefit.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
