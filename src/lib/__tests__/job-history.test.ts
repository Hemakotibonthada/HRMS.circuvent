import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeChange,
  readJobHistory,
  recordJobChanges,
  resetJobHistoryTableCache,
} from "@/lib/job-history";

/**
 * A transaction stub.
 *
 * `present` decides what `to_regclass` answers. The stub also models the
 * behaviour that made the first version of this module wrong: once a statement
 * fails inside a Postgres transaction, every later statement fails too. A stub
 * that merely rejects the one bad query cannot catch that class of bug, so this
 * one refuses everything afterwards the way the real database does.
 */
function makeTx(opts: { present: boolean }) {
  const state = { inserted: [] as unknown[][], poisoned: false, checks: 0 };

  const guard = () => {
    if (state.poisoned) {
      throw Object.assign(
        new Error("current transaction is aborted, commands ignored until end of transaction"),
        { code: "25P02" }
      );
    }
  };

  const missing = () => {
    state.poisoned = true;
    return Object.assign(new Error("Failed query: ... hrms.job_history"), {
      cause: Object.assign(new Error('relation "hrms.job_history" does not exist'), {
        code: "42P01",
      }),
    });
  };

  return {
    state,
    execute: async () => {
      guard();
      state.checks += 1;
      return { rows: [{ present: opts.present }] };
    },
    insert: () => ({
      values: async (rows: unknown[]) => {
        guard();
        if (!opts.present) throw missing();
        state.inserted.push(rows);
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              guard();
              if (!opts.present) throw missing();
              return [];
            },
          }),
        }),
      }),
    }),
  };
}

const who = { orgId: "org-1", employeeId: "emp-1", changedById: "user-1" };
const oneChange = [{ field: "designation" as const, fromValue: "Engineer", toValue: "Lead" }];

beforeEach(() => {
  resetJobHistoryTableCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("recordJobChanges", () => {
  it("writes nothing when a field was saved with the value it already had", async () => {
    const tx = makeTx({ present: true });
    const written = await recordJobChanges(tx as never, who, [
      { field: "designation", fromValue: "Engineer", toValue: "Engineer" },
    ]);

    expect(written).toBe(0);
    expect(tx.state.inserted).toHaveLength(0);
    // Nothing to write means the table is not even asked about.
    expect(tx.state.checks).toBe(0);
  });

  it("records both sides of a real change", async () => {
    const tx = makeTx({ present: true });
    const written = await recordJobChanges(tx as never, who, oneChange);

    expect(written).toBe(1);
    const row = (tx.state.inserted[0] as Record<string, unknown>[])[0];
    expect(row.fromValue).toBe("Engineer");
    expect(row.toValue).toBe("Lead");
    expect(row.changedById).toBe("user-1");
  });

  it("treats a first-time value as a change", async () => {
    const tx = makeTx({ present: true });
    await expect(
      recordJobChanges(tx as never, who, [
        { field: "manager", fromValue: null, toValue: "Asha Rao", fromId: null, toId: "emp-9" },
      ])
    ).resolves.toBe(1);
  });

  it("notices an id change even when both names read the same", async () => {
    // Two departments can share a name. The id is what actually moved.
    const tx = makeTx({ present: true });
    await expect(
      recordJobChanges(tx as never, who, [
        {
          field: "department",
          fromValue: "Support",
          toValue: "Support",
          fromId: "d-1",
          toId: "d-2",
        },
      ])
    ).resolves.toBe(1);
  });

  it("writes one row per changed field", async () => {
    const tx = makeTx({ present: true });
    const written = await recordJobChanges(tx as never, who, [
      { field: "designation", fromValue: "Engineer", toValue: "Lead" },
      { field: "department", fromValue: "A", toValue: "B", fromId: "d-1", toId: "d-2" },
      { field: "employment_type", fromValue: "intern", toValue: "intern" },
    ]);

    expect(written).toBe(2);
    expect(tx.state.inserted[0]).toHaveLength(2);
  });

  it("does not fail the edit when the table has not been created yet", async () => {
    const tx = makeTx({ present: false });
    await expect(recordJobChanges(tx as never, who, oneChange)).resolves.toBe(0);
  });

  it("leaves the surrounding transaction usable when the table is missing", async () => {
    // The point of the whole design. Catching the error instead of asking first
    // passed a simpler test and still aborted the employee update around it,
    // because the failed statement had already poisoned the transaction.
    const tx = makeTx({ present: false });
    await recordJobChanges(tx as never, who, oneChange);

    expect(tx.state.poisoned).toBe(false);
    await expect(tx.execute()).resolves.toBeTruthy();
  });

  it("asks the database once and remembers the answer", async () => {
    const tx = makeTx({ present: true });
    await recordJobChanges(tx as never, who, oneChange);
    await recordJobChanges(tx as never, who, oneChange);
    await recordJobChanges(tx as never, who, oneChange);

    expect(tx.state.checks).toBe(1);
    expect(tx.state.inserted).toHaveLength(3);
  });
});

describe("readJobHistory", () => {
  it("reads as empty rather than throwing when the table is absent", async () => {
    const tx = makeTx({ present: false });
    await expect(readJobHistory(tx as never, "org-1", "emp-1")).resolves.toEqual([]);
    expect(tx.state.poisoned).toBe(false);
  });
});

describe("describeChange", () => {
  const base = { effectiveOn: "2026-01-01T00:00:00.000Z", note: null };

  it("keeps the previous value in the sentence", () => {
    expect(
      describeChange({ ...base, field: "designation", fromValue: "Engineer", toValue: "Lead" })
    ).toEqual({ title: "Role changed", detail: "Engineer → Lead" });
  });

  it("reads an enum as words", () => {
    expect(
      describeChange({
        ...base,
        field: "employment_type",
        fromValue: "intern",
        toValue: "full_time",
      }).detail
    ).toBe("intern → full time");
  });

  it("does not invent a previous value when there was none", () => {
    expect(
      describeChange({ ...base, field: "manager", fromValue: null, toValue: "Asha Rao" }).detail
    ).toBe("Asha Rao");
  });
});
