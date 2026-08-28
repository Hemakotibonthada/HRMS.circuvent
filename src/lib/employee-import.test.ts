// ═══════════════════════════════════════════════════════════════
// Bulk employee import — pure logic
// ═══════════════════════════════════════════════════════════════
// No database here, by design (see the header comment in employee-import.ts)
// — every case below is set up in memory so the whole module can be exercised
// without Neon, `withTenant`, or a Next.js request.

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  EMAIL_SHAPE_PATTERN,
  MAX_IMPORT_ROWS,
  SpreadsheetParseError,
  applyMapping,
  buildErrorReportCsv,
  missingRequiredFields,
  parseSpreadsheet,
  parseTolerantDate,
  planImport,
  suggestColumnMapping,
  type ImportField,
} from "./employee-import";

describe("suggestColumnMapping", () => {
  it("matches canonical field names against themselves", () => {
    const { mapping } = suggestColumnMapping([
      "firstName",
      "lastName",
      "workEmail",
      "joinDate",
      "designation",
    ]);
    expect(mapping).toEqual(["firstName", "lastName", "workEmail", "joinDate", "designation"]);
  });

  it("matches the task's own example header variants, case-insensitively", () => {
    // "Employee Name", "Full Name" and bare "name" are the three spellings the
    // task calls out by name as things a real export will use.
    expect(suggestColumnMapping(["Employee Name"]).mapping).toEqual(["fullName"]);
    expect(suggestColumnMapping(["Full Name"]).mapping).toEqual(["fullName"]);
    expect(suggestColumnMapping(["name"]).mapping).toEqual(["fullName"]);
    expect(suggestColumnMapping(["NAME"]).mapping).toEqual(["fullName"]);
  });

  it("tolerates underscores, dots and extra whitespace as word separators", () => {
    expect(suggestColumnMapping(["work_email"]).mapping).toEqual(["workEmail"]);
    expect(suggestColumnMapping(["  Work   Email  "]).mapping).toEqual(["workEmail"]);
    expect(suggestColumnMapping(["Date.Of.Joining"]).mapping).toEqual(["joinDate"]);
  });

  it("matches a condensed acronym header against its spelled-out alias", () => {
    // "DOJ" is a listed alias already; "D.O.J" is not spelled out anywhere —
    // it only matches because punctuation-stripping collapses it to "doj".
    expect(suggestColumnMapping(["DOJ"]).mapping).toEqual(["joinDate"]);
    expect(suggestColumnMapping(["D.O.J"]).mapping).toEqual(["joinDate"]);
  });

  it("leaves an unrecognised header unmapped rather than guessing", () => {
    expect(suggestColumnMapping(["Favourite Colour"]).mapping).toEqual([null]);
  });

  it("never maps any column onto an employee code — there is no such field to match", () => {
    const { mapping } = suggestColumnMapping(["Employee Code", "Employee ID", "Emp Code"]);
    expect(mapping).toEqual([null, null, null]);
  });

  it("retargets a bare Name column to firstName when a Last Name column is also present", () => {
    const { mapping, missingRequired } = suggestColumnMapping([
      "Name",
      "Last Name",
      "Work Email",
      "Join Date",
      "Designation",
    ]);
    expect(mapping).toEqual(["firstName", "lastName", "workEmail", "joinDate", "designation"]);
    expect(missingRequired).toEqual([]);
  });

  it("does not retarget Full Name when there is no separate Last Name column", () => {
    const { mapping } = suggestColumnMapping(["Full Name", "Work Email", "Join Date", "Designation"]);
    expect(mapping).toEqual(["fullName", "workEmail", "joinDate", "designation"]);
  });

  it("does not retarget Name when First Name is already mapped elsewhere", () => {
    const { mapping } = suggestColumnMapping(["Name", "First Name", "Last Name"]);
    // "Name" still resolves to fullName; the heuristic only fires when no
    // firstName column exists anywhere in the file.
    expect(mapping).toEqual(["fullName", "firstName", "lastName"]);
  });

  it("reports every missing required field, including the combined name requirement", () => {
    const { missingRequired } = suggestColumnMapping(["Phone"]);
    expect(missingRequired).toEqual([
      "Work Email",
      "Join Date",
      "Designation",
      "Employee Name (a Full Name column, or both First Name and Last Name)",
    ]);
  });

  it("does not report the name requirement once first and last name are both mapped", () => {
    const { missingRequired } = suggestColumnMapping(["First Name", "Last Name"]);
    expect(missingRequired).not.toContain(
      "Employee Name (a Full Name column, or both First Name and Last Name)"
    );
  });
});

