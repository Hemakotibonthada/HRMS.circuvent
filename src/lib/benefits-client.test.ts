// Pins the routing bug that made the benefits page write into the wrong
// table entirely.
//
// Unlike payroll's 404 (a collection with no entity route and no allowlist
// entry, so every read and write failed loudly), the benefits page wrote
// through `genericService(COLLECTIONS.policies).create(...)` -- and
// `policies` genuinely is an allowed document-store collection, for company
// policy documents. So the write succeeded, the toast said "created", and
// nothing about the request was ever wrong enough to notice. The tests below
// pin that: `policies` staying real and allowed is correct on its own terms
// and is exactly why this bug needed a human to read the code, not a 404 in
// the console, to be found.

import { describe, expect, it } from "vitest";
import { ALLOWED_COLLECTIONS } from "@/app/api/collections/[collection]/route";
import { COLLECTIONS } from "@/lib/collection-service";
import {
  daysUntil,
  dependantsForEnrolment,
  enrichEnrolments,
  humanize,
  listMyDependants,
  plansWithOpenWindows,
  resolveViewedEmployeeId,
} from "@/lib/benefits-client";
import type { Dependant, EnrolmentRecord, PlanRecord } from "@/lib/benefits-client";

describe("the benefits routing gap", () => {
  it("policies is a real, allowed document-store collection", () => {
    // This is what made the bug silent instead of loud: the write did not
    // fail, it just landed somewhere that was never benefits.
    expect(COLLECTIONS.policies).toBe("policies");
    expect(ALLOWED_COLLECTIONS.has(COLLECTIONS.policies)).toBe(true);
  });

  it("has no collection of its own for a benefits page to reach for instead", () => {
    // There was never a plausible `COLLECTIONS.benefits` to reach for --
    // `policies` was a nearby, unrelated, wrong choice, not the only option.
    expect("benefits" in COLLECTIONS).toBe(false);
    expect("benefitPlans" in COLLECTIONS).toBe(false);
  });

  it("so benefits reads and writes must go through @/lib/benefits-client", () => {
    // benefitPlans, enrolmentWindows, benefitEnrolments, dependants and
    // benefitClaims all have their own tables and their own /api/benefits/*
    // routes. Routing them through genericService -- into *any* document
    // collection, allowed or not -- would give the same records two homes.
    for (const owned of ["benefitPlans", "benefitEnrolments", "dependants", "benefitClaims"]) {
      expect(owned in COLLECTIONS).toBe(false);
    }
  });
});

describe("resolveViewedEmployeeId", () => {
  const SELF = "11111111-1111-1111-1111-111111111111";
  const OTHER = "22222222-2222-2222-2222-222222222222";

  it("lets a privileged role look up someone else's benefits", () => {
    expect(resolveViewedEmployeeId("hr", SELF, OTHER)).toEqual({ employeeId: OTHER, isSelf: false });
    expect(resolveViewedEmployeeId("admin", SELF, OTHER)).toEqual({ employeeId: OTHER, isSelf: false });
    expect(resolveViewedEmployeeId("owner", SELF, OTHER)).toEqual({ employeeId: OTHER, isSelf: false });
  });

  it("never lets an ordinary employee view someone else's benefits", () => {
    // The isolation guarantee this feature actually needs: a non-privileged
    // caller's requested id is discarded here exactly as the server discards
    // it, so a page built on this function cannot be talked into requesting
    // a colleague's data even if its input field would accept any id typed
    // into it.
    expect(resolveViewedEmployeeId("employee", SELF, OTHER)).toEqual({ employeeId: SELF, isSelf: true });
  });

  it("falls back to self when nobody requested anyone else", () => {
    expect(resolveViewedEmployeeId("hr", SELF)).toEqual({ employeeId: SELF, isSelf: true });
    expect(resolveViewedEmployeeId("employee", SELF)).toEqual({ employeeId: SELF, isSelf: true });
  });

  it("treats a privileged lookup of one's own id as self, not 'someone else'", () => {
    // An admin who looks themselves up is still viewing their own benefits --
    // the page should not show a "you are viewing someone else's data" note
    // for that.
    expect(resolveViewedEmployeeId("admin", SELF, SELF)).toEqual({ employeeId: SELF, isSelf: true });
  });
});

describe("listMyDependants", () => {
  it("takes no employeeId parameter -- structurally, not just by convention", () => {
    // `/api/benefits/dependants` never reads an employeeId for anyone, so
    // this function has no parameter through which one could be smuggled in.
    // If a later change gives it an `employeeId` parameter without a default
    // value, this function's declared arity changes and this test fails --
    // it is not a substitute for the server-side check, but the client
    // should not even offer a way to ask for someone else's dependants.
    expect(listMyDependants.length).toBe(0);
  });
});

describe("humanize", () => {
  it("title-cases every benefit type", () => {
    const types: Record<string, string> = {
      health_insurance: "Health Insurance",
      life_insurance: "Life Insurance",
      accident_insurance: "Accident Insurance",
      retirement: "Retirement",
      wellness: "Wellness",
      meal: "Meal",
      transport: "Transport",
      education: "Education",
      childcare: "Childcare",
      other: "Other",
    };
    for (const [value, label] of Object.entries(types)) {
      expect(humanize(value)).toBe(label);
    }
  });

  it("title-cases every dependant relation", () => {
    const relations: Record<string, string> = {
      spouse: "Spouse",
      child: "Child",
      parent: "Parent",
      parent_in_law: "Parent-in-law",
      sibling: "Sibling",
      other: "Other",
    };
    for (const [value, label] of Object.entries(relations)) {
      expect(humanize(value)).toBe(label);
    }
  });

  it("special-cases parent_in_law rather than rendering 'Parent In Law'", () => {
    expect(humanize("parent_in_law")).toBe("Parent-in-law");
  });

  it("formats an unrecognised snake_case value the same generic way", () => {
    // Claim status is a plain text column with no enforced enum (only ever
    // observed as "submitted" -- there is no admin workflow that changes it
    // yet), so this must not assume a closed set the way benefit type and
    // relation can.
    expect(humanize("pending_review")).toBe("Pending Review");
    expect(humanize("submitted")).toBe("Submitted");
  });
});

