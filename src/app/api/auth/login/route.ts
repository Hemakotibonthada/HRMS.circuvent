// ═══════════════════════════════════════════════════════════════
// POST /api/auth/login
// ═══════════════════════════════════════════════════════════════
// Tokens are set as httpOnly cookies rather than returned in the body, so no
// script on the page can read them. That closes the whole class of "XSS steals
// the session token from localStorage" attacks that a bearer-token-in-JS design
// leaves open.
//
// Failure responses are deliberately uniform: a wrong password and an unknown
// address return the same status and message, because differing responses turn
// the form into an account-enumeration oracle.

import { NextResponse, type NextRequest, after } from "next/server";
import { z } from "zod";
import { signIn, recordSignInWorkLog, type SignInFailure } from "@/lib/auth/session";
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from "@/lib/auth/tokens";
import { checkRateLimit, clientIdentifier } from "@/lib/api-context";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(320),
  password: z.string().min(1, "Password is required").max(1024),
  totpCode: z.string().trim().max(10).optional(),
  backupCode: z.string().trim().max(32).optional(),
  deviceName: z.string().trim().max(120).optional(),
  app: z.enum(["hrms", "cv365", "ats", "mail", "office", "website"]).optional(),
});

/** Client-visible message per failure. Never reveals whether an account exists. */
const MESSAGES: Record<SignInFailure, { status: number; error: string }> = {
  invalid_credentials: { status: 401, error: "Incorrect email or password" },
  account_locked: {
    status: 423,
    error: "Too many failed attempts. Try again shortly or reset your password.",
  },
  account_inactive: { status: 403, error: "This account is not active" },
  mfa_required: { status: 401, error: "Enter the code from your authenticator app" },
  mfa_invalid: { status: 401, error: "That code is not valid" },
  password_reset_required: { status: 403, error: "You must set a new password to continue" },
};

export async function POST(request: NextRequest) {
  // Keyed by IP: the caller is anonymous by definition here. Tight, because
  // this endpoint is the one an attacker sprays credentials at.
  const limit = checkRateLimit(`login:${clientIdentifier(request)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please wait a moment." },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await signIn({
      ...parsed.data,
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
  } catch (error) {
    console.error("Sign-in failed:", error);
    return NextResponse.json({ error: "Sign-in is temporarily unavailable" }, { status: 503 });
  }

  if (!result.ok) {
    const { status, error } = MESSAGES[result.reason];
    return NextResponse.json(
      {
        error,
        // The client needs to know to show the MFA field or the reset flow;
        // both only occur after the password was already correct, so this
        // reveals nothing to someone guessing.
        ...(result.reason === "mfa_required" ? { mfaRequired: true } : {}),
        ...(result.reason === "password_reset_required" ? { passwordResetRequired: true } : {}),
        ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
      },
      { status }
    );
  }

  // Native clients have no cookie jar, so they need the tokens themselves.
  // Returned only when the caller asks: handing a browser a JS-readable access
  // token would give up exactly the XSS protection the httpOnly cookie exists
  // to provide, which is the reason this route sets cookies in the first place.
  const wantsTokens =
    (raw as { client?: unknown })?.client === "native" ||
    request.headers.get("x-circuvent-client") === "native";

  const response = NextResponse.json({
    user: result.user,
    ...(wantsTokens
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

  after(async () => {
    await recordSignInWorkLog(result.user.id, result.user.orgId, result.user.email);
  });

  return response;
}
