// Full and final settlement.
//
// The cases below are the ones that cost money in either direction: a gratuity
// that should not have been paid, a notice recovery taken from an estate, an
// encashment exemption still using the pre-2023 ceiling, and a net that ought
// to be negative and was quietly clamped to zero.

import { describe, expect, it } from "vitest";
import {
  computeSettlement,
  gratuityExemption,
  leaveEncashmentExemption,
  type SettlementInput,
} from "@/lib/settlement";

/** Somebody on ₹1,00,000 a month who has served six years. */
function base(overrides: Partial<SettlementInput> = {}): SettlementInput {
  return {
    joinDate: "2019-04-01",
    exitDate: "2025-08-31",
    reason: "resignation",
    monthlyBasicPlusDaMinor: 50_000_00n,
    monthlyGrossMinor: 1_00_000_00n,
    daysWorkedInFinalMonth: 31,
    daysInFinalMonth: 31,
    noticePeriodDays: 60,
    noticeServedDays: 60,
    encashableLeaveDays: 12,
    leaveEncashmentBasis: 30,
    ...overrides,
  };
}

const line = (lines: { code: string; amountMinor: bigint }[], code: string) =>
  lines.find((l) => l.code === code);

describe("the final month", () => {
  it("pays a whole month when the whole month was worked", () => {
    const s = computeSettlement(base());
    expect(line(s.earnings, "final_salary")?.amountMinor).toBe(1_00_000_00n);
  });

  it("pro-rates a part month", () => {
    const s = computeSettlement(base({ daysWorkedInFinalMonth: 15, daysInFinalMonth: 30 }));
    expect(line(s.earnings, "final_salary")?.amountMinor).toBe(50_000_00n);
  });

  it("cannot pay for more days than the month has", () => {
    const s = computeSettlement(base({ daysWorkedInFinalMonth: 45, daysInFinalMonth: 30 }));
    expect(line(s.earnings, "final_salary")?.amountMinor).toBe(1_00_000_00n);
  });
});

describe("gratuity", () => {
  it("is paid after five years", () => {
    const s = computeSettlement(base());
    expect(s.gratuity.isEligible).toBe(true);
    expect(line(s.earnings, "gratuity")?.amountMinor).toBeGreaterThan(0n);
  });

  it("is not paid before five years, and says why", () => {
    const s = computeSettlement(base({ joinDate: "2022-04-01" }));
    expect(s.gratuity.isEligible).toBe(false);
    expect(line(s.earnings, "gratuity")).toBeUndefined();
    expect(s.notes.join(" ")).toMatch(/No gratuity/);
  });

  it("waives the five years where service ended in death", () => {
    const s = computeSettlement(base({ joinDate: "2023-04-01", reason: "death" }));
    expect(s.gratuity.isEligible).toBe(true);
  });

  it("waives the five years for disablement too", () => {
    const s = computeSettlement(base({ joinDate: "2023-04-01", reason: "disablement" }));
    expect(s.gratuity.isEligible).toBe(true);
  });

  it("notes when the statutory ceiling has cut the entitlement", () => {
    const s = computeSettlement(
      base({ joinDate: "1990-04-01", monthlyBasicPlusDaMinor: 10_00_000_00n })
    );
    expect(line(s.earnings, "gratuity")?.amountMinor).toBe(20_00_000_00n);
    expect(s.notes.join(" ")).toMatch(/capped at the statutory ceiling/);
  });
});

describe("leave encashment", () => {
  it("uses the basis the organisation states", () => {
    const at30 = computeSettlement(base({ leaveEncashmentBasis: 30 }));
    const at26 = computeSettlement(base({ leaveEncashmentBasis: 26 }));
    expect(line(at26.earnings, "leave_encashment")!.amountMinor).toBeGreaterThan(
      line(at30.earnings, "leave_encashment")!.amountMinor
    );
  });

  it("computes on basic plus DA rather than gross", () => {
    // 12 days at ₹50,000/30 = ₹20,000. On gross it would be ₹40,000.
    const s = computeSettlement(base({ leaveEncashmentBasis: 30 }));
    expect(line(s.earnings, "leave_encashment")?.amountMinor).toBe(20_000_00n);
  });

  it("omits the line entirely when there is no leave to encash", () => {
    const s = computeSettlement(base({ encashableLeaveDays: 0 }));
    expect(line(s.earnings, "leave_encashment")).toBeUndefined();
  });
});

