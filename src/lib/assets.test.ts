// @vitest-environment node
//
// Depreciation feeds the balance sheet and is reported to auditors, so the
// arithmetic has to be exact and reproducible for any date. The lifecycle
// tests pin the states an asset register must refuse, because a register that
// accepts impossible states quietly diverges from the cupboard.

import { describe, expect, it } from "vitest";
import {
  addMonths,
  availableActions,
  canIssue,
  canTransition,
  daysBetween,
  depreciate,
  depreciationSchedule,
  exitClearance,
  monthsBetween,
  nextServiceDue,
  warrantyPosition,
  type AssetState,
  type DepreciableAsset,
} from "@/lib/assets";

const laptop: DepreciableAsset = {
  purchaseCostMinor: 120_000_00n,
  purchaseDate: "2026-01-01",
  usefulLifeMonths: 36,
  salvageValueMinor: 12_000_00n,
  method: "straight_line",
};

describe("depreciate — straight line", () => {
  it("has full value on the purchase date", () => {
    const position = depreciate(laptop, "2026-01-01");
    expect(position.bookValueMinor).toBe(120_000_00n);
    expect(position.accumulatedMinor).toBe(0n);
  });

  it("charges evenly each month", () => {
    // 108,000.00 depreciable over 36 months is 3,000.00 a month.
    const position = depreciate(laptop, "2026-02-01");
    expect(position.accumulatedMinor).toBe(3_000_00n);
    expect(position.bookValueMinor).toBe(117_000_00n);
  });

  it("reaches exactly salvage value at the end of life", () => {
    const position = depreciate(laptop, "2029-01-01");
    expect(position.bookValueMinor).toBe(12_000_00n);
    expect(position.isFullyDepreciated).toBe(true);
  });

  it("never falls below salvage value afterwards", () => {
    // A negative asset on a balance sheet is the kind of thing an auditor
    // asks about for an hour.
    const position = depreciate(laptop, "2040-01-01");
    expect(position.bookValueMinor).toBe(12_000_00n);
  });

  it("sums to exactly the depreciable amount despite rounding", () => {
    // 100,000.00 over 7 months does not divide evenly; the final month must
    // absorb the remainder rather than leaving paise behind.
    const awkward: DepreciableAsset = {
      ...laptop,
      purchaseCostMinor: 100_000_00n,
      salvageValueMinor: 0n,
      usefulLifeMonths: 7,
    };

    expect(depreciate(awkward, "2026-08-01").bookValueMinor).toBe(0n);
  });

  it("stops charging once fully depreciated", () => {
    expect(depreciate(laptop, "2029-06-01").monthlyChargeMinor).toBe(0n);
  });

  it("counts only whole months", () => {
    // Mid-month is not a partial charge: the schedule is monthly.
    expect(depreciate(laptop, "2026-01-20").accumulatedMinor).toBe(0n);
  });
});

describe("depreciate — declining balance", () => {
  const declining: DepreciableAsset = { ...laptop, method: "double_declining" };

  it("charges more early than straight line", () => {
    const early = depreciate(declining, "2026-04-01");
    const straight = depreciate(laptop, "2026-04-01");
    expect(early.accumulatedMinor).toBeGreaterThan(straight.accumulatedMinor);
  });

  it("never falls below salvage value", () => {
    // Declining balance approaches salvage asymptotically and would never
    // reach it without the clamp.
    const position = depreciate(declining, "2035-01-01");
    expect(position.bookValueMinor).toBe(12_000_00n);
  });

  it("is exactly at salvage value at the end of its useful life", () => {
    // Pure declining balance leaves a residue above salvage — about 3,300 on
    // this asset — which would mean it is never fully depreciated and sits on
    // the balance sheet above its agreed residual for ever. The final period
    // absorbs the remainder.
    const position = depreciate(declining, "2029-01-01");
    expect(position.bookValueMinor).toBe(12_000_00n);
    expect(position.isFullyDepreciated).toBe(true);
  });

  it("charges less than double-declining under the 1.5 factor", () => {
    const gentler = depreciate({ ...laptop, method: "declining_balance" }, "2026-07-01");
    const steeper = depreciate(declining, "2026-07-01");
    expect(gentler.accumulatedMinor).toBeLessThan(steeper.accumulatedMinor);
  });
});

describe("depreciate — none", () => {
  it("holds value indefinitely", () => {
    // Land and some fixtures do not depreciate.
    const land: DepreciableAsset = { ...laptop, method: "none" };
    const position = depreciate(land, "2050-01-01");

    expect(position.bookValueMinor).toBe(120_000_00n);
    expect(position.isFullyDepreciated).toBe(false);
  });
});

