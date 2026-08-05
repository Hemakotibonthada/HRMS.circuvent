// @vitest-environment node
//
// Referral rules decide who gets paid what. The failure modes are paying
// twice, paying for a hire who left, and paying the wrong person when two
// colleagues referred the same candidate — each tested here.

import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  detectDuplicate,
  explainRefusal,
  isTerminal,
  payoutEligibleOn,
  scheduleInstalments,
  stillQualifies,
  type ExistingReferral,
  type ReferralStatus,
} from "@/lib/referral-rules";

const ALL: ReferralStatus[] = [
  "submitted",
  "screening",
  "interviewing",
  "offered",
  "hired",
  "rejected",
  "withdrawn",
  "duplicate",
];

describe("stage transitions", () => {
  it("walks the happy path", () => {
    expect(canTransition("submitted", "screening")).toBe(true);
    expect(canTransition("screening", "interviewing")).toBe(true);
    expect(canTransition("interviewing", "offered")).toBe(true);
    expect(canTransition("offered", "hired")).toBe(true);
  });

  it("refuses a jump straight to hired", () => {
    // Skipping stages would bypass the bonus eligibility calculation.
    expect(canTransition("submitted", "hired")).toBe(false);
    expect(canTransition("screening", "hired")).toBe(false);
  });

  it("refuses to move backwards", () => {
    expect(canTransition("interviewing", "screening")).toBe(false);
    expect(canTransition("offered", "submitted")).toBe(false);
  });

  it("treats hired as terminal", () => {
    // The bonus clock has started and an employee record exists; reversing is
    // a correction, not a stage change.
    expect(isTerminal("hired")).toBe(true);
    for (const status of ALL) {
      expect(canTransition("hired", status), `hired -> ${status}`).toBe(false);
    }
  });

  it("treats every closed outcome as terminal", () => {
    for (const status of ["rejected", "withdrawn", "duplicate"] as ReferralStatus[]) {
      expect(isTerminal(status), status).toBe(true);
    }
  });

  it("allows abandoning from any open stage", () => {
    for (const status of ["submitted", "screening", "interviewing", "offered"] as ReferralStatus[]) {
      expect(canTransition(status, "withdrawn"), status).toBe(true);
      expect(canTransition(status, "rejected"), status).toBe(true);
    }
  });

  it("never allows a self-transition", () => {
    for (const status of ALL) {
      expect(canTransition(status, status), status).toBe(false);
    }
  });

  it("defines transitions for every status", () => {
    for (const status of ALL) {
      expect(ALLOWED_TRANSITIONS[status], status).toBeDefined();
    }
  });

  it("explains a refusal in terms the user can act on", () => {
    // "Invalid transition" tells someone nothing.
    expect(explainRefusal("hired", "screening")).toMatch(/cannot change further/);
    expect(explainRefusal("submitted", "hired")).toMatch(/cannot move to hired/);
    expect(explainRefusal("submitted", "screening")).toBe("");
  });
});

describe("payoutEligibleOn", () => {
  it("adds the qualifying period to the hire date", () => {
    expect(payoutEligibleOn("2026-04-06", 90)).toBe("2026-07-05");
  });

  it("handles a zero qualifying period", () => {
    expect(payoutEligibleOn("2026-04-06", 0)).toBe("2026-04-06");
  });

  it("treats a negative period as immediate rather than back-dating", () => {
    expect(payoutEligibleOn("2026-04-06", -30)).toBe("2026-04-06");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(payoutEligibleOn("2026-12-20", 30)).toBe("2027-01-19");
    expect(payoutEligibleOn("2028-02-01", 29)).toBe("2028-03-01");
  });

  it("rejects an unparseable date rather than returning a wrong one", () => {
    expect(() => payoutEligibleOn("not-a-date", 90)).toThrow(/valid YYYY-MM-DD/);
  });
});

describe("scheduleInstalments", () => {
  it("defaults to a single instalment at the qualifying date", () => {
    const schedule = scheduleInstalments(
      { bonusAmountMinor: 5_000_000n, qualifyingPeriodDays: 90 },
      "2026-04-06"
    );

    expect(schedule).toHaveLength(1);
    expect(schedule[0].amountMinor).toBe(5_000_000n);
    expect(schedule[0].dueOn).toBe("2026-07-05");
  });

  it("splits across instalments at their own due dates", () => {
    const schedule = scheduleInstalments(
      {
        bonusAmountMinor: 5_000_000n,
        qualifyingPeriodDays: 90,
        instalments: [
          { afterDays: 90, percent: 50 },
          { afterDays: 180, percent: 50 },
        ],
      },
      "2026-04-06"
    );

    expect(schedule).toHaveLength(2);
    expect(schedule[0].amountMinor).toBe(2_500_000n);
    expect(schedule[1].amountMinor).toBe(2_500_000n);
    expect(schedule[1].dueOn).toBe("2026-10-03");
  });

  it("always sums to exactly the promised total despite rounding", () => {
    // An uneven split must not leave the employee short or the company over;
    // neither reconciles at year end.
    const total = 1_000_001n;
    const schedule = scheduleInstalments(
      {
        bonusAmountMinor: total,
        qualifyingPeriodDays: 90,
        instalments: [
          { afterDays: 30, percent: 33 },
          { afterDays: 60, percent: 33 },
          { afterDays: 90, percent: 34 },
        ],
      },
      "2026-04-06"
    );

    expect(schedule.reduce((sum, i) => sum + i.amountMinor, 0n)).toBe(total);
  });

  it("gives the rounding remainder to the final instalment", () => {
    const schedule = scheduleInstalments(
      {
        bonusAmountMinor: 100n,
        qualifyingPeriodDays: 90,
        instalments: [
          { afterDays: 30, percent: 33 },
          { afterDays: 60, percent: 67 },
        ],
      },
      "2026-04-06"
    );

    expect(schedule[0].amountMinor).toBe(33n);
    expect(schedule[1].amountMinor).toBe(67n);
  });

  it("returns nothing for a zero bonus", () => {
    expect(
      scheduleInstalments({ bonusAmountMinor: 0n, qualifyingPeriodDays: 90 }, "2026-04-06")
    ).toEqual([]);
  });

  it("rejects instalments that do not total 100%", () => {
    // Silently normalising would pay out the wrong amount.
    expect(() =>
      scheduleInstalments(
        {
          bonusAmountMinor: 100n,
          qualifyingPeriodDays: 90,
          instalments: [
            { afterDays: 30, percent: 50 },
            { afterDays: 60, percent: 40 },
          ],
        },
        "2026-04-06"
      )
    ).toThrow(/must total 100%/);
  });
});

