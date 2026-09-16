// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), verify: vi.fn(), signIn: vi.fn(), jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => mocks.jar.has(name) ? { value: mocks.jar.get(name) } : undefined }) }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ signInWithSso: mocks.signIn, recordSignInWorkLog: vi.fn() }));
vi.mock("@/lib/circuvent-sso", async (original) => ({ ...await original<typeof import("@/lib/circuvent-sso")>(), exchangeCode: mocks.exchange, verifyToken: mocks.verify }));
import { GET } from "@/app/api/auth/callback/route";

describe("portal callback", () => {
  beforeEach(() => {
    vi.stubEnv("SSO_CLIENT_ID", "hrms");
    vi.stubEnv("SSO_REDIRECT_URI", "https://hrms.circuvent.com/api/auth/callback");
    mocks.jar.clear();
    for (const [key, value] of Object.entries({ sso_state: "state", sso_verifier: "verifier", sso_nonce: "nonce", sso_next: "/leave" })) mocks.jar.set(key, value);
    mocks.exchange.mockReset().mockResolvedValue({ id_token: "id-token" });
    mocks.verify.mockReset().mockResolvedValue({ sub: "person", email: "person@tenant.test", nonce: "nonce" });
    mocks.signIn.mockReset().mockResolvedValue({ ok: true, accessToken: "access", refreshToken: "refresh", user: { id: "person", orgId: "tenant-a", email: "person@tenant.test" } });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each(["employee", "intern", "hr", "manager"])("exchanges with the same registered callback and lands locally for %s", async (portal) => {
    const res = await GET(new NextRequest(`https://${portal}.circuvent.com/api/auth/callback?code=code&state=state`));
    expect(mocks.exchange).toHaveBeenCalledWith("code", "verifier", `https://${portal}.circuvent.com/api/auth/callback`);
    expect(mocks.signIn.mock.calls[0][0].app).toBe("hrms");
    expect(res.status).toBe(200);
    expect(res.cookies.get("cv_access")?.value).toBe("access");
    expect(res.cookies.get("cv_refresh")?.value).toBe("refresh");
    expect(res.cookies.get("sso_next")?.value).toBe("");
    expect(await res.text()).toContain('location.replace("/leave")');
  });
  it("refuses state mismatches before exchanging credentials", async () => {
    const res = await GET(new NextRequest("https://hr.circuvent.com/api/auth/callback?code=x&state=wrong"));
    expect(res.headers.get("location")).toContain("https://hr.circuvent.com/login?sso_error=state_mismatch");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("refuses a missing nonce and creates no HRMS session", async () => {
    mocks.verify.mockResolvedValue({ email: "person@tenant.test" });
    const res = await GET(new NextRequest("https://hr.circuvent.com/api/auth/callback?code=x&state=state"));
    expect(res.headers.get("location")).toContain("nonce_mismatch");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it("ignores cross-app handoff cookies on a role portal", async () => {
    mocks.jar.set("sso_return", "https://mail.circuvent.com/mail");
    mocks.jar.set("sso_app", "mail");
    const res = await GET(new NextRequest("https://employee.circuvent.com/api/auth/callback?code=x&state=state"));
    expect(res.headers.get("location")).toBeNull();
    expect(mocks.signIn.mock.calls[0][0].app).toBe("hrms");
  });
});
