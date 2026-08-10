// @vitest-environment node
//
// Hiring decisions get challenged, sometimes formally. These tests pin the
// rules that keep the record defensible: stages that cannot be skipped,
// scorecards that cannot be read before they are written, and offers that
// cannot be self-approved or accepted after they lapse.

import { describe, expect, it } from "vitest";
import {
  canAcceptOffer,
  canAdvance,
  canSeeOtherScorecards,
  canSendOffer,
  findConflicts,
  findDuplicates,
  funnel,
  normaliseEmail,
  normalisePhone,
  sourceEffectiveness,
  summarisePanel,
  timeToHire,
  type ApplicationState,
  type PipelineStage,
  type Scorecard,
} from "@/lib/ats";

const stages: PipelineStage[] = [
  { id: "applied", name: "Applied", sequence: 1, kind: "sourcing", requiredScorecards: 0 },
  { id: "screen", name: "Screening", sequence: 2, kind: "screening", requiredScorecards: 1 },
  { id: "interview", name: "Interview", sequence: 3, kind: "interview", requiredScorecards: 2 },
  { id: "offer", name: "Offer", sequence: 4, kind: "offer", requiredScorecards: 0 },
  { id: "hired", name: "Hired", sequence: 5, kind: "hired", requiredScorecards: 0 },
];

function application(over: Partial<ApplicationState> = {}): ApplicationState {
  return { stageId: "applied", status: "active", scorecardCount: 0, ...over };
}

describe("canAdvance", () => {
  it("moves to the next stage", () => {
    expect(canAdvance(application(), stages)).toEqual({ allowed: true, toStageId: "screen" });
  });

  it("refuses to skip a stage", () => {
    // Jumping from applied straight to offer loses the record of why the
    // candidate was considered suitable — and that record is what an
    // unsuccessful candidate's discrimination claim asks to see.
    const verdict = canAdvance(application(), stages, "offer");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/skip Screening, Interview/);
  });

  it("refuses to move backwards through advance", () => {
    const verdict = canAdvance(application({ stageId: "interview" }), stages, "screen");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/stage reversal/);
  });

  it("requires the stage's scorecards before advancing", () => {
    const verdict = canAdvance(application({ stageId: "screen" }), stages);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/needs 1 scorecard/);
  });

  it("advances once the scorecards are in", () => {
    expect(
      canAdvance(application({ stageId: "screen", scorecardCount: 1 }), stages)
    ).toEqual({ allowed: true, toStageId: "interview" });
  });

  it("refuses an application that is not active", () => {
    expect(canAdvance(application({ status: "rejected" }), stages).allowed).toBe(false);
    expect(canAdvance(application({ status: "withdrawn" }), stages).allowed).toBe(false);
  });

  it("refuses when the score is below an auto-reject threshold", () => {
    const strict = stages.map((s) =>
      s.id === "screen" ? { ...s, autoRejectBelow: 3 } : s
    );
    const verdict = canAdvance(
      application({ stageId: "screen", scorecardCount: 1, averageScore: 2 }),
      strict
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/below the 3 threshold/);
  });

  it("refuses at the end of the pipeline", () => {
    const verdict = canAdvance(application({ stageId: "hired" }), stages);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/no further stage/);
  });

  it("refuses a stage that is not in this pipeline", () => {
    expect(canAdvance(application({ stageId: "nonsense" }), stages).allowed).toBe(false);
  });

  it("orders by sequence, not by array position", () => {
    const shuffled = [...stages].reverse();
    expect(canAdvance(application(), shuffled)).toEqual({
      allowed: true,
      toStageId: "screen",
    });
  });
});

describe("normaliseEmail", () => {
  it("lowercases and trims", () => {
    expect(normaliseEmail("  Asha@Example.COM ")).toBe("asha@example.com");
  });

  it("strips plus-addressing, which is a routing hint not a different person", () => {
    expect(normaliseEmail("asha+jobs@example.com")).toBe("asha@example.com");
  });

  it("ignores dots on Gmail, which routes them to the same inbox", () => {
    expect(normaliseEmail("a.s.h.a@gmail.com")).toBe("asha@gmail.com");
    expect(normaliseEmail("asha@googlemail.com")).toBe("asha@googlemail.com");
  });

  it("keeps dots on other providers, which treat them as significant", () => {
    expect(normaliseEmail("a.s.h.a@example.com")).toBe("a.s.h.a@example.com");
  });

  it("leaves something that is not an email alone", () => {
    expect(normaliseEmail("asha")).toBe("asha");
  });
});