describe("depreciate — refusals", () => {
  it("refuses a zero useful life", () => {
    expect(() => depreciate({ ...laptop, usefulLifeMonths: 0 }, "2026-06-01")).toThrow(
      /positive useful life/
    );
  });

  it("refuses a negative salvage value", () => {
    expect(() => depreciate({ ...laptop, salvageValueMinor: -1n }, "2026-06-01")).toThrow(
      /cannot be negative/
    );
  });

  it("refuses salvage above cost", () => {
    // It would produce a negative depreciable amount and an asset that
    // appreciates on the balance sheet.
    expect(() =>
      depreciate({ ...laptop, salvageValueMinor: 200_000_00n }, "2026-06-01")
    ).toThrow(/cannot exceed the purchase cost/);
  });

  it("allows a zero useful life when nothing depreciates", () => {
    expect(() =>
      depreciate({ ...laptop, usefulLifeMonths: 0, method: "none" }, "2026-06-01")
    ).not.toThrow();
  });
});

describe("depreciationSchedule", () => {
  it("produces one row per month of life", () => {
    expect(depreciationSchedule(laptop)).toHaveLength(36);
  });

  it("ends at salvage value", () => {
    const schedule = depreciationSchedule(laptop);
    expect(schedule.at(-1)?.bookValueMinor).toBe(12_000_00n);
  });

  it("has charges summing to the depreciable amount", () => {
    const total = depreciationSchedule(laptop).reduce((sum, r) => sum + r.chargeMinor, 0n);
    expect(total).toBe(108_000_00n);
  });

  it("is empty for a non-depreciating asset", () => {
    expect(depreciationSchedule({ ...laptop, method: "none" })).toEqual([]);
  });

  it("is bounded, so a data-entry error does not produce twelve thousand rows", () => {
    const absurd: DepreciableAsset = { ...laptop, usefulLifeMonths: 12_000 };
    expect(depreciationSchedule(absurd).length).toBeLessThanOrEqual(600);
  });
});

describe("canTransition", () => {
  it("allows issuing from stock", () => {
    expect(canTransition("in_stock", "issue")).toEqual({ allowed: true, to: "assigned" });
  });

  it("refuses issuing an asset already assigned", () => {
    const verdict = canTransition("assigned", "issue");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/assigned cannot be issued/);
  });

  it("refuses returning an asset nobody has", () => {
    expect(canTransition("in_stock", "return").allowed).toBe(false);
  });

  it("allows the repair round trip", () => {
    expect(canTransition("assigned", "send_for_repair")).toEqual({
      allowed: true,
      to: "in_repair",
    });
    expect(canTransition("in_repair", "repair_complete")).toEqual({
      allowed: true,
      to: "in_stock",
    });
  });

  it("allows a lost asset to be recovered", () => {
    expect(canTransition("lost", "recover")).toEqual({ allowed: true, to: "in_stock" });
  });

  it("retires a lost asset rather than deleting it", () => {
    // It stays in the register with its history, because "where did that
    // laptop go?" is asked later.
    expect(canTransition("lost", "retire")).toEqual({ allowed: true, to: "retired" });
  });

  it("permits nothing once disposed", () => {
    const actions: AssetState[] = [];
    expect(availableActions("disposed")).toEqual(actions);
    expect(canTransition("disposed", "issue").allowed).toBe(false);
  });

  it("requires retirement before disposal", () => {
    expect(canTransition("assigned", "dispose").allowed).toBe(false);
    expect(canTransition("retired", "dispose").allowed).toBe(true);
  });

  it("lists the actions available from a state", () => {
    expect(availableActions("assigned").sort()).toEqual(
      ["report_lost", "return", "send_for_repair"].sort()
    );
  });
});

describe("canIssue", () => {
  const base = {
    assetState: "in_stock" as AssetState,
    employeeHoldings: [],
    categoryId: "laptops",
    employeeIsActive: true,
  };

  it("allows a normal issue", () => {
    expect(canIssue(base)).toEqual({ allowed: true });
  });

  it("refuses an asset that is not in stock", () => {
    expect(canIssue({ ...base, assetState: "in_repair" }).allowed).toBe(false);
  });

  it("refuses issuing to someone who has left", () => {
    // This is how a laptop leaves the building permanently: the register and
    // the employment record are checked by different people at different
    // times.
    const verdict = canIssue({ ...base, employeeIsActive: false });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/no longer active/);
  });

  it("enforces a per-category limit", () => {
    const verdict = canIssue({
      ...base,
      maxPerEmployee: 1,
      employeeHoldings: [{ categoryId: "laptops", count: 1 }],
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/limit is 1/);
  });

  it("counts only the category being issued", () => {
    expect(
      canIssue({
        ...base,
        maxPerEmployee: 1,
        employeeHoldings: [{ categoryId: "monitors", count: 3 }],
      })
    ).toEqual({ allowed: true });
  });

  it("treats a zero limit as no limit", () => {
    expect(
      canIssue({
        ...base,
        maxPerEmployee: 0,
        employeeHoldings: [{ categoryId: "laptops", count: 99 }],
      })
    ).toEqual({ allowed: true });
  });
});

