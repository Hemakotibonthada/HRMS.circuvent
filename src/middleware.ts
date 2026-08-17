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
  // Reached from an emailed link by someone who is, by definition, signed out.
  "/reset-password",
  "/careers",
  "/privacy",
  "/terms",
  // A referred candidate is, by definition, not an employee and has no
  // account. The link they were emailed carries a 256-bit token that the
  // handler resolves against a stored hash before anything else happens; the
  // session gate here would reject them before they could present it.
  "/refer",
  "/api/public/referral",
  "/api/auth/login",
  // The whole point of these is to obtain a session, so requiring one first
  // would make single sign-on impossible to start or finish.
  "/api/auth/sso",
  "/api/auth/callback",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/health",
  // The public API authenticates by API key, not by session, and every /api/v1
  // handler calls requireApiKey before touching data. Passing it through here
  // is what lets an integration with no browser use it at all — it is not an
  // exemption from authentication.
  "/api/v1",
  // A candidate signing an offer letter has no account and no session. Their
  // only credential is the single-use token in the emailed link, which the
  // handler verifies against a stored hash in constant time. Requiring a
  // session here would make the whole e-signature flow unusable for exactly
  // the people it exists for.
  "/api/sign",
  "/sign",
  // SCIM authenticates by a bearer token issued to the identity provider, not
  // by a session — the caller is Okta or Entra, which has no browser. Every
  // handler calls authenticateScim before touching data.
  "/api/scim",
  // ── discovery and link-preview surfaces ────────────────────────────────
  // Googlebot, Bingbot and every chat client that unfurls a link arrive with
  // no cookie and follow no redirects into a sign-in form. Gating these does
  // not protect anything -- none of them expose tenant data -- it just means
  // robots.txt and the sitemap answer with the login page, and a pasted link
  // renders as a bare grey URL instead of a preview card. That failure is
  // invisible from inside the app, which is why it is worth naming here.
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.json",
  "/opengraph-image",
  "/twitter-image",
  "/icon",
  "/icons",
  "/apple-icon",
  "/.well-known",
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

  // Bearer first, then the cookie. Native apps have no usable cookie jar, so
  // they present the same signed token as a bearer credential; without this
  // the outermost gate would reject every mobile request before any route
  // handler could authorise it.
  const authorization = request.headers.get("authorization");
  const bearer =
    authorization && /^Bearer /i.test(authorization) ? authorization.slice(7).trim() : null;
  const token = bearer || request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = token ? await verifyAccessToken(token) : null;

  if (!claims) {
    // An expired access token with a refresh cookie present is the normal
    // state every 15 minutes, not a sign-out. The client is told to refresh
    // rather than being bounced to the login screen mid-session.
    const canRefresh = !!request.cookies.get(REFRESH_COOKIE)?.value || !!bearer;

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