describe("missingRequiredFields", () => {
  // Exercised directly, not just through `suggestColumnMapping`, because the
  // `/preview` route calls this again on the user's edited mapping — it is a
  // public contract in its own right now, not an implementation detail.
  it("reports nothing once every required field has a column", () => {
    const mapping: (ImportField | null)[] = ["fullName", "workEmail", "joinDate", "designation"];
    expect(missingRequiredFields(mapping)).toEqual([]);
  });

  it("accepts firstName + lastName as satisfying the name requirement without fullName", () => {
    const mapping: (ImportField | null)[] = ["firstName", "lastName", "workEmail", "joinDate", "designation"];
    expect(missingRequiredFields(mapping)).toEqual([]);
  });

  it("reports every required field as missing for a mapping of all nulls", () => {
    expect(missingRequiredFields([null, null])).toEqual([
      "Work Email",
      "Join Date",
      "Designation",
      "Employee Name (a Full Name column, or both First Name and Last Name)",
    ]);
  });

  it("still reports the name requirement when only one of firstName/lastName is mapped", () => {
    expect(missingRequiredFields(["firstName", "workEmail", "joinDate", "designation"])).toEqual([
      "Employee Name (a Full Name column, or both First Name and Last Name)",
    ]);
  });
});

describe("applyMapping", () => {
  const mapping: (ImportField | null)[] = ["firstName", null, "workEmail"];

  it("reads each column by its mapped field, ignoring unmapped columns", () => {
    expect(applyMapping(mapping, ["Aditi", "ignored", "aditi@x.com"])).toEqual({
      firstName: "Aditi",
      workEmail: "aditi@x.com",
    });
  });

  it("omits a field entirely when its column is blank", () => {
    expect(applyMapping(mapping, ["", "ignored", "aditi@x.com"])).toEqual({
      workEmail: "aditi@x.com",
    });
  });

  it("when two columns map to the same field, the first non-blank one wins", () => {
    const dupMapping: (ImportField | null)[] = ["workEmail", "workEmail"];
    expect(applyMapping(dupMapping, ["primary@x.com", "secondary@x.com"])).toEqual({
      workEmail: "primary@x.com",
    });
    // If the first is blank, the second is used — it is "first non-blank", not "first column".
    expect(applyMapping(dupMapping, ["", "secondary@x.com"])).toEqual({
      workEmail: "secondary@x.com",
    });
  });
});

describe("parseTolerantDate", () => {
  it("passes through an exact YYYY-MM-DD unchanged", () => {
    expect(parseTolerantDate("2024-03-04")).toBe("2024-03-04");
  });

  it("takes the date prefix off an ISO timestamp", () => {
    expect(parseTolerantDate("2024-03-04T10:30:00Z")).toBe("2024-03-04");
    expect(parseTolerantDate("2024-03-04 00:00:00")).toBe("2024-03-04");
  });

  it("reads a four-digit-year-first date as unambiguous", () => {
    expect(parseTolerantDate("2024/03/04")).toBe("2024-03-04");
    expect(parseTolerantDate("2024-3-4")).toBe("2024-03-04");
  });

  it("reads a slash or dash date as day-first, including the ambiguous both-under-13 case", () => {
    // 04/03/2024 could be read either way; this product's default is
    // day-first, so it must mean 4 March, not 3 April.
    expect(parseTolerantDate("04/03/2024")).toBe("2024-03-04");
    expect(parseTolerantDate("04-03-2024")).toBe("2024-03-04");
    // Unambiguous once the first part is over 12 — still day-first.
    expect(parseTolerantDate("25/12/2023")).toBe("2023-12-25");
  });

  it("pivots a 2-digit year the same way a spreadsheet application would", () => {
    expect(parseTolerantDate("15/06/25")).toBe("2025-06-15");
    expect(parseTolerantDate("15/06/69")).toBe("2069-06-15");
    expect(parseTolerantDate("15/06/70")).toBe("1970-06-15");
  });

  it("reads a spelled-out month unambiguously regardless of separator style", () => {
    expect(parseTolerantDate("4 Mar 2024")).toBe("2024-03-04");
    expect(parseTolerantDate("March 4, 2024")).toBe("2024-03-04");
  });

  it("rejects a date whose day or month does not exist", () => {
    expect(parseTolerantDate("2024-13-01")).toBeNull(); // month 13
    expect(parseTolerantDate("31/02/2024")).toBeNull(); // 31 February
    expect(parseTolerantDate("2024-02-30")).toBeNull(); // 30 February
  });

  it("rejects text that is not a date at all", () => {
    expect(parseTolerantDate("not a date")).toBeNull();
    expect(parseTolerantDate("")).toBeNull();
    expect(parseTolerantDate("   ")).toBeNull();
  });
});