describe("detectDuplicate", () => {
  function existing(over: Partial<ExistingReferral> = {}): ExistingReferral {
    return {
      id: "ref-1",
      referrerId: "emp-1",
      candidateEmail: "priya@example.com",
      jobId: "job-1",
      status: "screening",
      submittedAt: "2026-04-01T10:00:00Z",
      ...over,
    };
  }

  it("passes a genuinely new referral", () => {
    expect(
      detectDuplicate("new@example.com", "job-1", "emp-2", "ben@circuvent.com", [existing()])
    ).toEqual({ kind: "none" });
  });

  it("blocks referring yourself", () => {
    expect(
      detectDuplicate("ben@circuvent.com", "job-1", "emp-2", "Ben@Circuvent.com ", [])
    ).toEqual({ kind: "self_referral" });
  });

  it("tells you when it was your own earlier referral", () => {
    // A mistake the user can correct.
    const verdict = detectDuplicate(
      "priya@example.com",
      "job-1",
      "emp-1",
      "asha@circuvent.com",
      [existing()]
    );
    expect(verdict).toEqual({ kind: "own_duplicate", existingId: "ref-1" });
  });

  it("distinguishes a colleague's claim, which involves someone else's bonus", () => {
    const verdict = detectDuplicate(
      "priya@example.com",
      "job-1",
      "emp-2",
      "ben@circuvent.com",
      [existing()]
    );
    expect(verdict).toEqual({
      kind: "colleague_duplicate",
      existingId: "ref-1",
      referrerId: "emp-1",
    });
  });

  it("awards the collision to the earliest submission", () => {
    // The only defensible rule when money is attached.
    const verdict = detectDuplicate("priya@example.com", "job-1", "emp-3", "c@x.com", [
      existing({ id: "later", referrerId: "emp-2", submittedAt: "2026-04-05T10:00:00Z" }),
      existing({ id: "earliest", referrerId: "emp-1", submittedAt: "2026-03-01T10:00:00Z" }),
    ]);

    expect(verdict).toMatchObject({ existingId: "earliest", referrerId: "emp-1" });
  });

  it("does not let a closed referral block a new one", () => {
    // The candidate may have become suitable, or be applying for another role.
    for (const status of ["rejected", "withdrawn", "duplicate"] as ReferralStatus[]) {
      expect(
        detectDuplicate("priya@example.com", "job-1", "emp-2", "b@x.com", [
          existing({ status }),
        ]),
        status
      ).toEqual({ kind: "none" });
    }
  });

  it("scopes collisions to the same role", () => {
    // Referring one person for two different jobs is legitimate.
    expect(
      detectDuplicate("priya@example.com", "job-2", "emp-2", "b@x.com", [existing()])
    ).toEqual({ kind: "none" });
  });

  it("ignores email casing and stray whitespace", () => {
    expect(
      detectDuplicate("  PRIYA@example.com ", "job-1", "emp-2", "b@x.com", [existing()])
    ).toMatchObject({ kind: "colleague_duplicate" });
  });

  it("handles a speculative referral with no job attached", () => {
    expect(
      detectDuplicate("priya@example.com", null, "emp-2", "b@x.com", [
        existing({ jobId: null }),
      ])
    ).toMatchObject({ kind: "colleague_duplicate" });
  });
});

describe("stillQualifies", () => {
  it("pays for a hire who is still there", () => {
    expect(stillQualifies("active", false)).toBe(true);
    expect(stillQualifies("probation", false)).toBe(true);
    expect(stillQualifies("on_leave", false)).toBe(true);
  });

  it("does not pay for someone who has left", () => {
    expect(stillQualifies("terminated", false)).toBe(false);
    expect(stillQualifies("inactive", false)).toBe(false);
  });

  it("treats notice period as leaving", () => {
    // A retention bonus for someone whose resignation is already in defeats
    // the purpose of the qualifying period.
    expect(stillQualifies("notice_period", false)).toBe(false);
  });

  it("does not pay for a deleted record whatever its status says", () => {
    expect(stillQualifies("active", true)).toBe(false);
  });
});
