// The mapping between the offer form and the documents API. The case that
// matters most is that a single "compensation" field on the form lands under
// the token the engagement is actually paid in — so there is no path through
// this code that puts an annual CTC on an internship.

import { describe, expect, it } from "vitest";
import {
  checkDraft,
  describeDelivery,
  generateRequestFor,
  tokensFor,
  type OfferDraft,
  type SendResult,
} from "@/lib/letters-client";
import { ENGAGEMENT_TYPES, compensationTokenFor, ruleFor } from "@/lib/offer-rules";

function draft(overrides: Partial<OfferDraft> = {}): OfferDraft {
  return {
    engagementType: "full_time",
    templateId: "11111111-1111-1111-1111-111111111111",
    candidateName: "Asha Rao",
    candidateEmail: "asha@example.test",
    positionTitle: "Backend Engineer",
    startDate: "2026-04-01",
    compensation: "1200000",
    probationPeriod: "6 months",
    hrEmail: "people@acme.test",
    hrName: "People Ops",
    extra: { basic_salary: "480000" },
    ...overrides,
  };
}

const INTERNSHIP = draft({
  engagementType: "internship",
  compensation: "25000",
  endDate: "2026-09-30",
  mentorName: "Team lead",
  probationPeriod: "6 months",
  extra: {},
});