describe("normalisePhone", () => {
  it("strips formatting", () => {
    expect(normalisePhone("+91 98765 43210")).toBe("9876543210");
  });

  it("matches a number written with and without a country code", () => {
    expect(normalisePhone("+919876543210")).toBe(normalisePhone("9876543210"));
  });

  it("leaves a short number alone", () => {
    expect(normalisePhone("12345")).toBe("12345");
  });
});

describe("findDuplicates", () => {
  const existing = [
    { id: "c1", email: "asha@gmail.com", phone: "+91 98765 43210" },
    { id: "c2", email: "ravi@example.com" },
  ];

  it("matches on email with certainty", () => {
    const matches = findDuplicates({ email: "a.sha+jobs@gmail.com" }, existing);
    expect(matches[0]).toMatchObject({ candidateId: "c1", confidence: "certain" });
  });

  it("matches on phone only as likely", () => {
    // Shared household numbers are common enough that merging on one alone
    // would combine two real people.
    const matches = findDuplicates(
      { email: "different@example.com", phone: "9876543210" },
      existing
    );
    expect(matches[0]).toMatchObject({ confidence: "likely", matchedOn: "phone" });
  });

  it("prefers the email match and does not double-report", () => {
    const matches = findDuplicates(
      { email: "asha@gmail.com", phone: "9876543210" },
      existing
    );
    expect(matches.filter((m) => m.candidateId === "c1")).toHaveLength(1);
  });

  it("finds nothing for a genuinely new candidate", () => {
    expect(findDuplicates({ email: "new@example.com" }, existing)).toEqual([]);
  });
});

describe("findConflicts", () => {
  const at = (iso: string) => new Date(`${iso}Z`);

  const existing = [
    {
      interviewerId: "i1",
      startsAt: at("2026-04-06T10:00:00"),
      endsAt: at("2026-04-06T11:00:00"),
    },
  ];

  it("finds an overlapping booking", () => {
    // An interview quietly scheduled over another produces an empty room and a
    // candidate who travelled for it.
    const conflicts = findConflicts(
      {
        interviewerId: "i1",
        startsAt: at("2026-04-06T10:30:00"),
        endsAt: at("2026-04-06T11:30:00"),
      },
      existing
    );
    expect(conflicts).toHaveLength(1);
  });

  it("allows a back-to-back booking with no buffer", () => {
    expect(
      findConflicts(
        {
          interviewerId: "i1",
          startsAt: at("2026-04-06T11:00:00"),
          endsAt: at("2026-04-06T12:00:00"),
        },
        existing
      )
    ).toEqual([]);
  });

  it("flags a back-to-back booking when a buffer is required", () => {
    const conflicts = findConflicts(
      {
        interviewerId: "i1",
        startsAt: at("2026-04-06T11:00:00"),
        endsAt: at("2026-04-06T12:00:00"),
      },
      existing,
      15
    );
    expect(conflicts[0].reason).toMatch(/Within 15 minutes/);
  });

  it("ignores a different interviewer", () => {
    expect(
      findConflicts(
        {
          interviewerId: "i2",
          startsAt: at("2026-04-06T10:30:00"),
          endsAt: at("2026-04-06T11:30:00"),
        },
        existing
      )
    ).toEqual([]);
  });

  it("ignores a booking on a different day", () => {
    expect(
      findConflicts(
        {
          interviewerId: "i1",
          startsAt: at("2026-04-07T10:00:00"),
          endsAt: at("2026-04-07T11:00:00"),
        },
        existing
      )
    ).toEqual([]);
  });
});

describe("canSeeOtherScorecards", () => {
  const panel: Scorecard[] = [
    {
      interviewerId: "i1",
      submittedAt: "2026-04-06T12:00:00Z",
      scores: { c1: 4 },
      recommendation: "hire",
    },
    { interviewerId: "i2", scores: {}, recommendation: "hire" },
  ];

  it("hides the panel from someone who has not submitted", () => {
    // Panels converge hard on the first opinion voiced. Showing previous
    // scores while the next interviewer is still typing turns four
    // independent assessments into one repeated four times — which is worse
    // than one, because it looks like corroboration.
    const verdict = canSeeOtherScorecards("i2", panel);
    expect(verdict.canSee).toBe(false);
    if (!verdict.canSee) expect(verdict.reason).toMatch(/Submit your own/);
  });

  it("shows the panel once they have submitted", () => {
    expect(canSeeOtherScorecards("i1", panel)).toEqual({ canSee: true });
  });

  it("always shows the hiring manager, who must decide", () => {
    expect(canSeeOtherScorecards("hm", panel, true)).toEqual({ canSee: true });
  });

  it("refuses someone who is not on the panel", () => {
    const verdict = canSeeOtherScorecards("stranger", panel);
    expect(verdict.canSee).toBe(false);
    if (!verdict.canSee) expect(verdict.reason).toMatch(/not on this panel/);
  });
});