describe("daysUntil", () => {
  it("counts whole days to a future date", () => {
    expect(daysUntil("2026-05-15", "2026-05-01")).toBe(14);
  });

  it("is negative once the date has passed", () => {
    expect(daysUntil("2026-04-30", "2026-05-01")).toBe(-1);
  });

  it("is zero on the deadline itself", () => {
    expect(daysUntil("2026-05-01", "2026-05-01")).toBe(0);
  });

  it("is not shifted by timezone the way new Date() subtraction would be", () => {
    // The regression this guards against: `new Date("2026-04-30")` is
    // midnight UTC, so subtracting two such dates drifts by a day in any
    // timezone behind UTC. Crossing a month boundary is where that would
    // silently show the wrong number of days left to enrol.
    expect(daysUntil("2026-03-01", "2026-02-01")).toBe(28); // 2026: Feb has 28 days
  });
});

describe("plansWithOpenWindows", () => {
  const plan = (overrides: Partial<PlanRecord> = {}): PlanRecord => ({
    id: "plan-1",
    name: "Health Cover",
    benefitType: "health_insurance",
    employerContribution: 80,
    employeeContribution: 20,
    currency: "INR",
    allowsDependants: true,
    eligibleRelations: ["spouse", "child"],
    isAutoEnrolled: false,
    ...overrides,
  });

  it("returns nothing when no plan has an open window", () => {
    expect(plansWithOpenWindows([plan(), plan({ id: "plan-2" })])).toEqual([]);
  });

  it("surfaces only the plans with an open window, keyed by plan", () => {
    // A window is per-plan (enrolment_windows.plan_ids), not global -- dental
    // can be open while health is closed, and this must not collapse that
    // into a single page-wide flag.
    const withWindow = plan({
      id: "plan-2",
      name: "Dental Cover",
      enrolmentWindow: { opensOn: "2026-05-01", closesOn: "2026-05-20" },
    });
    const result = plansWithOpenWindows([plan(), withWindow], "2026-05-10");
    expect(result).toEqual([
      {
        planId: "plan-2",
        planName: "Dental Cover",
        opensOn: "2026-05-01",
        closesOn: "2026-05-20",
        daysRemaining: 10,
      },
    ]);
  });
});

describe("enrichEnrolments", () => {
  const plan: PlanRecord = {
    id: "plan-1",
    name: "Health Cover",
    benefitType: "health_insurance",
    employerContribution: 80,
    employeeContribution: 20,
    coverageAmount: 500000,
    currency: "INR",
    allowsDependants: true,
    eligibleRelations: ["spouse", "child"],
    isAutoEnrolled: false,
  };

  const enrolment = (overrides: Partial<EnrolmentRecord> = {}): EnrolmentRecord => ({
    id: "enr-1",
    planId: "plan-1",
    employeeId: "emp-1",
    status: "active",
    planYear: 2026,
    employeeCost: 500,
    employerCost: 2000,
    dependantIds: [],
    electedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

  it("attaches the matching plan's coverage details", () => {
    const [result] = enrichEnrolments([enrolment()], [plan]);
    expect(result.plan).toEqual(plan);
  });

  it("leaves the plan undefined -- not dropped, not thrown -- when it's no longer active", () => {
    // availablePlans() only returns isActive plans, so an enrolment in a plan
    // HR later deactivated is real but has nothing to join against here.
    const orphan = enrolment({ planId: "plan-deactivated" });
    const [result] = enrichEnrolments([orphan], [plan]);
    expect(result.plan).toBeUndefined();
    expect(result.id).toBe("enr-1"); // the enrolment itself still comes through
  });
});

describe("dependantsForEnrolment", () => {
  const dependant = (overrides: Partial<Dependant> = {}): Dependant => ({
    id: "dep-1",
    fullName: "Asha Rao",
    relation: "spouse",
    isNominee: false,
    ...overrides,
  });

  const enrolment: EnrolmentRecord = {
    id: "enr-1",
    planId: "plan-1",
    employeeId: "emp-1",
    status: "active",
    planYear: 2026,
    employeeCost: 500,
    employerCost: 2000,
    dependantIds: ["dep-1", "dep-2"],
    electedAt: "2026-01-01T00:00:00.000Z",
  };

  it("resolves dependant ids to the matching records, in order", () => {
    const all = [dependant({ id: "dep-2", fullName: "Kiran Rao", relation: "child" }), dependant()];
    expect(dependantsForEnrolment(enrolment, all)).toEqual([
      dependant(),
      dependant({ id: "dep-2", fullName: "Kiran Rao", relation: "child" }),
    ]);
  });

  it("drops an id with no matching dependant instead of throwing", () => {
    // `enrolment_dependants` rows outlive edits to the dependant they point
    // at only in theory, but a stale id here should not crash the page that
    // is trying to show someone their coverage.
    expect(dependantsForEnrolment(enrolment, [dependant()])).toEqual([dependant()]);
  });

  it("returns nothing for an enrolment that covers no dependants", () => {
    expect(dependantsForEnrolment({ ...enrolment, dependantIds: [] }, [dependant()])).toEqual([]);
  });
});
