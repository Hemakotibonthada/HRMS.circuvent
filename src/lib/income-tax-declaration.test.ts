// What a declaration is allowed to reduce, and what it is not.
//
// These are tax rules, so the tests are written as statements about the law
// rather than about the functions: a test that only says "returns 150000" does
// not tell the next person why, and the why is the part that changes with each
// Finance Act.

import { describe, expect, it } from "vitest";
import {
  DEDUCTION_SECTIONS,
  STANDARD_DEDUCTION,
  allowedDeductions,
  capFor80D,
  compareRegimes,
  formatRupees,
  hraExemption,
  outstandingProofs,
  sectionFor,
  validateDeclaration,
} from "@/lib/income-tax-declaration";

const OLD = { regime: "old" as const };
const NEW = { regime: "new" as const };

describe("the 80C ceiling", () => {
  it("caps a single claim at ₹1,50,000", () => {
    const { totalAllowedMinor } = allowedDeductions(
      [{ section: "80C", declaredMinor: 2_00_000_00n }],
      OLD
    );
    expect(totalAllowedMinor).toBe(1_50_000_00n);
  });

  it("is one ceiling across 80C, 80CCC and 80CCD(1), not three", () => {
    const { totalAllowedMinor } = allowedDeductions(
      [
        { section: "80C", declaredMinor: 1_50_000_00n },
        { section: "80CCC", declaredMinor: 1_50_000_00n },
        { section: "80CCD(1)", declaredMinor: 1_50_000_00n },
      ],
      OLD
    );
    expect(totalAllowedMinor).toBe(1_50_000_00n);
  });

  it("fills the ceiling in the order declared, and says why the rest fell away", () => {
    const { items } = allowedDeductions(
      [
        { section: "80C", declaredMinor: 1_00_000_00n },
        { section: "80CCD(1)", declaredMinor: 1_00_000_00n },
      ],
      OLD
    );
    expect(items[0].allowedMinor).toBe(1_00_000_00n);
    expect(items[1].allowedMinor).toBe(50_000_00n);
    expect(items[1].reason).toBe("over_shared_cap");
  });

  it("does not let 80CCD(1B) be swallowed by the 80C ceiling", () => {
    const { totalAllowedMinor } = allowedDeductions(
      [
        { section: "80C", declaredMinor: 1_50_000_00n },
        { section: "80CCD(1B)", declaredMinor: 50_000_00n },
      ],
      OLD
    );
    expect(totalAllowedMinor).toBe(2_00_000_00n);
  });
});

describe("the new regime", () => {
  it("allows almost nothing that was declared", () => {
    const { totalAllowedMinor } = allowedDeductions(
      [
        { section: "80C", declaredMinor: 1_50_000_00n },
        { section: "80D", declaredMinor: 25_000_00n },
        { section: "24B", declaredMinor: 2_00_000_00n },
      ],
      NEW
    );
    expect(totalAllowedMinor).toBe(0n);
  });

  it("says the reason is the regime, not a missing receipt", () => {
    const { items } = allowedDeductions([{ section: "80C", declaredMinor: 1_00_000_00n }], NEW);
    expect(items[0].reason).toBe("not_allowed_in_new_regime");
  });

  it("keeps the employer's NPS contribution, which is the point of 80CCD(2)", () => {
    const { totalAllowedMinor } = allowedDeductions(
      [{ section: "80CCD(2)", declaredMinor: 80_000_00n }],
      NEW
    );
    expect(totalAllowedMinor).toBe(80_000_00n);
  });

  it("gives a larger standard deduction than the old regime", () => {
    expect(STANDARD_DEDUCTION.new).toBeGreaterThan(STANDARD_DEDUCTION.old);
    expect(STANDARD_DEDUCTION.new).toBe(75_000_00n);
    expect(STANDARD_DEDUCTION.old).toBe(50_000_00n);
  });
});

