// ═══════════════════════════════════════════════════════════════
// BENEFITS RULES
// ═══════════════════════════════════════════════════════════════
// Eligibility, enrolment windows and cost calculation, separated from
// persistence so they can be tested without a database.
//
// Benefits are where an HR system quietly costs a company real money. The
// three failure modes:
//
//  * Letting someone elect cover outside a window. Benefits are priced on the
//    assumption that healthy and unhealthy people enrol together; allowing
//    election on demand means people elect the week they need surgery and drop
//    it after, and the pool collapses.
//  * Getting the cost split wrong, so payroll deducts the wrong amount from
//    someone's salary every month until a person notices.
//  * Losing coverage dates, so a claim is paid for a period nobody was
//    covered — or refused for one they were.

export type EligibilityOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in";

export interface EligibilityRule {
  field: string;
  operator: EligibilityOperator;
  value: unknown;
}

export interface EligibilityRules {
  match?: "all" | "any";
  rules: EligibilityRule[];
}

/** The employee facts eligibility can be tested against. */
export interface EligibilitySubject {
  employmentType: string;
  status: string;
  /** Whole months of service at the date being tested. */
  tenureMonths: number;
  departmentId?: string;
  locationId?: string;
  designation?: string;
  /** Annual cost to company in minor units. */
  ctcMinor?: bigint;
}

function readField(subject: EligibilitySubject, field: string): unknown {
  return (subject as unknown as Record<string, unknown>)[field];
}

function compare(actual: unknown, operator: EligibilityOperator, expected: unknown): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual);
    default: {
      // bigint and number both occur here — CTC is bigint, tenure is number —
      // so both sides are normalised before comparing.
      const a = typeof actual === "bigint" ? Number(actual) : Number(actual);
      const b = typeof expected === "bigint" ? Number(expected) : Number(expected);
      // A non-numeric comparison is a misconfigured rule; failing closed keeps
      // it from silently enrolling everyone.
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (operator === "gt") return a > b;
      if (operator === "gte") return a >= b;
      if (operator === "lt") return a < b;
      return a <= b;
    }
  }
}

/**
 * Whether an employee qualifies for a plan.
 *
 * No rules means everyone qualifies, which is the common case for a company
 * health plan.
 */
export function isEligible(subject: EligibilitySubject, rules?: EligibilityRules): boolean {
  if (!rules || rules.rules.length === 0) return true;

  const results = rules.rules.map((rule) =>
    compare(readField(subject, rule.field), rule.operator, rule.value)
  );

  return rules.match === "any" ? results.some(Boolean) : results.every(Boolean);
}

// ─── Enrolment windows ───────────────────────────────────────

export interface Window {
  id: string;
  opensOn: string;
  closesOn: string;
  coverageStartsOn: string;
  planIds: string[];
}

export type WindowVerdict =
  | { open: true; window: Window }
  | { open: false; reason: "no_window" | "not_yet_open" | "closed"; nextOpensOn?: string };

/**
 * Whether a plan can be elected today.
 *
 * Refusing outside a window is the whole point: it is what stops adverse
 * selection. The message distinguishes "not yet" from "too late" because the
 * first has a date the employee can wait for.
 */
export function windowFor(planId: string, windows: Window[], today: string): WindowVerdict {
  const applicable = windows.filter((w) => w.planIds.includes(planId));
  if (applicable.length === 0) return { open: false, reason: "no_window" };

  const open = applicable.find((w) => today >= w.opensOn && today <= w.closesOn);
  if (open) return { open: true, window: open };

  const upcoming = applicable
    .filter((w) => w.opensOn > today)
    .sort((a, b) => a.opensOn.localeCompare(b.opensOn))[0];

  return upcoming
    ? { open: false, reason: "not_yet_open", nextOpensOn: upcoming.opensOn }
    : { open: false, reason: "closed" };
}

/**
 * A qualifying life event opens an election outside the normal window.
 *
 * Without this, someone who marries or has a child in June waits until the
 * next annual window to add them — which is exactly when they need cover.
 */
export type LifeEvent =
  | "marriage"
  | "birth"
  | "adoption"
  | "divorce"
  | "death_of_dependant"
  | "spouse_lost_coverage"
  | "new_hire";

/** Days after a life event during which a special election is allowed. */
const LIFE_EVENT_WINDOW_DAYS = 30;

