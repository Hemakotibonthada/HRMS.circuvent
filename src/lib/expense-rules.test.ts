import { describe, expect, it } from "vitest";
import {
  CATEGORY_LIMITS_MINOR,
  canTransition,
  categoryLimitMinor,
  formatClaimNumber,
  isKnownCategory,
  isOpen,
  resolveApprovedMinor,
  totalOfLineItems,
  validateClaim,
  type ExpenseLineItem,
  type ExpenseStage,
} from "@/lib/expense-rules";

const TODAY = "2026-06-15";

function line(amountMinor: string, description = "Taxi"): ExpenseLineItem {
  return { description, amountMinor };
}

describe("categories", () => {
  it("knows its own categories", () => {
    expect(isKnownCategory("travel")).toBe(true);
    expect(isKnownCategory("meals")).toBe(true);
    expect(isKnownCategory("bribes")).toBe(false);
  });

  it("states limits in minor units, not rupees", () => {
    // The old route had `travel: 50000`, which read as ₹500 if taken as paise.
    // ₹50,000 is 5,000,000 paise.
    expect(categoryLimitMinor("travel")).toBe(5_000_000n);
    expect(categoryLimitMinor("books")).toBe(500_000n);
  });

  it("returns null for an unknown category rather than a default", () => {
    expect(categoryLimitMinor("bribes")).toBeNull();
  });

  it("gives every category a positive limit", () => {
    for (const [category, limit] of Object.entries(CATEGORY_LIMITS_MINOR)) {
      expect(limit, `${category} should have a positive limit`).toBeGreaterThan(0n);
    }
  });
});

describe("totalOfLineItems", () => {
  it("adds exactly", () => {
    expect(totalOfLineItems([line("1000"), line("2500"), line("75")])).toBe("3575");
  });

  it("is zero for no lines", () => {
    expect(totalOfLineItems([])).toBe("0");
  });

  it("does not drift the way a float would", () => {
    // 0.1 + 0.2 in rupees. As paise it is exact.
    expect(totalOfLineItems([line("10"), line("20")])).toBe("30");
  });

  it("stays exact across many lines", () => {
    const many = Array.from({ length: 1000 }, () => line("3333333"));
    expect(totalOfLineItems(many)).toBe("3333333000");
  });
});

