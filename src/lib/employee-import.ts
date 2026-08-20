// ═══════════════════════════════════════════════════════════════
// BULK EMPLOYEE IMPORT — spreadsheet in, employee records out
// ═══════════════════════════════════════════════════════════════
// Everything here is pure: no database, no `fetch`, no Next.js request object.
// That is deliberate, not incidental — it is what lets header matching, row
// validation and date parsing be tested with plain vitest, the same reason
// `employee-rules.ts` stays free of a database import. The API routes under
// `src/app/api/employees/import/**` are the thin, untested-by-choice layer
// that turns a request into calls to the functions below, then turns a plan
// into database rows.
//
// ── Why this does not reuse `validateEmployeeFields` ──
// That function is right for the "Add Employee" form and wrong here, on
// purpose, in three ways:
//
//   - It requires the address to be on the org's configured company domain.
//     A brand-new customer — the entire audience for this feature — has
//     usually not configured one, so every row would fail against the
//     hard-coded circuvent.com fallback. Rejecting a new customer's own staff
//     for not using our domain is the opposite of what "import your
//     employees" means.
//   - It rejects the joining date being in the past. Every row here describes
//     somebody who already works there; a past join date is the *expected*
//     shape of the data, not a mistake. (The single-add form's own
//     `allowPastJoiningDate` escape hatch exists for exactly this case —
//     backfilling somebody who genuinely started before today — which is a
//     good sign this feature belongs on the lenient side of that switch.)
//   - It rejects role mailboxes (hr@, billing@) and enforces a letters-only
//     designation pattern. Neither is in this feature's brief, and both have
//     real false positives here — a designation such as "L2" or "Band 6" is
//     ordinary in plenty of organisations.
//
// So validation below is deliberately lighter: an email has to have the shape
// of an email, a date has to be a date, and a designation has to be present.
// Nothing here checks whose domain it is or whether it looks like a person.
//
// ── Employee codes ──
// There is no "Employee Code" field anywhere below — not as a canonical field,
// not as a header alias, not even one the user could map a column onto. A
// code in the uploaded file is never read, on purpose: every code this system
// hands out comes from `hrms.next_employee_code(org_id, prefix)`, which is
// the one place that guarantees two organisations — or a stale code carried
// over from whatever system the customer used before this one — can never
// collide. Guessing from the file would defeat the entire point of that
// function existing.

import * as XLSX from "xlsx";

import { normaliseEmploymentType } from "@/lib/employee-rules";

// ─── Canonical fields ────────────────────────────────────────

/**
 * The fields this importer understands, independent of what a customer's
 * spreadsheet happens to call them.
 *
 * `fullName` is its own field rather than an alias of `firstName`, because a
 * single "Employee Name" / "Full Name" / "Name" column — the shape the task's
 * own examples describe — has no first/last split to alias onto. It is split
 * at plan time in `resolveName`, once mapping has already decided which
 * column means what.
 */
export type ImportField =
  | "fullName"
  | "firstName"
  | "lastName"
  | "workEmail"
  | "joinDate"
  | "designation"
  | "department"
  | "employmentType"
  | "phone";

/**
 * One source of truth for the mapping UI, the same shape as
 * `EMPLOYMENT_TYPE_OPTIONS` in `employee-rules.ts` — a dropdown built from an
 * array here cannot drift from what the importer actually accepts.
 */
export const IMPORT_FIELD_OPTIONS: ReadonlyArray<{
  value: ImportField;
  label: string;
  required: boolean;
}> = [
  { value: "fullName", label: "Full Name", required: false },
  { value: "firstName", label: "First Name", required: false },
  { value: "lastName", label: "Last Name", required: false },
  { value: "workEmail", label: "Work Email", required: true },
  { value: "joinDate", label: "Join Date", required: true },
  { value: "designation", label: "Designation", required: true },
  { value: "department", label: "Department", required: false },
  { value: "employmentType", label: "Employment Type", required: false },
  { value: "phone", label: "Phone", required: false },
];