describe("EMAIL_SHAPE_PATTERN", () => {
  it("accepts ordinary email shapes", () => {
    expect(EMAIL_SHAPE_PATTERN.test("aditi.rao@example.com")).toBe(true);
    expect(EMAIL_SHAPE_PATTERN.test("a@b.co.in")).toBe(true);
  });

  it("rejects anything missing an @ or a domain dot", () => {
    expect(EMAIL_SHAPE_PATTERN.test("aditi.rao")).toBe(false);
    expect(EMAIL_SHAPE_PATTERN.test("aditi.rao@example")).toBe(false);
    expect(EMAIL_SHAPE_PATTERN.test("aditi rao@example.com")).toBe(false);
    expect(EMAIL_SHAPE_PATTERN.test("")).toBe(false);
  });

  // Deliberately not tested here: whose domain it is, or whether it is a role
  // mailbox — see the file header for why this feature does not apply
  // `isCompanyAddress` / `isRoleAddress` from employee-rules.ts.
});

describe("planImport", () => {
  const mapping: (ImportField | null)[] = [
    "firstName",
    "lastName",
    "workEmail",
    "joinDate",
    "designation",
    "department",
    "employmentType",
    "phone",
  ];
  const FIELD_ORDER = mapping as ImportField[];

  /** Builds one spreadsheet row from field values, in whatever order `mapping` above declares. */
  function row(rowNumber: number, values: Partial<Record<ImportField, string>>) {
    return { rowNumber, values: FIELD_ORDER.map((f) => values[f] ?? "") };
  }

  it("creates a fully valid row, normalising email case, date shape and employment type", () => {
    const plan = planImport({
      rows: [
        row(2, {
          firstName: "Aditi",
          lastName: "Rao",
          workEmail: "Aditi.Rao@Example.com",
          joinDate: "04/03/2024",
          designation: "Engineer",
          department: "Engineering",
          employmentType: "Full-time",
          phone: "9876543210",
        }),
      ],
      mapping,
      existingEmails: new Set<string>(),
    });

    expect(plan.toReject).toEqual([]);
    expect(plan.toSkip).toEqual([]);
    expect(plan.toCreate).toEqual([
      {
        rowNumber: 2,
        firstName: "Aditi",
        lastName: "Rao",
        workEmail: "aditi.rao@example.com",
        joinDate: "2024-03-04",
        designation: "Engineer",
        department: "Engineering",
        employmentType: "full_time",
        phone: "9876543210",
      },
    ]);
  });

  it("splits a Full Name column into first/last when there is no separate last name column", () => {
    const fullNameMapping: (ImportField | null)[] = ["fullName", "workEmail", "joinDate", "designation"];
    const plan = planImport({
      rows: [
        {
          rowNumber: 2,
          values: ["Aditi Kumari Rao", "aditi@example.com", "2024-03-04", "Engineer"],
        },
      ],
      mapping: fullNameMapping,
      existingEmails: new Set<string>(),
    });
    expect(plan.toCreate).toEqual([
      expect.objectContaining({ firstName: "Aditi Kumari", lastName: "Rao" }),
    ]);
  });

  it("collects every problem on a bad row at once, not just the first", () => {
    const plan = planImport({ rows: [row(5, {})], mapping, existingEmails: new Set<string>() });
    expect(plan.toCreate).toEqual([]);
    expect(plan.toSkip).toEqual([]);
    expect(plan.toReject).toHaveLength(1);
    expect(plan.toReject[0].rowNumber).toBe(5);
    expect(plan.toReject[0].reasons).toEqual([
      "Name is required — map a Full Name column, or both First Name and Last Name",
      "Work email is required",
      "Join date is required",
      "Designation is required",
    ]);
  });

  it("rejects an invalid email shape with a specific reason", () => {
    const plan = planImport({
      rows: [row(2, { firstName: "A", lastName: "B", workEmail: "not-an-email", joinDate: "2024-01-01", designation: "Engineer" })],
      mapping,
      existingEmails: new Set<string>(),
    });
    expect(plan.toReject[0].reasons).toEqual(['"not-an-email" is not a valid email address']);
  });

  it("rejects an unparseable date with a specific reason", () => {
    const plan = planImport({
      rows: [row(2, { firstName: "A", lastName: "B", workEmail: "a@b.com", joinDate: "45th of Junuary", designation: "Engineer" })],
      mapping,
      existingEmails: new Set<string>(),
    });
    expect(plan.toReject[0].reasons).toEqual(['"45th of Junuary" could not be read as a date']);
  });

  it("does not require an employment type column at all", () => {
    const plan = planImport({
      rows: [row(2, { firstName: "A", lastName: "B", workEmail: "a@b.com", joinDate: "2024-01-01", designation: "Engineer" })],
      mapping,
      existingEmails: new Set<string>(),
    });
    expect(plan.toReject).toEqual([]);
    expect(plan.toCreate[0].employmentType).toBeUndefined();
  });

  it("rejects an unrecognised employment type value when the column is present", () => {
    const plan = planImport({
      rows: [
        row(2, {
          firstName: "A",
          lastName: "B",
          workEmail: "a@b.com",
          joinDate: "2024-01-01",
          designation: "Engineer",
          employmentType: "made up type",
        }),
      ],
      mapping,
      existingEmails: new Set<string>(),
    });
    expect(plan.toReject[0].reasons).toEqual([
      '"made up type" is not a recognised employment type — leave the column blank for full-time',
    ]);
  });

  it("treats designation values like 'L2' as valid — no letters-only pattern is enforced here", () => {
    const plan = planImport({
      rows: [row(2, { firstName: "A", lastName: "B", workEmail: "a@b.com", joinDate: "2024-01-01", designation: "L2" })],
      mapping,
      existingEmails: new Set<string>(),
    });
    expect(plan.toReject).toEqual([]);
    expect(plan.toCreate[0].designation).toBe("L2");
  });

  it("accepts a past join date without complaint — that is the expected shape for a bulk import", () => {
    const plan = planImport({
      rows: [row(2, { firstName: "A", lastName: "B", workEmail: "a@b.com", joinDate: "2010-01-01", designation: "Engineer" })],
      mapping,
      existingEmails: new Set<string>(),
    });
    expect(plan.toReject).toEqual([]);
    expect(plan.toCreate[0].joinDate).toBe("2010-01-01");
  });

  it("resolves an in-file duplicate email by first occurrence, independent of that row's own validity", () => {
    const plan = planImport({
      rows: [
        // Row 2 uses the email but is itself invalid (bad designation) — it
        // is still the one "first seen", judged only on its own problem.
        row(2, { firstName: "A", lastName: "One", workEmail: "dup@x.com", joinDate: "2024-01-01", designation: "" }),
        row(3, { firstName: "B", lastName: "Two", workEmail: "dup@x.com", joinDate: "2024-01-02", designation: "Engineer" }),
      ],
      mapping,
      existingEmails: new Set<string>(),
    });
    expect(plan.toCreate).toEqual([]);
    expect(plan.toReject).toHaveLength(2);
    expect(plan.toReject[0].reasons).toEqual(["Designation is required"]);
    expect(plan.toReject[1].reasons).toEqual([
      "Duplicate work email — already used by row 2 in this file; only the first occurrence is imported",
    ]);
  });

  it("skips (does not reject) a row whose only problem is an existing-organisation email collision", () => {
    const plan = planImport({
      rows: [row(2, { firstName: "A", lastName: "B", workEmail: "already@x.com", joinDate: "2024-01-01", designation: "Engineer" })],
      mapping,
      existingEmails: new Set<string>(["already@x.com"]),
    });
    expect(plan.toCreate).toEqual([]);
    expect(plan.toReject).toEqual([]);
    expect(plan.toSkip).toEqual([
      {
        rowNumber: 2,
        workEmail: "already@x.com",
        reasons: ["An employee with this work email already exists in your organisation"],
      },
    ]);
  });

  it("matches an existing-organisation collision case-insensitively", () => {
    const plan = planImport({
      rows: [row(2, { firstName: "A", lastName: "B", workEmail: "Already@X.com", joinDate: "2024-01-01", designation: "Engineer" })],
      mapping,
      existingEmails: new Set<string>(["already@x.com"]),
    });
    expect(plan.toSkip).toHaveLength(1);
  });

  it("rejects rather than skips when a collision row also has a real problem", () => {
    const plan = planImport({
      rows: [row(2, { firstName: "A", lastName: "B", workEmail: "already@x.com", joinDate: "not a date", designation: "Engineer" })],
      mapping,
      existingEmails: new Set<string>(["already@x.com"]),
    });
    expect(plan.toSkip).toEqual([]);
    expect(plan.toReject).toEqual([
      {
        rowNumber: 2,
        raw: expect.objectContaining({ workEmail: "already@x.com" }),
        reasons: [
          '"not a date" could not be read as a date',
          "An employee with this work email already exists in your organisation",
        ],
      },
    ]);
  });

  it("leaves department and phone unset when blank, rather than empty strings", () => {
    const plan = planImport({
      rows: [row(2, { firstName: "A", lastName: "B", workEmail: "a@b.com", joinDate: "2024-01-01", designation: "Engineer" })],
      mapping,
      existingEmails: new Set<string>(),
    });
    expect(plan.toCreate[0].department).toBeUndefined();
    expect(plan.toCreate[0].phone).toBeUndefined();
  });
});