describe("80D, which is two allowances rather than one", () => {
  it("is ₹50,000 for a family with no senior citizens", () => {
    expect(capFor80D({})).toBe(50_000_00n);
  });

  it("rises when the employee's own cover includes a senior citizen", () => {
    expect(capFor80D({ selfOrFamilyIsSenior: true })).toBe(75_000_00n);
  });

  it("reaches ₹1,00,000 only when both halves are senior", () => {
    expect(capFor80D({ selfOrFamilyIsSenior: true, parentsAreSenior: true })).toBe(1_00_000_00n);
  });

  it("caps the claim at the circumstances, not at the headline figure", () => {
    const { totalAllowedMinor } = allowedDeductions(
      [{ section: "80D", declaredMinor: 1_00_000_00n }],
      { regime: "old" }
    );
    expect(totalAllowedMinor).toBe(50_000_00n);
  });
});

describe("80TTA and 80TTB", () => {
  it("cannot both be claimed", () => {
    const problems = validateDeclaration(
      [
        { section: "80TTA", declaredMinor: 10_000_00n },
        { section: "80TTB", declaredMinor: 50_000_00n },
      ],
      OLD
    );
    expect(problems.some((p) => /cannot both be claimed/.test(p.message))).toBe(true);
  });

  it("keeps the larger of the two rather than refusing both", () => {
    const { items, totalAllowedMinor } = allowedDeductions(
      [
        { section: "80TTA", declaredMinor: 10_000_00n },
        { section: "80TTB", declaredMinor: 50_000_00n },
      ],
      OLD
    );
    expect(totalAllowedMinor).toBe(50_000_00n);
    expect(items.find((i) => i.section === "80TTA")?.reason).toBe("excluded_by_other_section");
  });
});

describe("proof", () => {
  it("does not withhold a deduction while the window is still open", () => {
    const { totalAllowedMinor } = allowedDeductions(
      [{ section: "80C", declaredMinor: 1_00_000_00n, proofStatus: "awaiting" }],
      OLD
    );
    expect(totalAllowedMinor).toBe(1_00_000_00n);
  });

  it("withdraws an unproven deduction once the window shuts", () => {
    const { items, totalAllowedMinor } = allowedDeductions(
      [{ section: "80C", declaredMinor: 1_00_000_00n, proofStatus: "awaiting" }],
      { regime: "old", proofWindowClosed: true }
    );
    expect(totalAllowedMinor).toBe(0n);
    expect(items[0].reason).toBe("proof_missing");
  });

  it("keeps a deduction whose proof was accepted", () => {
    const { totalAllowedMinor } = allowedDeductions(
      [{ section: "80C", declaredMinor: 1_00_000_00n, proofStatus: "accepted" }],
      { regime: "old", proofWindowClosed: true }
    );
    expect(totalAllowedMinor).toBe(1_00_000_00n);
  });

  it("does not ask for evidence of the employer's own NPS contribution", () => {
    expect(sectionFor("80CCD(2)")?.requiresProof).toBe(false);
    const outstanding = outstandingProofs([
      { section: "80CCD(2)", declaredMinor: 50_000_00n },
      { section: "80C", declaredMinor: 50_000_00n },
    ]);
    expect(outstanding).toEqual(["80C"]);
  });

  it("does not chase proof for a claim the regime already refused", () => {
    const { items } = allowedDeductions([{ section: "80C", declaredMinor: 1_00_000_00n }], {
      regime: "new",
      proofWindowClosed: true,
    });
    expect(items[0].reason).toBe("not_allowed_in_new_regime");
  });
});