/** Spellings a customer's export is likely to use for each field, beyond the field's own name. */
const FIELD_ALIASES: Record<ImportField, string[]> = {
  fullName: ["full name", "employee name", "name", "staff name", "emp name"],
  firstName: ["first name", "fname", "given name", "forename"],
  lastName: ["last name", "lname", "surname", "family name"],
  workEmail: [
    "work email",
    "email",
    "email address",
    "official email",
    "company email",
    "business email",
    "email id",
    "work email address",
  ],
  joinDate: [
    "join date",
    "joining date",
    "date of joining",
    "doj",
    "start date",
    "hire date",
    "joined on",
    "date joined",
    "employment start date",
  ],
  designation: ["designation", "job title", "title", "role", "position"],
  department: ["department", "dept", "team", "division", "business unit"],
  employmentType: ["employment type", "emp type", "employee type", "worker type"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact number", "telephone"],
};

/**
 * Case, punctuation and whitespace all vary between exports of the same
 * concept — "Work Email", "work_email", "WORK EMAIL". Collapsing separators to
 * a single space and lower-casing puts all of them in one shape before they
 * are compared against the alias list.
 */
function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every space removed, so an acronym header ("DOJ", "D.O.J") matches an alias written as words ("date of joining" has no acronym form listed, but "doj" itself is one). */
function condense(normalisedHeader: string): string {
  return normalisedHeader.replace(/\s+/g, "");
}

const ALIAS_LOOKUP = new Map<string, ImportField>();
const CONDENSED_LOOKUP = new Map<string, ImportField>();

for (const field of Object.keys(FIELD_ALIASES) as ImportField[]) {
  // The canonical key itself is always a valid header too — an export of this
  // product's own data, or an API-shaped CSV, may literally say "workEmail".
  const aliases = [field, ...FIELD_ALIASES[field]];
  for (const alias of aliases) {
    const normalised = normaliseHeader(alias);
    if (!ALIAS_LOOKUP.has(normalised)) ALIAS_LOOKUP.set(normalised, field);
    const condensed = condense(normalised);
    if (!CONDENSED_LOOKUP.has(condensed)) CONDENSED_LOOKUP.set(condensed, field);
  }
}

function matchHeader(header: string): ImportField | null {
  const normalised = normaliseHeader(header);
  if (!normalised) return null;
  return ALIAS_LOOKUP.get(normalised) ?? CONDENSED_LOOKUP.get(condense(normalised)) ?? null;
}

export interface ColumnMappingSuggestion {
  /** Same length and order as the file's headers; `null` means "not imported". */
  mapping: (ImportField | null)[];
  /** Required fields with no column mapped to them anywhere in the file, as labels for display. */
  missingRequired: string[];
}

/**
 * Guesses which column is which, for the user to correct before anything is
 * previewed or committed — the file's own column order is never trusted.
 */
export function suggestColumnMapping(headers: string[]): ColumnMappingSuggestion {
  const mapping: (ImportField | null)[] = headers.map(matchHeader);

  // A bare "Name" column sitting next to an explicit "Last Name" column is
  // almost always the first name, not "Firstname Lastname" squashed together
  // — a file that already separates out the surname is not also repeating it
  // inside a combined name field. Left as `fullName` it would demand a first
  // name the user has to notice is missing and fix by hand; re-targeting it
  // gets the common case right without giving up the ability to override it.
  const fullNameIdx = mapping.indexOf("fullName");
  if (fullNameIdx !== -1 && mapping.includes("lastName") && !mapping.includes("firstName")) {
    mapping[fullNameIdx] = "firstName";
  }

  return { mapping, missingRequired: missingRequiredFields(mapping) };
}

/**
 * Required fields with no column mapped to them anywhere in `mapping`, as
 * labels for display.
 *
 * Factored out of `suggestColumnMapping` so the `/preview` route can ask the
 * same question again after the user edits the guess: the first answer comes
 * from the heuristic above, but the user's corrected mapping is what actually
 * decides whether there is enough here to run a dry run, and that check must
 * be the same function either way — not a second copy of "is Work Email
 * mapped" that could drift from the first.
 */
export function missingRequiredFields(mapping: (ImportField | null)[]): string[] {
  const has = (f: ImportField) => mapping.includes(f);
  const missingRequired: string[] = [];
  if (!has("workEmail")) missingRequired.push("Work Email");
  if (!has("joinDate")) missingRequired.push("Join Date");
  if (!has("designation")) missingRequired.push("Designation");
  if (!has("fullName") && !(has("firstName") && has("lastName"))) {
    missingRequired.push("Employee Name (a Full Name column, or both First Name and Last Name)");
  }
  return missingRequired;
}

/**
 * Reads one row's values out by canonical field rather than column position.
 *
 * When two columns map to the same field — a messy but real file, or a user
 * override that has not been cleaned up yet — the first one with a non-blank
 * value for that row wins, rather than the first column encountered
 * regardless of content.
 */
export function applyMapping(
  mapping: (ImportField | null)[],
  values: string[]
): Partial<Record<ImportField, string>> {
  const out: Partial<Record<ImportField, string>> = {};
  mapping.forEach((field, colIndex) => {
    if (!field) return;
    const value = values[colIndex] ?? "";
    if (value.trim() === "" || out[field] !== undefined) return;
    out[field] = value;
  });
  return out;
}

// ─── Spreadsheet parsing ─────────────────────────────────────

export interface ParsedSpreadsheet {
  headers: string[];
  /**
   * Data rows, each carrying the 1-based row number a spreadsheet application
   * would show (header is row 1). Fully blank rows are dropped rather than
   * turned into all-fields-missing rejections, but the numbering is not
   * reassigned around the gap — row 12 stays "row 12" even if row 11 was
   * blank and skipped, because that is the row the user will scroll to.
   */
  rows: { rowNumber: number; values: string[] }[];
}

/** A file that could not be read at all — bad format, empty, too large. Distinct from a row-level problem, which belongs in the plan, not an exception. */
export class SpreadsheetParseError extends Error {}

/** Rows above this are almost certainly the wrong file, or need splitting — a bulk import is meant to seed an org's roster once, not replace a data warehouse load. */
export const MAX_IMPORT_ROWS = 2000;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Excel stores a date cell as a serial number; asking `xlsx` for `cellDates`
 * gives back a real JS `Date` instead, built from that serial number at UTC
 * midnight. Reading it back with UTC getters is therefore the round trip —
 * local getters would shift the day for any server timezone behind UTC.
 */
function formatDateFromCell(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function cellToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return formatDateFromCell(value);
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

/**
 * Turns an uploaded file's bytes into headers plus rows of plain strings.
 *
 * CSV and XLSX are handled by two explicit branches rather than one call that
 * auto-detects the format from content: `xlsx` can usually tell a zip-based
 * XLSX from plain text, but a wrong guess on a customer's export is exactly
 * the kind of failure that should never happen silently. The extension the
 * browser reports is a much more reliable signal than content sniffing for
 * the two formats this feature promises to accept.
 *
 * Always reads with `header: 1` (arrays of arrays), never letting the library
 * turn the header row into object keys itself — column meaning is decided
 * entirely by `suggestColumnMapping`/`applyMapping` above, not by whatever key
 * name a duplicate or blank header would produce.
 */
export function parseSpreadsheet(data: ArrayBuffer | Buffer, filename: string): ParsedSpreadsheet {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length === 0) throw new SpreadsheetParseError("The file is empty.");

  const isCsv = /\.csv$/i.test(filename);

  let workbook: XLSX.WorkBook;
  try {
    // `raw: true` here (a `read` option, not just the `sheet_to_json` one
    // below) turned out to matter more than expected: without it, `xlsx`
    // "helpfully" guesses the type of every plain-text CSV cell, so a date
    // written as "04/03/2024" silently becomes the number 45385 (its Excel
    // serial value) before this module ever sees it, and a zero-padded value
    // like a phone number "0091234567" loses its leading zeros. With it, CSV
    // cells come back exactly as written and `parseTolerantDate` below is the
    // only thing that decides what a date string means. Confirmed empirically
    // against this exact version of the library, not assumed from docs.
    // Genuine Excel date cells are unaffected — those carry real type
    // metadata the file format itself provides, which is what `cellDates`
    // reads, so `.xlsx` files still hand back JS `Date` objects for them.
    workbook = isCsv
      ? XLSX.read(stripBom(buf.toString("utf8")), { type: "string", raw: true })
      : XLSX.read(buf, { type: "buffer", cellDates: true, raw: true });
  } catch {
    throw new SpreadsheetParseError(
      `Could not read "${filename}" as a spreadsheet. Upload a .xlsx or .csv file.`
    );
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new SpreadsheetParseError("The file has no sheets.");
  const sheet = workbook.Sheets[sheetName];

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
  if (grid.length === 0) throw new SpreadsheetParseError("The file has no data.");

  const headerRow = (grid[0] ?? []) as unknown[];
  const headers = headerRow.map((h) => String(h ?? "").trim());
  if (headers.every((h) => h === "")) {
    throw new SpreadsheetParseError("The first row must contain column headers.");
  }

  const rows: { rowNumber: number; values: string[] }[] = [];
  for (let i = 1; i < grid.length; i++) {
    const raw = (grid[i] ?? []) as unknown[];
    if (raw.every((c) => String(c ?? "").trim() === "")) continue; // a blank spacer row, common at the end of an export
    rows.push({ rowNumber: i + 1, values: headers.map((_, col) => cellToString(raw[col])) });
  }

  if (rows.length === 0) {
    throw new SpreadsheetParseError("The file has a header row but no data below it.");
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new SpreadsheetParseError(
      `This file has ${rows.length} data rows. Import ${MAX_IMPORT_ROWS} at a time — split larger files and import them separately.`
    );
  }

  return { headers, rows };
}

// ─── Date parsing ────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME_PREFIX = /^(\d{4})-(\d{2})-(\d{2})[T ]/;
const YEAR_FIRST_DATE = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;
const DAY_FIRST_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/;

function toIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Rejects the Date constructor's own tolerance for overflow (month 13, 31 Feb) by checking the parts survive a round trip. */
function isValidYmd(year: number, month: number, day: number): boolean {
  if (![year, month, day].every(Number.isInteger)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000 || year > 9999) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
  );
}

/**
 * Parses a date cell as tolerantly as a spreadsheet from an arbitrary HR
 * system is likely to need, in a fixed order chosen for which formats are
 * unambiguous:
 *
 *   1. Exact `YYYY-MM-DD` — already unambiguous, and what this function
 *      itself returns, so re-feeding an already-normalised date is a no-op.
 *   2. An ISO date with a time part (`2024-03-04T00:00:00Z`, "2024-03-04
 *      00:00:00") — the date prefix is taken as-is; the time, if any, is not
 *      this product's concern.
 *   3. `YYYY/MM/DD` or `YYYY-MM-DD`-with-slashes — unambiguous because a
 *      four-digit first component can only be a year.
 *   4. `DD/MM/YYYY` or `DD-MM-YYYY` — read day-first even when both parts are
 *      ≤12 and genuinely ambiguous (e.g. 03/04/2024), because this product's
 *      statutory defaults (PF, ESI, professional tax) are Indian and that is
 *      the convention its customers write dates in. Stated here rather than
 *      silently assumed.
 *   5. Anything containing a letter — a spelled-out month ("4 Mar 2024",
 *      "March 4, 2024") is unambiguous regardless of locale, so the platform's
 *      own date parser is trustworthy here in a way it is not for
 *      slash-separated numbers. Read with local getters because that is how
 *      the platform itself parsed a string with no explicit timezone.
 *
 * Returns `null` rather than throwing — an unparseable date is a row problem
 * to collect and report, not a reason to stop processing the file.
 */
export function parseTolerantDate(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const iso = ISO_DATE.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    return isValidYmd(Number(y), Number(m), Number(d)) ? trimmed : null;
  }

  const isoPrefix = ISO_DATE_TIME_PREFIX.exec(trimmed);
  if (isoPrefix) {
    const [, y, m, d] = isoPrefix;
    return isValidYmd(Number(y), Number(m), Number(d)) ? `${y}-${m}-${d}` : null;
  }

  const yearFirst = YEAR_FIRST_DATE.exec(trimmed);
  if (yearFirst) {
    const [, y, m, d] = yearFirst;
    return isValidYmd(Number(y), Number(m), Number(d)) ? toIso(Number(y), Number(m), Number(d)) : null;
  }

  const dayFirst = DAY_FIRST_DATE.exec(trimmed);
  if (dayFirst) {
    const [, dRaw, mRaw, yRaw] = dayFirst;
    const day = Number(dRaw);
    const month = Number(mRaw);
    let year = Number(yRaw);
    if (yRaw.length <= 2) year += year < 70 ? 2000 : 1900;
    return isValidYmd(year, month, day) ? toIso(year, month, day) : null;
  }

  if (/[A-Za-z]/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return toIso(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
    }
  }

  return null;
}

