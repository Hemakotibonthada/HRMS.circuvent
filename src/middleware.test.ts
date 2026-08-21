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

    it("lets Razorpay reach the billing webhook without a session", async () => {
      /*
       * Razorpay posts server-to-server with no cookie. Gated, the middleware
       * answers 401 before the handler runs: Razorpay records a failed
       * delivery, the subscription is never activated, and the customer has
       * paid for something that was never switched on. Nothing in the
       * application logs it, because the request reached no application code.
       *
       * The handler does its own, stricter check — an HMAC over the raw body —
       * so this is not an exemption from authentication.
       */
      const response = await middleware(makeRequest("/api/billing/webhook"));
      expect(response.status).toBe(200);
    });

    it("keeps the rest of billing behind a session", async () => {
      // The exemption above is for one path, not for /api/billing. Checkout
      // starts a payment, settings holds the merchant credentials, and verify
      // grants a plan — none may be reachable without a session.
      for (const path of [
        "/api/billing/checkout",
        "/api/billing/settings",
        "/api/billing/verify",
        "/api/billing/subscription",
      ]) {
        const response = await middleware(makeRequest(path));
        expect(response.status, `${path} must require a session`).toBe(401);
      }
    });

    it("does not treat a prefix collision as public", async () => {
      // "/loginsomething" must not inherit "/login"'s exemption.
      const response = await middleware(makeRequest("/loginsomething"));
      expect(response.status).toBe(307);
    });

    it("lets crawlers and link unfurlers reach the discovery routes", async () => {
      // These arrive with no cookie and do not follow a redirect into a sign-in
      // form. Gated, robots.txt and the sitemap answer with the login page and
      // a pasted link renders without a preview card — a failure that is
      // invisible from inside the app, so it is pinned here instead.
      for (const path of [
        "/robots.txt",
        "/sitemap.xml",
        "/manifest.json",
        "/opengraph-image",
        "/twitter-image",
        "/icon",
        "/apple-icon",
      ]) {
        const response = await middleware(makeRequest(path));
        expect(response.status, `${path} should be reachable without a session`).toBe(200);
      }
    });

    it("keeps /api/auth/me protected", async () => {
      // Session introspection requires a session.
      const response = await middleware(makeRequest("/api/auth/me"));
      expect(response.status).toBe(401);
    });

    it("passes /api/v1 through, since those routes authenticate by API key", async () => {
      // An integration has no session cookie. The handlers themselves call
      // requireApiKey, so this is a different authentication path rather than
      // an exemption from one.
      for (const path of ["/api/v1/employees", "/api/v1/leave", "/api/v1/openapi"]) {
        const response = await middleware(makeRequest(path));
        expect(response.status, `${path} should reach its handler`).toBe(200);
      }
    });

    it("does not extend that to a lookalike path", async () => {
      const response = await middleware(makeRequest("/api/v1nonsense"));
      expect(response.status).toBe(401);
    });

    it("passes the signing routes through, since a candidate has no session", async () => {
      // Someone signing an offer letter has no account. Their credential is
      // the single-use token in the emailed link, which the handler verifies
      // against a stored hash. Requiring a session here would make the whole
      // e-signature flow unusable for exactly the people it exists for.
      for (const path of [
        "/api/sign/6b1f0b4a-0000-4000-8000-000000000000",
        "/sign/6b1f0b4a-0000-4000-8000-000000000000",
      ]) {
        const response = await middleware(makeRequest(path));
        expect(response.status, `${path} should reach its handler`).toBe(200);
      }
    });

    it("passes the SCIM routes through, since the caller is an identity provider", async () => {
      // Okta and Entra have no browser and no session. Every SCIM handler
      // calls authenticateScim before touching data, so this is a different
      // authentication path rather than an exemption from one.
      for (const path of [
        "/api/scim/v2/Users",
        "/api/scim/v2/ServiceProviderConfig",
      ]) {
        const response = await middleware(makeRequest(path));
        expect(response.status, `${path} should reach its handler`).toBe(200);
      }
    });

    it("does not extend the SCIM exemption to a lookalike path", async () => {
      const response = await middleware(makeRequest("/api/scimulator"));
      expect(response.status).toBe(401);
    });

    it("does not extend the signing exemption to a lookalike path", async () => {      // A prefix match that caught /api/signatures would expose every
      // signature record in the system without a session. API paths are
      // refused outright; page paths redirect to sign-in. Neither may pass.
      for (const path of ["/api/signatures", "/api/signing-keys"]) {
        const response = await middleware(makeRequest(path));
        expect(response.status, `${path} must not be public`).toBe(401);
      }

      const page = await middleware(makeRequest("/signatures"));
      expect(page.status, "/signatures must not be public").toBe(307);
      expect(page.headers.get("location")).toContain("/login");
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

  describe("bearer tokens (native clients)", () => {
    // Native apps have no usable cookie jar. They present the same signed
    // token as a bearer credential, so the middleware has to accept it or
    // every mobile request is refused before a handler ever runs.

    it("accepts a valid bearer token with no cookie present", async () => {
      const response = await middleware(
        makeRequest("/api/employees", {}, { authorization: `Bearer ${await tokenFor("hr")}` })
      );
      expect(response.status).toBe(200);
    });

    it("forwards identity from a bearer token", async () => {
      const response = await middleware(
        makeRequest("/api/employees", {}, { authorization: `Bearer ${await tokenFor("hr")}` })
      );
      expect(response.headers.get("x-middleware-request-x-user-id")).toBe("user-1");
      expect(response.headers.get("x-middleware-request-x-org-id")).toBe("org-1");
      expect(response.headers.get("x-middleware-request-x-user-role")).toBe("hr");
    });

    it("rejects a tampered bearer token", async () => {
      const response = await middleware(
        makeRequest(
          "/api/employees",
          {},
          { authorization: `Bearer ${await tokenFor("admin")}tampered` }
        )
      );
      expect(response.status).toBe(401);
    });

    it("rejects a malformed authorization header", async () => {
      for (const value of ["Bearer", "Bearer ", "Basic abc", "abc"]) {
        const response = await middleware(
          makeRequest("/api/employees", {}, { authorization: value })
        );
        expect(response.status, `${value} should be refused`).toBe(401);
      }
    });

    it("prefers the bearer token over a cookie that rode along", async () => {
      // A native caller presenting a token should be judged on it, not on
      // whatever cookie happened to be attached to the request.
      const response = await middleware(
        makeRequest(
          "/api/employees",
          { [ACCESS_COOKIE]: await tokenFor("employee") },
          { authorization: `Bearer ${await tokenFor("admin")}` }
        )
      );
      expect(response.headers.get("x-middleware-request-x-user-role")).toBe("admin");
    });
  });
});