describe("validateClaim", () => {
  const valid = {
    title: "Client visit, Pune",
    category: "travel",
    expenseDate: "2026-06-10",
    lineItems: [line("120000", "Return flight")],
  };

  it("accepts a well-formed claim", () => {
    expect(validateClaim(valid, TODAY)).toEqual({ ok: true, errors: [] });
  });

  it("requires a title", () => {
    const result = validateClaim({ ...valid, title: "   " }, TODAY);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("A title is required");
  });

  it("rejects an unknown category", () => {
    const result = validateClaim({ ...valid, category: "bribes" }, TODAY);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Unknown category");
  });

  it("rejects a malformed date", () => {
    const result = validateClaim({ ...valid, expenseDate: "10-06-2026" }, TODAY);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Expense date must be YYYY-MM-DD");
  });

  it("rejects a future date — that is an advance, not a claim", () => {
    const result = validateClaim({ ...valid, expenseDate: "2026-06-16" }, TODAY);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("An expense cannot be dated in the future");
  });

  it("accepts a claim dated today", () => {
    expect(validateClaim({ ...valid, expenseDate: TODAY }, TODAY).ok).toBe(true);
  });

  it("requires at least one line", () => {
    const result = validateClaim({ ...valid, lineItems: [] }, TODAY);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("A claim needs at least one line item");
  });

  it("rejects a zero or negative line", () => {
    expect(validateClaim({ ...valid, lineItems: [line("0")] }, TODAY).ok).toBe(false);
    expect(validateClaim({ ...valid, lineItems: [line("-500")] }, TODAY).ok).toBe(false);
  });

  it("rejects a line with no description", () => {
    const result = validateClaim({ ...valid, lineItems: [line("1000", "  ")] }, TODAY);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Line 1 needs a description");
  });

  it("rejects a malformed amount without throwing", () => {
    const result = validateClaim({ ...valid, lineItems: [line("12.50")] }, TODAY);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Line 1 has an invalid amount");
  });

  it("enforces the category limit on the total, not per line", () => {
    // Three lines of ₹20,000 each is ₹60,000 — over the ₹50,000 travel limit,
    // even though no single line is.
    const result = validateClaim(
      { ...valid, lineItems: [line("2000000"), line("2000000"), line("2000000")] },
      TODAY
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("exceeds the travel limit");
  });

  it("allows a total exactly on the limit", () => {
    const result = validateClaim({ ...valid, lineItems: [line("5000000")] }, TODAY);
    expect(result.ok).toBe(true);
  });

  it("reports every problem at once", () => {
    const result = validateClaim(
      { title: "", category: "bribes", expenseDate: "nope", lineItems: [] },
      TODAY
    );
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it("numbers the offending line from one, not zero", () => {
    const result = validateClaim(
      { ...valid, lineItems: [line("1000"), line("0", "Coffee")] },
      TODAY
    );
    expect(result.errors).toContain("Line 2 must be a positive amount");
  });
});

describe("canTransition", () => {
  it("allows a decision on a pending claim", () => {
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("pending", "rejected")).toBe(true);
    expect(canTransition("pending", "cancelled")).toBe(true);
  });

  it("allows reimbursement only after approval", () => {
    expect(canTransition("approved", "reimbursed")).toBe(true);
    expect(canTransition("pending", "reimbursed")).toBe(false);
    expect(canTransition("rejected", "reimbursed")).toBe(false);
  });

  it("refuses to approve twice — the second is a duplicate payment", () => {
    expect(canTransition("approved", "approved")).toBe(false);
    expect(canTransition("reimbursed", "reimbursed")).toBe(false);
  });

  it("refuses to reopen a decided claim", () => {
    expect(canTransition("rejected", "pending")).toBe(false);
    expect(canTransition("approved", "pending")).toBe(false);
    expect(canTransition("cancelled", "pending")).toBe(false);
    expect(canTransition("reimbursed", "approved")).toBe(false);
  });

  it("has no cycles — every claim reaches a terminal stage", () => {
    const stages: ExpenseStage[] = [
      "pending",
      "approved",
      "rejected",
      "cancelled",
      "reimbursed",
    ];
    // Nothing may return to pending, so no claim can loop forever.
    for (const stage of stages) {
      expect(canTransition(stage, "pending"), `${stage} -> pending`).toBe(false);
    }
  });
});

describe("isOpen", () => {
  it("is true only while awaiting a decision", () => {
    expect(isOpen("pending")).toBe(true);
    for (const stage of ["approved", "rejected", "cancelled", "reimbursed"] as ExpenseStage[]) {
      expect(isOpen(stage)).toBe(false);
    }
  });
});

describe("resolveApprovedMinor", () => {
  it("defaults to the full claim", () => {
    expect(resolveApprovedMinor("500000", null)).toBe("500000");
    expect(resolveApprovedMinor("500000", undefined)).toBe("500000");
  });

  it("allows approving part of a claim", () => {
    expect(resolveApprovedMinor("500000", "300000")).toBe("300000");
  });

  it("allows approving nothing while still not rejecting", () => {
    expect(resolveApprovedMinor("500000", "0")).toBe("0");
  });

  it("refuses to approve more than was claimed", () => {
    expect(() => resolveApprovedMinor("500000", "500001")).toThrow(RangeError);
  });

  it("refuses a negative approval", () => {
    expect(() => resolveApprovedMinor("500000", "-1")).toThrow(RangeError);
  });
});

describe("formatClaimNumber", () => {
  it("pads to a sortable width", () => {
    expect(formatClaimNumber(2026, 1)).toBe("EXP-2026-000001");
    expect(formatClaimNumber(2026, 123)).toBe("EXP-2026-000123");
  });

  it("sorts lexicographically in issue order", () => {
    const numbers = [
      formatClaimNumber(2026, 2),
      formatClaimNumber(2026, 10),
      formatClaimNumber(2026, 1),
    ];
    expect([...numbers].sort()).toEqual([
      "EXP-2026-000001",
      "EXP-2026-000002",
      "EXP-2026-000010",
    ]);
  });

  it("keeps years in order too", () => {
    expect(formatClaimNumber(2025, 999999) < formatClaimNumber(2026, 1)).toBe(true);
  });

  it("rejects nonsense", () => {
    expect(() => formatClaimNumber(26, 1)).toThrow(RangeError);
    expect(() => formatClaimNumber(2026, 0)).toThrow(RangeError);
    expect(() => formatClaimNumber(2026, -5)).toThrow(RangeError);
    expect(() => formatClaimNumber(2026, 1.5)).toThrow(RangeError);
  });
});