/** The same shape check `validateEmployeeFields` uses — an email has a local part, an "@", and a domain with a dot. Nothing about whose domain it is. */
export const EMAIL_SHAPE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Row planning ────────────────────────────────────────────

export interface CanonicalRow {
  rowNumber: number;
  firstName: string;
  lastName: string;
  /** Lower-cased and trimmed — the exact form collision checks and the unique index both key on. */
  workEmail: string;
  /** YYYY-MM-DD. */
  joinDate: string;
  designation: string;
  department?: string;
  /** Normalised to a stored enum value (e.g. "full_time"), never the raw spelling. */
  employmentType?: string;
  phone?: string;
}

export interface RejectedRow {
  rowNumber: number;
  /** The mapped values as read from the file, for the downloadable report — not the canonical row, which was never fully formed. */
  raw: Partial<Record<ImportField, string>>;
  reasons: string[];
}

export interface SkippedRow {
  rowNumber: number;
  workEmail: string;
  reasons: string[];
}

export interface ImportPlan {
  toCreate: CanonicalRow[];
  toSkip: SkippedRow[];
  toReject: RejectedRow[];
}

function resolveName(values: Partial<Record<ImportField, string>>): {
  firstName: string;
  lastName: string;
  nameReasons: string[];
} {
  const firstRaw = (values.firstName ?? "").trim();
  const lastRaw = (values.lastName ?? "").trim();

  if (firstRaw || lastRaw) {
    const reasons: string[] = [];
    if (!firstRaw) reasons.push("First name is required");
    if (!lastRaw) reasons.push("Last name is required");
    return { firstName: firstRaw, lastName: lastRaw, nameReasons: reasons };
  }

  const full = (values.fullName ?? "").trim();
  if (!full) {
    return {
      firstName: "",
      lastName: "",
      nameReasons: [
        "Name is required — map a Full Name column, or both First Name and Last Name",
      ],
    };
  }

  // Last whitespace-delimited token is the surname, the rest is the given
  // name — right for "Aditi Rao" and "Aditi Kumari Rao" alike, and the
  // ordinary reading of a single free-text name column.
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return {
      firstName: parts[0] ?? "",
      lastName: "",
      nameReasons: [`"${full}" has no separate last name — add one, or provide a Last Name column`],
    };
  }

  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1], nameReasons: [] };
}

