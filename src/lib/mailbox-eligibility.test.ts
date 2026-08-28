// The refusals are the interesting half. A rule that lets the wrong person
// claim a mailbox is a rule that hands somebody a company identity, so every
// branch that says no is asserted here, including the ones that are easy to
// leave out: a leaver, and an employee with no date of birth on file.

import { describe, expect, it } from "vitest";

import {
  checkMailboxEligibility,
  normaliseDate,
  selectEligible,
  type EmployeeRecord,
} from "@/lib/mailbox-eligibility";

function employee(over: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    id: "emp-1",
    orgId: "org-1",
    employeeCode: "CVT-0042",
    firstName: "Rahul",
    lastName: "Sharma",
    designation: "Backend Engineer",
    department: "Engineering",
    employmentType: "intern",
    joinDate: "2026-09-15",
    status: "active",
    deletedAt: null,
    ...over,
  };
}

describe("matching an employee ID to a date of birth", () => {
  it("accepts the pair that matches, and returns the profile an approver needs", () => {
    const result = checkMailboxEligibility(employee(), "2026-09-15");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.employee.employeeId).toBe("emp-1");
    expect(result.employee.displayName).toBe("Rahul Sharma");
    expect(result.employee.designation).toBe("Backend Engineer");
    expect(result.employee.department).toBe("Engineering");
    expect(result.employee.employmentType).toBe("intern");
  });

  it("refuses a date of birth that does not match", () => {
    const result = checkMailboxEligibility(employee(), "2026-09-16");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-match");
  });

  it("refuses an employee ID that matches nothing", () => {
    const result = checkMailboxEligibility(null, "2026-09-15");
    expect(result.ok).toBe(false);
  });

  it("refuses a deleted record", () => {
    const result = checkMailboxEligibility(
      employee({ deletedAt: new Date("2026-01-01") }),
      "2026-09-15"
    );
    expect(result.ok).toBe(false);
  });
});

describe("who may not claim a mailbox even with the right pair", () => {
  it("refuses somebody who has left", () => {
    // A leaver knows their own employee ID and date of birth forever. Without
    // this, leaving the company does not stop you creating a mailbox at it.
    for (const status of ["terminated", "inactive", "TERMINATED"]) {
      const result = checkMailboxEligibility(employee({ status }), "2026-09-15");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("not-current");
    }
  });

  it("still lets somebody on notice or on leave claim theirs", () => {
    // They are still employed, and somebody serving notice may well be the
    // person who has just been asked to set their account up.
    for (const status of ["active", "probation", "notice_period", "on_leave"]) {
      expect(checkMailboxEligibility(employee({ status }), "2026-09-15").ok).toBe(true);
    }
  });

  it("refuses when no date of birth is on file, rather than skipping the check", () => {
    // The dangerous reading of a blank is "nothing to compare, so allow it",
    // which would make every employee with an incomplete record claimable by
    // anyone holding their employee ID.
    for (const dob of [null, "", undefined]) {
      const result = checkMailboxEligibility(
        employee({ joinDate: dob as string | null }),
        "2026-09-15"
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("no-joining-date-on-file");
    }
  });

  it("refuses a second mailbox for somebody who already has one", () => {
    const result = checkMailboxEligibility(employee({ hasMailbox: true }), "2026-09-15");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("already-has-mailbox");
  });

  it("refuses a blank supplied date rather than matching a blank on file", () => {
    expect(checkMailboxEligibility(employee(), "").ok).toBe(false);
    expect(checkMailboxEligibility(employee(), "   ").ok).toBe(false);
  });
});

describe("when the same employee code exists in two organisations", () => {
  it("accepts the record that matches, not merely the first one found", () => {
    // `CV-001` is already used by two organisations on this deployment. A loop
    // that stops at the first organisation holding the code refuses a real
    // employee because a different company shares their number.
    const otherCompany = employee({
      id: "emp-other",
      orgId: "org-2",
      firstName: "Someone",
      lastName: "Else",
      joinDate: "2020-01-01",
    });
    const theirs = employee({ id: "emp-mine", orgId: "org-1", joinDate: "2026-09-15" });

    const result = selectEligible([otherCompany, theirs], "2026-09-15");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.employee.employeeId).toBe("emp-mine");
    expect(result.employee.orgId).toBe("org-1");
  });

  it("refuses when no organisation's record matches", () => {
    const a = employee({ id: "a", joinDate: "2020-01-01" });
    const b = employee({ id: "b", joinDate: "2021-01-01" });
    expect(selectEligible([a, b], "2026-09-15").ok).toBe(false);
  });

  it("reports a specific reason rather than a blanket no-match", () => {
    // An administrator reading the log should be able to tell "this person has
    // left" from "nobody has that code".
    const result = selectEligible([employee({ status: "terminated" })], "2026-09-15");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-current");
  });

  it("refuses an empty candidate list", () => {
    expect(selectEligible([], "2026-09-15").ok).toBe(false);
  });
});

describe("comparing dates without losing a day", () => {
  it("reads a Date by its calendar parts, not through UTC", () => {
    // `toISOString()` on a local midnight shifts the date for anybody west of
    // UTC, so somebody born on the 9th would fail to match their own birthday.
    const local = new Date(2026, 8, 15, 0, 0, 0);
    expect(normaliseDate(local)).toBe("2026-09-15");
  });

  it("matches a pg date column against what the form sent", () => {
    const fromPg = new Date(2026, 8, 15);
    expect(checkMailboxEligibility(employee({ joinDate: fromPg }), "2026-09-15").ok).toBe(true);
  });

  it("ignores a time component on the supplied value", () => {
    expect(normaliseDate("2026-09-15T18:30:00.000Z")).toBe("2026-09-15");
  });

  it("rejects anything that is not a date", () => {
    for (const value of ["", "not-a-date", "15/09/2026", "2026-13-01", "2026-09-32", null]) {
      expect(normaliseDate(value)).toBeNull();
    }
  });

  it("does not treat an invalid Date as a match", () => {
    expect(normaliseDate(new Date("nonsense"))).toBeNull();
  });
});
