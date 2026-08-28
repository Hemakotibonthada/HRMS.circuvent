// ═══════════════════════════════════════════════════════════════
// WHO IS AN EMPLOYEE — the rules, in one place
// ═══════════════════════════════════════════════════════════════
// These are shared by the Add Employee form and by `POST /api/employees`.
// Deliberately free of "use client", React and any database import, because a
// rule enforced only in the browser is a suggestion: anything with a session
// can post JSON straight at the route.
//
// ── Why an employee is not just "someone with an address" ──
// The HRMS employee list had `abuse@`, `accounts@` and `billing@` in it, listed
// as Owner, counted in headcount and offered to payroll. Those are role
// mailboxes — shared destinations, not colleagues. Mail is free to create any
// address the company needs, including groups, aliases and catch-alls; none of
// them is a person, and none may hold an employee record.
//
// The company's own hiring pattern is Career portal → ATS → employee. Somebody
// becomes staff by being hired, and the employee record is created from the
// application they were hired against. `POST /api/employees` exists for the
// cases that genuinely sit outside that — a founder, a transfer, a correction —
// and it is the only other door, so these rules guard it.

export interface FieldIssue {
  field: string;
  message: string;
}

// ── Employment types ─────────────────────────────────────────

/**
 * The employment types the product supports, and the labels it shows.
 *
 * One list, because there were two. The employees page kept its own array of
 * display strings — Full-time, Part-time, Contract, Intern, **Consultant** —
 * while the normaliser and the database enum knew nothing about a consultant
 * and did know about a freelancer the page never offered. Choosing "Consultant"
 * therefore produced `"Consultant" is not an employment type` from a dropdown
 * that offered it: a control that is present, looks supported, and is refused
 * at the boundary.
 *
 * This is now the only place the choices are written down. The page renders it,
 * `normaliseEmploymentType` resolves it, the API schema is built from it, and a
 * test asserts it against the live `employment_type` enum — so adding one here
 * without the matching database value fails the suite rather than a submission.
 */
export const EMPLOYMENT_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "consultant", label: "Consultant" },
  { value: "freelance", label: "Freelance" },
  { value: "intern", label: "Intern" },
];

/** The stored values, for building an enum schema. */
export const EMPLOYMENT_TYPE_VALUES = EMPLOYMENT_TYPE_OPTIONS.map((o) => o.value) as [
  string,
  ...string[],
];

/** Spellings accepted on input, mapped onto the stored value. */
const EMPLOYMENT_TYPE_ALIASES: Record<string, string> = {
  ...Object.fromEntries(EMPLOYMENT_TYPE_OPTIONS.map((o) => [o.value, o.value])),
  ...Object.fromEntries(EMPLOYMENT_TYPE_OPTIONS.map((o) => [o.label.toLowerCase(), o.value])),
  "full time": "full_time",
  "part time": "part_time",
  contractor: "contract",
  consulting: "consultant",
  internship: "intern",
  freelancer: "freelance",
};

export function normaliseEmploymentType(value: string): string | null {
  return EMPLOYMENT_TYPE_ALIASES[value.trim().toLowerCase()] ?? null;
}

const STATUSES = new Set([
  "active",
  "on_leave",
  "probation",
  "notice_period",
  "terminated",
  "inactive",
]);

export function normaliseStatus(value: string): string | null {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return STATUSES.has(key) ? key : null;
}

// ── Addresses ────────────────────────────────────────────────

/**
 * Lower-cases each domain, strips a leading "@" (people paste either shape),
 * and drops empty entries.
 *
 * The one place this normalisation is written down, shared by
 * {@link companyEmailDomains} (the env-wide list) and, for a per-organisation
 * list stored on `identity.organizations.settings`,
 * `resolveCompanyEmailDomains` in `db/repositories/employee.neon.ts` — an
 * org's own configuration deserves exactly the same cleanup a
 * comma-separated env var gets, not a second, slightly different rule.
 */