describe("idempotent re-import", () => {
  it("importing the same file twice creates nothing the second time", () => {
    const mapping: (ImportField | null)[] = ["firstName", "lastName", "workEmail", "joinDate", "designation"];
    const rows = [
      { rowNumber: 2, values: ["Aditi", "Rao", "aditi@example.com", "2024-01-01", "Engineer"] },
      { rowNumber: 3, values: ["Bob", "Singh", "bob@example.com", "2024-02-01", "Manager"] },
    ];

    // First run: a brand new organisation, nobody exists yet.
    const first = planImport({ rows, mapping, existingEmails: new Set<string>() });
    expect(first.toCreate).toHaveLength(2);
    expect(first.toSkip).toEqual([]);
    expect(first.toReject).toEqual([]);

    // Simulate the commit: the org's employees now include exactly the
    // emails that were created (this is what `_lib.ts` would fetch back out
    // of the database before the second `planImport` call).
    const existingEmails = new Set(first.toCreate.map((r) => r.workEmail));

    // Second run: the identical file, re-uploaded against the same org.
    const second = planImport({ rows, mapping, existingEmails });
    expect(second.toCreate).toEqual([]);
    expect(second.toReject).toEqual([]);
    expect(second.toSkip).toEqual([
      {
        rowNumber: 2,
        workEmail: "aditi@example.com",
        reasons: ["An employee with this work email already exists in your organisation"],
      },
      {
        rowNumber: 3,
        workEmail: "bob@example.com",
        reasons: ["An employee with this work email already exists in your organisation"],
      },
    ]);
  });
});