/**
 * Validates and buckets every row, collecting every problem a row has rather
 * than stopping at its first — the same reason `validateEmployeeFields`
 * returns an array instead of throwing on the first issue.
 *
 * `existingEmails` is the org's current employees (see the collision note on
 * `CanonicalRow.workEmail`), matched case-insensitively; it must include
 * soft-deleted employees, because `employees_org_work_email_key` does — an
 * email is not available again just because the person who held it left.
 * Fetching that set is a database concern and stays out of this file; the
 * caller (`_lib.ts`) supplies it.
 *
 * Bucketing: a row with no problems at all creates. A row whose *only*
 * problem is that the email already belongs to an employee in this
 * organisation skips — that is the ordinary, harmless outcome of importing
 * the same file twice, not a mistake to fix. Anything else rejects, even if
 * a collision is also present, because there is a real data problem the user
 * needs to see regardless of what re-running would do.
 *
 * A duplicate email *within this file* is resolved by file order: the first
 * row to use an email is judged entirely on its own merits (and may itself be
 * rejected for an unrelated reason); every later row with the same email is
 * rejected as a duplicate, full stop. This is simpler to predict than trying
 * to track which duplicate "would have won" — the user fixes or removes the
 * duplicate and re-uploads, same as any other rejection.
 */
export function planImport(input: {
  rows: ParsedSpreadsheet["rows"];
  mapping: (ImportField | null)[];
  existingEmails: ReadonlySet<string>;
}): ImportPlan {
  const toCreate: CanonicalRow[] = [];
  const toSkip: SkippedRow[] = [];
  const toReject: RejectedRow[] = [];
  const seenInFile = new Map<string, number>();

  for (const row of input.rows) {
    const values = applyMapping(input.mapping, row.values);
    const hardReasons: string[] = [];

    const { firstName, lastName, nameReasons } = resolveName(values);
    hardReasons.push(...nameReasons);

    const emailRaw = (values.workEmail ?? "").trim();
    const email = emailRaw.toLowerCase();
    const emailShapeValid = EMAIL_SHAPE_PATTERN.test(emailRaw);
    if (!emailRaw) hardReasons.push("Work email is required");
    else if (!emailShapeValid) hardReasons.push(`"${emailRaw}" is not a valid email address`);

    let joinDate = "";
    const joinDateRaw = (values.joinDate ?? "").trim();
    if (!joinDateRaw) {
      hardReasons.push("Join date is required");
    } else {
      const parsed = parseTolerantDate(joinDateRaw);
      if (!parsed) hardReasons.push(`"${joinDateRaw}" could not be read as a date`);
      else joinDate = parsed;
    }

    const designation = (values.designation ?? "").trim();
    if (!designation) hardReasons.push("Designation is required");

    let collisionReason: string | null = null;
    if (emailRaw && emailShapeValid) {
      const firstSeenRow = seenInFile.get(email);
      if (firstSeenRow === undefined) {
        seenInFile.set(email, row.rowNumber);
        if (input.existingEmails.has(email)) {
          collisionReason = "An employee with this work email already exists in your organisation";
        }
      } else {
        hardReasons.push(
          `Duplicate work email — already used by row ${firstSeenRow} in this file; only the first occurrence is imported`
        );
      }
    }

    const employmentTypeRaw = (values.employmentType ?? "").trim();
    let employmentType: string | undefined;
    if (employmentTypeRaw) {
      const normalised = normaliseEmploymentType(employmentTypeRaw);
      if (!normalised) {
        hardReasons.push(
          `"${employmentTypeRaw}" is not a recognised employment type — leave the column blank for full-time`
        );
      } else {
        employmentType = normalised;
      }
    }

    if (hardReasons.length > 0) {
      toReject.push({
        rowNumber: row.rowNumber,
        raw: values,
        reasons: collisionReason ? [...hardReasons, collisionReason] : hardReasons,
      });
      continue;
    }
    if (collisionReason) {
      toSkip.push({ rowNumber: row.rowNumber, workEmail: email, reasons: [collisionReason] });
      continue;
    }

    toCreate.push({
      rowNumber: row.rowNumber,
      firstName,
      lastName,
      workEmail: email,
      joinDate,
      designation,
      department: values.department?.trim() || undefined,
      employmentType,
      phone: values.phone?.trim() || undefined,
    });
  }

  return { toCreate, toSkip, toReject };
}

// ─── Error report ────────────────────────────────────────────

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The downloadable report: one line per row that did not create, in file
 * order, with every reason collected for it. Rows that *did* create are not
 * in here — this file exists so HR can fix problems and re-upload, and a
 * successfully created row is not a problem.
 */
export function buildErrorReportCsv(plan: Pick<ImportPlan, "toReject" | "toSkip">): string {
  const lines = [
    ...plan.toReject.map((r) => ({
      rowNumber: r.rowNumber,
      status: "Rejected",
      workEmail: r.raw.workEmail ?? "",
      reasons: r.reasons.join("; "),
    })),
    ...plan.toSkip.map((r) => ({
      rowNumber: r.rowNumber,
      status: "Skipped (already in this organisation)",
      workEmail: r.workEmail,
      reasons: r.reasons.join("; "),
    })),
  ].sort((a, b) => a.rowNumber - b.rowNumber);

  const table = [
    ["Row", "Status", "Work Email", "Problems"],
    ...lines.map((l) => [String(l.rowNumber), l.status, l.workEmail, l.reasons]),
  ];

  return table.map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
