// The point of these rules is to stop an offer promising something the
// engagement cannot deliver. The forbidden-token cases matter more than the
// required-token ones: a missing field produces an obviously incomplete
// letter, while a field that should not be there produces a complete and
// plausible letter that is wrong.

import { describe, expect, it } from "vitest";
import {
  COMMON_OFFER_TOKENS,
  ENGAGEMENT_TYPES,
  compensationTokenFor,
  isEngagementType,
  ruleFor,
  statutoryFor,
  validateOffer,
  type EngagementType,
  type OfferInput,
} from "@/lib/offer-rules";

function offer(type: EngagementType, values: Record<string, string | number>): OfferInput {
  return { engagementType: type, values };
}

const VALID: Record<EngagementType, Record<string, string | number>> = {
  full_time: {
    annual_ctc: "1200000",
    basic_salary: "480000",
    probation_period: "6 months",
    notice_period: "60 days",
    start_date: "2026-04-01",
  },
  part_time: {
    monthly_salary: "35000",
    weekly_hours: "20",
    notice_period: "30 days",
    start_date: "2026-04-01",
  },
  internship: {
    stipend_amount: "25000",
    engagement_end_date: "2026-09-30",
    mentor_name: "Team lead",
    start_date: "2026-04-01",
  },
  apprenticeship: {
    stipend_amount: "18000",
    engagement_end_date: "2027-03-31",
    trade_name: "Software development",
    start_date: "2026-04-01",
  },
  contract: {
    professional_fees: "180000",
    engagement_end_date: "2026-12-31",
    payment_schedule: "Monthly, within 15 days of invoice",
    start_date: "2026-04-01",
  },
};

describe("engagement types", () => {
  it("covers every type with a rule", () => {
    for (const type of ENGAGEMENT_TYPES) {
      expect(ruleFor(type).type).toBe(type);
    }
  });

  it("recognises its own types and rejects others", () => {
    for (const type of ENGAGEMENT_TYPES) expect(isEngagementType(type)).toBe(true);
    expect(isEngagementType("permanent")).toBe(false);
    expect(isEngagementType("")).toBe(false);
    expect(isEngagementType("constructor")).toBe(false);
  });

  it("gives every type its own template", () => {
    const templates = ENGAGEMENT_TYPES.map((t) => ruleFor(t).templateType);
    expect(new Set(templates).size).toBe(templates.length);
  });

  it("accepts a well-formed offer of every type", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const result = validateOffer(offer(type, VALID[type]));
      expect(result.problems).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });
});

describe("statutory position", () => {
  it("applies the employment enactments to employees", () => {
    for (const type of ["full_time", "part_time"] as const) {
      const s = ruleFor(type).statutory;
      expect(s.providentFund).toBe(true);
      expect(s.employeeStateInsurance).toBe(true);
      expect(s.gratuity).toBe(true);
      expect(s.tdsSection).toBe("192");
    }
  });

  it("withholds them from trainees", () => {
    for (const type of ["internship", "apprenticeship"] as const) {
      const s = ruleFor(type).statutory;
      expect(s.providentFund).toBe(false);
      expect(s.employeeStateInsurance).toBe(false);
      expect(s.gratuity).toBe(false);
    }
  });

  it("taxes a contractor under 194J, not as salary", () => {
    const s = ruleFor("contract").statutory;
    expect(s.tdsSection).toBe("194J");
    expect(s.providentFund).toBe(false);
    expect(s.gratuity).toBe(false);
  });

  it("states the basis for every position, so it can be checked", () => {
    for (const type of ENGAGEMENT_TYPES) {
      expect(ruleFor(type).statutory.basis.length).toBeGreaterThan(40);
    }
  });

  it("allows PF to be extended voluntarily, and says that is what happened", () => {
    const position = statutoryFor({
      engagementType: "internship",
      values: VALID.internship,
      voluntaryBenefits: { providentFund: true },
    });

    expect(position.providentFund).toBe(true);
    expect(position.basis).toContain("voluntarily");
    expect(position.basis).toContain("not a statutory entitlement");
  });

  it("does not relabel a statutory entitlement as voluntary", () => {
    const position = statutoryFor({
      engagementType: "full_time",
      values: VALID.full_time,
      voluntaryBenefits: { providentFund: true },
    });

    expect(position.providentFund).toBe(true);
    expect(position.basis).not.toContain("voluntarily");
  });

  it("leaves the default position untouched without an override", () => {
    expect(statutoryFor(offer("internship", VALID.internship)).providentFund).toBe(false);
  });
});

describe("an offer cannot promise what the engagement cannot deliver", () => {
  it("refuses PF-bearing salary fields on an internship", () => {
    const result = validateOffer(
      offer("internship", { ...VALID.internship, annual_ctc: "600000", basic_salary: "240000" })
    );

    expect(result.valid).toBe(false);
    expect(result.problems.map((p) => p.field)).toEqual(
      expect.arrayContaining(["annual_ctc", "basic_salary"])
    );
  });

  it("refuses a stipend on a full-time offer", () => {
    const result = validateOffer(
      offer("full_time", { ...VALID.full_time, stipend_amount: "25000" })
    );

    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.field === "stipend_amount")).toBe(true);
  });

  it("refuses professional fees on an employment offer", () => {
    const result = validateOffer(
      offer("full_time", { ...VALID.full_time, professional_fees: "180000" })
    );

    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.field === "professional_fees")).toBe(true);
  });

  it("refuses probation where the engagement has none", () => {
    for (const type of ["internship", "apprenticeship", "contract"] as const) {
      const result = validateOffer(
        offer(type, { ...VALID[type], probation_period: "3 months" })
      );
      expect(result.valid).toBe(false);
      expect(result.problems.some((p) => p.field === "probation_period")).toBe(true);
    }
  });

  it("names the engagement in the message, so the fix is obvious", () => {
    const result = validateOffer(
      offer("internship", { ...VALID.internship, annual_ctc: "600000" })
    );
    const problem = result.problems.find((p) => p.field === "annual_ctc");
    expect(problem?.message).toContain("Internship");
  });
});

