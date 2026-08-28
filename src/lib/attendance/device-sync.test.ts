// Coverage for the two things this module is actually responsible for:
//
// 1. `mapDeviceRegisterToAttendance` — the pure decision function. No
//    database, no HTTP: given a register and the candidates, does it match
//    codes honestly, does it leave a human's correction alone, and does it
//    resist inventing an absence out of silence? This is where nearly all of
//    this integration's judgement calls live, and all of it is testable
//    without a Postgres connection.
//
// 2. `syncDeviceAttendanceForAllOrgs` — the cron entrypoint. Its `listOrgs`
//    and `syncOrg` dependencies are injectable for the same reason
//    `sweepOutboxes` takes `listOrgs`/`drainPaystub`/`drainGroups` (see
//    `outbox-sweep.test.ts`): the property worth proving — that one
//    organisation's failure does not cost the others their sync — is not
//    provable against a real database and a live device API, so it is proved
//    against fakes instead.
//
// `syncDeviceAttendanceForOrg` and `defaultSyncRange` are not tested directly
// here: both call `withTenant` against a real connection, and this repo has
// no test-database infrastructure (see `outbox-sweep.test.ts`, which tests
// `sweepOutboxes` the same way — through its injected dependencies, never the
// real drains). Their SQL is a straightforward re-read of columns already
// covered by the routes that write them; the logic worth pinning is entirely
// inside the pure function and the per-organisation isolation above it.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RegisterRow } from "@/lib/attendance/device-client";
import {
  addDays,
  enumerateDays,
  isoDateInZone,
  mapDeviceRegisterToAttendance,
  resolveSiteId,
  syncDeviceAttendanceForAllOrgs,
  type DeviceSyncEmployee,
  type DeviceSyncInput,
  type DeviceSyncSummary,
} from "@/lib/attendance/device-sync";

function deviceRow(overrides: Partial<RegisterRow> = {}): RegisterRow {
  return {
    personId: 1,
    name: "Test Person",
    code: "CV-001",
    role: "Employee",
    groupName: null,
    status: "present",
    firstIn: "2025-01-15T09:00:00Z",
    lastOut: "2025-01-15T18:00:00Z",
    workedMinutes: 540,
    lateMinutes: 0,
    earlyMinutes: 0,
    punches: 2,
    assumedOut: false,
    note: "",
    manual: false,
    ...overrides,
  };
}

function employee(overrides: Partial<DeviceSyncEmployee> = {}): DeviceSyncEmployee {
  return { id: "emp-1", employeeCode: "CV-001", ...overrides };
}

function baseInput(overrides: Partial<DeviceSyncInput> = {}): DeviceSyncInput {
  return {
    day: "2025-01-15",
    rows: [deviceRow()],
    employees: [employee()],
    isHoliday: false,
    employeeIdsOnApprovedLeave: new Set(),
    protectedEmployeeIds: new Set(),
    ...overrides,
  };
}

describe("matching a badge code to an employee", () => {
  it("matches regardless of case or stray whitespace", () => {
    // A terminal keypad and an HR onboarding form are not the same input
    // method; "cv-001" and " CV-001 " are the same badge, not two different
    // ones.
    const result = mapDeviceRegisterToAttendance(
      baseInput({
        rows: [deviceRow({ code: "  cv-001  " })],
        employees: [employee({ employeeCode: "CV-001" })],
      })
    );

    expect(result.unmatched).toHaveLength(0);
    expect(result.toWrite).toHaveLength(1);
    expect(result.toWrite[0].employeeId).toBe("emp-1");
  });

  it("reports a code that matches no employee instead of dropping it", () => {
    // Every unmatched badge is either a new joiner nobody has entered into
    // HRMS yet, or one that should have been revoked when somebody left —
    // both need a human to look at it.
    const result = mapDeviceRegisterToAttendance(
      baseInput({
        rows: [deviceRow({ code: "CV-999", name: "Unknown Badge", personId: 42, status: "present" })],
        employees: [],
      })
    );

    expect(result.toWrite).toHaveLength(0);
    expect(result.unmatched).toEqual([{ code: "CV-999", name: "Unknown Badge", personId: 42, status: "present" }]);
  });
});