export function normaliseEmailDomains(
  domains: readonly (string | null | undefined)[]
): string[] {
  return domains
    .map((d) => (d ?? "").trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * The domains the company issues staff addresses on.
 *
 * An employee record's address is their *work* address — what payroll, the
 * directory and every internal system keys on. A personal address in that field
 * is a different fact wearing the same name: it is how you reach a candidate,
 * not how you identify a colleague. `COMPANY_EMAIL_DOMAINS` may be overridden
 * for a deployment that is not ours, because acquiring a second trading domain
 * is ordinary and should not need a code change.
 *
 * This is one list for the whole process — right for a single deployment, but
 * this product is multi-tenant, and every organisation issues staff addresses
 * on its own domain, not this one. Callers that know which organisation they
 * are acting for should prefer `resolveCompanyEmailDomains` in
 * `db/repositories/employee.neon.ts`, which reads that organisation's own
 * list and falls back to this function only when it has not set one. This
 * function stays exactly as it was — no organisation, no database, just the
 * env var and the built-in default — because callers with no org context
 * (and the tests here) still need it to mean what it always meant.
 */
export function companyEmailDomains(
  env: Record<string, string | undefined> = process.env
): readonly string[] {
  const configured = normaliseEmailDomains((env.COMPANY_EMAIL_DOMAINS ?? "").split(","));
  return configured.length > 0 ? configured : ["circuvent.com"];
}

/**
 * Local parts that name a function rather than a person.
 *
 * This is the direct cause of "why am I seeing all these mail as employees".
 * These addresses are on the company domain, so a domain check alone lets them
 * through, and once one has an employee record it appears in headcount, in the
 * org chart, in payroll's source data and in every "who works here" answer the
 * product gives.
 */
const ROLE_LOCAL_PARTS = new Set([
  "abuse",
  "accounts",
  "admin",
  "administrator",
  "billing",
  "careers",
  "contact",
  "finance",
  "help",
  "hello",
  "hr",
  "info",
  "invoices",
  "it",
  "jobs",
  "legal",
  "mail",
  "mailer-daemon",
  "marketing",
  "no-reply",
  "noreply",
  "notifications",
  "office",
  "payroll",
  "postmaster",
  "privacy",
  "recruitment",
  "root",
  "sales",
  "security",
  "support",
  "sysadmin",
  "team",
  "webmaster",
]);

/** True when an address names a function or a group rather than a human being. */
export function isRoleAddress(email: string): boolean {
  const local = (email.trim().toLowerCase().split("@")[0] ?? "").trim();
  if (!local) return false;
  if (ROLE_LOCAL_PARTS.has(local)) return true;
  // Distribution lists: all@, everyone@, team-india@, dl_finance@, eng-all@.
  // Anchored to a separator so a surname is not mistaken for a list —
  // "billingsley" is a person, "billing" is a mailbox.
  return (
    /^(all|everyone|staff|group|team|dl|list)([._-]|$)/.test(local) || /[._-]all$/.test(local)
  );
}

/** True when the address is on a domain the company issues staff addresses on. */
export function isCompanyAddress(email: string, domains = companyEmailDomains()): boolean {
  const domain = (email.trim().toLowerCase().split("@")[1] ?? "").trim();
  return domains.some((d) => domain === d);
}

// ── Dates ────────────────────────────────────────────────────

/**
 * Today, as YYYY-MM-DD in the given timezone offset's local terms.
 *
 * Deliberately local rather than UTC. Somebody in India picking today's date at
 * nine in the morning is at 03:30 UTC on the same day, but at 2am they are on
 * the *previous* UTC day — and a rule written in UTC would reject the date the
 * date-picker had just offered them as today.
 */
export function todayLocalIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ── Titles ───────────────────────────────────────────────────

/**
 * A job title is made of words.
 *
 * Allows letters, spaces and the punctuation that appears in real titles —
 * "Sr. Engineer (Backend)", "Head of People & Culture", "Analyst, Risk",
 * "Full-stack Developer". Rejects digits and every other symbol, which is what
 * "Business Analyst123456789" was.
 *
 * `\p{M}` is in the set alongside `\p{L}` because a great many scripts write a
 * single letter as a base character plus a combining mark: "अभियंता" carries
 * U+0902, and "Ingénieur" may arrive decomposed. Matching letters alone rejects
 * perfectly ordinary job titles in most of the languages this company hires in.
 */
export const DESIGNATION_PATTERN = /^[\p{L}][\p{L}\p{M}\s'&.,/()-]*$/u;

// ── The rules ────────────────────────────────────────────────

export interface EmployeeFieldValues {
  firstName?: string;
  lastName?: string;
  email?: string;
  designation?: string;
  /** YYYY-MM-DD. */
  joiningDate?: string;
  employmentType?: string;
  /** As typed, so "abc" can be reported as not a number. */
  salary?: string;
}

export interface ValidateOptions {
  now?: Date;
  domains?: readonly string[];
  /**
   * Skips the "not in the past" rule.
   *
   * For correcting or backfilling somebody who genuinely started before today.
   * Off by default: the overwhelmingly common case is adding a person who is
   * about to join, and a joining date silently in the past is how somebody ends
   * up owed backdated salary nobody meant to promise.
   */
  allowPastJoiningDate?: boolean;
}

/**
 * Every rule that decides whether these values describe an employee.
 *
 * Returns all the problems rather than the first, because a form that reveals
 * one fault per submission takes as many round trips as there are mistakes.
 */
export function validateEmployeeFields(
  values: EmployeeFieldValues,
  options: ValidateOptions = {}
): FieldIssue[] {
  const now = options.now ?? new Date();
  const domains = options.domains ?? companyEmailDomains();
  const issues: FieldIssue[] = [];

  const firstName = (values.firstName ?? "").trim();
  const lastName = (values.lastName ?? "").trim();
  if (!firstName) issues.push({ field: "firstName", message: "First name is required" });
  if (!lastName) issues.push({ field: "lastName", message: "Last name is required" });

  const email = (values.email ?? "").trim().toLowerCase();
  if (!email) {
    issues.push({ field: "email", message: "Email is required" });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push({ field: "email", message: "Enter a valid email address" });
  } else if (!isCompanyAddress(email, domains)) {
    issues.push({
      field: "email",
      message:
        `An employee needs a work address on ${domains.join(" or ")}. ` +
        `${email} is a personal address — that belongs on a candidate record, not an employee.`,
    });
  } else if (isRoleAddress(email)) {
    issues.push({
      field: "email",
      message:
        `${email} is a shared or role mailbox, not a person. ` +
        `Create the mailbox in Mail if it is needed — it must not have an employee record.`,
    });
  }

  const designation = (values.designation ?? "").trim();
  if (!designation) {
    issues.push({ field: "designation", message: "Designation is required" });
  } else if (!DESIGNATION_PATTERN.test(designation)) {
    issues.push({
      field: "designation",
      message: `"${designation}" is not a job title — letters only, no digits or symbols`,
    });
  }

  const joiningDate = (values.joiningDate ?? "").trim();
  if (!joiningDate) {
    issues.push({ field: "joiningDate", message: "Joining date is required" });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) {
    issues.push({ field: "joiningDate", message: "Joining date must be YYYY-MM-DD" });
  } else if (!options.allowPastJoiningDate && joiningDate < todayLocalIso(now)) {
    issues.push({
      field: "joiningDate",
      message: `Joining date cannot be in the past — ${joiningDate} has already passed`,
    });
  }

  const employmentType = (values.employmentType ?? "").trim();
  if (employmentType && normaliseEmploymentType(employmentType) === null) {
    issues.push({
      field: "employmentType",
      message:
        `"${employmentType}" is not an employment type. ` +
        `Choose one of ${EMPLOYMENT_TYPE_OPTIONS.map((o) => o.label).join(", ")}.`,
    });
  }

  const salary = (values.salary ?? "").trim();
  if (salary) {
    const amount = Number(salary);
    if (!Number.isFinite(amount)) {
      issues.push({ field: "salary", message: "Salary must be a number" });
    } else if (amount < 0) {
      issues.push({ field: "salary", message: "Salary cannot be negative" });
    }
  }

  return issues;
}

/** The issues as one readable sentence per line, for a toast or an API message. */
export function describeIssues(issues: FieldIssue[]): string {
  return issues.map((i) => i.message).join("\n");
}
