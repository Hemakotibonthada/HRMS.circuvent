// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), tenant: vi.fn(), list: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/myspace-actor", () => ({ myspaceActor: mocks.actor }));
vi.mock("@/db/client", () => ({ withTenant: mocks.tenant }));
vi.mock("@/lib/api-context", () => ({ checkRateLimit: () => ({ allowed: true }) }));
vi.mock("@/db/repositories/employee.neon", () => ({ NeonEmployeeRepository: class { constructor(ctx: unknown) { mocks.context(ctx); } list = mocks.list; } }));
import { GET } from "@/app/api/service/myspace/route";
afterEach(() => vi.clearAllMocks());
const request = (query = "") => new NextRequest(`https://hrms.test/api/service/myspace${query}`, { headers: { authorization: "Bearer delegated" } });
describe("automatic HRMS directory", () => {
  it("uses the source account org, never an org from request parameters", async () => {
    mocks.actor.mockResolvedValue("admin@tenant.test"); mocks.tenant.mockResolvedValue([{ id: "user-a", orgId: "org-a", role: "admin" }]);
    mocks.list.mockResolvedValue({ items: [], total: 0 });
    expect((await GET(request("?orgId=org-b"))).status).toBe(200);
    expect(mocks.context).toHaveBeenCalledWith({ orgId: "org-a", userId: "user-a" });
  });
  it.each([{ actors: [] }, { actors: [{ id: "user-a", orgId: "org-a", role: "employee" }] }, { actors: [{ role: "admin" }, { role: "admin" }] }])("denies missing, non-admin or ambiguous identities: %j", async ({ actors }) => {
    mocks.actor.mockResolvedValue("person@tenant.test"); mocks.tenant.mockResolvedValue(actors);
    expect((await GET(request())).status).toBe(403); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("does not look up an unverified caller", async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401); expect(mocks.tenant).not.toHaveBeenCalled();
  });
});
