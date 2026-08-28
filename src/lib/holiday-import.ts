// ═══════════════════════════════════════════════════════════════
// BULK HOLIDAY IMPORT — reading a year's calendar in one go
// ═══════════════════════════════════════════════════════════════
//
// Adding public holidays one dialog at a time is roughly twenty-five clicks a
// year per location, and the cost of missing one is not cosmetic: attendance
// marks somebody absent on a day the office was shut, leave deducts a working
// day that was never worked, and payroll counts it toward working days.
//
// Two sources, one shape. The curated Andhra Pradesh calendar in
// `ap-holidays.ts` covers the dates this product can state with certainty; a
// pasted list covers everything else — the lunisolar festivals that module
// deliberately refuses to guess, another state's calendar, an employer's own
// shutdown days.
//
// Parsing lives here rather than in the route so the screen previewing an
// import and the endpoint performing it agree about what a row means. Two
// parsers is how a preview shows twenty-six holidays and the import writes
// twenty-four.

import { canonicalName, holidaysFor, SUPPORTED_YEARS } from "@/lib/ap-holidays";

export interface ParsedHolidayRow {
  name: string;
  /** ISO date, YYYY-MM-DD. */
  holidayDate: string;
  year: number;
  isOptional: boolean;
  description: string | null;
}

export interface RowIssue {
  /** 1-based line number in the pasted text, so the message points at something the user can see. */
  line: number;
  text: string;
  reason: string;
}

export interface ParsedHolidayImport {
  rows: ParsedHolidayRow[];
  issues: RowIssue[];
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_LENGTHS[month - 1];
}

function isRealDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * Reads a date, accepting only forms that cannot mean two things.
 *
 * `2026-01-26` and `26-Jan-2026` are accepted. `26/01/2026` is not, and the
 * refusal is the point: the same string is the 26th of January to an Indian
 * reader and an invalid month to an American one, and `03/04/2026` is a real
 * date under both readings with two months between them. A holiday calendar
 * silently off by a month marks a whole office absent, so this asks the person
 * pasting to disambiguate rather than guessing on their behalf.
 */
export function parseHolidayDate(raw: string): string | null {
  const value = raw.trim();

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (isoMatch) {
    const [year, month, day] = [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])];
    return isRealDate(year, month, day) ? `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` : null;
  }

  const namedMatch = /^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/.exec(value);
  if (namedMatch) {
    const day = Number(namedMatch[1]);
    const month = MONTHS[namedMatch[2].slice(0, 3).toLowerCase()];
    const year = Number(namedMatch[3]);
    if (month === undefined || !isRealDate(year, month, day)) return null;
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  }

  return null;
}

/** Splits one CSV line, honouring double quotes so a description may contain a comma. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      // A doubled quote inside a quoted field is a literal quote — the
      // convention every spreadsheet writes and most hand-rolled splitters
      // forget, turning one field into two from that point on.
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

const TRUTHY = new Set(["true", "yes", "y", "1", "optional", "restricted"]);
const HEADER_FIRST_FIELDS = new Set(["name", "holiday", "holiday name", "festival"]);

/**
 * Reads pasted text into holiday rows, reporting every bad line rather than
 * stopping at the first.
 *
 * Columns are `name, date, optional, description` — the last two may be
 * omitted. A header row is detected and skipped rather than required, because
 * a list copied out of a spreadsheet usually has one and a list typed by hand
 * usually does not.
 *
 * A row that cannot be read becomes an issue, not an exception. Someone
 * pasting twenty-five holidays wants to hear about all three typos at once,
 * and a partial import that silently dropped rows would be worse than either.
 */
