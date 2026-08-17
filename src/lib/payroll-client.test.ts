// Pins the routing bug that made payroll unrunnable.
//
// `genericService(COLLECTIONS.payroll)` resolves an endpoint in two steps: a
// lookup in `ENTITY_ROUTES` for collections with a real table, falling back to
// `/api/collections/<name>` for the free-form document store. `payroll` was in
// neither — no entity route, and deliberately excluded from the document
// store's allowlist because it has its own table.
//
// Both halves of that are still true and both are still correct. What was
// missing was anything stopping a page from asking for the combination, which
// 404s on every read and every write. These tests make the gap visible rather
// than leaving it to be rediscovered from a screenshot of a red toast.

import { describe, expect, it } from "vitest";
import { ALLOWED_COLLECTIONS } from "@/app/api/collections/[collection]/route";
import { COLLECTIONS } from "@/lib/collection-service";
import { MONTH_NAMES, monthNumberFrom, periodLabel } from "@/lib/payroll-client";

describe("the payroll routing gap", () => {
  it("payroll is not a document-store collection", () => {
    // Correct, and the reason is in the route's own comment: payroll has a
    // real table, and a second home would let the two drift apart.
    expect(ALLOWED_COLLECTIONS.has("payroll")).toBe(false);
  });

  it("so nothing may route payroll through genericService", () => {
    // `COLLECTIONS.payroll` still exists for the collection *name*, but any
    // page using it for I/O gets `/api/collections/payroll`, which 404s.
    // Payroll reads and writes must go through `@/lib/payroll-client`.
    expect(COLLECTIONS.payroll).toBe("payroll");
    expect(ALLOWED_COLLECTIONS.has(COLLECTIONS.payroll)).toBe(false);
  });

  it("every allowed collection is genuinely free-form", () => {
    // The tables with their own routes must stay out of the document store.
    // Adding one here would give those records two homes.
    for (const owned of ["payroll", "employees", "leaves", "attendance", "expenses"]) {
      expect(ALLOWED_COLLECTIONS.has(owned), `${owned} has its own table`).toBe(false);
    }
  });
});

describe("monthNumberFrom", () => {
  it("maps every month name to its 1-12 number", () => {
    MONTH_NAMES.forEach((name, index) => {
      expect(monthNumberFrom(name)).toBe(index + 1);
    });
  });

  it("is 1-based, matching the API and the database column", () => {
    // `Date` months are 0-11 and `periodMonth` is 1-12. Mixing the two runs
    // December's payroll into November's period.
    expect(monthNumberFrom("January")).toBe(1);
    expect(monthNumberFrom("December")).toBe(12);
  });

  it("ignores case and surrounding space", () => {
    expect(monthNumberFrom("  august ")).toBe(8);
    expect(monthNumberFrom("AUGUST")).toBe(8);
  });

  it("returns null rather than defaulting for something that is not a month", () => {
    // Defaulting to January would silently run the wrong period's payroll.
    expect(monthNumberFrom("Smarch")).toBeNull();
    expect(monthNumberFrom("")).toBeNull();
    expect(monthNumberFrom("8")).toBeNull();
  });

  it("produces a value the API schema accepts", () => {
    for (const name of MONTH_NAMES) {
      const n = monthNumberFrom(name)!;
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(12);
    }
  });
});

describe("periodLabel", () => {
  it("reads as a period a person would recognise", () => {
    expect(periodLabel({ periodMonth: 8, periodYear: 2026 })).toBe("August 2026");
  });

  it("round-trips with monthNumberFrom", () => {
    // The dialog holds a name, the API holds a number, and the toast shows a
    // name again. All three have to agree or the confirmation names a
    // different month from the one that ran.
    for (const [index, name] of MONTH_NAMES.entries()) {
      const periodMonth = monthNumberFrom(name)!;
      expect(periodLabel({ periodMonth, periodYear: 2026 })).toBe(`${MONTH_NAMES[index]} 2026`);
    }
  });
});