describe("parseSpreadsheet", () => {
  it("rejects a zero-byte upload", () => {
    expect(() => parseSpreadsheet(Buffer.from(""), "empty.csv")).toThrow(SpreadsheetParseError);
  });

  it("rejects content that cannot be read as a spreadsheet at all", () => {
    // A ZIP-magic-number prefix routes into the XLSX/zip parser, which then
    // fails hard on the bogus content that follows — unlike arbitrary
    // non-zip bytes, which xlsx will happily read as a one-cell text sheet.
    const fakeZip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("not actually a valid zip archive"),
    ]);
    expect(() => parseSpreadsheet(fakeZip, "employees.xlsx")).toThrow(SpreadsheetParseError);
  });

  it("rejects a header row with no column names at all", () => {
    expect(() => parseSpreadsheet(Buffer.from(",,\r\ndata,data,data\r\n"), "employees.csv")).toThrow(
      SpreadsheetParseError
    );
  });

  it("rejects a file with headers but no data rows", () => {
    expect(() => parseSpreadsheet(Buffer.from("Name,Work Email\r\n"), "employees.csv")).toThrow(
      SpreadsheetParseError
    );
  });

  it("rejects more rows than the import cap", () => {
    const lines = ["Name,Work Email"];
    for (let i = 0; i < MAX_IMPORT_ROWS + 1; i++) lines.push(`Person ${i},p${i}@x.com`);
    expect(() => parseSpreadsheet(Buffer.from(lines.join("\r\n")), "employees.csv")).toThrow(
      SpreadsheetParseError
    );
  });

  it("parses a CSV file, stripping a BOM from the header and preserving row numbers across a blank row", () => {
    const csv =
      "\uFEFFName,Work Email,Join Date,Designation\r\n" +
      "Alice One,alice@x.com,2024-01-01,Engineer\r\n" +
      ",,,\r\n" +
      "Bob Two,bob@x.com,2024-02-02,Manager\r\n";
    const parsed = parseSpreadsheet(Buffer.from(csv, "utf8"), "employees.csv");
    expect(parsed.headers).toEqual(["Name", "Work Email", "Join Date", "Designation"]);
    expect(parsed.rows.map((r) => r.rowNumber)).toEqual([2, 4]); // row 3 (blank) is skipped, not renumbered away
    expect(parsed.rows[1].values).toEqual(["Bob Two", "bob@x.com", "2024-02-02", "Manager"]);
  });

  it("keeps a numeric-looking CSV cell as literal text instead of coercing it", () => {
    // The regression this guards: without `raw: true` on the `read` call,
    // xlsx quietly turns "007" into the number 7 and a slash-date into an
    // Excel serial number before this module ever sees the cell.
    const csv = "Name,Work Email,Join Date,Designation\r\nA B,a@x.com,04/03/2024,007\r\n";
    const parsed = parseSpreadsheet(Buffer.from(csv, "utf8"), "employees.csv");
    expect(parsed.rows[0].values).toEqual(["A B", "a@x.com", "04/03/2024", "007"]);
  });

  it("parses an XLSX file, reading a real Date cell back without an off-by-one day", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Name", "Join Date", "Designation"],
      ["Alice One", new Date(Date.UTC(2020, 5, 15)), "Engineer"],
      ["", "", ""],
      ["Bob Two", new Date(Date.UTC(2021, 11, 31)), "Manager"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const parsed = parseSpreadsheet(buf, "employees.xlsx");
    expect(parsed.headers).toEqual(["Name", "Join Date", "Designation"]);
    expect(parsed.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(parsed.rows[0].values).toEqual(["Alice One", "2020-06-15", "Engineer"]);
    expect(parsed.rows[1].values).toEqual(["Bob Two", "2021-12-31", "Manager"]);
  });
});

