// Mandatory training is a compliance obligation, so these tests pin the cases
// that decide whether a lapse is visible: expiry measured from completion,
// expired completions counting as missing, and progress that can actually
// reach 100%.

import { describe, expect, it } from "vitest";
import {
  addDays,
  applyScore,
  calculateProgress,
  canEnrol,
  complianceStatus,
  daysBetween,
  dueDateFor,
  gradeAssessment,
  isMandatoryFor,
  missingMandatory,
  nextModule,
  type CourseDefinition,
  type EmployeeProfile,
  type EnrolmentState,
  type ModuleDefinition,
} from "@/lib/learning-rules";

const course: CourseDefinition = {
  id: "fire-safety",
  passingScorePercent: 70,
  prerequisiteCourseIds: [],
  isMandatory: true,
};

const employee: EmployeeProfile = {
  id: "emp-1",
  departmentId: "dept-ops",
  designation: "Technician",
  locationId: "loc-chennai",
  employmentType: "full_time",
  joinDate: "2026-01-15",
};

function enrolment(over: Partial<EnrolmentState> = {}): EnrolmentState {
  return {
    courseId: "fire-safety",
    employeeId: "emp-1",
    state: "assigned",
    completedModuleIds: [],
    attempts: 0,
    ...over,
  };
}

