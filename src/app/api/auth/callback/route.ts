import { NextResponse, type NextRequest, after } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeCode,
  idpAssertedMfa,
  requestedApp,
  safeReturnTo,
  ssoEnabled,
  verifyToken,
} from "@/lib/circuvent-sso";
import { signInWithSso, recordSignInWorkLog, type SignInFailure } from "@/lib/auth/session";
import { clearPkceCookies, ssoLanding } from "@/lib/sso-flow";
import { sealDelegationHandoff } from "@/lib/sso-delegation-handoff";

export const runtime = "nodejs";

const MESSAGES: Record<SignInFailure, string> = {
  invalid_credentials: "no_hrms_account",
  account_locked: "account_locked",
  account_inactive: "account_inactive",
  mfa_required: "mfa_required",
  mfa_invalid: "mfa_required",
  password_reset_required: "password_reset_required",
};

function appUrl(req: NextRequest): string {
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

function fail(req: NextRequest, reason: string, returnTo?: string | null) {
  const delegated = safeReturnTo(returnTo);
  const hrmsOrigin = new URL(appUrl(req)).origin;
  if (delegated && new URL(delegated).origin !== hrmsOrigin) {
    const url = new URL("/login", delegated);
    url.searchParams.set("sso_error", reason);
    const res = NextResponse.redirect(url);
    clearPkceCookies(res);
    return res;
  }

  const url = new URL("/login", appUrl(req));
  url.searchParams.set("sso_error", reason);
  const res = NextResponse.redirect(url);
  clearPkceCookies(res);
  return res;
}

export async function GET(req: NextRequest) {
  if (!ssoEnabled()) return fail(req, "not_configured");

  const url = new URL(req.url);
  const jar = await cookies();
  const returnTo = jar.get("sso_return")?.value;

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return fail(req, url.searchParams.get("error_description") || error, returnTo);
  }
  if (!code || !state) return fail(req, "missing_code", returnTo);

  const expectedState = jar.get("sso_state")?.value;
  const verifier = jar.get("sso_verifier")?.value;
  const nonce = jar.get("sso_nonce")?.value;
  const app = requestedApp(jar.get("sso_app")?.value);

  if (!expectedState || state !== expectedState || !verifier) {
    return fail(req, "state_mismatch", returnTo);
  }

  try {
    const tokens = await exchangeCode(code, verifier);
    const claims = await verifyToken(tokens.id_token);

    if (nonce && claims.nonce && claims.nonce !== nonce) {
      return fail(req, "nonce_mismatch", returnTo);
    }

    if (!claims.email?.trim()) {
      return fail(req, "exchange_failed", returnTo);
    }

    const result = await signInWithSso({
      email: claims.email,
      app,
      displayName:
        typeof claims.name === "string" && claims.name.trim() ? claims.name : null,
      subject: typeof claims.sub === "string" ? claims.sub : null,
      ssoRole: typeof claims.role === "string" ? claims.role : null,
      ssoPermissions: Array.isArray(claims.permissions)
        ? claims.permissions.filter((p): p is string => typeof p === "string")
        : null,
      idpMfaVerified: idpAssertedMfa(claims),
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    if (!result.ok) return fail(req, MESSAGES[result.reason], returnTo);

    const destination =
      safeReturnTo(returnTo) ?? new URL("/dashboard", appUrl(req)).toString();
    const destUrl = new URL(destination);
    const hrmsOrigin = new URL(appUrl(req)).origin;
    const nextPath = `${destUrl.pathname}${destUrl.search}`;

    if (destUrl.origin !== hrmsOrigin) {
      const handoff = await sealDelegationHandoff({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        next: nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard",
      });
      const complete = new URL("/api/auth/sso/complete", destUrl.origin);
      complete.searchParams.set("handoff", handoff);
      const res = NextResponse.redirect(complete);
      clearPkceCookies(res);
      return res;
    }

    const res = ssoLanding(nextPath, result.accessToken, result.refreshToken);

    after(async () => {
      await recordSignInWorkLog(result.user.id, result.user.orgId, result.user.email);
    });

    return res;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("SSO callback failed:", detail, e);
    return fail(req, "exchange_failed", returnTo);
  }
}
