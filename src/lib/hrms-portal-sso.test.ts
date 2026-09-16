// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as start } from "@/app/api/auth/sso/start/route";
import { requestPortalOrigin } from "@/lib/hrms-portals";
import { ssoLanding } from "@/lib/sso-flow";

describe("portal sign-in", () => {
  beforeEach(() => {
    vi.stubEnv("SSO_CLIENT_ID", "hrms");
    vi.stubEnv("SSO_REDIRECT_URI", "https://hrms.circuvent.com/api/auth/callback");
  });
  it.each(["employee", "intern", "hr", "manager"])("uses a same-host PKCE callback for %s", async (portal) => {
    const req = new NextRequest(`https://${portal}.circuvent.com/api/auth/sso/start?next=%2Fleave&app=mail&return_to=https%3A%2Fmail.circuvent.com`);
    const res = await start(req);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("redirect_uri")).toBe(`https://${portal}.circuvent.com/api/auth/callback`);
    expect(location.searchParams.get("client_id")).toBe("hrms");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(res.cookies.get("sso_app")?.value).toBe("hrms");
    expect(res.cookies.get("sso_next")?.value).toBe("/leave");
    expect(res.cookies.get("sso_return")?.value).toBe("");
    expect(res.headers.get("set-cookie")).not.toContain("Domain=");
  });
  it("keeps the registered main HRMS callback for unrelated hosts", async () => {
    const res = await start(new NextRequest("https://preview.example.test/api/auth/sso/start"));
    expect(new URL(res.headers.get("location")!).searchParams.get("redirect_uri")).toBe("https://hrms.circuvent.com/api/auth/callback");
  });
  it("handles Next's local bind URL using the Host header, not forwarded-host", () => {
    vi.stubEnv("NODE_ENV", "development");
    const request = new Request("http://127.0.0.1:3002/api/auth/sso/start", { headers: { host: "intern.localhost:3002", "x-forwarded-host": "evil.test" } });
    expect(requestPortalOrigin(request)).toBe("http://intern.localhost:3002");
    const forged = new Request("https://example.test/", { headers: { "x-forwarded-host": "hr.circuvent.com" } });
    expect(requestPortalOrigin(forged)).toBeNull();
  });
  it("does not permit script injection or protocol-relative redirects in the landing response", async () => {
    const res = ssoLanding('/leave?q=</script><script>alert(1)</script>', "access", "refresh");
    const html = await res.text();
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("\\u003c/script>");
    expect(await ssoLanding("/\\evil.test", "a", "r").text()).toContain('location.replace("/dashboard")');
  });
});

afterEach(() => vi.unstubAllEnvs());