describe("notice", () => {
  it("recovers a shortfall", () => {
    const s = computeSettlement(base({ noticeServedDays: 30 }));
    // 30 days short, on basic ₹50,000 at a 30-day month.
    expect(line(s.deductions, "notice_recovery")?.amountMinor).toBe(50_000_00n);
  });

  it("recovers on gross when the organisation says so", () => {
    const s = computeSettlement(base({ noticeServedDays: 30, noticeRecoveryOnGross: true }));
    expect(line(s.deductions, "notice_recovery")?.amountMinor).toBe(1_00_000_00n);
  });

  it("recovers nothing when the full notice was served", () => {
    const s = computeSettlement(base());
    expect(line(s.deductions, "notice_recovery")).toBeUndefined();
  });

  it("records a waiver as a decision rather than silently dropping it", () => {
    const s = computeSettlement(base({ noticeServedDays: 30, noticeWaived: true }));
    expect(line(s.deductions, "notice_recovery")).toBeUndefined();
    expect(s.notes.join(" ")).toMatch(/recovery was waived/);
  });

  it("never recovers notice from someone who died in service", () => {
    const s = computeSettlement(base({ noticeServedDays: 0, reason: "death" }));
    expect(line(s.deductions, "notice_recovery")).toBeUndefined();
    expect(s.notes.join(" ")).toMatch(/no recovery is made/);
  });

  it("never recovers notice on redundancy", () => {
    const s = computeSettlement(base({ noticeServedDays: 0, reason: "redundancy" }));
    expect(line(s.deductions, "notice_recovery")).toBeUndefined();
  });
});

describe("recoveries", () => {
  it("deducts an outstanding loan", () => {
    const s = computeSettlement(base({ outstandingLoanMinor: 25_000_00n }));
    expect(line(s.deductions, "loan_recovery")?.amountMinor).toBe(25_000_00n);
  });

  it("deducts unreturned property, and says it can be reversed", () => {
    const s = computeSettlement(base({ unreturnedAssetMinor: 60_000_00n }));
    const l = s.deductions.find((d) => d.code === "asset_recovery");
    expect(l?.amountMinor).toBe(60_000_00n);
    expect(l?.note).toMatch(/Reverse this line if the item is returned/);
  });

  it("leaves out recovery lines that are zero", () => {
    const s = computeSettlement(base());
    expect(s.deductions.map((d) => d.code)).not.toContain("loan_recovery");
    expect(s.deductions.map((d) => d.code)).not.toContain("other_recovery");
  });
});

describe("the net", () => {
  it("adds up to earnings less deductions", () => {
    const s = computeSettlement(base({ outstandingLoanMinor: 10_000_00n }));
    expect(s.netPayableMinor).toBe(s.totalEarningsMinor - s.totalDeductionsMinor);
  });

  it("can be negative, because sometimes the employee owes the company", () => {
    const s = computeSettlement(
      base({
        joinDate: "2024-01-01",
        noticeServedDays: 0,
        encashableLeaveDays: 0,
        daysWorkedInFinalMonth: 2,
        daysInFinalMonth: 31,
        outstandingLoanMinor: 1_50_000_00n,
        unreturnedAssetMinor: 80_000_00n,
      })
    );
    expect(s.netPayableMinor).toBeLessThan(0n);
    expect(s.employeeOwes).toBe(true);
  });

  it("explains a negative net rather than presenting it bare", () => {
    const s = computeSettlement(
      base({ joinDate: "2024-01-01", encashableLeaveDays: 0, outstandingLoanMinor: 5_00_000_00n })
    );
    expect(s.notes.join(" ")).toMatch(/recoverable from the employee/);
  });

  it("is positive for an ordinary well-behaved exit", () => {
    const s = computeSettlement(base());
    expect(s.employeeOwes).toBe(false);
    expect(s.netPayableMinor).toBeGreaterThan(0n);
  });
});

describe("what escapes tax", () => {
  it("exempts gratuity up to the lifetime ceiling", () => {
    const r = gratuityExemption(15_00_000_00n);
    expect(r.exemptMinor).toBe(15_00_000_00n);
    expect(r.taxableMinor).toBe(0n);
  });

  it("taxes gratuity above the ceiling", () => {
    const r = gratuityExemption(25_00_000_00n);
    expect(r.exemptMinor).toBe(20_00_000_00n);
    expect(r.taxableMinor).toBe(5_00_000_00n);
  });

  it("counts what a previous employer already exempted", () => {
    const r = gratuityExemption(15_00_000_00n, { alreadyExemptedMinor: 12_00_000_00n });
    expect(r.exemptMinor).toBe(8_00_000_00n);
    expect(r.taxableMinor).toBe(7_00_000_00n);
  });

  it("warns that the ceiling is a lifetime one it cannot see", () => {
    expect(gratuityExemption(1_00_000_00n).note).toMatch(/lifetime one and this employer cannot see/);
  });

  it("uses the ₹25,00,000 leave encashment ceiling, not the pre-2023 ₹3,00,000", () => {
    // A system still on the old figure taxes almost the whole payment.
    const r = leaveEncashmentExemption(5_00_000_00n);
    expect(r.exemptMinor).toBe(5_00_000_00n);
    expect(r.taxableMinor).toBe(0n);
  });

  it("taxes leave encashment above the ceiling", () => {
    const r = leaveEncashmentExemption(30_00_000_00n);
    expect(r.exemptMinor).toBe(25_00_000_00n);
    expect(r.taxableMinor).toBe(5_00_000_00n);
  });

  it("never returns a negative exemption when the ceiling is already used up", () => {
    const r = gratuityExemption(5_00_000_00n, { alreadyExemptedMinor: 25_00_000_00n });
    expect(r.exemptMinor).toBe(0n);
    expect(r.taxableMinor).toBe(5_00_000_00n);
  });
});
