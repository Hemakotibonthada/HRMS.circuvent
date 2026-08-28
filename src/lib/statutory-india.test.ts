// @vitest-environment node
//
// This is the highest-consequence arithmetic in the system. Under-deducting PF
// leaves the employer liable for both halves plus interest and damages;
// over-deducting takes money from someone's salary they are entitled to. The
// figures are filed with the government, so these tests pin exact amounts
// rather than approximate behaviour.

import { describe, expect, it } from "vitest";
import {
  ESI_CONFIG_2025,
  OLD_REGIME_SLABS,
  PF_CONFIG_2025,
  calculateEsi,
  calculateGratuity,
  calculateIncomeTax,
  calculateLwf,
  calculatePf,
  calculateProfessionalTax,
  esiContributionPeriod,
  financialYear,
  monthlyTds,
  monthsBetween,
  toWholeRupees,
} from "@/lib/statutory-india";

describe("toWholeRupees", () => {
  it("rounds half up, as EPFO and the Income Tax Department both do", () => {
    expect(toWholeRupees(100_50n)).toBe(101_00n);
    expect(toWholeRupees(100_49n)).toBe(100_00n);
  });

  it("leaves whole rupees alone", () => {
    expect(toWholeRupees(100_00n)).toBe(100_00n);
  });
});

describe("calculatePf", () => {
  it("caps contributions at the statutory wage ceiling", () => {
    // ₹50,000 basic, but PF is on ₹15,000: 12% is ₹1,800.
    const result = calculatePf(50_000_00n);
    expect(result.pfWagesMinor).toBe(15_000_00n);
    expect(result.employeeContributionMinor).toBe(1_800_00n);
  });

  it("computes on actual wages below the ceiling", () => {
    const result = calculatePf(12_000_00n);
    expect(result.pfWagesMinor).toBe(12_000_00n);
    expect(result.employeeContributionMinor).toBe(1_440_00n);
  });

  it("splits the employer share between PF and pension", () => {
    // 8.33% of ₹15,000 is ₹1,249.50, rounding to ₹1,250; the remaining ₹550
    // goes to PF.
    const result = calculatePf(15_000_00n);
    expect(result.employerPensionMinor).toBe(1_250_00n);
    expect(result.employerPfMinor).toBe(550_00n);
    expect(result.employerPensionMinor + result.employerPfMinor).toBe(1_800_00n);
  });

  it("caps the pension share even when contributing on full wages", () => {
    // The detail most implementations get wrong: PF on ₹50,000 but EPS still
    // only on ₹15,000.
    const result = calculatePf(50_000_00n, {
      ...PF_CONFIG_2025,
      contributeOnFullWages: true,
    });

    expect(result.pfWagesMinor).toBe(50_000_00n);
    expect(result.employerPensionMinor).toBe(1_250_00n);
    expect(result.employerPfMinor).toBe(6_000_00n - 1_250_00n);
  });

  it("has no pension ceiling for an international worker", () => {
    const result = calculatePf(50_000_00n, PF_CONFIG_2025, {
      isInternationalWorker: true,
    });
    expect(result.pfWagesMinor).toBe(50_000_00n);
    expect(result.employerPensionMinor).toBeGreaterThan(1_250_00n);
  });

  it("applies the ₹500 minimum administrative charge", () => {
    // 0.5% of ₹10,000 is ₹50; the minimum is ₹500. Applying the percentage
    // alone under-charges every small employer, and the shortfall is
    // recovered with damages at inspection.
    expect(calculatePf(10_000_00n).adminChargeMinor).toBe(500_00n);
  });

  it("charges the percentage once it exceeds the minimum", () => {
    // 0.5% of ₹2,00,000 is ₹1,000.
    const result = calculatePf(2_00_000_00n, {
      ...PF_CONFIG_2025,
      contributeOnFullWages: true,
    });
    expect(result.adminChargeMinor).toBe(1_000_00n);
  });

  it("totals the employer cost including admin and EDLI", () => {
    const result = calculatePf(15_000_00n);
    expect(result.totalEmployerCostMinor).toBe(
      1_800_00n + result.adminChargeMinor + result.edliMinor
    );
  });

  it("returns nothing for an exempted trust", () => {
    const result = calculatePf(15_000_00n, PF_CONFIG_2025, { hasExemption: true });
    expect(result.isExempt).toBe(true);
    expect(result.employeeContributionMinor).toBe(0n);
    expect(result.exemptionReason).toMatch(/exempted trust/);
  });

  it("returns nothing for zero wages", () => {
    expect(calculatePf(0n).employeeContributionMinor).toBe(0n);
  });

  it("rounds contributions to whole rupees, as the return requires", () => {
    const result = calculatePf(12_345_00n);
    expect(result.employeeContributionMinor % 100n).toBe(0n);
    expect(result.employerPensionMinor % 100n).toBe(0n);
  });
});

