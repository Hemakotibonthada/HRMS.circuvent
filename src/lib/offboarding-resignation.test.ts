import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTICE_PERIOD_DAYS,
  canAcceptResignation,
  canAdjustLastWorkingDay,
  canSubmitResignation,
  computeAgreedLastWorkingDay,
  policyLastWorkingDay,
} from "./offboarding-resignation";

describe("policyLastWorkingDay", () => {
  it("adds the notice period to the submission date", () => {
    expect(policyLastWorkingDay("2026-01-01", 60)).toBe("2026-03-02");
  });

  it("allows a zero notice period rather than treating it as unset", () => {
    // Some employment types (probationers, interns) can carry a genuine
    // zero-day notice policy. That is a valid business answer, not a bug —
    // only a missing/negative value should raise.
    expect(policyLastWorkingDay("2026-01-01", 0)).toBe("2026-01-01");
  });

  it("rejects a malformed submission date rather than silently misreading it", () => {
    expect(() => policyLastWorkingDay("01/01/2026", 60)).toThrow(RangeError);
  });

  it("rejects a negative or fractional notice period", () => {
    expect(() => policyLastWorkingDay("2026-01-01", -1)).toThrow(RangeError);
    expect(() => policyLastWorkingDay("2026-01-01", 45.5)).toThrow(RangeError);
  });
});

describe("computeAgreedLastWorkingDay", () => {
  it("falls back to the policy minimum when the employee offers less notice than policy requires", () => {
    // The bug this guards against: accepting a resignation must not itself
    // waive notice. An employee who offers 10 days against a 60-day policy
    // still owes the other 50 unless HR later calls adjustLastWorkingDay.
    const agreed = computeAgreedLastWorkingDay("2026-01-01", "2026-01-11", 60);
    expect(agreed).toBe(policyLastWorkingDay("2026-01-01", 60));
    expect(agreed).toBe("2026-03-02");
  });

  it("honours an intended date that offers more notice than policy requires", () => {
    const agreed = computeAgreedLastWorkingDay("2026-01-01", "2026-06-30", 60);
    expect(agreed).toBe("2026-06-30");
  });

  it("keeps the intended date when it lands exactly on the policy minimum", () => {
    const policyMinimum = policyLastWorkingDay("2026-01-01", 30);
    const agreed = computeAgreedLastWorkingDay("2026-01-01", policyMinimum, 30);
    expect(agreed).toBe(policyMinimum);
  });

  it("uses the documented default when a policy value is somehow missing", () => {
    // employees.noticePeriodDays defaults to this same number; the constant
    // exists so a null column reads the same as an explicit 60, not as 0.
    expect(DEFAULT_NOTICE_PERIOD_DAYS).toBe(60);
  });

  it("rejects a malformed intended last working day", () => {
    expect(() => computeAgreedLastWorkingDay("2026-01-01", "not-a-date", 60)).toThrow(RangeError);
  });
});

describe("canAcceptResignation", () => {
  it("allows accepting only from submitted", () => {
    expect(canAcceptResignation("submitted")).toBe(true);
  });

  it("refuses to accept an already-accepted resignation a second time", () => {
    // There is no "accepted" -> "submitted" path back, so re-accepting must
    // not be silently allowed to look like a no-op success.
    expect(canAcceptResignation("accepted")).toBe(false);
  });

  it("refuses any other status, including one this module has never heard of", () => {
    expect(canAcceptResignation("withdrawn")).toBe(false);
  });
});

describe("canAdjustLastWorkingDay", () => {
  it("allows HR to move the date after acceptance, before settlement is frozen", () => {
    expect(canAdjustLastWorkingDay("accepted", false)).toBe(true);
  });

  it("blocks the move once a settlement snapshot exists", () => {
    // The snapshot is what freezes proration. Moving the date after that
    // point would leave a frozen settlement quietly priced against a last
    // working day that is no longer the real one — settlement never
    // recomputes once frozen, so the guard must sit here, before the freeze.
    expect(canAdjustLastWorkingDay("accepted", true)).toBe(false);
  });

  it("blocks the move before acceptance — there is nothing agreed yet to adjust", () => {
    expect(canAdjustLastWorkingDay("submitted", false)).toBe(false);
  });
});

describe("canSubmitResignation", () => {
  it("allows a first resignation", () => {
    expect(canSubmitResignation(false)).toBe(true);
  });

  it("refuses a second resignation while one is already open", () => {
    // One open resignation per employee: submitting again would otherwise
    // leave two competing notice periods and two agreed last working days.
    expect(canSubmitResignation(true)).toBe(false);
  });
});