describe("compensation lands under the right token", () => {
  it("uses the token its engagement is paid in", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const tokens = tokensFor(draft({ engagementType: type, compensation: "5000" }));
      expect(tokens[compensationTokenFor(type)]).toBe("5000");
    }
  });

  it("never produces a CTC for an internship", () => {
    const tokens = tokensFor(INTERNSHIP);
    expect(tokens.annual_ctc).toBeUndefined();
    expect(tokens.stipend_amount).toBe("25000");
  });

  it("never produces a stipend for full-time employment", () => {
    const tokens = tokensFor(draft());
    expect(tokens.stipend_amount).toBeUndefined();
    expect(tokens.annual_ctc).toBe("1200000");
  });

  it("emits no token another engagement forbids", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const tokens = tokensFor(draft({ engagementType: type, compensation: "5000" }));
      for (const forbidden of ruleFor(type).forbiddenTokens) {
        expect(Object.keys(tokens), `${type} emitted ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("probation", () => {
  // The form carries a probation field because most offers are full-time. It
  // must not follow the user across to an engagement that has none, or the
  // rules reject the offer over a field that is not on their screen.
  it("is dropped for engagements that have none, even when the form supplies it", () => {
    for (const type of ["internship", "apprenticeship", "contract"] as const) {
      const tokens = tokensFor(
        draft({ engagementType: type, probationPeriod: "3 months", compensation: "1" })
      );
      expect(tokens.probation_period).toBeUndefined();
    }
  });

  it("is kept where it means something", () => {
    expect(tokensFor(draft()).probation_period).toBe("6 months");
    expect(
      tokensFor(draft({ engagementType: "part_time", probationPeriod: "2 months" }))
        .probation_period
    ).toBe("2 months");
  });
});

describe("defaults", () => {
  it("takes the notice period from the engagement when the form omits it", () => {
    expect(tokensFor(draft()).notice_period).toBe("60 days");
    expect(tokensFor(draft({ engagementType: "internship", compensation: "1", endDate: "2026-09-30", mentorName: "L" })).notice_period).toBe("7 days");
  });

  it("lets the form override it", () => {
    expect(tokensFor(draft({ noticePeriod: "90 days" })).notice_period).toBe("90 days");
  });

  it("supplies a work mode and hours rather than leaving the letter blank", () => {
    const tokens = tokensFor(draft({ workMode: undefined, workingHours: undefined }));
    expect(tokens.work_mode.length).toBeGreaterThan(0);
    expect(tokens.working_hours.length).toBeGreaterThan(0);
  });

  it("lets extra values win, for a template the form does not model", () => {
    const tokens = tokensFor(draft({ extra: { work_mode: "hybrid", custom_clause: "x" } }));
    expect(tokens.work_mode).toBe("hybrid");
    expect(tokens.custom_clause).toBe("x");
  });
});

describe("checking a draft before sending it", () => {
  it("accepts a complete full-time offer", () => {
    expect(checkDraft(draft()).valid).toBe(true);
  });

  it("accepts a complete internship offer", () => {
    expect(checkDraft(INTERNSHIP).problems).toEqual([]);
  });

  it("requires a template", () => {
    const result = checkDraft(draft({ templateId: "" }));
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.field === "templateId")).toBe(true);
  });

  it("requires a candidate name and a real email", () => {
    for (const email of ["", "asha", "asha@", "@example.test", "a b@c.test"]) {
      const result = checkDraft(draft({ candidateEmail: email }));
      expect(result.valid, `accepted ${email}`).toBe(false);
    }
    expect(checkDraft(draft({ candidateName: "  " })).valid).toBe(false);
  });

  // HR counter-signs, and `buildSlots` refuses a signatory with no recipient.
  // Without this check the failure surfaces as a 400 from deep in the
  // repository rather than as a field on the form.
  it("requires an HR address for the counter-signature", () => {
    const result = checkDraft(draft({ hrEmail: "" }));
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.field === "hrEmail")).toBe(true);
  });

  it("rejects an internship with no end date", () => {
    const result = checkDraft(draft({ engagementType: "internship", compensation: "1", endDate: undefined, mentorName: "L" }));
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.field === "engagement_end_date")).toBe(true);
  });

  it("rejects an end date before the start", () => {
    const result = checkDraft({ ...INTERNSHIP, endDate: "2026-03-01" });
    expect(result.valid).toBe(false);
  });

  it("reports every problem, so the form can mark them all", () => {
    const result = checkDraft(draft({ candidateName: "", candidateEmail: "", templateId: "" }));
    expect(result.problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the generate request", () => {
  it("names both signatories, candidate first", () => {
    const request = generateRequestFor(draft());
    expect(request.recipients.employee.email).toBe("asha@example.test");
    expect(request.recipients.hr.email).toBe("people@acme.test");
  });

  it("trims addresses, because a pasted address carries a space", () => {
    const request = generateRequestFor(
      draft({ candidateEmail: "  asha@example.test ", hrEmail: " people@acme.test " })
    );
    expect(request.recipients.employee.email).toBe("asha@example.test");
    expect(request.recipients.hr.email).toBe("people@acme.test");
  });

  it("titles the document by engagement and role", () => {
    expect(generateRequestFor(INTERNSHIP).title).toBe("Internship — Backend Engineer");
    expect(generateRequestFor(draft()).title).toBe("Full-time employment — Backend Engineer");
  });

  it("passes the expiry through when set", () => {
    expect(generateRequestFor(draft({ expiresInDays: 14 })).expiresInDays).toBe(14);
  });

  it("carries the tokens, not the raw form", () => {
    const request = generateRequestFor(INTERNSHIP);
    expect(request.extraValues.stipend_amount).toBe("25000");
    expect(request.extraValues).not.toHaveProperty("compensation");
    expect(request.extraValues).not.toHaveProperty("engagementType");
  });
});

describe("describing what happened after a send", () => {
  const base: SendResult = {
    document: { id: "d", title: "t", category: "letter", status: "sent", signatures: [] },
    links: [],
    delivery: [
      { email: "a@x.test", role: "employee", sent: true },
      { email: "b@x.test", role: "hr", sent: true },
    ],
    mailConfigured: true,
  };

  it("reports a clean send", () => {
    expect(describeDelivery(base)).toEqual({ tone: "success", message: "Sent to 2 recipients" });
  });

  it("uses the singular for one recipient", () => {
    const one = { ...base, delivery: [base.delivery[0]] };
    expect(describeDelivery(one).message).toBe("Sent to 1 recipient");
  });

  // The offer is issued and the links exist, so "failed" would be wrong; but
  // "sent" would be wrong too, and the user would only find out when the
  // candidate says nothing arrived.
  it("does not claim success when no email went out", () => {
    const result = describeDelivery({
      ...base,
      mailConfigured: false,
      delivery: base.delivery.map((d) => ({ ...d, sent: false, reason: "no-smtp" })),
    });
    expect(result.tone).toBe("warning");
    expect(result.message).toContain("not configured");
    expect(result.message).toContain("signing links");
  });

  it("counts a partial failure precisely", () => {
    const result = describeDelivery({
      ...base,
      delivery: [base.delivery[0], { ...base.delivery[1], sent: false, reason: "send-failed" }],
    });
    expect(result.tone).toBe("warning");
    expect(result.message).toContain("1 of 2");
  });
});

describe("stale fields do not survive an engagement change", () => {
  // Someone fills in a full-time offer, then realises it is an internship and
  // switches. Whatever they typed is still in the draft, and `extra` is merged
  // last, so without filtering a basic salary rides through onto a letter that
  // must not carry one.
  it("drops a salary carried over from a full-time draft", () => {
    const tokens = tokensFor({
      ...INTERNSHIP,
      extra: { basic_salary: "480000", hra: "192000" },
    });

    expect(tokens.basic_salary).toBeUndefined();
    expect(tokens.stipend_amount).toBe("25000");
  });

  it("still accepts extras the engagement permits", () => {
    const tokens = tokensFor({ ...INTERNSHIP, extra: { project_summary: "Billing service" } });
    expect(tokens.project_summary).toBe("Billing service");
  });

  it("cannot be talked into a forbidden token by any route", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const rule = ruleFor(type);
      const hostile = Object.fromEntries(rule.forbiddenTokens.map((t) => [t, "x"]));
      const tokens = tokensFor(draft({ engagementType: type, compensation: "1", extra: hostile }));

      for (const forbidden of rule.forbiddenTokens) {
        expect(tokens, `${type} let ${forbidden} through`).not.toHaveProperty(forbidden);
      }
    }
  });
});
