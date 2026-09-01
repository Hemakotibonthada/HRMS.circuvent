import { NextResponse } from "next/server";

import { writeSessionCookies } from "@/lib/auth/tokens";

export function redirectWithPkce(
  target: string,
  values: {
    verifier: string;
    state: string;
    nonce: string;
    returnTo?: string;
    app?: string;
  }
): NextResponse {
  const response = NextResponse.redirect(target);
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60,
  };
  response.cookies.set("sso_verifier", values.verifier, options);
  response.cookies.set("sso_state", values.state, options);
  response.cookies.set("sso_nonce", values.nonce, options);
  if (values.returnTo) {
    response.cookies.set("sso_return", values.returnTo, options);
  } else {
    response.cookies.set("sso_return", "", { ...options, maxAge: 0 });
  }
  if (values.app) {
    response.cookies.set("sso_app", values.app, options);
  } else {
    response.cookies.set("sso_app", "", { ...options, maxAge: 0 });
  }
  return response;
}

export function clearPkceCookies(response: NextResponse): void {
  for (const name of ["sso_state", "sso_verifier", "sso_nonce", "sso_return", "sso_app"]) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}

export function ssoLanding(
  path: string,
  accessToken: string,
  refreshToken: string
): NextResponse {
  const target = path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Signing in</title></head>
<body><p>Signing you in…</p>
<script>setTimeout(function(){location.replace(${JSON.stringify(target)});},100);</script>
</body></html>`;
  const response = new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
  writeSessionCookies(response, accessToken, refreshToken);
  clearPkceCookies(response);
  return response;
}