describe("buildErrorReportCsv", () => {
  it("combines rejected and skipped rows, sorted by original row number", () => {
    const csv = buildErrorReportCsv({
      toReject: [{ rowNumber: 5, raw: { workEmail: "bad@x.com" }, reasons: ["Designation is required"] }],
      toSkip: [{ rowNumber: 2, workEmail: "dup@x.com", reasons: ["Already exists"] }],
    });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Row,Status,Work Email,Problems");
    expect(lines[1]).toBe("2,Skipped (already in this organisation),dup@x.com,Already exists");
    expect(lines[2]).toBe("5,Rejected,bad@x.com,Designation is required");
  });

  it("quotes a field that contains a comma, quote or newline", () => {
    const csv = buildErrorReportCsv({
      toReject: [
        {
          rowNumber: 1,
          raw: { workEmail: 'weird,"email@x.com' },
          reasons: ['Contains a comma, a "quote", and\na newline'],
        },
      ],
      toSkip: [],
    });
    const dataLine = csv.trim().split("\r\n")[1];
    expect(dataLine).toBe(
      '1,Rejected,"weird,""email@x.com","Contains a comma, a ""quote"", and\na newline"'
    );
  });

  it("produces just the header for an empty plan", () => {
    const csv = buildErrorReportCsv({ toReject: [], toSkip: [] });
    expect(csv).toBe("Row,Status,Work Email,Problems\r\n");
  });
});
