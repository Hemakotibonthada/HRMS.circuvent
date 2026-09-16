// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claims: { sub: "u", org: "tenant-a", role: "employee", email: "intern@example.test" }, identity: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-hrms-portal": "intern" }), cookies: async () => ({ get: () => ({ value: "test-token" }) }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/auth/tokens", () => ({ ACCESS_COOKIE: "cv_access", verifyAccessToken: async () => mocks.claims }));
vi.mock("@/lib/current-employee", () => ({ currentEmployeeIdentity: mocks.identity }));
vi.mock("@/components/dashboard-shell", () => ({ DashboardShell: () => null }));
import DashboardLayout from "@/app/(dashboard)/layout";

describe("intern server layout", () => {
  beforeEach(() => { mocks.claims.role = "employee"; mocks.identity.mockReset(); });
  it("admits only the signed-in tenant's intern record", async () => {
    mocks.identity.mockResolvedValue({ employmentType: "intern" });
    await expect(DashboardLayout({ children: null })).resolves.toBeTruthy();
    expect(mocks.identity).toHaveBeenCalledWith({ orgId: "tenant-a", userId: "u", email: "intern@example.test" });
  });
  it.each([null, { employmentType: "full_time" }])("denies missing or non-intern employment", async (identity) => {
    mocks.identity.mockResolvedValue(identity);
    await expect(DashboardLayout({ children: null })).rejects.toThrow("redirect:/portal-access");
  });
  it("does not render the protected shell when the employment lookup fails", async () => {
    mocks.identity.mockRejectedValue(new Error("database unavailable"));
    await expect(DashboardLayout({ children: null })).rejects.toThrow("database unavailable");
  });
  it("allows HR preview without impersonating an intern", async () => {
    mocks.claims.role = "hr";
    await expect(DashboardLayout({ children: null })).resolves.toBeTruthy();
    expect(mocks.identity).not.toHaveBeenCalled();
  });
});
