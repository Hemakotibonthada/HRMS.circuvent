// @vitest-environment node
//
// The middleware is now a security control rather than a UX affordance: it
// decides, before any page code runs, whether a request is allowed through.
// These tests cover the decisions that matter — public routes stay open,
// unauthenticated requests are turned away, an expired token is distinguished
// from a signed-out one, module gating matches rbac.ts, and forged identity
// headers are overwritten.

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { ACCESS_COOKIE, REFRESH_COOKIE, signAccessToken } from "@/lib/auth/tokens";

const ORIGIN = "https://hrms.circuvent.com";

async function tokenFor(role: string): Promise<string> {
  return signAccessToken({
    sub: "user-1",
    org: "org-1",
    role,
    sid: "session-1",
    email: "asha@circuvent.com",
  });
}

function makeRequest(
  path: string,
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {}
): NextRequest {
  const request = new NextRequest(new URL(path, ORIGIN), { headers: new Headers(headers) });
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

describe("middleware", () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = "c".repeat(48);
  });

  describe("public routes", () => {
    it("lets unauthenticated users reach sign-in and public pages", async () => {
      for (const path of ["/", "/login", "/register", "/forgot-password", "/careers", "/privacy"]) {
        const response = await middleware(makeRequest(path));
        expect(response.status, `${path} should be public`).toBe(200);
      }
    });

    it("lets the auth endpoints through so sign-in is reachable", async () => {
      for (const path of ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"]) {
        const response = await middleware(makeRequest(path));
        expect(response.status, `${path} should be public`).toBe(200);
      }
    });

    it("does not treat a prefix collision as public", async () => {
      // "/loginsomething" must not inherit "/login"'s exemption.
      const response = await middleware(makeRequest("/loginsomething"));
      expect(response.status).toBe(307);
    });

    it("keeps /api/auth/me protected", async () => {
      // Session introspection requires a session.
      const response = await middleware(makeRequest("/api/auth/me"));
      expect(response.status).toBe(401);
    });
  });

  describe("unauthenticated access", () => {
    it("redirects page requests to sign-in", async () => {
      const response = await middleware(makeRequest("/employees"));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/login");
    });

    it("preserves the intended destination so the user lands where they meant to", async () => {
      const response = await middleware(makeRequest("/payroll?month=4"));
      const location = new URL(response.headers.get("location")!);
      expect(location.searchParams.get("next")).toBe("/payroll?month=4");
    });

    it("returns 401 for API requests rather than redirecting", async () => {
      // A fetch() following a redirect to an HTML login page produces a
      // confusing JSON parse error instead of a clear 401.
      const response = await middleware(makeRequest("/api/employees"));
      expect(response.status).toBe(401);
    });

    it("signals refreshable when a refresh cookie is present", async () => {
      // An expired access token mid-session is normal every 15 minutes and
      // must not look like a sign-out.
      const response = await middleware(
        makeRequest("/api/employees", { [REFRESH_COOKIE]: "refresh-token" })
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("x-session-refresh")).toBe("1");
    });

    it("does not signal refreshable without a refresh cookie", async () => {
      const response = await middleware(makeRequest("/api/employees"));
      expect(response.headers.get("x-session-refresh")).toBeNull();
    });

    it("rejects a tampered access token", async () => {
      const token = await tokenFor("admin");
      const response = await middleware(
        makeRequest("/employees", { [ACCESS_COOKIE]: `${token}tampered` })
      );
      expect(response.status).toBe(307);
    });
  });

  describe("authenticated access", () => {
    it("admits a valid session", async () => {
      const response = await middleware(
        makeRequest("/employees", { [ACCESS_COOKIE]: await tokenFor("admin") })
      );
      expect(response.status).toBe(200);
    });

    it("forwards the verified identity to route handlers", async () => {
      const response = await middleware(
        makeRequest("/api/employees", { [ACCESS_COOKIE]: await tokenFor("hr") })
      );
      expect(response.headers.get("x-middleware-override-headers")).toContain("x-user-id");
    });

    it("overwrites client-supplied identity headers", async () => {
      // Without this, a client could simply send x-org-id and read another
      // tenant's data through any handler that trusted the header.
      const response = await middleware(
        makeRequest(
          "/api/employees",
          { [ACCESS_COOKIE]: await tokenFor("employee") },
          { "x-org-id": "attacker-org", "x-user-role": "admin" }
        )
      );
      expect(response.headers.get("x-middleware-request-x-org-id")).toBe("org-1");
      expect(response.headers.get("x-middleware-request-x-user-role")).toBe("employee");
    });
  });

  describe("module gating", () => {
    it("keeps employees out of payroll, audit and billing", async () => {
      const token = await tokenFor("employee");
      for (const path of ["/payroll", "/audit", "/billing", "/compensation"]) {
        const response = await middleware(makeRequest(path, { [ACCESS_COOKIE]: token }));
        expect(response.status, `${path} should be denied`).toBe(307);
        expect(response.headers.get("location")).toContain("denied=");
      }
    });

    it("admits employees to their own self-service modules", async () => {
      const token = await tokenFor("employee");
      for (const path of ["/dashboard", "/leave", "/payslip", "/directory", "/holidays"]) {
        const response = await middleware(makeRequest(path, { [ACCESS_COOKIE]: token }));
        expect(response.status, `${path} should be allowed`).toBe(200);
      }
    });

    it("admits HR to payroll but not to the audit trail", async () => {
      const token = await tokenFor("hr");
      expect((await middleware(makeRequest("/payroll", { [ACCESS_COOKIE]: token }))).status).toBe(
        200
      );
      expect((await middleware(makeRequest("/audit", { [ACCESS_COOKIE]: token }))).status).toBe(
        307
      );
    });

    it("admits admins everywhere", async () => {
      const token = await tokenFor("admin");
      for (const path of ["/payroll", "/audit", "/billing", "/settings", "/admin"]) {
        const response = await middleware(makeRequest(path, { [ACCESS_COOKIE]: token }));
        expect(response.status, `${path} should be allowed for admin`).toBe(200);
      }
    });

    it("does not gate API routes here, leaving that to the handlers", async () => {
      // Path segments under /api do not map to rbac module ids, so gating them
      // by the same rule would deny valid requests.
      const response = await middleware(
        makeRequest("/api/employees", { [ACCESS_COOKIE]: await tokenFor("employee") })
      );
      expect(response.status).toBe(200);
    });
  });
});
