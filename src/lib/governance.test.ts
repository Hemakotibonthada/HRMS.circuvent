// @vitest-environment node
//
// Erasure is irreversible and retention is a legal obligation, so these tests
// pin the cases where the two conflict: a legal hold beating a schedule, a
// statute beating an erasure request, and a subject-access response that says
// what it is not disclosing.

import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildSubjectAccess,
  daysBetween,
  decide,
  dueDate,
  hasConsent,
  isThirdPartySensitive,
  mask,
  maskEmail,
  planErasure,
  planRetention,
  pseudonym,
  type RetainedRecord,
  type RetentionPolicy,
} from "@/lib/governance";

const payrollPolicy: RetentionPolicy = {
  id: "p1",
  entityType: "payroll_record",
  retainForMonths: 84,
  anchor: "period_end",
  method: "retain",
  basis: "Income Tax Act s.44AA (7 years)",
  overridesErasure: true,
  isActive: true,
};

const applicantPolicy: RetentionPolicy = {
  id: "p2",
  entityType: "candidate",
  retainForMonths: 6,
  anchor: "created_at",
  method: "delete",
  basis: "Recruitment data minimisation policy",
  overridesErasure: false,
  isActive: true,
};

describe("addMonths", () => {
  it("adds whole months", () => {
    expect(addMonths("2026-01-15", 3)).toBe("2026-04-15");
  });

  it("clamps to the last day of a shorter month", () => {
    // 31 January plus one month is 28 February, not 3 March. Rolling over
    // would push a retention deadline into the wrong month.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("clamps to a leap day when there is one", () => {
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("crosses a year boundary", () => {
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("subtracts", () => {
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
  });

  it("rejects a malformed date rather than returning nonsense", () => {
    expect(() => addMonths("15/01/2026", 1)).toThrow(/YYYY-MM-DD/);
  });
});

describe("dueDate", () => {
  it("is the anchor plus the retention period", () => {
    expect(dueDate(applicantPolicy, "2026-01-15")).toBe("2026-07-15");
  });

  it("handles a seven-year statutory period", () => {
    expect(dueDate(payrollPolicy, "2026-03-31")).toBe("2033-03-31");
  });
});

describe("decide", () => {
  function record(over: Partial<RetainedRecord> = {}): RetainedRecord {
    return {
      entityType: "candidate",
      entityId: "c1",
      anchorDate: "2025-01-15",
      ...over,
    };
  }

  it("retains a record still inside its period", () => {
    const decision = decide(applicantPolicy, record({ anchorDate: "2026-01-15" }), "2026-04-01");
    expect(decision.method).toBe("retain");
    expect(decision.reason).toContain("Recruitment data minimisation policy");
  });

  it("acts on a record past its period", () => {
    const decision = decide(applicantPolicy, record(), "2026-04-01");
    expect(decision.method).toBe("delete");
    expect(decision.daysUntilDue).toBeLessThan(0);
  });

  it("names the basis in the reason, so the decision is defensible", () => {
    // "Why was this destroyed?" needs a citation, not a shrug.
    const decision = decide(applicantPolicy, record(), "2026-04-01");
    expect(decision.reason).toMatch(/Recruitment data minimisation policy/);
  });

  it("suspends retention under a legal hold", () => {
    // Destroying evidence during litigation is far worse than keeping a
    // record longer than the schedule says.
    const decision = decide(
      applicantPolicy,
      record({ legalHoldId: "LIT-2026-04" }),
      "2030-01-01"
    );
    expect(decision.method).toBe("retain");
    expect(decision.reason).toContain("LIT-2026-04");
  });

  it("treats the due date itself as still retained", () => {
    const decision = decide(applicantPolicy, record({ anchorDate: "2026-01-15" }), "2026-07-14");
    expect(decision.method).toBe("retain");
  });
});

describe("planRetention", () => {
  const records: RetainedRecord[] = [
    { entityType: "candidate", entityId: "c1", anchorDate: "2024-01-01" },
    { entityType: "candidate", entityId: "c2", anchorDate: "2025-06-01" },
    { entityType: "candidate", entityId: "c3", anchorDate: "2026-03-01" },
  ];

  it("lists only records that are due", () => {
    const plan = planRetention([applicantPolicy], records, "2026-04-01");
    expect(plan.map((d) => d.entityId)).toEqual(["c1", "c2"]);
  });

  it("orders the most overdue first", () => {
    const plan = planRetention([applicantPolicy], records, "2026-04-01");
    expect(plan[0].entityId).toBe("c1");
  });

  it("ignores an entity type with no policy", () => {
    const plan = planRetention(
      [applicantPolicy],
      [{ entityType: "asset", entityId: "a1", anchorDate: "2020-01-01" }],
      "2026-04-01"
    );
    expect(plan).toEqual([]);
  });

  it("ignores an inactive policy", () => {
    const plan = planRetention(
      [{ ...applicantPolicy, isActive: false }],
      records,
      "2026-04-01"
    );
    expect(plan).toEqual([]);
  });

  it("excludes records under legal hold", () => {
    const held = records.map((r) => ({ ...r, legalHoldId: "LIT-1" }));
    expect(planRetention([applicantPolicy], held, "2026-04-01")).toEqual([]);
  });
});

describe("planErasure", () => {
  const scope = [
    { entityType: "employee", entityId: "e1", areas: ["profile", "attendance"] },
    { entityType: "payroll_record", entityId: "e1", areas: ["payslips"] },
  ];

  it("anonymises rather than deleting by default", () => {
    // Removing a row from payroll history changes totals that were already
    // reported and filed.
    const plan = planErasure("e1", [scope[0]], []);
    expect(plan.items.every((i) => i.method === "anonymise")).toBe(true);
  });

  it("retains an area a statute requires, and names the statute", () => {
    // A request that silently skipped it would leave the requester believing
    // their data was gone.
    const plan = planErasure("e1", scope, [payrollPolicy]);
    const payslips = plan.items.find((i) => i.area === "payslips");

    expect(payslips?.method).toBe("retain");
    expect(payslips?.reason).toContain("Income Tax Act");
  });

  it("still erases the areas it can", () => {
    const plan = planErasure("e1", scope, [payrollPolicy]);
    expect(plan.actionable).toBe(true);
    expect(plan.items.filter((i) => i.method === "anonymise")).toHaveLength(2);
  });

  it("reports the retained areas separately, for the response to the subject", () => {
    const plan = planErasure("e1", scope, [payrollPolicy]);
    expect(plan.retained.map((i) => i.area)).toEqual(["payslips"]);
  });

  it("is not actionable when everything is retained", () => {
    const plan = planErasure("e1", [scope[1]], [payrollPolicy]);
    expect(plan.actionable).toBe(false);
  });

  it("lets a legal hold override even an otherwise erasable area", () => {
    const plan = planErasure("e1", [scope[0]], [], [
      { entityType: "employee", entityId: "e1", reference: "LIT-2026-04" },
    ]);
    expect(plan.items.every((i) => i.method === "retain")).toBe(true);
    expect(plan.items[0].reason).toContain("LIT-2026-04");
  });

  it("ignores a policy that does not override erasure", () => {
    const plan = planErasure("c1", [{ entityType: "candidate", entityId: "c1", areas: ["cv"] }], [
      applicantPolicy,
    ]);
    expect(plan.items[0].method).toBe("anonymise");
  });

  it("ignores an inactive policy", () => {
    const plan = planErasure("e1", [scope[1]], [{ ...payrollPolicy, isActive: false }]);
    expect(plan.items[0].method).toBe("anonymise");
  });
});

describe("pseudonym", () => {
  it("is stable for the same subject", async () => {
    // An anonymised payslip and an anonymised attendance record must still be
    // recognisable as the same unidentified person, or the aggregate
    // reporting the anonymisation preserved stops working.
    expect(await pseudonym("e1", "salt")).toBe(await pseudonym("e1", "salt"));
  });

  it("differs between subjects", async () => {
    expect(await pseudonym("e1", "salt")).not.toBe(await pseudonym("e2", "salt"));
  });

  it("differs between tenants using different salts", async () => {
    // Otherwise the same pseudonym across two customers would let them
    // correlate a person between them.
    expect(await pseudonym("e1", "org-a")).not.toBe(await pseudonym("e1", "org-b"));
  });

  it("does not contain the original id", async () => {
    expect(await pseudonym("alice@example.com", "salt")).not.toContain("alice");
  });
});

describe("mask", () => {
  it("keeps the last few characters", () => {
    expect(mask("ABCDE1234F")).toBe("••••••234F");
  });

  it("masks a short value entirely", () => {
    expect(mask("ab")).toBe("••");
  });

  it("returns an empty string for no value", () => {
    expect(mask(null)).toBe("");
    expect(mask(undefined)).toBe("");
  });

  it("keeps the domain of an email so the account is still recognisable", () => {
    expect(maskEmail("asha@example.com")).toBe("a•••@example.com");
  });

  it("falls back to plain masking for something that is not an email", () => {
    expect(maskEmail("not-an-email")).toBe("••••••••mail");
  });
});

describe("buildSubjectAccess", () => {
  it("keeps empty sections rather than dropping them", () => {
    // "We hold no disciplinary record for you" is itself an answer the
    // requester is entitled to; omitting the section is indistinguishable
    // from forgetting to look.
    const result = buildSubjectAccess("e1", [{ area: "disciplinary", records: [] }]);
    expect(result.sections).toHaveLength(1);
  });

  it("records what was deliberately withheld and why", () => {
    const result = buildSubjectAccess("e1", [], [
      { area: "peer_review_comments", reason: "Contains a third party's personal data" },
    ]);
    expect(result.omitted[0].reason).toMatch(/third party/);
  });

  it("stamps the time it was generated", () => {
    const result = buildSubjectAccess("e1", [], [], "2026-04-01T00:00:00.000Z");
    expect(result.generatedAt).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("isThirdPartySensitive", () => {
  it("flags areas containing someone else's personal data", () => {
    // A subject is entitled to their own data, not a colleague's.
    expect(isThirdPartySensitive("peer_review_comments")).toBe(true);
    expect(isThirdPartySensitive("investigation_witness_statements")).toBe(true);
  });

  it("does not flag ordinary areas", () => {
    expect(isThirdPartySensitive("payslips")).toBe(false);
  });
});

describe("hasConsent", () => {
  it("is false with no record at all", () => {
    expect(hasConsent([], "marketing", 1)).toBe(false);
  });

  it("is true for a current grant", () => {
    expect(
      hasConsent([{ purpose: "marketing", grantedAt: "2026-01-01", policyVersion: 1 }], "marketing", 1)
    ).toBe(true);
  });

  it("is false once withdrawn", () => {
    expect(
      hasConsent(
        [
          {
            purpose: "marketing",
            grantedAt: "2026-01-01",
            withdrawnAt: "2026-02-01",
            policyVersion: 1,
          },
        ],
        "marketing",
        1
      )
    ).toBe(false);
  });

  it("does not carry consent forward across a policy change", () => {
    // If the wording changed, the person agreed to something else.
    expect(
      hasConsent([{ purpose: "marketing", grantedAt: "2026-01-01", policyVersion: 1 }], "marketing", 2)
    ).toBe(false);
  });

  it("uses the most recent grant", () => {
    const consents = [
      { purpose: "marketing", grantedAt: "2026-01-01", withdrawnAt: "2026-02-01", policyVersion: 1 },
      { purpose: "marketing", grantedAt: "2026-03-01", policyVersion: 2 },
    ];
    expect(hasConsent(consents, "marketing", 2)).toBe(true);
  });

  it("keeps purposes separate", () => {
    const consents = [{ purpose: "marketing", grantedAt: "2026-01-01", policyVersion: 1 }];
    expect(hasConsent(consents, "profiling", 1)).toBe(false);
  });
});

describe("daysBetween", () => {
  it("is negative for a past date", () => {
    expect(daysBetween("2026-04-01", "2026-03-25")).toBe(-7);
  });

  it("rejects a malformed date", () => {
    expect(() => daysBetween("2026-04-01", "soon")).toThrow(/YYYY-MM-DD/);
  });
});
