// ═══════════════════════════════════════════════════════════════
// EMPLOYEE CODE PREFIXES
// ═══════════════════════════════════════════════════════════════
// `hrms.next_employee_code` (drizzle/0031_employee_code_generator.sql,
// extended by drizzle/0040_intern_lifecycle.sql) owns the actual sequence —
// the advisory lock and the no-reuse scan both live in the database, where
// two concurrent transactions can actually be made to serialise. This file
// only owns the one decision the database cannot make for itself: which
// prefix a given hire draws from. Interns get CVI- (Circuvent Intern) so
// their codes are visibly distinct from permanent staff's CV- codes on every
// payslip, badge and signed letter — and, more importantly, so the two
// counts never collide: an org with 40 permanent staff and 40 interns ends
// up with both a CV-040 and a CVI-040, not one employee silently overwriting
// the sequence position of another.
//
// Keep this mapping here, not duplicated at each call site: `create()` and
// `convertToPermanent()` in `db/repositories/employee.neon.ts` both need it,
// and a hardcoded "CVI-" string in two places is how the four employee-code
// generators this migration replaced ended up drifting apart in the first
// place.

/** Permanent staff — full-time, part-time, contract or freelance. Unchanged
 * from before interns existed, so every pre-existing CV-* code stays valid. */
export const PERMANENT_EMPLOYEE_CODE_PREFIX = "CV-";

/** Interns only. A completely separate counter from CV-, not a sub-range of
 * it — see `hrms.next_employee_code`'s prefix-scoped regexp match. */
export const INTERN_EMPLOYEE_CODE_PREFIX = "CVI-";

/**
 * The one employment type that draws from the intern sequence. Every other
 * value of `employmentType` (full_time, part_time, contract, freelance) is
 * permanent staff for the purpose of code allocation, even though they are
 * not all "full time" — this only decides which counter to draw from, not
 * how the person is otherwise treated.
 */
const INTERN_EMPLOYMENT_TYPE = "intern";

/**
 * Which `hrms.next_employee_code` prefix a hire of this employment type
 * should draw from. Defaults to the permanent prefix for anything that
 * is not literally "intern", so a typo'd or future employment type never
 * silently falls through to CVI-.
 */
export function employeeCodePrefixFor(employmentType: string | null | undefined): string {
  return employmentType === INTERN_EMPLOYMENT_TYPE
    ? INTERN_EMPLOYEE_CODE_PREFIX
    : PERMANENT_EMPLOYEE_CODE_PREFIX;
}

/**
 * True for any code drawn from the intern sequence. Used where code alone
 * needs to signal "this was an intern's number", e.g. surfacing the retired
 * CVI- code on a converted employee's record without a second column lookup.
 *
 * Checked with a prefix match rather than equality against
 * `employeeCodePrefixFor` output, because this needs to answer the question
 * for codes read back out of the database (which may predate a schema
 * change to this file) as much as for codes this file just produced.
 */
export function isInternEmployeeCode(code: string | null | undefined): boolean {
  return typeof code === "string" && code.startsWith(INTERN_EMPLOYEE_CODE_PREFIX);
}
