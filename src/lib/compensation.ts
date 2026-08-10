// ═══════════════════════════════════════════════════════════════
// COMPENSATION RULES
// ═══════════════════════════════════════════════════════════════
// Salary bands, compa-ratio, merit matrices, budget pools and equity vesting.
// Pure, so it tests without a database.
//
// Money is in minor units as bigint throughout, the same as payroll. A merit
// cycle applies a percentage to thousands of salaries and then sums them
// against a budget; floating point loses that sum, and the number it loses it
// by is somebody's raise.
//
// The other thing this module is careful about: a merit cycle is the most
// politically sensitive process an HR system runs. Every decision it makes has
// to be explainable to the person it affects, which is why the recommendation
// functions return their reasoning rather than just a number.

export interface SalaryBand {
  id: string;
  gradeCode: string;
  minMinor: bigint;
  midMinor: bigint;
  maxMinor: bigint;
  currency: string;
}

export interface CompensationPosition {
  /** salary ÷ band midpoint. 1.0 is exactly at midpoint. */
  compaRatio: number;
  /** Where in the band, 0 at minimum and 1 at maximum. */
  rangePenetration: number;
  quartile: 1 | 2 | 3 | 4;
  status: "below_band" | "below_midpoint" | "at_midpoint" | "above_midpoint" | "above_band";
}

/**
 * Where a salary sits in its band.
 *
 * Compa-ratio is the number every compensation conversation starts from, and
 * getting it wrong by dividing by a zero midpoint would surface as `Infinity`
 * on a screen someone is about to have a difficult conversation in front of.
 */
