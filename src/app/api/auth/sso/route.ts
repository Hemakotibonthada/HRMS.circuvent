import { NextResponse, type NextRequest } from "next/server";
import { ssoEnabled } from "@/lib/circuvent-sso";

export const runtime = "nodejs";

/**
 * Restricts the cross-origin allowance to the suite.
 *
 * Apps that delegate their sign-in here -- ATS, Office -- ask this before
 * drawing a button, so it has to answer cross-origin. `*` would work today
 * because the answer is a single boolean about this deployment rather than
 * about the caller, but it would quietly become wrong the moment anything
 * else is added to this route.
 */
function corsFor(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host !== "circuvent.com" && !host.endsWith(".circuvent.com")) return {};
  } catch {
    return {};
  }
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

/**
 * Tells a sign-in screen whether suite single sign-on is wired up here, so the
 * button appears only where it will actually work.
 */
export function GET(req: NextRequest) {
  return NextResponse.json({ enabled: ssoEnabled() }, { headers: corsFor(req) });
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: { ...corsFor(req), "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}
