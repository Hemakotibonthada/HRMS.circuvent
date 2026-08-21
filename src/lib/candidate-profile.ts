// ═══════════════════════════════════════════════════════════════
// The candidate registration projection
// ═══════════════════════════════════════════════════════════════
// What somebody typed into the Career portal when they joined, narrowed to the
// parts that belong on a profile page.
//
// The tables behind this are a joining form, not a CV. `candidate_registration_
// employment` carries `last_drawn_ctc_minor` — previous salary — along with a
// PF number, the employee id a former employer used, and the *name and phone
// number of a former reporting manager*, who never agreed to appear anywhere.
// Education carries exam scores.
//
// So this is an allowlist, as with `employee-profile.ts`. A redact list would
// be one forgotten column away from putting somebody's old salary on their
// colleague-visible profile, and the failure would be silent.

/** One row of education history, as shown on a profile. */
export interface CandidateEducation {
  /** "Class X", "Bachelor's", "Master's" — the stage, not the grade. */
  level: string | null;
  institution: string | null;
  boardOrUniversity: string | null;
  degree: string | null;
  specialisation: string | null;
  /** full_time, part_time, distance. */
  mode: string | null;
  startYear: number | null;
  endYear: number | null;
}

/** One previous employer. */
export interface CandidateEmployment {
  employer: string | null;
  designation: string | null;
  location: string | null;
  fromDate: string | null;
  toDate: string | null;
  isCurrent: boolean;
}

export interface CandidateProfile {
  education: CandidateEducation[];
  employment: CandidateEmployment[];
  /** True when a registration exists at all, even with no rows in it. */
  registered: boolean;
}

/**
 * Fields that must never leave these tables.
 *
 * Redundant with the allowlist by design: the allowlist is the mechanism, this
 * is the alarm, and an alarm that repeats the mechanism is what catches the day
 * somebody widens the mechanism without meaning to.
 */
export const FORBIDDEN_CANDIDATE_FIELDS = [
  "last_drawn_ctc_minor", "lastDrawnCtcMinor", "ctc", "salary",
  "pf_number", "pfNumber", "has_pf_account",
  "employee_id", "employeeId",
  "reporting_manager_name", "reportingManagerName",
  "reporting_manager_contact", "reportingManagerContact",
  "reason_for_leaving", "reasonForLeaving",
  "score", "score_type", "scoreType",
  "relieving_letter_available",
] as const;

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const year = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 1900 && n < 2200 ? n : null;
};

const date = (value: unknown): string | null => {
  if (!value) return null;
  // Postgres `date` arrives as a Date or an ISO string depending on the driver;
  // both are normalised to YYYY-MM-DD so the consumer never has to guess.
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * Narrows an education row.
 *
 * Written by naming each destination field rather than by copying and deleting
 * what is unwanted — the delete-what-you-do-not-want approach fails silently
 * as the table grows.
 */
export function toEducation(row: Record<string, unknown>): CandidateEducation {
  return {
    level: text(row.level),
    institution: text(row.institution),
    boardOrUniversity: text(row.board_university),
    degree: text(row.degree),
    specialisation: text(row.specialisation),
    mode: text(row.mode),
    startYear: year(row.start_year),
    endYear: year(row.end_year),
  };
}

export function toEmployment(row: Record<string, unknown>): CandidateEmployment {
  return {
    employer: text(row.employer),
    designation: text(row.designation),
    location: text(row.location),
    fromDate: date(row.from_date),
    toDate: date(row.to_date),
    isCurrent: row.is_current === true,
  };
}