export function position(salaryMinor: bigint, band: SalaryBand): CompensationPosition {
  if (band.midMinor <= 0n) {
    throw new Error("A salary band needs a positive midpoint");
  }
  if (band.maxMinor < band.minMinor) {
    throw new Error("A salary band cannot have a maximum below its minimum");
  }

  const compaRatio = round(Number(salaryMinor) / Number(band.midMinor), 4);

  // A band with no width is a single point; everyone in it is at the top.
  const width = Number(band.maxMinor - band.minMinor);
  const rangePenetration =
    width === 0 ? 1 : round(Number(salaryMinor - band.minMinor) / width, 4);

  const clamped = Math.min(1, Math.max(0, rangePenetration));
  const quartile = (clamped >= 0.75 ? 4 : clamped >= 0.5 ? 3 : clamped >= 0.25 ? 2 : 1) as
    | 1
    | 2
    | 3
    | 4;

  let status: CompensationPosition["status"];
  if (salaryMinor < band.minMinor) status = "below_band";
  else if (salaryMinor > band.maxMinor) status = "above_band";
  else if (salaryMinor === band.midMinor) status = "at_midpoint";
  else if (salaryMinor < band.midMinor) status = "below_midpoint";
  else status = "above_midpoint";

  return { compaRatio, rangePenetration, quartile, status };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ─── Merit matrix ────────────────────────────────────────────

export type PerformanceRating =
  | "outstanding"
  | "exceeds"
  | "meets"
  | "partially_meets"
  | "below";

/**
 * Percentage increase by rating and quartile.
 *
 * Quartile matters as much as rating, and the reason is not obvious: two
 * people rated equally are not equally underpaid. Someone excellent sitting in
 * the first quartile is being paid below what the role is worth, so their
 * increase is larger than that of an equally excellent colleague already near
 * the top of the band — who would otherwise be pushed out of it entirely
 * within a couple of cycles.
 */
export type MeritMatrix = Record<PerformanceRating, [number, number, number, number]>;

export const DEFAULT_MERIT_MATRIX: MeritMatrix = {
  //                Q1     Q2     Q3     Q4
  outstanding: [12.0, 10.0, 8.0, 6.0],
  exceeds: [9.0, 7.5, 6.0, 4.5],
  meets: [6.0, 5.0, 4.0, 3.0],
  partially_meets: [3.0, 2.5, 2.0, 0.0],
  // A rating of "below" carries no merit increase. Awarding one anyway makes
  // the rating meaningless and the process indefensible.
  below: [0, 0, 0, 0],
};

export interface MeritRecommendation {
  employeeId: string;
  currentSalaryMinor: bigint;
  recommendedPercent: number;
  increaseMinor: bigint;
  newSalaryMinor: bigint;
  rating: PerformanceRating;
  quartile: 1 | 2 | 3 | 4;
  compaRatio: number;
  /** Written to be shown to the employee, not just the manager. */
  rationale: string;
  /** Set when the recommendation needs a human decision before it can stand. */
  warnings: string[];
}

export interface MeritInput {
  employeeId: string;
  salaryMinor: bigint;
  rating: PerformanceRating;
  band: SalaryBand;
  /** Fraction of the cycle the employee was employed for, 0 to 1. */
  eligibleFraction?: number;
}

/**
 * Recommends an increase.
 *
 * Prorated for someone who joined mid-cycle: a full merit increase for two
 * months' service is a raise the rest of the team funded.
 */
export function recommend(
  input: MeritInput,
  matrix: MeritMatrix = DEFAULT_MERIT_MATRIX
): MeritRecommendation {
  const where = position(input.salaryMinor, input.band);
  const base = matrix[input.rating][where.quartile - 1];

  const fraction = clamp01(input.eligibleFraction ?? 1);
  const percent = round(base * fraction, 2);

  const increaseMinor = percentOf(input.salaryMinor, percent);
  const newSalaryMinor = input.salaryMinor + increaseMinor;

  const warnings: string[] = [];

  if (newSalaryMinor > input.band.maxMinor) {
    // Flagged, never silently capped. Capping hides a real problem — either
    // the band is wrong or the person is in the wrong grade — and quietly
    // gives them less than the matrix says they earned.
    warnings.push(
      `This takes the salary above the band maximum. Either the band needs review or this should be a promotion rather than a merit increase.`
    );
  }
  if (where.status === "below_band") {
    warnings.push(
      "This salary is below the band minimum. A merit increase alone may not close the gap."
    );
  }
  if (input.rating === "below" && where.status === "above_band") {
    warnings.push("Paid above band while rated below expectations.");
  }

  const rationale = buildRationale(input.rating, where, base, fraction, percent);

  return {
    employeeId: input.employeeId,
    currentSalaryMinor: input.salaryMinor,
    recommendedPercent: percent,
    increaseMinor,
    newSalaryMinor,
    rating: input.rating,
    quartile: where.quartile,
    compaRatio: where.compaRatio,
    rationale,
    warnings,
  };
}

function buildRationale(
  rating: PerformanceRating,
  where: CompensationPosition,
  base: number,
  fraction: number,
  percent: number
): string {
  const ratingText = rating.replace(/_/g, " ");
  const parts = [
    `Rated "${ratingText}" with a compa-ratio of ${where.compaRatio.toFixed(2)} (quartile ${where.quartile}), which gives a guideline of ${base.toFixed(1)}%.`,
  ];

  if (fraction < 1) {
    parts.push(
      `Prorated to ${percent.toFixed(2)}% for ${Math.round(fraction * 100)}% of the cycle worked.`
    );
  }

  if (base === 0) {
    parts.push("No merit increase applies at this rating.");
  }

  return parts.join(" ");
}

/** A percentage of a minor-unit amount, rounded half-up to the nearest unit. */
export function percentOf(amountMinor: bigint, percent: number): bigint {
  if (!Number.isFinite(percent)) throw new Error("A percentage must be a finite number");

  // Scaled to four decimal places so a percentage like 7.25 is exact in
  // integer arithmetic rather than accumulating float error over a cycle.
  const scaled = BigInt(Math.round(percent * 10_000));
  const product = amountMinor * scaled;
  const divisor = 1_000_000n;

  const quotient = product / divisor;
  const remainder = product % divisor;

  // Round half away from zero, so a 0.5 remainder does not systematically
  // favour the employer across thousands of records.
  const half = divisor / 2n;
  const magnitude = remainder < 0n ? -remainder : remainder;
  if (magnitude * 2n >= divisor || magnitude >= half) {
    return quotient + (product < 0n ? -1n : 1n);
  }
  return quotient;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

// ─── Budget ──────────────────────────────────────────────────

export interface BudgetPool {
  id: string;
  name: string;
  /** Total available, in minor units. */
  allocatedMinor: bigint;
  /** Already committed by approved recommendations. */
  committedMinor: bigint;
}

export interface BudgetCheck {
  withinBudget: boolean;
  requestedMinor: bigint;
  remainingMinor: bigint;
  overspendMinor: bigint;
  /** For the manager who has to cut something. */
  message: string;
}

/**
 * Whether a set of recommendations fits the pool.
 *
 * The overspend is reported rather than the request being trimmed. Deciding
 * whose raise to cut is a management decision, and software that silently
 * scales everyone down by 3% has made it badly and invisibly.
 */
export function checkBudget(
  pool: BudgetPool,
  recommendations: { increaseMinor: bigint }[],
  excludingCommitted = false
): BudgetCheck {
  const requestedMinor = recommendations.reduce((sum, r) => sum + r.increaseMinor, 0n);
  const committed = excludingCommitted ? 0n : pool.committedMinor;
  const remainingMinor = pool.allocatedMinor - committed - requestedMinor;

  if (remainingMinor >= 0n) {
    return {
      withinBudget: true,
      requestedMinor,
      remainingMinor,
      overspendMinor: 0n,
      message: `${formatMinor(remainingMinor)} remaining of ${formatMinor(pool.allocatedMinor)}`,
    };
  }

  const overspendMinor = -remainingMinor;
  return {
    withinBudget: false,
    requestedMinor,
    remainingMinor: 0n,
    overspendMinor,
    message: `Over budget by ${formatMinor(overspendMinor)}. Reduce recommendations or request more budget.`,
  };
}

function formatMinor(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const major = absolute / 100n;
  const cents = absolute % 100n;
  return `${negative ? "-" : ""}${major}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Distributes a budget across recommendations in proportion to their size.
 *
 * Offered as an explicit action a manager chooses, never applied
 * automatically. The last recipient absorbs the rounding remainder so the
 * parts sum to exactly the budget — otherwise the pool is left a few units
 * short or over, and the reconciliation never balances.
 */
export function scaleToBudget<T extends { increaseMinor: bigint }>(
  recommendations: T[],
  budgetMinor: bigint
): (T & { scaledIncreaseMinor: bigint })[] {
  const total = recommendations.reduce((sum, r) => sum + r.increaseMinor, 0n);

  if (total <= budgetMinor || total === 0n) {
    return recommendations.map((r) => ({ ...r, scaledIncreaseMinor: r.increaseMinor }));
  }

  const scaled = recommendations.map((r) => ({
    ...r,
    scaledIncreaseMinor: (r.increaseMinor * budgetMinor) / total,
  }));

  const distributed = scaled.reduce((sum, r) => sum + r.scaledIncreaseMinor, 0n);
  const remainder = budgetMinor - distributed;

  if (remainder !== 0n && scaled.length > 0) {
    scaled[scaled.length - 1].scaledIncreaseMinor += remainder;
  }

  return scaled;
}

// ─── Equity ──────────────────────────────────────────────────

export interface EquityGrant {
  totalUnits: number;
  grantDate: string;
  /** Months before anything vests. */
  cliffMonths: number;
  /** Total vesting period in months. */
  vestingMonths: number;
  /** Vesting frequency after the cliff. */
  cadenceMonths: number;
}

export interface VestingPosition {
  vestedUnits: number;
  unvestedUnits: number;
  nextVestDate?: string;
  nextVestUnits: number;
  isCliffPassed: boolean;
}

/**
 * How much of a grant has vested by a date.
 *
 * The cliff is all-or-nothing: nothing vests before it, and everything the
 * cliff period earned vests at once when it passes. Accruing gradually towards
 * the cliff and paying out early is the mistake — a leaver on day one before
 * the cliff is entitled to nothing, and any other reading creates a liability
 * nobody agreed to.
 */
export function vestingPosition(grant: EquityGrant, asOf: string): VestingPosition {
  if (grant.vestingMonths <= 0) throw new Error("A grant needs a positive vesting period");
  if (grant.cadenceMonths <= 0) throw new Error("A grant needs a positive vesting cadence");
  if (grant.cliffMonths > grant.vestingMonths) {
    throw new Error("A cliff cannot be longer than the vesting period");
  }

  const monthsElapsed = monthsBetween(grant.grantDate, asOf);

  if (monthsElapsed < grant.cliffMonths) {
    return {
      vestedUnits: 0,
      unvestedUnits: grant.totalUnits,
      nextVestDate: addMonths(grant.grantDate, grant.cliffMonths),
      nextVestUnits: unitsFor(grant, grant.cliffMonths),
      isCliffPassed: false,
    };
  }

  if (monthsElapsed >= grant.vestingMonths) {
    return {
      vestedUnits: grant.totalUnits,
      unvestedUnits: 0,
      nextVestUnits: 0,
      isCliffPassed: true,
    };
  }

  // Only whole cadence periods count. A grant vesting quarterly does not vest
  // a third of a quarter partway through one.
  const completedPeriods = Math.floor(monthsElapsed / grant.cadenceMonths);
  const vestedMonths = Math.max(
    grant.cliffMonths,
    completedPeriods * grant.cadenceMonths
  );

  const vestedUnits = unitsFor(grant, vestedMonths);
  const nextMonths = Math.min(
    grant.vestingMonths,
    (completedPeriods + 1) * grant.cadenceMonths
  );

  return {
    vestedUnits,
    unvestedUnits: grant.totalUnits - vestedUnits,
    nextVestDate: addMonths(grant.grantDate, nextMonths),
    nextVestUnits: unitsFor(grant, nextMonths) - vestedUnits,
    isCliffPassed: true,
  };
}

/**
 * Units vested after a number of months.
 *
 * Floored, so the final tranche absorbs the remainder and the parts sum to
 * exactly the grant. Rounding each tranche independently leaves a grant of
 * 1,000 units vesting 1,002.
 */
function unitsFor(grant: EquityGrant, months: number): number {
  if (months >= grant.vestingMonths) return grant.totalUnits;
  return Math.floor((grant.totalUnits * months) / grant.vestingMonths);
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);

  if ([fy, fm, fd, ty, tm, td].some(Number.isNaN)) {
    throw new Error("Dates must be YYYY-MM-DD");
  }

  let months = (ty - fy) * 12 + (tm - fm);
  // A month is not complete until the day-of-month is reached.
  if (td < fd) months -= 1;

  return months;
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));

  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();

  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// ─── Pay equity ──────────────────────────────────────────────

export interface PayGapRow {
  group: string;
  headcount: number;
  medianSalaryMinor: bigint;
  meanSalaryMinor: bigint;
}

export interface PayGapResult {
  rows: PayGapRow[];
  /** Percentage the comparison group is paid below the reference group. */
  medianGapPercent: number | null;
  meanGapPercent: number | null;
  /** Set when a group is too small to report without identifying people. */
  suppressed: string[];
}

/**
 * Pay gap between two groups.
 *
 * Groups below the threshold are suppressed rather than reported. In a group
 * of two, publishing a median is publishing an individual's salary — and pay
 * equity analysis that discloses pay is self-defeating.
 */
export function payGap(
  salariesByGroup: Record<string, bigint[]>,
  referenceGroup: string,
  comparisonGroup: string,
  minimumGroupSize = 5
): PayGapResult {
  const rows: PayGapRow[] = [];
  const suppressed: string[] = [];

  for (const [group, salaries] of Object.entries(salariesByGroup)) {
    if (salaries.length < minimumGroupSize) {
      suppressed.push(group);
      continue;
    }
    rows.push({
      group,
      headcount: salaries.length,
      medianSalaryMinor: median(salaries),
      meanSalaryMinor: mean(salaries),
    });
  }

  const reference = rows.find((r) => r.group === referenceGroup);
  const comparison = rows.find((r) => r.group === comparisonGroup);

  if (!reference || !comparison || reference.medianSalaryMinor === 0n) {
    return { rows, medianGapPercent: null, meanGapPercent: null, suppressed };
  }

  return {
    rows,
    medianGapPercent: gapPercent(reference.medianSalaryMinor, comparison.medianSalaryMinor),
    meanGapPercent: gapPercent(reference.meanSalaryMinor, comparison.meanSalaryMinor),
    suppressed,
  };
}

function gapPercent(reference: bigint, comparison: bigint): number {
  if (reference === 0n) return 0;
  return round(((Number(reference) - Number(comparison)) / Number(reference)) * 100, 2);
}

export function median(values: bigint[]): bigint {
  if (values.length === 0) return 0n;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle];
  // Integer division truncates, which is correct for minor units: there is no
  // half of a paisa to allocate.
  return (sorted[middle - 1] + sorted[middle]) / 2n;
}

export function mean(values: bigint[]): bigint {
  if (values.length === 0) return 0n;
  const total = values.reduce((sum, v) => sum + v, 0n);
  return total / BigInt(values.length);
}