describe("HRA exemption", () => {
  const base = {
    basicPlusDaMinor: 6_00_000_00n,
    hraReceivedMinor: 3_00_000_00n,
    rentPaidMinor: 3_60_000_00n,
  };

  it("is the least of the three limbs", () => {
    // HRA received 3,00,000; rent less 10% of basic = 3,00,000; 50% of basic
    // = 3,00,000. All three coincide here.
    expect(hraExemption({ ...base, metroCity: true, regime: "old" })).toBe(3_00_000_00n);
  });

  it("is smaller outside a metro, where the limb is 40% rather than 50%", () => {
    expect(hraExemption({ ...base, metroCity: false, regime: "old" })).toBe(2_40_000_00n);
  });

  it("is nothing when the rent is below a tenth of basic pay", () => {
    expect(
      hraExemption({ ...base, rentPaidMinor: 30_000_00n, metroCity: true, regime: "old" })
    ).toBe(0n);
  });

  it("is never negative", () => {
    expect(
      hraExemption({ ...base, rentPaidMinor: 0n, metroCity: false, regime: "old" })
    ).toBe(0n);
  });

  it("does not exist under the new regime", () => {
    expect(hraExemption({ ...base, metroCity: true, regime: "new" })).toBe(0n);
  });
});

describe("choosing a regime", () => {
  it("prefers the new regime for someone who declares nothing", () => {
    const result = compareRegimes({ grossIncomeMinor: 12_00_000_00n, items: [] });
    expect(result.better).toBe("new");
    expect(result.new.tax.totalTaxMinor).toBeLessThan(result.old.tax.totalTaxMinor);
  });

  it("buys nothing with deductions below the new regime's rebate threshold", () => {
    // The Finance Act 2025 rebate wipes out tax entirely up to ₹12,00,000 of
    // taxable income. This employee has invested ₹4,50,000 to save tax under
    // the old regime and still owes something, while the new regime asks for
    // nothing from someone who invested not a rupee. It is the most common
    // piece of bad advice in Indian salary planning, and the comparison screen
    // exists to settle it with a figure.
    const result = compareRegimes({
      grossIncomeMinor: 12_00_000_00n,
      items: [
        { section: "80C", declaredMinor: 1_50_000_00n },
        { section: "80CCD(1B)", declaredMinor: 50_000_00n },
        { section: "80D", declaredMinor: 50_000_00n },
        { section: "24B", declaredMinor: 2_00_000_00n },
      ],
    });
    expect(result.new.tax.totalTaxMinor).toBe(0n);
    expect(result.old.tax.totalTaxMinor).toBeGreaterThan(0n);
    expect(result.better).toBe("new");
  });

  it("prefers the old regime higher up, where the rebate no longer reaches", () => {
    const result = compareRegimes({
      grossIncomeMinor: 25_00_000_00n,
      items: [
        { section: "80C", declaredMinor: 1_50_000_00n },
        { section: "80CCD(1B)", declaredMinor: 50_000_00n },
        { section: "80D", declaredMinor: 50_000_00n },
        { section: "24B", declaredMinor: 2_00_000_00n },
      ],
      hra: {
        basicPlusDaMinor: 12_00_000_00n,
        hraReceivedMinor: 6_00_000_00n,
        rentPaidMinor: 7_20_000_00n,
        metroCity: true,
      },
    });
    expect(result.better).toBe("old");
    expect(result.savingMinor).toBeGreaterThan(0n);
  });

  it("reports a saving that is the difference between the two", () => {
    const result = compareRegimes({ grossIncomeMinor: 20_00_000_00n, items: [] });
    const diff =
      result.old.tax.totalTaxMinor > result.new.tax.totalTaxMinor
        ? result.old.tax.totalTaxMinor - result.new.tax.totalTaxMinor
        : result.new.tax.totalTaxMinor - result.old.tax.totalTaxMinor;
    expect(result.savingMinor).toBe(diff);
  });

  it("ignores declared investments when costing the new regime", () => {
    const withClaims = compareRegimes({
      grossIncomeMinor: 15_00_000_00n,
      items: [{ section: "80C", declaredMinor: 1_50_000_00n }],
    });
    const without = compareRegimes({ grossIncomeMinor: 15_00_000_00n, items: [] });
    expect(withClaims.new.tax.totalTaxMinor).toBe(without.new.tax.totalTaxMinor);
    expect(withClaims.old.tax.totalTaxMinor).toBeLessThan(without.old.tax.totalTaxMinor);
  });

  it("never produces a negative taxable income", () => {
    const result = compareRegimes({
      grossIncomeMinor: 1_00_000_00n,
      items: [{ section: "80C", declaredMinor: 1_50_000_00n }],
    });
    expect(result.old.taxableIncomeMinor).toBe(0n);
    expect(result.old.tax.totalTaxMinor).toBe(0n);
  });
});

