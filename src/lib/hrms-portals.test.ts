// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { signAccessToken, ACCESS_COOKIE } from "@/lib/auth/tokens";
import { MODULES } from "@/lib/constants";
import { HRMS_PORTALS, portalForHost, canEnterPortal, canEnterInternPortal, portalAllowsModule, rolePortalOrigin, safePortalPath } from "@/lib/hrms-portals";

describe("HRMS portal policy", () => {
  it("matches exact hosts, including uppercase DNS and explicit development aliases", () => {
    expect(portalForHost("HR.CIRCUVENT.COM")).toBe("hr");
    expect(portalForHost("intern.localhost:3002", true)).toBe("intern");
    expect(portalForHost("intern.localhost:3002", false)).toBe("hrms");
    for (const host of ["hr.circuvent.com.evil.test", "notemployee.circuvent.com", "example.org"]) expect(portalForHost(host)).toBe("hrms");
  });
  it("never grants HR or manager roles from the selected portal", () => {
    expect(canEnterPortal("hr", "employee")).toBe(false);
    expect(canEnterPortal("hr", "manager")).toBe(false);
    expect(canEnterPortal("manager", "employee")).toBe(false);
    expect(canEnterPortal("hr", "hr")).toBe(true);
    expect(canEnterPortal("manager", "owner")).toBe(true);
    expect(canEnterPortal("employee", "unknown")).toBe(false);
  });
  it("requires an intern record, except for HR/admin previews", () => {
    expect(canEnterInternPortal("employee", "intern")).toBe(true);
    expect(canEnterInternPortal("employee", "full_time")).toBe(false);
    expect(canEnterInternPortal("employee", null)).toBe(false);
    expect(canEnterInternPortal("hr", null)).toBe(true);
    expect(canEnterInternPortal("admin", null)).toBe(true);
    expect(canEnterInternPortal("unknown", "intern")).toBe(false);
  });
  it("caps the portal surface even for administrators without changing account permissions", () => {
    for (const portal of ["employee", "intern", "manager"] as const) {
      for (const mod of ["payroll", "admin", "billing", "audit", "interns"]) expect(portalAllowsModule(portal, mod, "admin")).toBe(false);
      expect(portalAllowsModule(portal, "attendance", "employee")).toBe(portal !== "manager");
    }
    expect(portalAllowsModule("hr", "payroll", "hr")).toBe(true);
    expect(portalAllowsModule("hr", "billing", "owner")).toBe(false);
    expect(portalAllowsModule("hrms", "billing", "owner")).toBe(true);
  });
  it("exposes real personal entry points without duplicate module IDs", () => {
    expect(new Set(MODULES.map(m => m.id)).size).toBe(MODULES.length);
    for (const id of ["payslip", "mydocuments", "timesheets", "goals"]) {
      expect(MODULES.some(m => m.id === id)).toBe(true);
      expect(portalAllowsModule("intern", id, "employee")).toBe(true);
    }
  });
  it("rejects open redirects and only selects known callback origins", () => {
    expect(safePortalPath("/leave?year=2026")).toBe("/leave?year=2026");
    for (const next of ["//evil.test", "/\\evil.test", "https://evil.test", "/\nhello", "/\t/evil.test"]) expect(safePortalPath(next)).toBe("/workspace");
    expect(rolePortalOrigin("https://employee.circuvent.com/login")).toBe("https://employee.circuvent.com");
    expect(rolePortalOrigin("https://employee.circuvent.com.evil.test/login")).toBeNull();
    expect(rolePortalOrigin("http://employee.circuvent.com/login")).toBeNull();
    expect(rolePortalOrigin("https://employee.circuvent.com:9443/login")).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(rolePortalOrigin("http://employee.localhost:3002/login")).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("portal request enforcement", () => {
  beforeEach(() => { process.env.AUTH_JWT_SECRET = "p".repeat(48); });
  async function request(host: string, path: string, role?: string) {
    const req = new NextRequest(`https://${host}${path}`, { headers: { "x-hrms-portal": "hrms", "x-forwarded-host": "hrms.circuvent.com" } });
    if (role) req.cookies.set(ACCESS_COOKIE, await signAccessToken({ sub: "u", org: "tenant-a", role, sid: "s" }));
    return middleware(req);
  }
  it("takes each role portal root to its workspace and then login", async () => {
    for (const [id, portal] of Object.entries(HRMS_PORTALS)) {
      if (id === "hrms") continue;
      expect((await request(portal.host, "/")).headers.get("location")).toBe(`https://${portal.host}/workspace`);
      expect((await request(portal.host, "/workspace")).headers.get("location")).toContain("/login?next=%2Fworkspace");
    }
  });
  it("blocks employees from HR pages and APIs", async () => {
    expect((await request("hr.circuvent.com", "/employees", "employee")).headers.get("location")).toContain("/portal-access");
    expect((await request("hr.circuvent.com", "/api/employees", "employee")).status).toBe(403);
    expect((await request("hr.circuvent.com", "/api/auth/me", "employee")).status).toBe(200);
  });
  it("rejects direct out-of-scope module URLs on the employee portal", async () => {
    expect((await request("employee.circuvent.com", "/payroll", "admin")).headers.get("location")).toContain("/portal-access");
    expect((await request("employee.circuvent.com", "/payslip", "employee")).status).toBe(200);
  });
  it("overwrites forged portal headers and preserves tenant identity", async () => {
    const res = await request("employee.circuvent.com", "/workspace", "employee");
    expect(res.headers.get("x-middleware-request-x-hrms-portal")).toBe("employee");
    expect(res.headers.get("x-middleware-request-x-org-id")).toBe("tenant-a");
    expect((await request("intern.circuvent.com", "/login")).headers.get("x-middleware-request-x-hrms-portal")).toBe("intern");
  });
});