export function parseHolidayCsv(text: string): ParsedHolidayImport {
  const rows: ParsedHolidayRow[] = [];
  const issues: RowIssue[] = [];
  const seen = new Set<string>();

  const lines = text.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    const lineNumber = index + 1;
    if (!line) continue;

    const fields = splitCsvLine(line);
    const [nameField, dateField, optionalField, descriptionField] = fields;

    if (index === 0 && HEADER_FIRST_FIELDS.has((nameField ?? "").toLowerCase())) continue;

    if (!nameField) {
      issues.push({ line: lineNumber, text: line, reason: "No holiday name in the first column." });
      continue;
    }
    if (!dateField) {
      issues.push({
        line: lineNumber,
        text: line,
        reason: "No date in the second column. Expected: name, date, optional, description.",
      });
      continue;
    }

    const holidayDate = parseHolidayDate(dateField);
    if (!holidayDate) {
      issues.push({
        line: lineNumber,
        text: line,
        reason:
          `"${dateField}" is not a date this will accept. Use 2026-01-26 or 26-Jan-2026 — ` +
          `slash-separated dates are refused because 03/04/2026 means two different days ` +
          `either side of the Atlantic.`,
      });
      continue;
    }

    if (nameField.length > 200) {
      issues.push({ line: lineNumber, text: line, reason: "Holiday name is longer than 200 characters." });
      continue;
    }

    // Same day, same holiday, pasted twice — common when two years' lists are
    // concatenated. Keeping the first is right; reporting it stops the count
    // from silently disagreeing with the number of lines pasted.
    const name = canonicalName(nameField);
    const key = `${holidayDate}|${name.toLowerCase()}`;
    if (seen.has(key)) {
      issues.push({ line: lineNumber, text: line, reason: `Duplicate of an earlier line — ${name} on ${holidayDate}.` });
      continue;
    }
    seen.add(key);

    rows.push({
      name,
      holidayDate,
      year: Number(holidayDate.slice(0, 4)),
      isOptional: TRUTHY.has((optionalField ?? "").toLowerCase()),
      description: descriptionField ? descriptionField.slice(0, 2000) : null,
    });
  }

  rows.sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));
  return { rows, issues };
}

/**
 * The curated Andhra Pradesh calendar for one year, in import shape.
 *
 * Only the dates `ap-holidays.ts` states with certainty — the fixed-Gregorian
 * and solar ones. The lunisolar and Islamic festivals it deliberately refuses
 * to compute are not silently filled in here either; `missingFor` is what the
 * screen uses to say so, and pasting them is what the CSV path is for.
 *
 * Restricted holidays arrive as `isOptional`, which is the same idea under the
 * two products' different names: a day drawn from a floating pool rather than
 * a closed day everyone gets.
 */
export function apCalendarRows(year: number): ParsedHolidayRow[] {
  if (!Number.isInteger(year) || year < SUPPORTED_YEARS.first || year > SUPPORTED_YEARS.last) {
    throw new Error(
      `The Andhra Pradesh calendar is only generated for ${SUPPORTED_YEARS.first}–${SUPPORTED_YEARS.last}. ` +
        `For ${year}, paste the dates instead.`
    );
  }

  return holidaysFor(year).map((holiday) => ({
    name: holiday.name,
    holidayDate: holiday.date,
    year: holiday.year,
    isOptional: holiday.restricted,
    description: holiday.onWeekend
      ? `${holiday.description} Falls on a weekend this year — Indian public holidays are not moved to the following Monday.`
      : holiday.description,
  }));
}

export interface ExistingHoliday {
  holidayDate: string;
  name: string;
}

export interface DedupedImport {
  toInsert: ParsedHolidayRow[];
  duplicates: ParsedHolidayRow[];
}

/**
 * Splits rows into the ones worth writing and the ones already on file.
 *
 * `hrms.holidays` carries no unique constraint on (org, date, name), so
 * nothing in the database stops the same calendar being imported twice — and
 * "import the year again because two dates were added since" is exactly what
 * somebody will do. Matched on date *and* canonical name, so two genuinely
 * different holidays sharing a date both survive, which happens more often
 * than it sounds: Bhogi and New Year observances collide in some years.
 */
export function dedupeAgainstExisting(
  rows: readonly ParsedHolidayRow[],
  existing: readonly ExistingHoliday[]
): DedupedImport {
  const onFile = new Set(
    existing.map((row) => `${row.holidayDate}|${canonicalName(row.name).toLowerCase()}`)
  );

  const toInsert: ParsedHolidayRow[] = [];
  const duplicates: ParsedHolidayRow[] = [];

  for (const row of rows) {
    const key = `${row.holidayDate}|${row.name.toLowerCase()}`;
    if (onFile.has(key)) duplicates.push(row);
    else toInsert.push(row);
  }

  return { toInsert, duplicates };
}
