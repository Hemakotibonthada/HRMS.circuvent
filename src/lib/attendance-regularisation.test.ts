// Correcting attendance after the fact, without letting it rewrite history.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  canDecide,
  evaluate,
  workedMinutes,
  type RegularisationContext,
  type RegularisationRequest,
} from "@/lib/attendance-regularisation";

function req(overrides: Partial<RegularisationRequest> = {}): RegularisationRequest {
  return {
    employeeId: "e1",
    date: "2026-08-10",
    reason: "missed_punch",
    note: "Reader on the side door was down; security let me in.",
    inTime: "09:30",
    outTime: "18:30",
    ...overrides,
  };
}

function ctx(overrides: Partial<RegularisationContext> = {}): RegularisationContext {
  return {
    today: "2026-08-19",
    policy: DEFAULT_POLICY,
    approvedThisMonth: 0,
    hasOpenRequestForDate: false,
    payrollLockedForMonth: false,
    ...overrides,
  };
}

const problems = (o: ReturnType<typeof evaluate>) => (o.accepted ? [] : o.problems);

describe("when a correction is allowed", () => {
  it("accepts an ordinary missed punch inside the window", () => {
    const outcome = evaluate(req(), ctx());
    expect(outcome.accepted).toBe(true);
    if (outcome.accepted) expect(outcome.routing).toBe("normal");
  });

  it("refuses a day that has not happened", () => {
    const outcome = evaluate(req({ date: "2026-09-01" }), ctx());
    expect(problems(outcome).some((p) => /has not happened yet/.test(p.message))).toBe(true);
  });

  it("refuses a day older than the window, and says how old", () => {
    const outcome = evaluate(req({ date: "2026-06-01" }), ctx());
    const problem = problems(outcome).find((p) => /Regularisation closes/.test(p.message));
    expect(problem?.message).toContain("30 days");
    expect(problem?.message).toContain("79 days old");
  });

  it("accepts a day exactly on the window boundary", () => {
    const outcome = evaluate(req({ date: "2026-07-20" }), ctx());
    expect(outcome.accepted).toBe(true);
  });

  it("refuses a second live request for the same day", () => {
    const outcome = evaluate(req(), ctx({ hasOpenRequestForDate: true }));
    expect(problems(outcome).some((p) => /already a request open/.test(p.message))).toBe(true);
  });

  it("refuses once the monthly allowance is used up", () => {
    const outcome = evaluate(req(), ctx({ approvedThisMonth: 3 }));
    expect(problems(outcome).some((p) => /already been approved this month/.test(p.message))).toBe(true);
  });

  it("suggests the real fix when someone keeps missing punches", () => {
    const outcome = evaluate(req(), ctx({ approvedThisMonth: 5 }));
    expect(problems(outcome).some((p) => /rota\s+problem/.test(p.message))).toBe(true);
  });
});

describe("what the request must contain", () => {
  it("requires an explanation", () => {
    const outcome = evaluate(req({ note: "   " }), ctx());
    expect(problems(outcome).some((p) => p.field === "note")).toBe(true);
  });

  it("requires evidence for an on-duty claim", () => {
    const outcome = evaluate(req({ reason: "on_duty", inTime: undefined, outTime: undefined }), ctx());
    expect(problems(outcome).some((p) => p.field === "proof")).toBe(true);
  });

  it("accepts an on-duty claim with evidence and no times", () => {
    const outcome = evaluate(
      req({ reason: "on_duty", hasProof: true, inTime: undefined, outTime: undefined }),
      ctx()
    );
    expect(outcome.accepted).toBe(true);
  });

  it("rejects a time that is not a time", () => {
    const outcome = evaluate(req({ inTime: "25:00" }), ctx());
    expect(problems(outcome).some((p) => p.field === "inTime")).toBe(true);
  });

  it("rejects an out time that precedes the in time", () => {
    const outcome = evaluate(req({ inTime: "18:00", outTime: "09:00" }), ctx());
    expect(problems(outcome).some((p) => /not after the in time/.test(p.message))).toBe(true);
  });

  it("points an overnight shift at a shift change rather than accepting it", () => {
    const outcome = evaluate(req({ inTime: "22:00", outTime: "06:00" }), ctx());
    expect(problems(outcome).some((p) => /crosses midnight/.test(p.message))).toBe(true);
  });

  it("requires at least one time for an ordinary correction", () => {
    const outcome = evaluate(req({ inTime: undefined, outTime: undefined }), ctx());
    expect(problems(outcome).some((p) => /at least one corrected time/.test(p.message))).toBe(true);
  });

  it("reports everything wrong at once", () => {
    const outcome = evaluate(req({ note: "", inTime: "99:99", date: "2026-09-09" }), ctx());
    expect(problems(outcome).length).toBeGreaterThanOrEqual(3);
  });
});

describe("a month payroll has already paid", () => {
  it("still accepts the correction, because the employee was there", () => {
    const outcome = evaluate(req(), ctx({ payrollLockedForMonth: true }));
    expect(outcome.accepted).toBe(true);
  });

  it("routes it as an adjustment rather than a rewrite", () => {
    const outcome = evaluate(req(), ctx({ payrollLockedForMonth: true }));
    if (outcome.accepted) expect(outcome.routing).toBe("adjustment");
  });

  it("explains that the issued payslip still agrees with its own record", () => {
    const outcome = evaluate(req(), ctx({ payrollLockedForMonth: true }));
    if (outcome.accepted) {
      expect(outcome.notes.join(" ")).toMatch(/original record is kept/);
      expect(outcome.notes.join(" ")).toMatch(/next run as an adjustment/);
    }
  });

  it("routes normally when payroll has not run", () => {
    const outcome = evaluate(req(), ctx({ payrollLockedForMonth: false }));
    if (outcome.accepted) expect(outcome.routing).toBe("normal");
  });
});

describe("a holiday or weekly off", () => {
  it("is accepted but flagged toward compensatory off", () => {
    const outcome = evaluate(req(), ctx({ isNonWorkingDay: true }));
    expect(outcome.accepted).toBe(true);
    if (outcome.accepted) {
      expect(outcome.notes.join(" ")).toMatch(/compensatory off/);
    }
  });
});

describe("who may decide", () => {
  it("lets a manager approve", () => {
    expect(canDecide({ approverId: "m1", requesterId: "e1", status: "approved" }).allowed).toBe(true);
  });

  it("stops somebody approving their own", () => {
    const result = canDecide({ approverId: "e1", requesterId: "e1", status: "approved" });
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/cannot be approved by the person who raised it/);
  });

  it("requires a reason for a rejection", () => {
    const result = canDecide({ approverId: "m1", requesterId: "e1", status: "rejected" });
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/owed a reason/);
  });

  it("accepts a rejection that carries one", () => {
    const result = canDecide({
      approverId: "m1",
      requesterId: "e1",
      status: "rejected",
      reason: "You were on approved leave that day.",
    });
    expect(result.allowed).toBe(true);
  });

  it("refuses anything that is not a decision", () => {
    expect(canDecide({ approverId: "m1", requesterId: "e1", status: "pending" }).allowed).toBe(false);
  });
});

describe("what the corrected day is worth", () => {
  it("counts the minutes between the two times", () => {
    expect(workedMinutes("09:30", "18:30")).toBe(540);
  });

  it("is nothing when the times are reversed", () => {
    expect(workedMinutes("18:30", "09:30")).toBe(0);
  });

  it("is nothing for a time that is not a time", () => {
    expect(workedMinutes("bad", "18:30")).toBe(0);
  });
});