describe("summarisePanel", () => {
  function card(over: Partial<Scorecard>): Scorecard {
    return {
      interviewerId: "i",
      submittedAt: "2026-04-06T12:00:00Z",
      scores: { c1: 4 },
      recommendation: "hire",
      ...over,
    };
  }

  it("reports a unanimous hire", () => {
    const result = summarisePanel([
      card({ interviewerId: "i1" }),
      card({ interviewerId: "i2" }),
    ]);
    expect(result.recommendation).toBe("hire");
    expect(result.isSplit).toBe(false);
  });

  it("surfaces a split rather than averaging it away", () => {
    // Two strong hires and two strong no-hires average to the middle;
    // reporting that as neutral hides the only interesting fact about the
    // interview.
    const result = summarisePanel([
      card({ interviewerId: "i1", recommendation: "strong_hire", scores: { c1: 5 } }),
      card({ interviewerId: "i2", recommendation: "strong_no_hire", scores: { c1: 1 } }),
    ]);

    expect(result.isSplit).toBe(true);
    expect(result.recommendation).toBe("split");
    expect(result.summary).toMatch(/Split panel/);
  });

  it("reports a unanimous strong hire", () => {
    const result = summarisePanel([
      card({ interviewerId: "i1", recommendation: "strong_hire" }),
      card({ interviewerId: "i2", recommendation: "strong_hire" }),
    ]);
    expect(result.recommendation).toBe("strong_hire");
  });

  it("reports a unanimous no hire", () => {
    const result = summarisePanel([
      card({ interviewerId: "i1", recommendation: "no_hire" }),
      card({ interviewerId: "i2", recommendation: "no_hire" }),
    ]);
    expect(result.recommendation).toBe("no_hire");
  });

  it("ignores unsubmitted scorecards in the average", () => {
    const result = summarisePanel([
      card({ interviewerId: "i1", scores: { c1: 4 } }),
      card({ interviewerId: "i2", submittedAt: undefined, scores: { c1: 1 } }),
    ]);
    expect(result.averageScore).toBe(4);
    expect(result.pendingCount).toBe(1);
  });

  it("handles a panel with nothing submitted", () => {
    const result = summarisePanel([card({ submittedAt: undefined })]);
    expect(result.submittedCount).toBe(0);
    expect(result.summary).toMatch(/No assessments submitted/);
  });

  it("handles an empty panel", () => {
    expect(summarisePanel([]).submittedCount).toBe(0);
  });
});

describe("canSendOffer", () => {
  const now = new Date("2026-04-06T12:00:00Z");

  it("allows an approved offer", () => {
    expect(
      canSendOffer({ status: "approved", approvedById: "a", createdById: "b" }, now)
    ).toEqual({ allowed: true });
  });

  it("refuses an unapproved offer", () => {
    const verdict = canSendOffer({ status: "draft" }, now);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/not been approved/);
  });

  it("refuses a self-approved offer", () => {
    // An offer commits the company to a salary; one person drafting and
    // approving it has no check on it at all.
    const verdict = canSendOffer(
      { status: "approved", approvedById: "a", createdById: "a" },
      now
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/other than the person who drafted/);
  });

  it("refuses when no approver is recorded", () => {
    expect(canSendOffer({ status: "approved" }, now).allowed).toBe(false);
  });

  it("refuses an already-expired offer", () => {
    const verdict = canSendOffer(
      {
        status: "approved",
        approvedById: "a",
        createdById: "b",
        expiresAt: "2026-04-01T00:00:00Z",
      },
      now
    );
    expect(verdict.allowed).toBe(false);
  });
});