describe("calculateEsi", () => {
  it("applies below the ceiling", () => {
    // ₹20,000 gross: 0.75% is ₹150, 3.25% is ₹650.
    const result = calculateEsi(20_000_00n);
    expect(result.isApplicable).toBe(true);
    expect(result.employeeContributionMinor).toBe(150_00n);
    expect(result.employerContributionMinor).toBe(650_00n);
  });

  it("does not apply above the ceiling for a new joiner", () => {
    const result = calculateEsi(25_000_00n);
    expect(result.isApplicable).toBe(false);
    expect(result.reason).toMatch(/exceeds the ESI ceiling/);
  });

  it("continues to the end of the period after crossing mid-period", () => {
    // Cover must not be lost partway through a claim.
    const result = calculateEsi(25_000_00n, ESI_CONFIG_2025, {
      wasContributingAtPeriodStart: true,
    });
    expect(result.isApplicable).toBe(true);
    expect(result.reason).toMatch(/end of the contribution period/);
  });

  it("contributes on actual wages when continuing, not the capped figure", () => {
    // Capping would under-report to ESIC.
    const result = calculateEsi(25_000_00n, ESI_CONFIG_2025, {
      wasContributingAtPeriodStart: true,
    });
    expect(result.esiWagesMinor).toBe(25_000_00n);
  });

  it("uses the higher ceiling for a person with a disability", () => {
    expect(calculateEsi(23_000_00n, ESI_CONFIG_2025, { hasDisability: true }).isApplicable).toBe(
      true
    );
    expect(calculateEsi(23_000_00n).isApplicable).toBe(false);
  });

  it("is computed on gross, unlike PF which is on basic", () => {
    // The two most commonly confused bases in Indian payroll.
    const result = calculateEsi(21_000_00n);
    expect(result.esiWagesMinor).toBe(21_000_00n);
  });

  it("treats the ceiling itself as within scope", () => {
    expect(calculateEsi(21_000_00n).isApplicable).toBe(true);
  });

  it("returns nothing for zero wages", () => {
    expect(calculateEsi(0n).isApplicable).toBe(false);
  });
});

describe("esiContributionPeriod", () => {
  it("identifies the April to September period", () => {
    expect(esiContributionPeriod("2026-06-15")).toMatchObject({
      period: "apr_sep",
      startsOn: "2026-04-01",
      endsOn: "2026-09-30",
    });
  });

  it("identifies the October to March period", () => {
    expect(esiContributionPeriod("2026-11-15")).toMatchObject({
      period: "oct_mar",
      startsOn: "2026-10-01",
      endsOn: "2027-03-31",
    });
  });

  it("puts January in the period that began the previous October", () => {
    // It spans a year boundary, which is where off-by-one errors live.
    expect(esiContributionPeriod("2027-01-15")).toMatchObject({
      startsOn: "2026-10-01",
      endsOn: "2027-03-31",
    });
  });

  it("rejects a malformed date", () => {
    expect(() => esiContributionPeriod("June 2026")).toThrow(/YYYY-MM-DD/);
  });
});