export function lifeEventWindowOpen(eventDate: string, today: string): boolean {
  const event = new Date(`${eventDate}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  if (Number.isNaN(event) || Number.isNaN(now)) return false;

  const days = (now - event) / 86_400_000;
  // A future-dated event is not yet a life event; a very old one has lapsed.
  return days >= 0 && days <= LIFE_EVENT_WINDOW_DAYS;
}

// ─── Cost calculation ────────────────────────────────────────

export interface PlanCost {
  employerContributionMinor: bigint;
  employeeContributionMinor: bigint;
  /** Extra annual cost per dependant, if the plan charges per head. */
  perDependantMinor?: bigint;
  /** Employer share of dependant cost, 0-100. */
  employerDependantSharePercent?: number;
}

export interface CostBreakdown {
  employeeAnnualMinor: bigint;
  employerAnnualMinor: bigint;
  employeeMonthlyMinor: bigint;
  totalAnnualMinor: bigint;
}

/**
 * Splits the annual cost of a plan between employer and employee.
 *
 * Monthly figures round down and put the remainder in nothing — the annual
 * total is authoritative and payroll deducts the monthly figure twelve times.
 * Rounding up would over-deduct by up to eleven paise a year, which sounds
 * trivial until someone reconciles it.
 */
export function calculateCost(plan: PlanCost, dependantCount: number): CostBreakdown {
  if (dependantCount < 0) throw new Error("Dependant count cannot be negative");

  const perDependant = plan.perDependantMinor ?? 0n;
  const dependantTotal = perDependant * BigInt(dependantCount);

  const employerSharePercent = BigInt(
    Math.max(0, Math.min(100, plan.employerDependantSharePercent ?? 0))
  );
  const employerDependantShare = (dependantTotal * employerSharePercent) / 100n;
  // The remainder goes to the employee, so the two shares always sum to the
  // exact dependant total rather than losing a unit to rounding.
  const employeeDependantShare = dependantTotal - employerDependantShare;

  const employerAnnual = plan.employerContributionMinor + employerDependantShare;
  const employeeAnnual = plan.employeeContributionMinor + employeeDependantShare;

  return {
    employeeAnnualMinor: employeeAnnual,
    employerAnnualMinor: employerAnnual,
    employeeMonthlyMinor: employeeAnnual / 12n,
    totalAnnualMinor: employeeAnnual + employerAnnual,
  };
}

/**
 * Prorates an employee's contribution for a partial plan year.
 *
 * A mid-year joiner should not pay a full year's premium, and a leaver should
 * not be deducted for months they were not covered.
 */
export function prorateContribution(
  annualMinor: bigint,
  coverageFrom: string,
  planYearEnd: string
): bigint {
  const from = new Date(`${coverageFrom}T00:00:00Z`).getTime();
  const end = new Date(`${planYearEnd}T00:00:00Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(end) || end < from) return 0n;

  // Inclusive of both endpoints: cover on the last day is a day of cover.
  const days = Math.round((end - from) / 86_400_000) + 1;
  const capped = Math.min(days, 366);

  return (annualMinor * BigInt(capped)) / 365n;
}

// ─── Dependant validation ────────────────────────────────────

export interface DependantInput {
  relation: string;
  dateOfBirth?: string;
  isNominee?: boolean;
  nomineeSharePercent?: number;
}

export interface DependantPolicy {
  eligibleRelations: string[];
  maxDependants?: number;
  /** Age at which a child ceases to qualify. */
  childAgeLimit?: number;
}

export type DependantIssue =
  | { code: "relation_not_eligible"; relation: string }
  | { code: "too_many"; max: number }
  | { code: "child_over_age"; limit: number }
  | { code: "nominee_shares_invalid"; total: number };

/**
 * Validates a set of dependants against a plan's rules.
 *
 * Returns every problem rather than the first, so someone adding four family
 * members is told all of what is wrong instead of discovering it one
 * submission at a time.
 */
export function validateDependants(
  dependants: DependantInput[],
  policy: DependantPolicy,
  today: string
): DependantIssue[] {
  const issues: DependantIssue[] = [];

  if (policy.maxDependants !== undefined && dependants.length > policy.maxDependants) {
    issues.push({ code: "too_many", max: policy.maxDependants });
  }

  for (const dependant of dependants) {
    if (!policy.eligibleRelations.includes(dependant.relation)) {
      issues.push({ code: "relation_not_eligible", relation: dependant.relation });
    }

    if (
      policy.childAgeLimit !== undefined &&
      dependant.relation === "child" &&
      dependant.dateOfBirth
    ) {
      const age = ageInYears(dependant.dateOfBirth, today);
      if (age !== null && age >= policy.childAgeLimit) {
        issues.push({ code: "child_over_age", limit: policy.childAgeLimit });
      }
    }
  }

  const nominees = dependants.filter((d) => d.isNominee);
  if (nominees.length > 0) {
    const total = nominees.reduce((sum, d) => sum + (d.nomineeSharePercent ?? 0), 0);
    // Shares that do not total 100 leave part of a death benefit unassigned,
    // which is resolved by a court rather than by the policy.
    if (total !== 100) {
      issues.push({ code: "nominee_shares_invalid", total });
    }
  }

  return issues;
}

export function ageInYears(dateOfBirth: string, asOf: string): number | null {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const at = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(at.getTime())) return null;
  if (birth > at) return null;

  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - birth.getUTCMonth();
  // Birthday not yet reached this year.
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < birth.getUTCDate())) age--;

  return age;
}
