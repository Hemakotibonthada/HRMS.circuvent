// A letter that states the wrong figure is not a display bug — somebody takes
// it to a bank. So the arithmetic and the wording are pinned here, including
// the cases that are easy to get wrong: a very large salary, a cut, a first
// record with nothing to compare against, and a date near midnight.

import { describe, expect, it } from "vitest";

import {
  compensationLetterTitle,
  compensationLetterTokens,
  describeChange,
  formatLetterDate,
  formatMinorAsCurrency,
  type PayChange,
} from "@/lib/compensation-letter";

function change(over: Partial<PayChange> = {}): PayChange {
  return {
    previousSalaryMinor: 120_000_000n, // ₹12,00,000
    newSalaryMinor: 132_000_000n, // ₹13,20,000
    changePercent: "10.00",
    currency: "INR",
    reason: "merit_increase",
    effectiveOn: "2026-04-01",
    ...over,
  };
}

describe("formatting money held in minor units", () => {
  it("groups by the Indian convention", () => {
    expect(formatMinorAsCurrency(120_000_000n)).toBe("₹12,00,000");
    expect(formatMinorAsCurrency(100_000n)).toBe("₹1,000");
    // 10,000,000,000 paise is ten crore rupees, not one — last three digits,
    // then pairs.
    expect(formatMinorAsCurrency(10_000_000_000n)).toBe("₹10,00,00,000");
    expect(formatMinorAsCurrency(1_000_000_000n)).toBe("₹1,00,00,000");
  });

  it("keeps large salaries exact", () => {
    // The reason this takes a bigint at all: a Number of paise stops being
    // exact past Number.MAX_SAFE_INTEGER, and this is one paisa above it.
    // Passing it through a Number would round it to something ending 4740992.
    expect(formatMinorAsCurrency(9_007_199_254_740_993n)).toBe("₹9,00,71,99,25,47,409");
  });

  it("accepts a string, because that is how a bigint survives JSON", () => {
    expect(formatMinorAsCurrency("132000000")).toBe("₹13,20,000");
  });

  it("renders nothing as an em dash rather than zero", () => {
    // "₹0" on a letter is a claim. "—" is an absence, which is what it is.
    for (const value of [null, undefined, ""]) {
      expect(formatMinorAsCurrency(value)).toBe("—");
    }
  });

  it("does not crash on something that is not a number", () => {
    expect(formatMinorAsCurrency("not-a-number")).toBe("—");
  });

  it("names a non-rupee currency rather than pretending it is rupees", () => {
    expect(formatMinorAsCurrency(100_000n, "USD")).toBe("USD 1,000");
  });

  it("keeps a negative figure negative", () => {
    expect(formatMinorAsCurrency(-100_000n)).toBe("-₹1,000");
  });
});

describe("dates on a letter", () => {
  it("renders a plain date without moving it", () => {
    // `new Date("2026-04-01")` is UTC midnight, which prints as 31 March for
    // anybody west of UTC. A letter that says the revision takes effect a day
    // earlier than it does is a payroll dispute.
    expect(formatLetterDate("2026-04-01")).toBe("1 April 2026");
    expect(formatLetterDate("2026-12-31")).toBe("31 December 2026");
  });

  it("accepts a Date and reads its calendar parts", () => {
    expect(formatLetterDate(new Date(2026, 3, 1))).toBe("1 April 2026");
  });

  it("refuses to invent a date", () => {
    expect(formatLetterDate("nonsense")).toBe("—");
    expect(formatLetterDate(new Date("nonsense"))).toBe("—");
  });
});

describe("describing the change", () => {
  it("states the amount and the percentage together", () => {
    // The percentage is what people remember from the review; the amount is
    // what they can check against a payslip.
    expect(describeChange(change())).toBe("₹1,20,000 increase (10.00%)");
  });

  it("calls a cut a decrease", () => {
    // Dressing a cut as "a revision of -8%" is how somebody stops trusting
    // every other number on the page.
    const cut = change({
      previousSalaryMinor: 132_000_000n,
      newSalaryMinor: 120_000_000n,
      changePercent: "-9.09",
    });
    expect(describeChange(cut)).toBe("₹1,20,000 decrease (9.09%)");
  });

  it("handles a first record with nothing to compare against", () => {
    expect(describeChange(change({ previousSalaryMinor: null }))).toBe("Newly recorded");
  });

  it("says so when the figure did not move", () => {
    // A revision that changes the structure but not the total is a real thing,
    // and "₹0 increase" reads like a mistake.
    const flat = change({ newSalaryMinor: 120_000_000n, changePercent: "0.00" });
    expect(describeChange(flat)).toBe("No change to the annual figure");
  });

  it("still describes the change when no percentage was recorded", () => {
    expect(describeChange(change({ changePercent: null }))).toBe("₹1,20,000 increase");
  });
});

describe("the tokens the template is filled with", () => {
  it("supplies every token the letter uses", () => {
    const tokens = compensationLetterTokens(change());
    expect(tokens).toEqual({
      previous_ctc: "₹12,00,000",
      revised_ctc: "₹13,20,000",
      change_summary: "₹1,20,000 increase (10.00%)",
      effective_date: "1 April 2026",
      revision_reason: "Annual merit revision",
    });
  });

  it("words the reasons the compensation cycle actually writes", () => {
    // `apply()` writes exactly these two, so these two must not read as raw
    // database codes on a letter somebody receives.
    expect(compensationLetterTokens(change({ reason: "merit_increase" })).revision_reason).toBe(
      "Annual merit revision"
    );
    expect(compensationLetterTokens(change({ reason: "promotion" })).revision_reason).toBe(
      "Promotion"
    );
  });

  it("makes an unrecognised reason readable rather than hiding it", () => {
    // A reason somebody typed by hand is more informative than the word
    // "Revision", so it is tidied rather than replaced.
    expect(
      compensationLetterTokens(change({ reason: "market_adjustment_q3" })).revision_reason
    ).toBe("Market adjustment q3");
  });

  it("falls back to a word rather than leaving the token blank", () => {
    // An empty token renders as an empty cell in a legal document.
    expect(compensationLetterTokens(change({ reason: "" })).revision_reason).toBe("Revision");
  });
});

describe("the title an employee sees in their list", () => {
  it("names the effective date, because that is what distinguishes two of them", () => {
    expect(compensationLetterTitle(change())).toBe(
      "Compensation revision — effective 1 April 2026"
    );
  });
});
