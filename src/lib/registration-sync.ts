// ═══════════════════════════════════════════════════════════════
// REGISTRATION → EMPLOYEE — using what the joiner already told us
// ═══════════════════════════════════════════════════════════════
// A candidate fills in a long joining form on the Careers portal: legal name,
// date of birth, address, emergency contact, statutory numbers. It lands in
// `hrms.candidate_registration`, and for anybody hired through the ATS handoff
// most of it is copied onto the employee record at that moment.
//
// Anybody added another way — and every employee on this deployment was —
// keeps an employee record with those columns empty while the answers sit in
// the registration table, already given, never used. That is not only untidy:
// `date_of_birth` is what a payslip PDF's password is built from, and what PF
// and ESI eligibility are decided by, so an empty column has consequences well
// beyond a blank field on a profile page.
//
// ── Fills, never overwrites ──
// Only empty employee fields are populated. If HR has typed a correction, the
// registration is older information and must not win: a joining form completed
// weeks ago should not quietly revert an address somebody updated yesterday.
// That makes this safe to run repeatedly, which is what lets the nightly sweep
// call it rather than it being a one-off migration somebody has to remember.
//
// ── What is deliberately NOT copied ──
// PAN, Aadhaar, UAN, PF and ESI numbers. The registration holds them encrypted
// under ATS's `REGISTRATION_ENCRYPTION_KEY`; HRMS reads its own encrypted
// columns with `ENCRYPTION_KEY`. They are different keys held by different
// applications, so copying the ciphertext across would store a value HRMS can
// never decrypt — and Paystub, which reads those columns to print statutory
// numbers on a payslip, would emit rubbish rather than an em dash. The masked
// forms ("XXXXXX740A") are readable but are not the number, so they are no
// substitute. Moving these needs a decrypt-and-re-encrypt on the ATS side,
// where the registration key lives; it is not something this can do safely.

/** The employee columns this can fill. */
export interface EmployeePersonalFields {
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  bloodGroup: string | null;
  personalEmail: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

/** The registration columns this reads. */
export interface RegistrationSource {
  submittedAt: Date | string | null;
  dateOfBirth: string | Date | null;
  gender: string | null;
  maritalStatus: string | null;
  bloodGroup: string | null;
  personalEmail: string | null;
  mobile: string | null;
  mobileCountryCode?: string | null;
  presentLine1: string | null;
  presentLine2?: string | null;
  presentCity: string | null;
  presentState: string | null;
  presentPin: string | null;
  presentCountry: string | null;
}

export interface RegistrationSyncPlan {
  /** Columns to set, empty when there is nothing to do. */
  updates: Partial<EmployeePersonalFields>;
  /** Names of the fields being filled, for the audit line and the response. */
  filled: string[];
  /** Why nothing is being done, when that is the case. */
  reason?: "no-registration" | "not-submitted" | "already-complete";
}

/** `gender` is a Postgres enum on the employee row; anything else is dropped. */
const GENDER_VALUES = new Set(["male", "female", "other", "prefer_not_to_say"]);

function blank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

/** `YYYY-MM-DD` from a date column or a string, without a timezone conversion. */
function asDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Joins a mobile number to its country code.
 *
 * The form stores them apart. Stored apart on the employee they would be, at
 * best, a number nobody can dial from abroad — so they are rejoined here, and
 * only when the number does not already carry a prefix.
 */
function fullMobile(mobile: string | null, countryCode?: string | null): string | null {
  const number = String(mobile ?? "").trim();
  if (number.length === 0) return null;
  const code = String(countryCode ?? "").trim();
  if (!code || number.startsWith("+")) return number;
  return `${code} ${number}`;
}

/**
 * Works out what the registration can fill in on this employee.
 *
 * Takes both rows rather than fetching them, so every branch — including the
 * ones that decline to write anything — is reachable in a test.
 */
export function planRegistrationSync(
  employee: Partial<EmployeePersonalFields>,
  registration: RegistrationSource | null | undefined
): RegistrationSyncPlan {
  if (!registration) return { updates: {}, filled: [], reason: "no-registration" };

  // An unsubmitted form is a draft. Somebody halfway through typing their
  // address has not told us anything yet, and copying a half-finished answer
  // onto a personnel record would be worse than leaving the column empty.
  if (blank(registration.submittedAt)) {
    return { updates: {}, filled: [], reason: "not-submitted" };
  }

  const updates: Partial<EmployeePersonalFields> = {};

  const candidates: Array<[keyof EmployeePersonalFields, string | null]> = [
    ["dateOfBirth", asDateString(registration.dateOfBirth)],
    [
      "gender",
      GENDER_VALUES.has(String(registration.gender ?? "").trim().toLowerCase())
        ? String(registration.gender).trim().toLowerCase()
        : null,
    ],
    ["maritalStatus", registration.maritalStatus],
    ["bloodGroup", registration.bloodGroup],
    ["personalEmail", registration.personalEmail],
    ["phone", fullMobile(registration.mobile, registration.mobileCountryCode)],
    [
      "addressLine1",
      [registration.presentLine1, registration.presentLine2]
        .map((part) => String(part ?? "").trim())
        .filter((part) => part.length > 0)
        .join(", ") || null,
    ],
    ["city", registration.presentCity],
    ["state", registration.presentState],
    ["postalCode", registration.presentPin],
    ["country", registration.presentCountry],
  ];

  for (const [field, value] of candidates) {
    if (blank(value)) continue;
    // The rule that makes this safe to run every night.
    if (!blank(employee[field])) continue;
    updates[field] = String(value).trim();
  }

  const filled = Object.keys(updates);
  return filled.length === 0
    ? { updates: {}, filled: [], reason: "already-complete" }
    : { updates, filled };
}
