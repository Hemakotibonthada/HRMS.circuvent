// @vitest-environment node
//
// The report builder turns user input into SQL, which makes it the most
// dangerous component in the product. These tests exist mainly to prove that
// nothing a caller supplies ever reaches the query text: field names are
// resolved against a catalogue, values are always bound.

import { describe, expect, it } from "vitest";
import {
  ReportError,
  availableFields,
  compileReport,
  type ReportDefinition,
} from "@/lib/reporting/builder";

const ALL = new Set(["payroll.view"]);
const NONE = new Set<string>();

function base(over: Partial<ReportDefinition> = {}): ReportDefinition {
  return { source: "employees", fields: ["employeeCode", "designation"], ...over };
}

describe("injection resistance", () => {
  it("rejects a field name that is not in the catalogue", () => {
    // The entire defence: no allow-list entry, no query.
    expect(() => compileReport(base({ fields: ["e.work_email; DROP TABLE hrms.employees"] }))).toThrow(
      ReportError
    );
    expect(() => compileReport(base({ fields: ["'; DELETE FROM identity.users; --"] }))).toThrow(
      /Unknown field/
    );
  });

  it("rejects an injected sort field", () => {
    expect(() =>
      compileReport(base({ sortBy: [{ field: "1; DROP TABLE x", direction: "asc" }] }))
    ).toThrow(ReportError);
  });

  it("rejects an injected group-by field", () => {
    expect(() => compileReport(base({ groupBy: ["e.id) --"] }))).toThrow(ReportError);
  });

  it("rejects an alias that is not a plain identifier", () => {
    // Aliases are emitted into SQL, so they are constrained rather than escaped.
    for (const alias of ['x" , (SELECT 1) AS "y', "a-b", "1abc", ""]) {
      expect(() =>
        compileReport(
          base({
            fields: [],
            groupBy: [],
            aggregations: [{ field: "headcount", function: "count", alias }],
          })
        )
      ).toThrow(/Invalid alias/);
    }
  });

  it("binds filter values rather than interpolating them", () => {
    const compiled = compileReport(
      base({ filters: [{ field: "designation", operator: "eq", value: "'; DROP TABLE x; --" }] })
    );
    expect(compiled.sql).not.toContain("DROP TABLE");
    expect(compiled.sql).toContain("$1");
    expect(compiled.params).toEqual(["'; DROP TABLE x; --"]);
  });

  it("treats wildcard characters in a search term literally", () => {
    // The % belongs to us; the user's text is bound, so a search for "100%"
    // does not become a match-everything pattern.
    const compiled = compileReport(
      base({ filters: [{ field: "designation", operator: "contains", value: "100%_x" }] })
    );
    expect(compiled.params).toEqual(["%100%_x%"]);
    expect(compiled.sql).toContain("ILIKE $1");
  });
});

describe("permissions", () => {
  it("hides a restricted field from the designer", () => {
    expect(availableFields("employees", NONE).map((f) => f.key)).not.toContain("ctc");
    expect(availableFields("employees", ALL).map((f) => f.key)).toContain("ctc");
  });

  it("refuses to compile a report referencing a restricted field", () => {
    expect(() => compileReport(base({ fields: ["employeeCode", "ctc"] }), NONE)).toThrow(
      ReportError
    );
  });

  it("does not reveal that the restricted field exists", () => {
    // The message matches the unknown-field case exactly, so probing the API
    // cannot enumerate columns the caller may not see.
    let unknown = "";
    let restricted = "";
    try {
      compileReport(base({ fields: ["notAField"] }), NONE);
    } catch (e) {
      unknown = (e as Error).message;
    }
    try {
      compileReport(base({ fields: ["ctc"] }), NONE);
    } catch (e) {
      restricted = (e as Error).message;
    }
    expect(restricted).toBe(unknown.replace("notAField", "ctc"));
  });

  it("compiles the restricted field when the permission is held", () => {
    const compiled = compileReport(base({ fields: ["employeeCode", "ctc"] }), ALL);
    expect(compiled.columns).toEqual(["employeeCode", "ctc"]);
  });
});

