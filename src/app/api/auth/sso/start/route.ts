import { NextResponse, type NextRequest } from "next/server";
import {
  authorizeUrl,
  createPkcePair,
  randomState,
  requestedApp,
  safeReturnTo,
  ssoEnabled,
} from "@/lib/circuvent-sso";
import { redirectWithPkce } from "@/lib/sso-flow";

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

  const params = new URL(req.url).searchParams;
  const returnTo = safeReturnTo(params.get("return_to"));

  return redirectWithPkce(authorizeUrl({ state, codeChallenge: challenge, nonce }), {
    verifier,
    state,
    nonce,
    returnTo: returnTo ?? undefined,
    app: requestedApp(params.get("app")),
  });
}
