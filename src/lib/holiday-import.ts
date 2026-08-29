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

import * as XLSX from "xlsx";
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

const TRUTHY = new Set(["true", "yes", "y", "1", "optional", "restricted", "floating"]);
const HEADER_FIRST_FIELDS = new Set(["name", "holiday", "holiday name", "holiday name *", "festival", "title", "holiday_name"]);

/**
 * Reads CSV text into holiday rows, reporting every bad line rather than
 * stopping at the first.
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

    if (index === 0 && HEADER_FIRST_FIELDS.has((nameField ?? "").toLowerCase().replace(/[*_\s]+/g, " ").trim())) continue;

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
 * Parses an uploaded .xlsx or .csv spreadsheet file buffer into holiday rows.
 */
export function parseHolidaySpreadsheet(buffer: Buffer, _filename: string): ParsedHolidayImport {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return { rows: [], issues: [{ line: 1, text: "", reason: "The uploaded workbook contains no sheets." }] };
    }
    const sheet = workbook.Sheets[firstSheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return parseHolidayCsv(csv);
  } catch (err) {
    return {
      rows: [],
      issues: [
        {
          line: 1,
          text: "",
          reason: `Could not parse spreadsheet: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ],
    };
  }
}

/**
 * Generates all Saturdays and Sundays as weekly weekend holidays for a given year.
 */
export function weekendHolidayRows(year: number): ParsedHolidayRow[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new Error("Invalid year for weekend generation");
  }

  const rows: ParsedHolidayRow[] = [];
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dayOfWeek = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (dayOfWeek === 6) {
      // Saturday
      rows.push({
        name: "Saturday Off",
        holidayDate: iso,
        year,
        isOptional: false,
        description: "Weekly Weekend Holiday (Saturday)",
      });
    } else if (dayOfWeek === 0) {
      // Sunday
      rows.push({
        name: "Sunday Off",
        holidayDate: iso,
        year,
        isOptional: false,
        description: "Weekly Weekend Holiday (Sunday)",
      });
    }
  }

  return rows;
}

/**
 * The curated Andhra Pradesh calendar for one year, with optional weekend inclusion.
 */
export function apCalendarRows(year: number, includeWeekends: boolean = false): ParsedHolidayRow[] {
  if (!Number.isInteger(year) || year < SUPPORTED_YEARS.first || year > SUPPORTED_YEARS.last) {
    throw new Error(
      `The Andhra Pradesh calendar is only generated for ${SUPPORTED_YEARS.first}–${SUPPORTED_YEARS.last}. ` +
        `For ${year}, paste the dates instead.`
    );
  }

  const apHolidays: ParsedHolidayRow[] = holidaysFor(year).map((holiday) => ({
    name: holiday.name,
    holidayDate: holiday.date,
    year: holiday.year,
    isOptional: holiday.restricted,
    description: holiday.onWeekend
      ? `${holiday.description} Falls on a weekend this year — Indian public holidays are not moved to the following Monday.`
      : holiday.description,
  }));

  if (!includeWeekends) {
    return apHolidays;
  }

  const weekends = weekendHolidayRows(year);
  const existingDateMap = new Set(apHolidays.map((h) => h.holidayDate));
  
  // Combine public holidays and weekends (avoiding duplicate names on same dates)
  const combined: ParsedHolidayRow[] = [...apHolidays];
  for (const weekend of weekends) {
    if (!existingDateMap.has(weekend.holidayDate)) {
      combined.push(weekend);
    }
  }

  combined.sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));
  return combined;
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

// ─── Template Generation ─────────────────────────────────────

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const HOLIDAY_TEMPLATE_COLUMNS = [
  { header: "Holiday Name *", example1: "Republic Day", example2: "Diwali", example3: "Saturday Off", example4: "Sunday Off" },
  { header: "Date (YYYY-MM-DD) *", example1: "2026-01-26", example2: "2026-11-08", example3: "2026-01-03", example4: "2026-01-04" },
  { header: "Type (Gazetted / Optional / Weekend)", example1: "Gazetted", example2: "Gazetted", example3: "Weekend", example4: "Weekend" },
  { header: "Description / Notes", example1: "National Holiday", example2: "Festival of Lights", example3: "Weekly Off", example4: "Weekly Off" },
];

export function generateHolidayTemplateCsv(): string {
  const headers = HOLIDAY_TEMPLATE_COLUMNS.map((c) => c.header);
  const row1 = HOLIDAY_TEMPLATE_COLUMNS.map((c) => c.example1);
  const row2 = HOLIDAY_TEMPLATE_COLUMNS.map((c) => c.example2);
  const row3 = HOLIDAY_TEMPLATE_COLUMNS.map((c) => c.example3);
  const row4 = HOLIDAY_TEMPLATE_COLUMNS.map((c) => c.example4);
  const table = [headers, row1, row2, row3, row4];
  return table.map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function generateHolidayTemplateXlsx(): Buffer {
  const headers = HOLIDAY_TEMPLATE_COLUMNS.map((c) => c.header);
  const row1 = HOLIDAY_TEMPLATE_COLUMNS.map((c) => c.example1);
  const row2 = HOLIDAY_TEMPLATE_COLUMNS.map((c) => c.example2);
  const row3 = HOLIDAY_TEMPLATE_COLUMNS.map((c) => c.example3);
  const row4 = HOLIDAY_TEMPLATE_COLUMNS.map((c) => c.example4);
  const data = [headers, row1, row2, row3, row4];

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 4, 18) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Holiday Template");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