describe("select and filters", () => {
  it("always applies the source's base filter", () => {
    // Without this a report would include soft-deleted employees.
    expect(compileReport(base()).sql).toContain("e.deleted_at IS NULL");
  });

  it("maps operators to SQL", () => {
    const compiled = compileReport(
      base({
        filters: [
          { field: "joinDate", operator: "gte", value: "2026-01-01" },
          { field: "status", operator: "neq", value: "terminated" },
        ],
      })
    );
    expect(compiled.sql).toContain("e.join_date >= $1");
    expect(compiled.sql).toContain("e.status <> $2");
    expect(compiled.params).toEqual(["2026-01-01", "terminated"]);
  });

  it("handles IN with one placeholder per value", () => {
    const compiled = compileReport(
      base({ filters: [{ field: "status", operator: "in", value: ["active", "probation"] }] })
    );
    expect(compiled.sql).toContain("IN ($1, $2)");
    expect(compiled.params).toEqual(["active", "probation"]);
  });

  it("rejects an empty or oversized IN list", () => {
    expect(() =>
      compileReport(base({ filters: [{ field: "status", operator: "in", value: [] }] }))
    ).toThrow(/non-empty/);
    expect(() =>
      compileReport(
        base({
          filters: [{ field: "status", operator: "in", value: Array(1001).fill("active") }],
        })
      )
    ).toThrow(/at most 1000/);
  });

  it("emits null checks without a parameter", () => {
    const compiled = compileReport(
      base({ filters: [{ field: "exitDate", operator: "is_null" }] })
    );
    expect(compiled.sql).toContain("e.exit_date IS NULL");
    expect(compiled.params).toHaveLength(0);
  });

  it("requires exactly two values for between", () => {
    expect(() =>
      compileReport(
        base({ filters: [{ field: "joinDate", operator: "between", value: ["2026-01-01"] }] })
      )
    ).toThrow(/exactly two/);
  });

  it("rejects a text search on a non-text field", () => {
    expect(() =>
      compileReport(base({ filters: [{ field: "joinDate", operator: "contains", value: "x" }] }))
    ).toThrow(/cannot be searched by text/);
  });

  it("validates value types", () => {
    expect(() =>
      compileReport(base({ filters: [{ field: "joinDate", operator: "eq", value: "yesterday" }] }))
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      compileReport(base({ filters: [{ field: "status", operator: "eq", value: "nonsense" }] }))
    ).toThrow(/does not accept/);
    expect(() =>
      compileReport(base({ fields: ["ctc"], filters: [{ field: "ctc", operator: "gt", value: "lots" }] }), ALL)
    ).toThrow(/expects a number/);
  });
});

describe("aggregation", () => {
  it("builds a grouped count", () => {
    const compiled = compileReport(
      base({
        fields: ["department"],
        groupBy: ["department"],
        aggregations: [{ field: "headcount", function: "count", alias: "total" }],
      })
    );
    expect(compiled.sql).toContain('count(e.id) AS "total"');
    expect(compiled.sql).toContain("GROUP BY d.name");
    expect(compiled.columns).toEqual(["department", "total"]);
  });

  it("rejects a selected field that is neither grouped nor aggregated", () => {
    // Postgres would reject this too, but with a syntax error the report
    // author cannot act on.
    expect(() =>
      compileReport(
        base({
          fields: ["department", "firstName"],
          groupBy: ["department"],
          aggregations: [{ field: "headcount", function: "count", alias: "total" }],
        })
      )
    ).toThrow(/must be grouped or aggregated/);
  });

  it("rejects aggregating a non-aggregatable field", () => {
    expect(() =>
      compileReport(
        base({
          fields: [],
          aggregations: [{ field: "designation", function: "sum", alias: "x" }],
        })
      )
    ).toThrow(/cannot be aggregated/);
  });

  it("rejects grouping by a non-groupable field", () => {
    expect(() => compileReport(base({ fields: ["email"], groupBy: ["email"] }))).toThrow(
      /cannot be grouped/
    );
  });

  it("allows sorting by an aggregate alias", () => {
    const compiled = compileReport(
      base({
        fields: ["department"],
        groupBy: ["department"],
        aggregations: [{ field: "headcount", function: "count", alias: "total" }],
        sortBy: [{ field: "total", direction: "desc" }],
      })
    );
    expect(compiled.sql).toContain('ORDER BY "total" DESC');
  });
});

describe("limits", () => {
  it("applies a default limit", () => {
    expect(compileReport(base()).sql).toContain("LIMIT 1000");
  });

  it("caps the limit so one report cannot exhaust the database", () => {
    expect(compileReport(base({ limit: 10_000_000 })).sql).toContain("LIMIT 50000");
  });

  it("floors a nonsensical limit at one row", () => {
    expect(compileReport(base({ limit: 0 })).sql).toContain("LIMIT 1");
    expect(compileReport(base({ limit: -5 })).sql).toContain("LIMIT 1");
  });

  it("ignores a negative offset", () => {
    expect(compileReport(base({ offset: -10 })).sql).not.toContain("OFFSET");
  });
});

describe("sources", () => {
  it("rejects an unknown source", () => {
    expect(() => compileReport(base({ source: "secrets" }))).toThrow(/Unknown data source/);
    expect(() => availableFields("secrets", ALL)).toThrow(/Unknown data source/);
  });

  it("compiles leave and attendance reports", () => {
    expect(
      compileReport({
        source: "leave",
        fields: ["department"],
        groupBy: ["department"],
        aggregations: [{ field: "totalDays", function: "sum", alias: "days" }],
      }).sql
    ).toContain("sum(lr.total_days)");

    expect(
      compileReport({
        source: "attendance",
        fields: ["employeeCode"],
        groupBy: ["employeeCode"],
        aggregations: [{ field: "overtimeMinutes", function: "sum", alias: "ot" }],
      }).sql
    ).toContain("sum(a.overtime_minutes)");
  });

  it("requires at least one field or aggregation", () => {
    expect(() => compileReport(base({ fields: [] }))).toThrow(/at least one field/);
  });
});