describe("preserving a human correction", () => {
  it("does not write over a day HR has already regularised, even though the device has data for it", () => {
    const result = mapDeviceRegisterToAttendance(
      baseInput({ protectedEmployeeIds: new Set(["emp-1"]) })
    );

    expect(result.toWrite).toHaveLength(0);
    expect(result.skippedProtected).toEqual([{ employeeId: "emp-1", employeeCode: "CV-001" }]);
    // Seen, just not written — must not also surface as "no data", which
    // would misreport a protected day as one the terminal never covered.
    expect(result.noData).toHaveLength(0);
  });
});

describe("a missing device row is not an absence", () => {
  it("reports a holiday for an employee the terminal has no row for", () => {
    const result = mapDeviceRegisterToAttendance(baseInput({ isHoliday: true, rows: [] }));

    expect(result.toWrite).toHaveLength(0);
    expect(result.noData).toEqual([{ employeeId: "emp-1", employeeCode: "CV-001", reason: "holiday" }]);
  });

  it("reports approved leave for an employee the terminal has no row for", () => {
    const result = mapDeviceRegisterToAttendance(
      baseInput({ rows: [], employeeIdsOnApprovedLeave: new Set(["emp-1"]) })
    );

    expect(result.noData).toEqual([{ employeeId: "emp-1", employeeCode: "CV-001", reason: "approved_leave" }]);
  });

  it("reports 'no terminal data' on an ordinary day with no holiday or leave to explain the gap", () => {
    const result = mapDeviceRegisterToAttendance(baseInput({ rows: [] }));

    expect(result.noData).toEqual([{ employeeId: "emp-1", employeeCode: "CV-001", reason: "no_terminal_data" }]);
  });

  it("honours a device row even on a holiday — a present punch is not overridden by the calendar", () => {
    // Holiday/leave only explain a *missing* row. A row that exists is the
    // terminal's own observation and is never second-guessed by context.
    const result = mapDeviceRegisterToAttendance(
      baseInput({ isHoliday: true, rows: [deviceRow({ status: "present" })] })
    );

    expect(result.toWrite).toHaveLength(1);
    expect(result.toWrite[0].status).toBe("present");
    expect(result.noData).toHaveLength(0);
  });
});

describe("a checkout the terminal only assumed", () => {
  it("drops the guessed exit time and worked minutes even when the device filled them in", () => {
    const result = mapDeviceRegisterToAttendance(
      baseInput({
        rows: [deviceRow({ assumedOut: true, lastOut: "2025-01-15T18:00:00Z", workedMinutes: 540 })],
      })
    );

    const [row] = result.toWrite;
    expect(row.clockOutAt).toBeNull();
    expect(row.workedMinutes).toBeNull();
    // The guessed figure is preserved as a caveat in the notes, not silently
    // discarded — it is just never stored as a measured fact.
    expect(row.notes).toContain("540");
    expect(row.notes).toMatch(/assumed/i);
  });

  it("drops them the same way when the device sent no exit reading at all", () => {
    const result = mapDeviceRegisterToAttendance(
      baseInput({ rows: [deviceRow({ assumedOut: true, lastOut: null, workedMinutes: 0 })] })
    );

    const [row] = result.toWrite;
    expect(row.clockOutAt).toBeNull();
    expect(row.workedMinutes).toBeNull();
  });

  it("keeps a real checkout when the device did not have to assume one", () => {
    const result = mapDeviceRegisterToAttendance(
      baseInput({ rows: [deviceRow({ assumedOut: false, lastOut: "2025-01-15T18:00:00Z", workedMinutes: 540 })] })
    );

    const [row] = result.toWrite;
    expect(row.clockOutAt).not.toBeNull();
    expect(row.workedMinutes).toBe(540);
  });
});

