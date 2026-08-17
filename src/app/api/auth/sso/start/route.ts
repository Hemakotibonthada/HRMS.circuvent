import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  authorizeUrl,
  createPkcePair,
  randomState,
  requestedApp,
  safeReturnTo,
  ssoEnabled,
} from "@/lib/circuvent-sso";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!ssoEnabled()) {
    return NextResponse.json(
      { error: "Single sign-on is not configured" },
      { status: 503 }
    );
  }

  const { verifier, challenge } = createPkcePair();
  const state = randomState();
  const nonce = randomState();

  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60,
  };
  jar.set("sso_verifier", verifier, options);
  jar.set("sso_state", state, options);
  jar.set("sso_nonce", nonce, options);

  const params = new URL(req.url).searchParams;
  const returnTo = safeReturnTo(params.get("return_to"));
  if (returnTo) jar.set("sso_return", returnTo, options);
  else jar.set("sso_return", "", { ...options, maxAge: 0 });

  // Which app the person is actually entering. It decides the role written
  // into the session and the app recorded against it, so a sign-in that began
  // in Office is not filed as an HRMS one.
  jar.set("sso_app", requestedApp(params.get("app")), options);

  return NextResponse.redirect(
    authorizeUrl({ state, codeChallenge: challenge, nonce })
  );
}