describe("what the employee is told is wrong", () => {
  it("names the section and both figures when a cap is exceeded", () => {
    const [problem] = validateDeclaration(
      [{ section: "80C", declaredMinor: 2_00_000_00n }],
      OLD
    );
    expect(problem.message).toContain("80C");
    expect(problem.message).toContain("₹1,50,000");
    expect(problem.message).toContain("₹2,00,000");
  });

  it("reports the shared ceiling as one problem, not three", () => {
    const problems = validateDeclaration(
      [
        { section: "80C", declaredMinor: 1_00_000_00n },
        { section: "80CCC", declaredMinor: 1_00_000_00n },
      ],
      OLD
    );
    expect(problems.filter((p) => /share one limit/.test(p.message))).toHaveLength(1);
  });

  it("rejects a section the form does not know", () => {
    const [problem] = validateDeclaration([{ section: "80ZZ", declaredMinor: 1_00n }], OLD);
    expect(problem.message).toContain("not a section this form knows");
  });

  it("rejects a negative amount", () => {
    const problems = validateDeclaration([{ section: "80C", declaredMinor: -1_00n }], OLD);
    expect(problems.some((p) => /negative/.test(p.message))).toBe(true);
  });

  it("notices the same section claimed twice", () => {
    const problems = validateDeclaration(
      [
        { section: "80C", declaredMinor: 1_00n },
        { section: "80C", declaredMinor: 1_00n },
      ],
      OLD
    );
    expect(problems.some((p) => /more than once/.test(p.message))).toBe(true);
  });

  it("warns that a declaration buys nothing under the new regime", () => {
    const problems = validateDeclaration([{ section: "80C", declaredMinor: 1_00_000_00n }], NEW);
    expect(problems.some((p) => /does not reduce tax under the new regime/.test(p.message))).toBe(true);
  });

  it("returns every problem at once rather than the first", () => {
    const problems = validateDeclaration(
      [
        { section: "80C", declaredMinor: 2_00_000_00n },
        { section: "80ZZ", declaredMinor: 1_00n },
      ],
      OLD
    );
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts a declaration that is within every limit", () => {
    expect(
      validateDeclaration(
        [
          { section: "80C", declaredMinor: 1_50_000_00n },
          { section: "80CCD(1B)", declaredMinor: 50_000_00n },
        ],
        OLD
      )
    ).toEqual([]);
  });
});

describe("money as an Indian reader expects it", () => {
  it("groups the last three digits, then in pairs", () => {
    expect(formatRupees(1_50_000_00n)).toBe("₹1,50,000");
    expect(formatRupees(10_000_00n)).toBe("₹10,000");
    expect(formatRupees(1_00_00_000_00n)).toBe("₹1,00,00,000");
  });

  it("leaves small amounts alone", () => {
    expect(formatRupees(500_00n)).toBe("₹500");
  });
});

describe("the section catalogue itself", () => {
  it("has no duplicate codes", () => {
    const codes = DEDUCTION_SECTIONS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every section a note, since a bare code helps nobody", () => {
    for (const s of DEDUCTION_SECTIONS) expect(s.note.length).toBeGreaterThan(10);
  });

  it("keeps the new regime to the two things it actually allows", () => {
    const allowed = DEDUCTION_SECTIONS.filter((s) => s.allowedInNewRegime).map((s) => s.code);
    expect(allowed).toEqual(["80CCD(2)"]);
  });

  it("never caps a section at zero, which would be a section not worth listing", () => {
    for (const s of DEDUCTION_SECTIONS) {
      if (s.capMinor !== null) expect(s.capMinor).toBeGreaterThan(0n);
    }
  });
});