describe("exitClearance", () => {
  const held = [
    {
      assetId: "a1",
      assetTag: "LAP-001",
      name: "MacBook",
      categoryName: "Laptops",
      bookValueMinor: 60_000_00n,
      issuedOn: "2026-01-01",
    },
    {
      assetId: "a2",
      assetTag: "MON-004",
      name: "Monitor",
      categoryName: "Monitors",
      bookValueMinor: 8_000_00n,
      issuedOn: "2026-01-01",
    },
  ];

  it("totals the book value, not the purchase cost", () => {
    // Charging someone the full price of a four-year-old laptop is neither
    // defensible nor, in most places, lawful — and a figure that cannot be
    // defended gets waived entirely.
    expect(exitClearance(held).totalValueMinor).toBe(68_000_00n);
  });

  it("lists the most valuable item first", () => {
    expect(exitClearance(held).outstanding[0].assetTag).toBe("LAP-001");
  });

  it("reports clear when nothing is held", () => {
    const result = exitClearance([]);
    expect(result.isClear).toBe(true);
    expect(result.totalValueMinor).toBe(0n);
  });

  it("does not mutate its input", () => {
    const original = [...held];
    exitClearance(held);
    expect(held).toEqual(original);
  });
});

describe("warrantyPosition", () => {
  it("reports cover that is still live", () => {
    const position = warrantyPosition("2027-01-01", "2026-06-01");
    expect(position.isUnderWarranty).toBe(true);
    expect(position.expiringSoon).toBe(false);
  });

  it("warns before cover lapses", () => {
    // Finding out an asset is out of warranty at the moment it breaks is
    // finding out too late.
    const position = warrantyPosition("2026-07-01", "2026-06-01");
    expect(position.expiringSoon).toBe(true);
    expect(position.daysRemaining).toBe(30);
  });

  it("reports expired cover", () => {
    const position = warrantyPosition("2026-01-01", "2026-06-01");
    expect(position.isUnderWarranty).toBe(false);
    expect(position.daysRemaining).toBeLessThan(0);
  });

  it("handles an asset with no warranty recorded", () => {
    const position = warrantyPosition(null, "2026-06-01");
    expect(position.isUnderWarranty).toBe(false);
    expect(position.daysRemaining).toBeNull();
  });

  it("honours a custom warning window", () => {
    expect(warrantyPosition("2026-09-01", "2026-06-01", 120).expiringSoon).toBe(true);
  });

  it("treats the expiry date itself as still covered", () => {
    expect(warrantyPosition("2026-06-01", "2026-06-01").isUnderWarranty).toBe(true);
  });
});

describe("nextServiceDue", () => {
  it("counts from the last service", () => {
    expect(nextServiceDue("2026-01-15", 6, "2025-01-01")).toBe("2026-07-15");
  });

  it("counts from purchase when never serviced", () => {
    // Otherwise the one thing most likely to need attention is the one thing
    // the report never shows.
    expect(nextServiceDue(null, 6, "2026-01-15")).toBe("2026-07-15");
  });

  it("returns nothing when no interval is set", () => {
    expect(nextServiceDue("2026-01-15", 0, "2025-01-01")).toBeNull();
  });
});

describe("date helpers", () => {
  it("counts whole months only", () => {
    expect(monthsBetween("2026-01-15", "2026-02-14")).toBe(0);
    expect(monthsBetween("2026-01-15", "2026-02-15")).toBe(1);
  });

  it("clamps to a shorter month when adding", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("measures days across a month boundary", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
  });

  it("rejects malformed dates", () => {
    expect(() => monthsBetween("Jan 2026", "2026-02-01")).toThrow(/YYYY-MM-DD/);
    expect(() => addMonths("31/01/2026", 1)).toThrow(/YYYY-MM-DD/);
    expect(() => daysBetween("2026-01-01", "tomorrow")).toThrow(/YYYY-MM-DD/);
  });
});