describe("canAcceptOffer", () => {
  const now = new Date("2026-04-06T12:00:00Z");

  it("allows acceptance of a live offer", () => {
    expect(
      canAcceptOffer({ status: "sent", expiresAt: "2026-04-20T00:00:00Z" }, now)
    ).toEqual({ allowed: true });
  });

  it("refuses acceptance after expiry", () => {
    // An offer accepted three weeks after it lapsed leaves genuine doubt about
    // whether a contract exists, and that doubt is resolved in a tribunal.
    const verdict = canAcceptOffer(
      { status: "sent", expiresAt: "2026-04-01T00:00:00Z" },
      now
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/expired/);
  });

  it("refuses a second acceptance", () => {
    expect(canAcceptOffer({ status: "accepted" }, now).allowed).toBe(false);
  });

  it("refuses an offer that was never sent", () => {
    expect(canAcceptOffer({ status: "approved" }, now).allowed).toBe(false);
  });

  it("refuses a withdrawn offer", () => {
    expect(canAcceptOffer({ status: "withdrawn" }, now).allowed).toBe(false);
  });

  it("allows an offer with no expiry", () => {
    expect(canAcceptOffer({ status: "sent" }, now)).toEqual({ allowed: true });
  });
});

describe("funnel", () => {
  const rows = [
    { stageId: "applied", name: "Applied", sequence: 1, entered: 400 },
    { stageId: "screen", name: "Screening", sequence: 2, entered: 100 },
    { stageId: "interview", name: "Interview", sequence: 3, entered: 20 },
    { stageId: "hired", name: "Hired", sequence: 4, entered: 4 },
  ];

  it("reports conversion from the previous stage", () => {
    // Finds the step that is failing.
    expect(funnel(rows)[1].conversionFromPrevious).toBe(25);
  });

  it("reports conversion from the start", () => {
    // Tells a recruiter how many applications are needed for one hire.
    expect(funnel(rows)[3].conversionFromStart).toBe(1);
  });

  it("reports drop-off in absolute numbers", () => {
    expect(funnel(rows)[1].dropOff).toBe(300);
  });

  it("orders by sequence regardless of input order", () => {
    expect(funnel([...rows].reverse())[0].stageId).toBe("applied");
  });

  it("does not divide by zero on an empty pipeline", () => {
    const empty = rows.map((r) => ({ ...r, entered: 0 }));
    expect(funnel(empty).every((r) => r.conversionFromPrevious === 0)).toBe(true);
  });

  it("handles an empty list", () => {
    expect(funnel([])).toEqual([]);
  });
});

describe("timeToHire", () => {
  it("reports the median as well as the mean", () => {
    // One candidate who took nine months because a role was frozen drags a
    // mean far enough to make it useless for planning.
    const result = timeToHire([10, 12, 14, 270]);
    expect(result.medianDays).toBe(13);
    expect(result.averageDays).toBe(76.5);
  });

  it("takes the middle value for an odd count", () => {
    expect(timeToHire([10, 20, 30]).medianDays).toBe(20);
  });

  it("ignores nonsensical durations", () => {
    expect(timeToHire([10, -5, NaN, 20]).count).toBe(2);
  });

  it("returns nulls with nothing to measure", () => {
    expect(timeToHire([])).toEqual({ medianDays: null, averageDays: null, count: 0 });
  });
});

describe("sourceEffectiveness", () => {
  it("ranks by hire rate, not volume", () => {
    // A job board sending four hundred applications and one hire is worse than
    // a referral scheme sending ten and three; ranking by volume says the
    // opposite.
    const result = sourceEffectiveness([
      { source: "job_board", applications: 400, hires: 1 },
      { source: "referral", applications: 10, hires: 3 },
    ]);

    expect(result[0].source).toBe("referral");
  });

  it("computes cost per hire", () => {
    const result = sourceEffectiveness([
      { source: "agency", applications: 10, hires: 2, spendMinor: 200_000_00n },
    ]);
    expect(result[0].costPerHireMinor).toBe(100_000_00n);
  });

  it("omits cost per hire when nobody was hired", () => {
    const result = sourceEffectiveness([
      { source: "agency", applications: 10, hires: 0, spendMinor: 200_000_00n },
    ]);
    expect(result[0].costPerHireMinor).toBeUndefined();
  });

  it("does not divide by zero on a source with no applications", () => {
    expect(sourceEffectiveness([{ source: "x", applications: 0, hires: 0 }])[0].hireRate).toBe(
      0
    );
  });
});
