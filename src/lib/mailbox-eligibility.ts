// ═══════════════════════════════════════════════════════════════
// MAILBOX ELIGIBILITY — proving who you are with no account yet
// ═══════════════════════════════════════════════════════════════
// Somebody who opens mail.circuvent.com/register directly, rather than through
// the link in their onboarding email, has nothing identifying them. The form
// asked for a name, an address and a password — all of which they choose — so
// the request that reached the approvals queue could have come from anybody,
// and there was no identifier to link it to an HR record.
//
// This is the other half of that: they state their employee ID and joining
// date, and HRMS says whether that pair names a real, current employee.
//
// ── Why the joining date, and not the date of birth ──
// Date of birth was the first choice: it is the convention here already, since
// a payslip PDF opens with the first four letters of the name and DDMM of it.
// Then the column turned out to be empty for every employee on file, which
// would have made this refuse the entire workforce while looking correct.
//
// `join_date` is populated for everyone, is printed on the offer letter, and
// is quoted back in the onboarding email itself. It is a slightly weaker
// secret than a birthday — a determined guesser could try a season's worth of
// Mondays — which is why the attempt limit is tight and why matching it does
// not create anything. It places a request in a queue that a human approves,
// and that human is shown the HR record it matched.
//
// ── Why the refusals are deliberately vague ──
// The caller is told "no", never which half was wrong. Distinguishing "no such
// employee ID" from "wrong date" turns this into an oracle for enumerating
// employee IDs first and then brute-forcing the date against a known one.

/** What HRMS holds about somebody, once the pair has matched. */
export interface EligibleEmployee {
  employeeId: string;
  employeeCode: string;
  displayName: string;
  designation: string | null;
  department: string | null;
  employmentType: string | null;
  orgId: string;
}

export type EligibilityDecision =
  | { ok: true; employee: EligibleEmployee }
  | { ok: false; reason: EligibilityRefusal };

/**
 * Why a request was refused.
 *
 * Recorded in HRMS's own logs so an administrator can tell a genuine mismatch
 * from somebody probing, and deliberately **not** returned to the caller —
 * see the header. The wire response carries `ok: false` and nothing else.
 */
export type EligibilityRefusal =
  | "no-match"
  | "not-current"
  | "already-has-mailbox"
  | "no-joining-date-on-file";

/** The row shape this rule needs, so it can be tested without a database. */
export interface EmployeeRecord {
  id: string;
  orgId: string;
  employeeCode: string;
  firstName: string | null;
  lastName: string | null;
  designation: string | null;
  department: string | null;
  employmentType: string | null;
  joinDate: string | Date | null;
  status: string | null;
  deletedAt: Date | string | null;
  /** True when a mailbox request or account already exists for this person. */
  hasMailbox?: boolean;
}

/** Employment statuses that may not claim a mailbox. */
const INELIGIBLE_STATUSES = new Set(["terminated", "inactive"]);

/**
 * Decides whether this employee may claim a mailbox.
 *
 * Takes the candidate row rather than fetching it, so every branch here is
 * reachable in a test — including the ones that matter most, which are the
 * refusals.
 */
export function checkMailboxEligibility(
  employee: EmployeeRecord | null | undefined,
  suppliedJoiningDate: string
): EligibilityDecision {
  if (!employee) return { ok: false, reason: "no-match" };
  if (employee.deletedAt) return { ok: false, reason: "no-match" };

  // A leaver must not be able to create a company mailbox. Checked before the
  // date so that a correct pair for somebody who has left is still a refusal
  // rather than a match.
  if (INELIGIBLE_STATUSES.has(String(employee.status ?? "").toLowerCase())) {
    return { ok: false, reason: "not-current" };
  }

  const onFile = normaliseDate(employee.joinDate);
  if (!onFile) {
    // Nobody can match a blank. Refusing rather than skipping the check is the
    // whole point: an employee with no joining date recorded would otherwise
    // be claimable by anyone who knows their employee ID.
    return { ok: false, reason: "no-joining-date-on-file" };
  }

  const supplied = normaliseDate(suppliedJoiningDate);
  if (!supplied || supplied !== onFile) return { ok: false, reason: "no-match" };

  if (employee.hasMailbox) return { ok: false, reason: "already-has-mailbox" };

  const displayName = [employee.firstName, employee.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    ok: true,
    employee: {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      displayName: displayName || employee.employeeCode,
      designation: employee.designation ?? null,
      department: employee.department ?? null,
      employmentType: employee.employmentType ?? null,
      orgId: employee.orgId,
    },
  };
}

/**
 * Picks the matching employee from every organisation that holds that code.
 *
 * Employee codes are unique per organisation, not globally: `CV-001` exists in
 * two of them on this deployment already. Checking only the first organisation
 * that happens to hold the code would refuse a genuine employee because a
 * different company's record shares their number — so every candidate is
 * evaluated and the first that *passes* wins, rather than the first that is
 * merely found.
 */
export function selectEligible(
  candidates: readonly (EmployeeRecord | null | undefined)[],
  suppliedJoiningDate: string
): EligibilityDecision {
  let firstRefusal: EligibilityDecision | null = null;

  for (const candidate of candidates) {
    const decision = checkMailboxEligibility(candidate, suppliedJoiningDate);
    if (decision.ok) return decision;
    // Kept for the log, so "why was this refused" names something specific
    // rather than always saying no-match.
    if (!firstRefusal && candidate) firstRefusal = decision;
  }

  return firstRefusal ?? { ok: false, reason: "no-match" };
}

/**
 * Reduces a date to `YYYY-MM-DD`, or null when it is not a date.
 *
 * A `date` column comes back from pg as a Date in the server's zone; the form
 * sends a string. Comparing those directly is how a date one day either side
 * of midnight stops matching, so both are reduced to calendar parts and never
 * passed through a timezone conversion.
 */
export function normaliseDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Local parts, not toISOString(): the latter shifts to UTC, which moves the
    // date for anybody east or west of it.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return null;

  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${m}-${d}`;
}
