// The optimistic-update helpers previously applied a change to the UI and, if
// the write failed, only logged. The user saw an edit that was never saved, or
// a row that vanished from the list but still existed in the database and
// reappeared on the next refresh. These tests pin the rollback.

import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const remove = vi.fn();
const create = vi.fn();
const subscribe = vi.fn(() => () => {});

vi.mock("@/lib/collection-service", () => ({
  genericService: () => ({ update, remove, create, subscribe }),
  employeeService: {},
  leaveService: {},
  attendanceService: {},
  expenseService: {},
  payrollService: {},
  recruitmentService: {},
  helpdeskService: {},
  announcementService: {},
  COLLECTIONS: { employees: "employees" },
}));

vi.mock("@/db/repositories", () => ({
  dataBackend: () => "firestore",
  employeeRepository: () => ({ subscribe: vi.fn(() => () => {}) }),
}));

const {
  useEmployeeStore,
  createAndAdd,
  updateAndSync,
  removeAndSync,
} = await import("@/stores/unified-store");

interface Row {
  id: string;
  firstName: string;
  designation: string;
  [key: string]: unknown;
}

function seed(rows: Row[]) {
  useEmployeeStore.getState().setItems(rows as never);
  useEmployeeStore.getState().setError(null);
}

const ROWS: Row[] = [
  { id: "a", firstName: "Asha", designation: "Engineer" },
  { id: "b", firstName: "Ben", designation: "Designer" },
  { id: "c", firstName: "Chen", designation: "Analyst" },
];

describe("updateAndSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed(structuredClone(ROWS));
  });

  it("applies the change optimistically and keeps it when the write succeeds", async () => {
    update.mockResolvedValue(undefined);

    await updateAndSync("employees", "b", { designation: "Lead Designer" }, useEmployeeStore.getState() as never);

    const row = useEmployeeStore.getState().items.find((i) => i.id === "b");
    expect(row?.designation).toBe("Lead Designer");
    expect(useEmployeeStore.getState().error).toBeNull();
  });

  it("reverts the optimistic change when the write fails", async () => {
    update.mockRejectedValue(new Error("permission denied"));

    await expect(
      updateAndSync("employees", "b", { designation: "Lead Designer" }, useEmployeeStore.getState() as never)
    ).rejects.toThrow("permission denied");

    const row = useEmployeeStore.getState().items.find((i) => i.id === "b");
    expect(row?.designation).toBe("Designer");
  });

  it("surfaces the failure rather than only logging it", async () => {
    update.mockRejectedValue(new Error("permission denied"));

    await expect(
      updateAndSync("employees", "b", { designation: "X" }, useEmployeeStore.getState() as never)
    ).rejects.toThrow();

    expect(useEmployeeStore.getState().error).toBe("permission denied");
  });

  it("reverts a field that was previously undefined back to undefined", async () => {
    update.mockRejectedValue(new Error("nope"));

    await expect(
      updateAndSync("employees", "a", { location: "Bangalore" } as never, useEmployeeStore.getState() as never)
    ).rejects.toThrow();

    const row = useEmployeeStore.getState().items.find((i) => i.id === "a");
    expect(row?.location).toBeUndefined();
  });

  it("leaves other rows untouched on failure", async () => {
    update.mockRejectedValue(new Error("nope"));

    await expect(
      updateAndSync("employees", "b", { designation: "X" }, useEmployeeStore.getState() as never)
    ).rejects.toThrow();

    expect(useEmployeeStore.getState().items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(useEmployeeStore.getState().items[0].firstName).toBe("Asha");
  });
});

describe("removeAndSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed(structuredClone(ROWS));
  });

  it("removes the row when the delete succeeds", async () => {
    remove.mockResolvedValue(undefined);

    await removeAndSync("employees", "b", useEmployeeStore.getState() as never);

    expect(useEmployeeStore.getState().items.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("restores the row when the delete fails", async () => {
    remove.mockRejectedValue(new Error("conflict"));

    await expect(
      removeAndSync("employees", "b", useEmployeeStore.getState() as never)
    ).rejects.toThrow("conflict");

    expect(useEmployeeStore.getState().items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("restores the row at its original position, not the top of the list", async () => {
    // addItem() prepends, so a naive restore would silently reorder the table.
    remove.mockRejectedValue(new Error("conflict"));

    await expect(
      removeAndSync("employees", "c", useEmployeeStore.getState() as never)
    ).rejects.toThrow();

    expect(useEmployeeStore.getState().items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("surfaces the failure", async () => {
    remove.mockRejectedValue(new Error("conflict"));

    await expect(
      removeAndSync("employees", "a", useEmployeeStore.getState() as never)
    ).rejects.toThrow();

    expect(useEmployeeStore.getState().error).toBe("conflict");
  });
});

describe("createAndAdd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed(structuredClone(ROWS));
  });

  it("replaces the temporary id with the real one on success", async () => {
    create.mockResolvedValue("real-id");

    const id = await createAndAdd(
      "employees",
      { firstName: "Dev", designation: "QA" } as never,
      useEmployeeStore.getState() as never
    );

    expect(id).toBe("real-id");
    expect(useEmployeeStore.getState().items.some((i) => i.id === "real-id")).toBe(true);
    expect(useEmployeeStore.getState().items.some((i) => String(i.id).startsWith("temp_"))).toBe(
      false
    );
  });

  it("removes the optimistic row when the write fails", async () => {
    create.mockRejectedValue(new Error("rejected"));

    await expect(
      createAndAdd(
        "employees",
        { firstName: "Dev", designation: "QA" } as never,
        useEmployeeStore.getState() as never
      )
    ).rejects.toThrow("rejected");

    expect(useEmployeeStore.getState().items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});