describe("mapping device status onto HRMS's own vocabulary", () => {
  it("maps every status this codebase has an equivalent for", () => {
    const cases: Array<[string, string]> = [
      ["present", "present"],
      ["late", "late"],
      ["absent", "absent"],
      ["half", "half_day"],
      ["leave", "on_leave"],
      ["holiday", "holiday"],
      ["weekend", "weekend"],
    ];

    for (const [deviceStatus, hrmsStatus] of cases) {
      const result = mapDeviceRegisterToAttendance(baseInput({ rows: [deviceRow({ status: deviceStatus })] }));
      expect(result.toWrite[0]?.status, deviceStatus).toBe(hrmsStatus);
    }
  });

  it("reports a status with no honest HRMS equivalent instead of guessing", () => {
    const result = mapDeviceRegisterToAttendance(baseInput({ rows: [deviceRow({ status: "unknown" })] }));

    expect(result.toWrite).toHaveLength(0);
    expect(result.unmappedStatus).toEqual([{ employeeId: "emp-1", employeeCode: "CV-001", deviceStatus: "unknown" }]);
  });
});

describe("determinism", () => {
  it("produces the same output for the same input every time", () => {
    // The database-level guarantee (a second import writes no duplicates)
    // rests on this function being a pure, deterministic map from a register
    // to the rows that should exist — re-running it on the same register
    // must not itself introduce any variation for the upsert to paper over.
    const input = baseInput({
      rows: [deviceRow({ code: "CV-001" }), deviceRow({ code: "CV-002", personId: 2 })],
      employees: [employee({ id: "emp-1", employeeCode: "CV-001" }), employee({ id: "emp-2", employeeCode: "CV-002" })],
    });

    const first = mapDeviceRegisterToAttendance(input);
    const second = mapDeviceRegisterToAttendance(input);

    expect(second).toEqual(first);
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2025-01-31", 1)).toBe("2025-02-01");
  });

  it("crosses a leap-year February", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("goes backwards across a month boundary", () => {
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
  });
});

describe("enumerateDays", () => {
  it("lists every day inclusive of both ends", () => {
    expect(enumerateDays("2025-01-30", "2025-02-02")).toEqual([
      "2025-01-30",
      "2025-01-31",
      "2025-02-01",
      "2025-02-02",
    ]);
  });

  it("is empty, not infinite, when from is after to", () => {
    expect(enumerateDays("2025-02-02", "2025-01-30")).toEqual([]);
  });
});

describe("isoDateInZone", () => {
  it("reads the wall-clock date in the given zone, not UTC's", () => {
    // 20:30 UTC is already past midnight in Kolkata (UTC+5:30) but still the
    // same afternoon in Los Angeles (UTC-7 in June) — this is exactly why the
    // sync asks the device for "today" in the site's own zone rather than the
    // server's.
    const at = new Date("2025-06-15T20:30:00Z");
    expect(isoDateInZone(at, "Asia/Kolkata")).toBe("2025-06-16");
    expect(isoDateInZone(at, "America/Los_Angeles")).toBe("2025-06-15");
  });
});

describe("resolveSiteId", () => {
  const ORIGINAL_MAP = process.env.ATTENDANCE_DEVICE_SITE_MAP;

  afterEach(() => {
    if (ORIGINAL_MAP === undefined) delete process.env.ATTENDANCE_DEVICE_SITE_MAP;
    else process.env.ATTENDANCE_DEVICE_SITE_MAP = ORIGINAL_MAP;
  });

  it("prefers an explicit siteId over the map", () => {
    process.env.ATTENDANCE_DEVICE_SITE_MAP = JSON.stringify({ "org-1": 99 });
    expect(resolveSiteId("org-1", 5)).toBe(5);
  });

  it("falls back to the map when no explicit siteId is given", () => {
    process.env.ATTENDANCE_DEVICE_SITE_MAP = JSON.stringify({ "org-1": 99 });
    expect(resolveSiteId("org-1")).toBe(99);
  });

  it("returns null for an organisation missing from the map rather than guessing", () => {
    // A wrong guess would import another building's attendance into this
    // company's records — refusing is the only safe default.
    process.env.ATTENDANCE_DEVICE_SITE_MAP = JSON.stringify({ "org-1": 99 });
    expect(resolveSiteId("org-2")).toBeNull();
  });

  it("fails soft on a malformed map rather than throwing", () => {
    process.env.ATTENDANCE_DEVICE_SITE_MAP = "{not valid json";
    expect(resolveSiteId("org-1")).toBeNull();
  });

  it("returns null when nothing is configured at all", () => {
    delete process.env.ATTENDANCE_DEVICE_SITE_MAP;
    expect(resolveSiteId("org-1")).toBeNull();
  });
});

function emptySummary(overrides: Partial<DeviceSyncSummary["totals"]> = {}): DeviceSyncSummary {
  return {
    siteId: 1,
    from: "2025-01-15",
    to: "2025-01-15",
    days: [],
    totals: { matched: 0, written: 0, skipped: 0, unmatchedCodes: [], ...overrides },
    errors: [],
  };
}

describe("syncDeviceAttendanceForAllOrgs", () => {
  const ORIGINAL_TOKEN = process.env.ATTENDANCE_DEVICE_TOKEN;
  const ORIGINAL_MAP = process.env.ATTENDANCE_DEVICE_SITE_MAP;

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.ATTENDANCE_DEVICE_TOKEN;
    else process.env.ATTENDANCE_DEVICE_TOKEN = ORIGINAL_TOKEN;
    if (ORIGINAL_MAP === undefined) delete process.env.ATTENDANCE_DEVICE_SITE_MAP;
    else process.env.ATTENDANCE_DEVICE_SITE_MAP = ORIGINAL_MAP;
  });

  it("does nothing, and does not even list organisations, when the integration is not configured", async () => {
    delete process.env.ATTENDANCE_DEVICE_TOKEN;
    const listOrgs = vi.fn(async () => [{ id: "org-1", timezone: "UTC" }]);

    const result = await syncDeviceAttendanceForAllOrgs({ listOrgs });

    expect(listOrgs).not.toHaveBeenCalled();
    expect(result.organisations).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("skips an organisation with no site configured, without counting it as a problem", async () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    delete process.env.ATTENDANCE_DEVICE_SITE_MAP;
    const syncOrg = vi.fn();

    const result = await syncDeviceAttendanceForAllOrgs({
      listOrgs: async () => [{ id: "org-1", timezone: "UTC" }],
      syncOrg,
    });

    expect(syncOrg).not.toHaveBeenCalled();
    expect(result.organisations).toBe(1);
    expect(result.configured).toBe(0);
    expect(result.problems).toEqual([]);
  });

  it("keeps syncing the rest after one organisation's sync throws, and names the one that did", async () => {
    // Mirrors `sweepOutboxes`'s own per-organisation isolation test: a bad
    // tenant must cost only itself, and whoever reads the cron's response
    // must be able to tell which one it was without a stack trace.
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    process.env.ATTENDANCE_DEVICE_SITE_MAP = JSON.stringify({ "org-a": 1, "org-bad": 2, "org-b": 3 });

    const syncOrg = vi.fn(async (ctx: { orgId: string }) => {
      if (ctx.orgId === "org-bad") throw new Error("device unreachable");
      return emptySummary({ matched: 1, written: 1 });
    });

    const result = await syncDeviceAttendanceForAllOrgs({
      listOrgs: async () => [
        { id: "org-a", timezone: "UTC" },
        { id: "org-bad", timezone: "UTC" },
        { id: "org-b", timezone: "UTC" },
      ],
      syncOrg,
    });

    expect(syncOrg).toHaveBeenCalledTimes(3);
    expect(result.totals.written).toBe(2);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("org-bad");
    expect(result.problems[0]).toContain("device unreachable");
  });

  it("aggregates matched/written/skipped totals across organisations", async () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    process.env.ATTENDANCE_DEVICE_SITE_MAP = JSON.stringify({ "org-a": 1, "org-b": 2 });

    const result = await syncDeviceAttendanceForAllOrgs({
      listOrgs: async () => [
        { id: "org-a", timezone: "UTC" },
        { id: "org-b", timezone: "UTC" },
      ],
      syncOrg: async () => emptySummary({ matched: 5, written: 4, skipped: 1 }),
    });

    expect(result.totals).toEqual({ matched: 10, written: 8, skipped: 2 });
  });

  it("reports rather than throws when the organisations cannot be listed", async () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";

    const result = await syncDeviceAttendanceForAllOrgs({
      listOrgs: async () => {
        throw new Error("database unreachable");
      },
    });

    expect(result.organisations).toBe(0);
    expect(result.problems[0]).toContain("database unreachable");
  });
});