describe("calculateProfessionalTax", () => {
  it("applies Karnataka's slab", () => {
    // Karnataka's notification reads "not less than ₹25,000", so the boundary
    // itself is taxable.
    expect(calculateProfessionalTax(30_000_00n, "KA").amountMinor).toBe(200_00n);
    expect(calculateProfessionalTax(25_000_00n, "KA").amountMinor).toBe(200_00n);
    expect(calculateProfessionalTax(24_999_00n, "KA").amountMinor).toBe(0n);
  });

  it("exempts Maharashtra at exactly ₹7,500, unlike Karnataka at its boundary", () => {
    // "Exceeds ₹7,500 but does not exceed ₹10,000" — so ₹7,500 is nil. The
    // two states word their notifications differently and cannot share one
    // boundary convention.
    expect(calculateProfessionalTax(7_500_00n, "MH", 3).amountMinor).toBe(0n);
    expect(calculateProfessionalTax(7_500_01n, "MH", 3).amountMinor).toBe(175_00n);
    expect(calculateProfessionalTax(10_000_00n, "MH", 3).amountMinor).toBe(175_00n);
    expect(calculateProfessionalTax(10_000_01n, "MH", 3).amountMinor).toBe(200_00n);
  });

  it("applies Tamil Nadu's graduated slabs", () => {
    expect(calculateProfessionalTax(25_000_00n, "TN").amountMinor).toBe(135_00n);
    expect(calculateProfessionalTax(80_000_00n, "TN").amountMinor).toBe(1_250_00n);
  });

  it("charges Maharashtra's higher February rate", () => {
    // ₹300 in February brings the annual total to the ₹2,500 maximum. Missing
    // it under-deducts ₹100 a year for every employee in the state.
    expect(calculateProfessionalTax(50_000_00n, "MH", 2).amountMinor).toBe(300_00n);
    expect(calculateProfessionalTax(50_000_00n, "MH", 3).amountMinor).toBe(200_00n);
  });

  it("returns zero for a state that levies none", () => {
    const result = calculateProfessionalTax(1_00_000_00n, "DL");
    expect(result.amountMinor).toBe(0n);
    expect(result.isLevied).toBe(false);
  });

  it("flags an unconfigured state rather than silently deducting nothing", () => {
    // A zero identical to "this state has no PT" is how a missing
    // configuration survives to the first assessment notice.
    const result = calculateProfessionalTax(50_000_00n, "ZZ");
    expect(result.amountMinor).toBe(0n);
    expect(result.note).toMatch(/No professional tax slabs configured/);
  });

  it("is case- and whitespace-insensitive about the state code", () => {
    expect(calculateProfessionalTax(30_000_00n, " ka ").amountMinor).toBe(200_00n);
  });

  it("treats a slab boundary as the start of the higher band", () => {
    expect(calculateProfessionalTax(25_000_00n, "KA").amountMinor).toBe(200_00n);
  });});

describe("calculateGratuity", () => {
  it("refuses below five completed years", () => {
    const result = calculateGratuity(50_000_00n, "2022-01-01", "2026-01-01");
    expect(result.isEligible).toBe(false);
    expect(result.reason).toMatch(/requires 5/);
  });

  it("waives the five-year rule on death or disablement", () => {
    const result = calculateGratuity(50_000_00n, "2024-01-01", "2026-01-01", {
      isDeathOrDisablement: true,
    });
    expect(result.isEligible).toBe(true);
  });

  it("uses 26 working days, not 30 calendar days", () => {
    // Using 30 understates every payment by about 13%.
    // 50,000 × 15 ÷ 26 × 10 = 2,88,461.54
    const result = calculateGratuity(50_000_00n, "2016-01-01", "2026-01-01");
    expect(result.amountMinor).toBe((50_000_00n * 15n * 10n) / 26n);
  });

  it("rounds a part-year over six months up to a full year", () => {
    // Truncating instead costs a long-serving employee a whole year's
    // gratuity.
    const sevenMonths = calculateGratuity(50_000_00n, "2016-01-01", "2026-08-01");
    const fiveMonths = calculateGratuity(50_000_00n, "2016-01-01", "2026-06-01");

    expect(sevenMonths.yearsOfService).toBe(11);
    expect(fiveMonths.yearsOfService).toBe(10);
  });

  it("caps the exempt amount without reducing the entitlement", () => {
    // The ceiling is on the tax exemption, not on what is payable.
    const result = calculateGratuity(5_00_000_00n, "1996-01-01", "2026-01-01");
    expect(result.amountMinor).toBeGreaterThan(20_00_000_00n);
    expect(result.cappedAmountMinor).toBe(20_00_000_00n);
  });

  it("refuses an exit before the join date", () => {
    expect(() => calculateGratuity(50_000_00n, "2026-01-01", "2020-01-01")).toThrow(
      /cannot precede/
    );
  });
});