describe("fixed-term engagements", () => {
  it("requires an end date", () => {
    for (const type of ["internship", "apprenticeship", "contract"] as const) {
      const { engagement_end_date: _drop, ...rest } = VALID[type];
      const result = validateOffer(offer(type, rest));
      expect(result.valid).toBe(false);
      expect(result.problems.some((p) => p.field === "engagement_end_date")).toBe(true);
    }
  });

  it("does not require one of open-ended employment", () => {
    for (const type of ["full_time", "part_time"] as const) {
      expect(validateOffer(offer(type, VALID[type])).valid).toBe(true);
    }
  });

  it("rejects an end date on or before the start", () => {
    for (const end of ["2026-04-01", "2026-03-31"]) {
      const result = validateOffer(
        offer("internship", { ...VALID.internship, start_date: "2026-04-01", engagement_end_date: end })
      );
      expect(result.valid).toBe(false);
      expect(result.problems.some((p) => p.message.includes("end after it starts"))).toBe(true);
    }
  });

  it("accepts an end date one day after the start", () => {
    const result = validateOffer(
      offer("internship", {
        ...VALID.internship,
        start_date: "2026-04-01",
        engagement_end_date: "2026-04-02",
      })
    );
    expect(result.valid).toBe(true);
  });

  // Comparing ISO strings rather than Date objects avoids the trap that
  // `new Date("2026-03-01")` is UTC midnight, which is still February in IST.
  it("compares dates without a timezone shifting them", () => {
    const result = validateOffer(
      offer("contract", {
        ...VALID.contract,
        start_date: "2026-03-01",
        engagement_end_date: "2026-03-02",
      })
    );
    expect(result.valid).toBe(true);
  });

  it("rejects dates that are not ISO", () => {
    const result = validateOffer(
      offer("contract", { ...VALID.contract, engagement_end_date: "31/12/2026" })
    );
    expect(result.valid).toBe(false);
  });
});

describe("required fields", () => {
  it("reports every problem at once, not just the first", () => {
    const result = validateOffer(offer("full_time", { start_date: "2026-04-01" }));
    expect(result.problems.length).toBeGreaterThanOrEqual(4);
  });

  it("treats blank and whitespace as missing", () => {
    for (const blank of ["", "   ", "\t"]) {
      const result = validateOffer(
        offer("internship", { ...VALID.internship, stipend_amount: blank })
      );
      expect(result.valid).toBe(false);
      expect(result.problems.some((p) => p.field === "stipend_amount")).toBe(true);
    }
  });

  it("rejects an unknown engagement type without throwing", () => {
    const result = validateOffer({
      engagementType: "freelance" as EngagementType,
      values: {},
    });
    expect(result.valid).toBe(false);
    expect(result.problems[0].field).toBe("engagementType");
  });
});

describe("compensation basis", () => {
  it("maps each engagement to the token it states money in", () => {
    expect(compensationTokenFor("full_time")).toBe("annual_ctc");
    expect(compensationTokenFor("part_time")).toBe("monthly_salary");
    expect(compensationTokenFor("internship")).toBe("stipend_amount");
    expect(compensationTokenFor("apprenticeship")).toBe("stipend_amount");
    expect(compensationTokenFor("contract")).toBe("professional_fees");
  });

  it("requires the token it says it uses", () => {
    for (const type of ENGAGEMENT_TYPES) {
      expect(ruleFor(type).requiredTokens).toContain(compensationTokenFor(type));
    }
  });

  it("forbids every other engagement's compensation token", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const mine = compensationTokenFor(type);
      const others = ENGAGEMENT_TYPES.filter((t) => compensationTokenFor(t) !== mine).map(
        compensationTokenFor
      );

      for (const other of new Set(others)) {
        expect(ruleFor(type).forbiddenTokens).toContain(other);
      }
    }
  });
});

describe("token contract", () => {
  it("never lists a token as both required and forbidden", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const rule = ruleFor(type);
      for (const token of rule.requiredTokens) {
        expect(rule.forbiddenTokens).not.toContain(token);
      }
    }
  });

  it("keeps the common tokens out of the per-type lists", () => {
    for (const type of ENGAGEMENT_TYPES) {
      for (const common of COMMON_OFFER_TOKENS) {
        expect(ruleFor(type).forbiddenTokens).not.toContain(common);
      }
    }
  });

  it("gives every engagement a notice period, or none deliberately", () => {
    for (const type of ENGAGEMENT_TYPES) {
      expect(ruleFor(type).defaultNoticeDays).toBeGreaterThanOrEqual(0);
    }
  });
});
