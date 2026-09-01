import { NextResponse, type NextRequest, after } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, idpAssertedMfa, requestedApp, safeReturnTo, ssoEnabled, verifyToken } from "@/lib/circuvent-sso";
import { signInWithSso, recordSignInWorkLog, type SignInFailure } from "@/lib/auth/session";
import {
  writeSessionCookies,
} from "@/lib/auth/tokens";

export const runtime = "nodejs";

/**
 * Why a sign-in that the identity provider approved can still be refused here.
 *
 * The provider settles identity; HRMS still owns whether that person may work
 * in this system today. A suspended employee holding a perfectly valid token
 * must not get in.
 */
const MESSAGES: Record<SignInFailure, string> = {
  invalid_credentials: "no_hrms_account",
  account_locked: "account_locked",
  account_inactive: "account_inactive",
  mfa_required: "mfa_required",
  mfa_invalid: "mfa_required",
  password_reset_required: "password_reset_required",
};

function appUrl(req: NextRequest): string {
  // The host the browser actually used comes first. The session cookie is
  // scoped to a domain, so redirecting to a different hostname than the one
  // that just received the cookie would land the user on a page that cannot
  // see their new session -- which looks exactly like the sign-in failing.
  const forwarded = req.headers.get("x-forwarded-host");
  if (forwarded) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwarded}`;
  }
  return (
    process.env.NEXT_PUBLIC_HRMS_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(req.url).origin
  );
}

function fail(req: NextRequest, reason: string) {
  const url = new URL("/login", appUrl(req));
  url.searchParams.set("sso_error", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  if (!ssoEnabled()) return fail(req, "not_configured");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return fail(req, url.searchParams.get("error_description") || error);
  if (!code || !state) return fail(req, "missing_code");

  const jar = await cookies();
  const expectedState = jar.get("sso_state")?.value;
  const verifier = jar.get("sso_verifier")?.value;
  const nonce = jar.get("sso_nonce")?.value;
  const returnTo = jar.get("sso_return")?.value;
  const app = requestedApp(jar.get("sso_app")?.value);

  // A state that does not match means this response was not the answer to a
  // request this browser made, which is the shape of a CSRF on the callback.
  if (!expectedState || state !== expectedState || !verifier) {
    return fail(req, "state_mismatch");
  }

  for (const name of ["sso_state", "sso_verifier", "sso_nonce", "sso_return", "sso_app"]) {
    jar.set(name, "", { path: "/", maxAge: 0 });
  }

  try {
    const tokens = await exchangeCode(code, verifier);
    const claims = await verifyToken(tokens.id_token);

    if (nonce && claims.nonce && claims.nonce !== nonce) {
      return fail(req, "nonce_mismatch");
    }

    const result = await signInWithSso({
      email: claims.email,
      app,
      // The directory's own facts, used to seed the local cache row on a first
      // sign-in and to keep it in step afterwards. The person's name belongs to
      // auth.circuvent.com, not here.
      displayName:
        typeof claims.name === "string" && claims.name.trim() ? claims.name : null,
      subject: typeof claims.sub === "string" ? claims.sub : null,
      // From the verified id_token, so a group's grant in the identity service
      // reaches this app — and ATS, which signs in through here.
      ssoRole: typeof claims.role === "string" ? claims.role : null,
      ssoPermissions: Array.isArray(claims.permissions)
        ? claims.permissions.filter((p): p is string => typeof p === "string")
        : null,
      idpMfaVerified: idpAssertedMfa(claims),
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    if (!result.ok) return fail(req, MESSAGES[result.reason]);

    // Re-validated rather than trusted: the cookie was written by this app, but
    // treating it as safe on the way out would make a single bad write at the
    // start of the handshake into an open redirect.
    const destination = safeReturnTo(returnTo) ?? new URL("/dashboard", appUrl(req)).toString();

    const res = NextResponse.redirect(destination);
    writeSessionCookies(res, result.accessToken, result.refreshToken);

    after(async () => {
      await recordSignInWorkLog(result.user.id, result.user.orgId, result.user.email);
    });

    return res;
  } catch (e) {
    console.error("SSO callback failed:", e);
    return fail(req, "exchange_failed");
  }
}