describe("calculateIncomeTax", () => {
  it("taxes slabs marginally, not at a single rate", () => {
    // Applying one rate to the whole amount overstates tax by tens of
    // thousands of rupees.
    // ₹10,00,000: nil on 4L, 5% on 4L = 20,000, 10% on 2L = 20,000.
    const result = calculateIncomeTax(10_00_000_00n);
    expect(result.slabTaxMinor).toBe(40_000_00n);
  });

  it("applies the section 87A rebate below the threshold", () => {
    const result = calculateIncomeTax(11_00_000_00n);
    expect(result.totalTaxMinor).toBe(0n);
    expect(result.rebateMinor).toBeGreaterThan(0n);
  });

  it("produces the cliff at the rebate threshold", () => {
    // Someone on ₹11,90,000 pays nothing and someone on ₹12,10,000 pays a
    // great deal. That is the law, not a bug.
    const below = calculateIncomeTax(11_90_000_00n);
    const above = calculateIncomeTax(12_10_000_00n);

    expect(below.totalTaxMinor).toBe(0n);
    expect(above.totalTaxMinor).toBeGreaterThan(0n);
  });

  it("adds 4% health and education cess", () => {
    const result = calculateIncomeTax(20_00_000_00n);
    const expectedCess = (result.slabTaxMinor - result.rebateMinor) * 4n / 100n;
    expect(result.cessMinor).toBeGreaterThanOrEqual(expectedCess - 1n);
  });

  it("applies surcharge above fifty lakh", () => {
    const result = calculateIncomeTax(60_00_000_00n);
    expect(result.surchargeMinor).toBeGreaterThan(0n);
  });

  it("does not apply surcharge below the threshold", () => {
    expect(calculateIncomeTax(40_00_000_00n).surchargeMinor).toBe(0n);
  });

  it("uses the highest applicable surcharge band", () => {
    const high = calculateIncomeTax(3_00_00_000_00n);
    const mid = calculateIncomeTax(60_00_000_00n);
    expect(high.effectiveRate).toBeGreaterThan(mid.effectiveRate);
  });

  it("supports the old regime slabs", () => {
    // ₹10,00,000 old regime: 5% on 2.5L = 12,500, 20% on 5L = 1,00,000.
    const result = calculateIncomeTax(10_00_000_00n, {
      slabs: OLD_REGIME_SLABS,
      rebateThresholdMinor: 5_00_000_00n,
      rebateCapMinor: 12_500_00n,
    });
    expect(result.slabTaxMinor).toBe(1_12_500_00n);
  });

  it("returns zero for no income", () => {
    expect(calculateIncomeTax(0n).totalTaxMinor).toBe(0n);
    expect(calculateIncomeTax(-100n).totalTaxMinor).toBe(0n);
  });

  it("reports an effective rate below the marginal rate", () => {
    const result = calculateIncomeTax(30_00_000_00n);
    expect(result.effectiveRate).toBeLessThan(30);
    expect(result.effectiveRate).toBeGreaterThan(0);
  });
});

describe("monthlyTds", () => {
  it("spreads the outstanding tax over the months remaining", () => {
    expect(monthlyTds(1_20_000_00n, 0n, 12)).toBe(10_000_00n);
  });

  it("accounts for tax already deducted", () => {
    // Dividing the annual figure by twelve regardless leaves a large catch-up
    // in March, which is the complaint every payroll team gets every year.
    expect(monthlyTds(1_20_000_00n, 60_000_00n, 6)).toBe(10_000_00n);
  });

  it("deducts the whole balance in the final month", () => {
    expect(monthlyTds(1_20_000_00n, 1_10_000_00n, 1)).toBe(10_000_00n);
  });

  it("returns nothing when enough has already been deducted", () => {
    expect(monthlyTds(1_00_000_00n, 1_20_000_00n, 3)).toBe(0n);
  });

  it("returns the whole balance when no months remain", () => {
    expect(monthlyTds(1_00_000_00n, 40_000_00n, 0)).toBe(60_000_00n);
  });
});

describe("calculateLwf", () => {
  it("deducts in the month the state collects", () => {
    expect(calculateLwf("KA", 12).employeeMinor).toBe(20_00n);
    expect(calculateLwf("KA", 6).isLevied).toBe(false);
  });

  it("handles a twice-yearly state", () => {
    expect(calculateLwf("MH", 6).isLevied).toBe(true);
    expect(calculateLwf("MH", 12).isLevied).toBe(true);
    expect(calculateLwf("MH", 7).isLevied).toBe(false);
  });

  it("handles a monthly state", () => {
    expect(calculateLwf("HR", 4).isLevied).toBe(true);
  });

  it("returns nothing for a state with no fund", () => {
    expect(calculateLwf("ZZ", 12).isLevied).toBe(false);
  });
});

describe("financialYear", () => {
  it("runs April to March", () => {
    expect(financialYear("2025-04-01")).toBe("2025-26");
    expect(financialYear("2026-03-31")).toBe("2025-26");
  });

  it("puts January in the year that began the previous April", () => {
    expect(financialYear("2026-01-15")).toBe("2025-26");
  });

  it("rolls over on 1 April", () => {
    expect(financialYear("2026-04-01")).toBe("2026-27");
  });

  it("rejects a malformed date", () => {
    expect(() => financialYear("April 2026")).toThrow(/YYYY-MM-DD/);
  });
});

describe("monthsBetween", () => {
  it("does not count a month until the day is reached", () => {
    expect(monthsBetween("2026-01-15", "2026-02-14")).toBe(0);
    expect(monthsBetween("2026-01-15", "2026-02-15")).toBe(1);
  });
});
