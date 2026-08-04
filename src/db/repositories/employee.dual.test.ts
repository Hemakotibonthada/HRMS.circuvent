// The dual-write wrapper is what stands between the migration and data loss:
// it decides which store is authoritative, what happens when the other fails,
// and whether a Neon outage can block hiring. Those rules are tested here with
// fakes, because the behaviour under test is the failure policy itself.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DualWriteEmployeeRepository } from "@/db/repositories/employee.dual";
import type {
  EmployeeCreate,
  EmployeeRecord,
  EmployeeRepository,
  EmployeeUpdate,
  ListQuery,
  Page,
  Unsubscribe,
} from "@/db/repositories/types";

function record(overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    id: "emp-1",
    employeeCode: "CIR-0001",
    firstName: "Asha",
    lastName: "Rao",
    fullName: "Asha Rao",
    email: "asha@circuvent.com",
    designation: "Engineer",
    employmentType: "full_time",
    status: "active",
    joinDate: "2026-01-05",
    currency: "INR",
    organizationId: "org-1",
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

class FakeRepository implements EmployeeRepository {
  readonly created: EmployeeCreate[] = [];
  readonly updated: { id: string; data: EmployeeUpdate }[] = [];
  readonly removed: string[] = [];
  failOn: Set<"create" | "update" | "remove"> = new Set();

  constructor(private readonly seed: EmployeeRecord[] = [record()]) {}

  private guard(op: "create" | "update" | "remove") {
    if (this.failOn.has(op)) throw new Error(`${op} unavailable`);
  }

  async list(_q?: ListQuery): Promise<Page<EmployeeRecord>> {
    return { items: this.seed, total: this.seed.length, page: 1, pageSize: 50, hasMore: false };
  }
  async getById(id: string) {
    return this.seed.find((e) => e.id === id) ?? null;
  }
  async create(data: EmployeeCreate) {
    this.guard("create");
    this.created.push(data);
    return record({ ...data, fullName: `${data.firstName} ${data.lastName}` });
  }
  async update(id: string, data: EmployeeUpdate) {
    this.guard("update");
    this.updated.push({ id, data });
    return record({ id, ...data });
  }
  async remove(id: string) {
    this.guard("remove");
    this.removed.push(id);
  }
  subscribe(onChange: (items: EmployeeRecord[]) => void): Unsubscribe {
    onChange(this.seed);
    return () => {};
  }
  async listDirectReports() {
    return this.seed;
  }
  async countByStatus() {
    return { active: this.seed.length };
  }
}

describe("DualWriteEmployeeRepository", () => {
  let primary: FakeRepository;
  let secondary: FakeRepository;
  let repo: DualWriteEmployeeRepository;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    primary = new FakeRepository();
    secondary = new FakeRepository();
    repo = new DualWriteEmployeeRepository(primary, secondary);
  });

  const newEmployee: EmployeeCreate = {
    firstName: "Asha",
    lastName: "Rao",
    email: "asha@circuvent.com",
    designation: "Engineer",
    joinDate: "2026-01-05",
  };

  it("writes creates to both stores", async () => {
    await repo.create(newEmployee);
    expect(primary.created).toHaveLength(1);
    expect(secondary.created).toHaveLength(1);
  });

  it("carries the primary's employee code into the secondary so rows can be matched", async () => {
    await repo.create(newEmployee);
    expect(secondary.created[0].employeeCode).toBe("CIR-0001");
  });

  it("writes updates and removals to both stores", async () => {
    await repo.update("emp-1", { designation: "Senior Engineer" });
    await repo.remove("emp-1");

    expect(primary.updated).toHaveLength(1);
    expect(secondary.updated).toHaveLength(1);
    expect(primary.removed).toEqual(["emp-1"]);
    expect(secondary.removed).toEqual(["emp-1"]);
  });

  it("still succeeds when the secondary store is down", async () => {
    // A Neon outage mid-migration must not stop someone being hired.
    secondary.failOn.add("create");

    const created = await repo.create(newEmployee);

    expect(created.email).toBe("asha@circuvent.com");
    expect(primary.created).toHaveLength(1);
    expect(secondary.created).toHaveLength(0);
  });

  it("records a divergence when the secondary write fails", async () => {
    secondary.failOn.add("update");
    await repo.update("emp-1", { status: "on_leave" });

    const divergences = repo.getDivergences();
    expect(divergences).toHaveLength(1);
    expect(divergences[0].operation).toBe("update");
    expect(divergences[0].entityId).toBe("emp-1");
    expect(divergences[0].error).toContain("unavailable");
  });

  it("fails the call when the primary store fails, and does not write to the secondary", async () => {
    // The primary is the source of truth: if it rejects, the operation did not
    // happen and the secondary must not diverge by recording it.
    primary.failOn.add("create");

    await expect(repo.create(newEmployee)).rejects.toThrow("create unavailable");
    expect(secondary.created).toHaveLength(0);
  });

  it("bounds the divergence log so a sustained outage cannot exhaust memory", async () => {
    secondary.failOn.add("update");
    for (let i = 0; i < 250; i++) {
      await repo.update(`emp-${i}`, { status: "active" });
    }
    expect(repo.getDivergences().length).toBeLessThanOrEqual(200);
  });

  it("keeps the most recent divergences when the log overflows", async () => {
    secondary.failOn.add("update");
    for (let i = 0; i < 250; i++) {
      await repo.update(`emp-${i}`, { status: "active" });
    }
    const last = repo.getDivergences().at(-1);
    expect(last?.entityId).toBe("emp-249");
  });

  it("serves every read from the primary while migrating", async () => {
    // Reads must not depend on the store being validated, or the comparison is
    // meaningless.
    const listSpy = vi.spyOn(secondary, "list");
    const getSpy = vi.spyOn(secondary, "getById");

    await repo.list();
    await repo.getById("emp-1");
    await repo.countByStatus();
    await repo.listDirectReports("emp-1");
    repo.subscribe(() => {});

    expect(listSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });
});
