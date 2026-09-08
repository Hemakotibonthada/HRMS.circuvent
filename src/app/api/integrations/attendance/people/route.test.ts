import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { tenant, rows } = vi.hoisted(() => ({ tenant: vi.fn(), rows: vi.fn() }));
vi.mock("@/db/client", () => ({ withTenant: tenant }));
import { GET } from "./route";

const org = "11111111-1111-4111-8111-111111111111";
function request(siteId = "7", token = "test-roster-secret") {
  return new NextRequest(`https://hrms.example/api/integrations/attendance/people?siteId=${siteId}`, { headers: { authorization: `Bearer ${token}` } });
}
beforeEach(() => {
  vi.stubEnv("ATTENDANCE_ROSTER_TOKEN", "test-roster-secret");
  vi.stubEnv("ATTENDANCE_ROSTER_SITE_ORGS", JSON.stringify({ "7": org }));
  tenant.mockReset(); rows.mockReset();
  tenant.mockImplementation((_context, fn) => fn({ select: () => ({ from: () => ({ where: rows }) }) }));
});
afterEach(() => vi.unstubAllEnvs());

describe("attendance roster isolation", () => {
  it("rejects missing or invalid integration credentials before querying", async () => {
    expect((await GET(request("7", "wrong"))).status).toBe(401);
    vi.stubEnv("ATTENDANCE_ROSTER_TOKEN", "");
    expect((await GET(request())).status).toBe(401);
    expect(tenant).not.toHaveBeenCalled();
  });
  it("refuses unmapped sites rather than guessing an organization", async () => {
    expect((await GET(request("8"))).status).toBe(404);
    expect(tenant).not.toHaveBeenCalled();
  });
  it("scopes the query and returns only attendance fields", async () => {
    rows.mockResolvedValue([{ code: "EMP-1", firstName: "Test", lastName: "Person", email: "test@example.com", status: "active", deletedAt: null, salary: 999 }]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(tenant).toHaveBeenCalledWith({ orgId: org }, expect.any(Function));
    expect(await response.json()).toEqual({ siteId: 7, people: [{ code: "EMP-1", name: "Test Person", email: "test@example.com", active: true }] });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("retains leavers as inactive so existing cards lose access", async () => {
    rows.mockResolvedValue([{ code: "EMP-2", firstName: "Former", lastName: "Person", email: null, status: "terminated", deletedAt: null }]);
    const response = await GET(request());
    expect((await response.json()).people[0].active).toBe(false);
  });
});