describe("canEnrol", () => {
  it("allows a first enrolment", () => {
    expect(canEnrol(course, [], "2026-04-01")).toEqual({ allowed: true });
  });

  it("refuses when already in progress", () => {
    const verdict = canEnrol(course, [enrolment({ state: "in_progress" })], "2026-04-01");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/in progress/);
  });

  it("refuses when completed and still valid", () => {
    const verdict = canEnrol(
      course,
      [enrolment({ state: "completed", expiresOn: "2027-01-01" })],
      "2026-04-01"
    );
    expect(verdict.allowed).toBe(false);
  });

  it("allows re-enrolment once a completion has expired", () => {
    // Recertification is the whole point of an expiry date.
    const verdict = canEnrol(
      course,
      [enrolment({ state: "completed", expiresOn: "2026-03-01" })],
      "2026-04-01"
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it("allows re-enrolment after a failure", () => {
    expect(canEnrol(course, [enrolment({ state: "failed" })], "2026-04-01")).toEqual({
      allowed: true,
    });
  });

  it("refuses when a prerequisite is unmet, and names it", () => {
    const advanced: CourseDefinition = { ...course, id: "adv", prerequisiteCourseIds: ["basic"] };
    const verdict = canEnrol(advanced, [], "2026-04-01");

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.missingPrerequisiteIds).toEqual(["basic"]);
  });

  it("does not count a prerequisite that is only in progress", () => {
    // Half a course teaches nothing anyone can be relied on to know.
    const advanced: CourseDefinition = { ...course, id: "adv", prerequisiteCourseIds: ["basic"] };
    const verdict = canEnrol(
      advanced,
      [enrolment({ courseId: "basic", state: "in_progress" })],
      "2026-04-01"
    );
    expect(verdict.allowed).toBe(false);
  });

  it("does not count a prerequisite whose completion has expired", () => {
    const advanced: CourseDefinition = { ...course, id: "adv", prerequisiteCourseIds: ["basic"] };
    const verdict = canEnrol(
      advanced,
      [enrolment({ courseId: "basic", state: "completed", expiresOn: "2026-01-01" })],
      "2026-04-01"
    );
    expect(verdict.allowed).toBe(false);
  });

  it("accepts a completed prerequisite that never expires", () => {
    const advanced: CourseDefinition = { ...course, id: "adv", prerequisiteCourseIds: ["basic"] };
    expect(
      canEnrol(advanced, [enrolment({ courseId: "basic", state: "completed" })], "2026-04-01")
    ).toEqual({ allowed: true });
  });
});

describe("isMandatoryFor", () => {
  it("is false for a course that is not mandatory", () => {
    expect(isMandatoryFor({ ...course, isMandatory: false }, employee)).toBe(false);
  });

  it("applies to everyone when no rules are set", () => {
    // The alternative — no rules matching nobody — makes "mandatory for all
    // staff" the one case you cannot express.
    expect(isMandatoryFor(course, employee)).toBe(true);
  });

  it("matches on department", () => {
    expect(
      isMandatoryFor({ ...course, mandatoryForRules: { departmentIds: ["dept-ops"] } }, employee)
    ).toBe(true);
    expect(
      isMandatoryFor({ ...course, mandatoryForRules: { departmentIds: ["dept-hr"] } }, employee)
    ).toBe(false);
  });

  it("requires every stated rule to match, not any", () => {
    const rules = { departmentIds: ["dept-ops"], designations: ["Manager"] };
    expect(isMandatoryFor({ ...course, mandatoryForRules: rules }, employee)).toBe(false);
  });

  it("matches on employment type", () => {
    expect(
      isMandatoryFor(
        { ...course, mandatoryForRules: { employmentTypes: ["contract"] } },
        employee
      )
    ).toBe(false);
  });

  it("excludes people who joined before the rule took effect", () => {
    expect(
      isMandatoryFor(
        { ...course, mandatoryForRules: { joinedOnOrAfter: "2026-02-01" } },
        employee
      )
    ).toBe(false);
    expect(
      isMandatoryFor(
        { ...course, mandatoryForRules: { joinedOnOrAfter: "2026-01-01" } },
        employee
      )
    ).toBe(true);
  });

  it("does not match an employee missing the attribute a rule names", () => {
    const anonymous: EmployeeProfile = { id: "emp-2", joinDate: "2026-01-01" };
    expect(
      isMandatoryFor({ ...course, mandatoryForRules: { departmentIds: ["dept-ops"] } }, anonymous)
    ).toBe(false);
  });
});

describe("dueDateFor", () => {
  it("returns nothing when no window is configured", () => {
    expect(dueDateFor(course, employee, "2026-04-01")).toBeUndefined();
  });

  it("measures from the join date, not the assignment date", () => {
    // A course assigned late does not extend a new starter's deadline.
    const withWindow = { ...course, mandatoryForRules: { completeWithinDays: 90 } };
    expect(dueDateFor(withWindow, employee, "2026-02-01")).toBe("2026-04-15");
  });

  it("never falls before the assignment date", () => {
    // Otherwise the course arrives already overdue, which tells the learner
    // nothing useful and pollutes the compliance report.
    const withWindow = { ...course, mandatoryForRules: { completeWithinDays: 30 } };
    expect(dueDateFor(withWindow, employee, "2026-06-01")).toBe("2026-06-01");
  });
});

describe("calculateProgress", () => {
  const modules: ModuleDefinition[] = [
    { id: "m1", sequence: 1, isOptional: false },
    { id: "m2", sequence: 2, isOptional: false },
    { id: "m3", sequence: 3, isOptional: false },
    { id: "m4", sequence: 4, isOptional: true },
  ];

  it("counts only mandatory modules", () => {
    // An optional module nobody takes would otherwise cap every learner below
    // 100% and leave a course that can never be finished.
    expect(calculateProgress(modules, ["m1", "m2", "m3"])).toBe(100);
  });

  it("reports partial progress", () => {
    expect(calculateProgress(modules, ["m1"])).toBe(33);
  });

  it("is zero with nothing done", () => {
    expect(calculateProgress(modules, [])).toBe(0);
  });

  it("weights by duration when every module has one", () => {
    // A two-minute intro and a ninety-minute assessment are not equal halves.
    const timed: ModuleDefinition[] = [
      { id: "a", sequence: 1, isOptional: false, durationMinutes: 10 },
      { id: "b", sequence: 2, isOptional: false, durationMinutes: 90 },
    ];
    expect(calculateProgress(timed, ["a"])).toBe(10);
    expect(calculateProgress(timed, ["b"])).toBe(90);
  });

  it("falls back to counting when a duration is missing", () => {
    const partial: ModuleDefinition[] = [
      { id: "a", sequence: 1, isOptional: false, durationMinutes: 10 },
      { id: "b", sequence: 2, isOptional: false },
    ];
    expect(calculateProgress(partial, ["a"])).toBe(50);
  });

  it("treats a course of only optional modules as complete", () => {
    expect(calculateProgress([{ id: "x", sequence: 1, isOptional: true }], [])).toBe(100);
  });

  it("ignores completed ids that are no longer modules", () => {
    // A removed module must not inflate progress past 100%.
    expect(calculateProgress(modules, ["m1", "m2", "m3", "deleted"])).toBe(100);
  });
});

describe("nextModule", () => {
  const modules: ModuleDefinition[] = [
    { id: "m2", sequence: 2, isOptional: false },
    { id: "m1", sequence: 1, isOptional: false },
    { id: "m3", sequence: 3, isOptional: false },
  ];

  it("returns the earliest unfinished module regardless of input order", () => {
    expect(nextModule(modules, [])?.id).toBe("m1");
    expect(nextModule(modules, ["m1"])?.id).toBe("m2");
  });

  it("returns null when everything is done", () => {
    expect(nextModule(modules, ["m1", "m2", "m3"])).toBeNull();
  });
});

describe("gradeAssessment", () => {
  it("scores a single-answer quiz", () => {
    const questions = [
      { id: "q1", correctAnswer: "a" },
      { id: "q2", correctAnswer: "b" },
    ];
    expect(gradeAssessment(questions, [{ questionId: "q1", answer: "a" }])).toBe(50);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(
      gradeAssessment([{ id: "q1", correctAnswer: "Fire Exit" }], [
        { questionId: "q1", answer: "  fire exit " },
      ])
    ).toBe(100);
  });

  it("accepts multi-select answers in any order", () => {
    // Marking someone wrong for clicking the boxes in a different order is a
    // bug, not a standard.
    expect(
      gradeAssessment([{ id: "q1", correctAnswer: ["a", "b"] }], [
        { questionId: "q1", answer: ["b", "a"] },
      ])
    ).toBe(100);
  });

  it("rejects a partial multi-select answer", () => {
    expect(
      gradeAssessment([{ id: "q1", correctAnswer: ["a", "b"] }], [
        { questionId: "q1", answer: ["a"] },
      ])
    ).toBe(0);
  });

  it("does not accept a single answer for a multi-select question", () => {
    expect(
      gradeAssessment([{ id: "q1", correctAnswer: ["a"] }], [{ questionId: "q1", answer: "a" }])
    ).toBe(0);
  });

  it("respects question weights", () => {
    const questions = [
      { id: "q1", correctAnswer: "a", points: 3 },
      { id: "q2", correctAnswer: "b", points: 1 },
    ];
    expect(gradeAssessment(questions, [{ questionId: "q1", answer: "a" }])).toBe(75);
  });

  it("treats an unanswered question as wrong rather than skipping it", () => {
    expect(gradeAssessment([{ id: "q1", correctAnswer: "a" }], [])).toBe(0);
  });

  it("returns full marks for an assessment with no questions", () => {
    expect(gradeAssessment([], [])).toBe(100);
  });
});

describe("applyScore", () => {
  it("completes an enrolment on a passing score", () => {
    const result = applyScore(course, enrolment(), 80, "2026-04-01");
    expect(result.passed).toBe(true);
    expect(result.state).toBe("completed");
    expect(result.completedAt).toBe("2026-04-01");
  });

  it("sets expiry from the completion date, not the enrolment date", () => {
    // Someone who took six months to finish has not used up half their
    // certification period.
    const annual = { ...course, recertifyAfterDays: 365 };
    const result = applyScore(annual, enrolment(), 90, "2026-04-01");
    expect(result.expiresOn).toBe("2027-04-01");
  });

  it("leaves expiry unset when the course never lapses", () => {
    expect(applyScore(course, enrolment(), 90, "2026-04-01").expiresOn).toBeUndefined();
  });

  it("keeps an enrolment open on a failing score with attempts left", () => {
    const result = applyScore({ ...course, maxAttempts: 3 }, enrolment(), 50, "2026-04-01");
    expect(result.state).toBe("in_progress");
    expect(result.attemptsRemaining).toBe(2);
  });

  it("fails the enrolment once attempts run out", () => {
    const result = applyScore(
      { ...course, maxAttempts: 2 },
      enrolment({ attempts: 1 }),
      50,
      "2026-04-01"
    );
    expect(result.state).toBe("failed");
    expect(result.attemptsRemaining).toBe(0);
    expect(result.message).toMatch(/no attempts remaining/);
  });

  it("counts the attempt even when the learner passes", () => {
    // Otherwise someone can pass, see the answers and retake for a better mark
    // at no cost.
    expect(applyScore(course, enrolment({ attempts: 1 }), 90, "2026-04-01").attemptsUsed).toBe(2);
  });

  it("refuses a further attempt once the limit is reached", () => {
    expect(() =>
      applyScore({ ...course, maxAttempts: 2 }, enrolment({ attempts: 2 }), 90, "2026-04-01")
    ).toThrow(/No attempts remaining/);
  });

  it("allows unlimited attempts when no cap is set", () => {
    const result = applyScore(course, enrolment({ attempts: 99 }), 50, "2026-04-01");
    expect(result.state).toBe("in_progress");
    expect(result.attemptsRemaining).toBeNull();
  });

  it("treats the pass mark as inclusive", () => {
    expect(applyScore(course, enrolment(), 70, "2026-04-01").passed).toBe(true);
  });

  it("refuses to re-grade a completed enrolment", () => {
    expect(() =>
      applyScore(course, enrolment({ state: "completed" }), 90, "2026-04-01")
    ).toThrow(/already completed/);
  });

  it("refuses a waived enrolment", () => {
    expect(() => applyScore(course, enrolment({ state: "waived" }), 90, "2026-04-01")).toThrow(
      /waived/
    );
  });

  it("rejects an impossible score rather than storing it", () => {
    expect(() => applyScore(course, enrolment(), 120, "2026-04-01")).toThrow(/between 0 and 100/);
    expect(() => applyScore(course, enrolment(), -1, "2026-04-01")).toThrow(/between 0 and 100/);
    expect(() => applyScore(course, enrolment(), NaN, "2026-04-01")).toThrow(/between 0 and 100/);
  });
});

describe("complianceStatus", () => {
  it("reports a completed course with no expiry as compliant", () => {
    const status = complianceStatus(enrolment({ state: "completed" }), "2026-04-01");
    expect(status.state).toBe("compliant");
  });

  it("warns before a certification lapses", () => {
    // Discovering an expired safety certificate on the day it expires leaves
    // no time to do anything about it.
    const status = complianceStatus(
      enrolment({ state: "completed", expiresOn: "2026-04-20" }),
      "2026-04-01"
    );
    expect(status.state).toBe("expiring_soon");
    expect(status.daysRemaining).toBe(19);
  });

  it("reports an expired certification with how long it has been expired", () => {
    const status = complianceStatus(
      enrolment({ state: "completed", expiresOn: "2026-03-25" }),
      "2026-04-01"
    );
    expect(status.state).toBe("expired");
    expect(status.detail).toBe("Expired 7 days ago");
  });

  it("stays compliant well before expiry", () => {
    const status = complianceStatus(
      enrolment({ state: "completed", expiresOn: "2027-01-01" }),
      "2026-04-01"
    );
    expect(status.state).toBe("compliant");
  });

  it("honours a custom warning window", () => {
    const status = complianceStatus(
      enrolment({ state: "completed", expiresOn: "2026-06-01" }),
      "2026-04-01",
      90
    );
    expect(status.state).toBe("expiring_soon");
  });

  it("reports an unfinished course past its due date as overdue", () => {
    const status = complianceStatus(
      enrolment({ state: "in_progress", dueOn: "2026-03-01" }),
      "2026-04-01"
    );
    expect(status.state).toBe("overdue");
    expect(status.detail).toBe("Overdue by 31 days");
  });

  it("distinguishes not started from in progress", () => {
    expect(complianceStatus(enrolment(), "2026-04-01").state).toBe("not_started");
    expect(complianceStatus(enrolment({ state: "in_progress" }), "2026-04-01").state).toBe(
      "in_progress"
    );
  });

  it("reports a waiver without a countdown", () => {
    const status = complianceStatus(enrolment({ state: "waived" }), "2026-04-01");
    expect(status.state).toBe("waived");
    expect(status.daysRemaining).toBeNull();
  });

  it("reports a failure distinctly from an overdue course", () => {
    expect(complianceStatus(enrolment({ state: "failed" }), "2026-04-01").state).toBe("failed");
  });

  it("uses singular wording for one day", () => {
    const status = complianceStatus(
      enrolment({ state: "completed", expiresOn: "2026-04-02" }),
      "2026-04-01"
    );
    expect(status.detail).toBe("Expires in 1 day");
  });
});

describe("missingMandatory", () => {
  const courses: CourseDefinition[] = [
    course,
    { id: "optional-course", passingScorePercent: 70, prerequisiteCourseIds: [], isMandatory: false },
  ];

  it("lists a mandatory course with no enrolment", () => {
    expect(missingMandatory(courses, employee, [], "2026-04-01").map((c) => c.id)).toEqual([
      "fire-safety",
    ]);
  });

  it("ignores non-mandatory courses", () => {
    const result = missingMandatory(courses, employee, [], "2026-04-01");
    expect(result.map((c) => c.id)).not.toContain("optional-course");
  });

  it("does not list a course that is merely in progress", () => {
    // It is assigned and being worked on; listing it as missing would make the
    // report unusable.
    expect(
      missingMandatory(courses, employee, [enrolment({ state: "in_progress" })], "2026-04-01")
    ).toEqual([]);
  });

  it("does not list a valid completion", () => {
    expect(
      missingMandatory(
        courses,
        employee,
        [enrolment({ state: "completed", expiresOn: "2027-01-01" })],
        "2026-04-01"
      )
    ).toEqual([]);
  });

  it("lists an expired completion as missing", () => {
    // A lapsed certificate provides no assurance; treating it as done is how a
    // lapse goes unnoticed for a year.
    expect(
      missingMandatory(
        courses,
        employee,
        [enrolment({ state: "completed", expiresOn: "2026-03-01" })],
        "2026-04-01"
      ).map((c) => c.id)
    ).toEqual(["fire-safety"]);
  });

  it("does not list a waived course", () => {
    expect(
      missingMandatory(courses, employee, [enrolment({ state: "waived" })], "2026-04-01")
    ).toEqual([]);
  });

  it("only considers the given employee's enrolments", () => {
    expect(
      missingMandatory(
        courses,
        employee,
        [enrolment({ employeeId: "someone-else", state: "completed" })],
        "2026-04-01"
      ).map((c) => c.id)
    ).toEqual(["fire-safety"]);
  });
});

describe("date helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("adds days across a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("subtracts", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("measures a negative span for a past date", () => {
    expect(daysBetween("2026-04-01", "2026-03-25")).toBe(-7);
  });

  it("rejects a malformed date rather than returning NaN", () => {
    expect(() => addDays("01/04/2026", 1)).toThrow(/YYYY-MM-DD/);
    expect(() => daysBetween("2026-04-01", "nonsense")).toThrow(/YYYY-MM-DD/);
  });
});
