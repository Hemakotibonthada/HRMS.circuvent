// ═══════════════════════════════════════════════════════════════
// COMPENSATION LETTER — turning a pay change into the words on a letter
// ═══════════════════════════════════════════════════════════════
// The `compensation_revision` template has five tokens the employee record
// cannot supply: the two figures, the change between them, the effective date
// and what the change was for. This works them out.
//
// Pure, and separate from the endpoint that issues the letter, because the
// arithmetic and the wording are the part worth being sure about. A letter
// that states the wrong figure is not a display bug: somebody takes it to a
// bank.
//
// ── Why the previous figure is stated at all ──
// A letter naming only the new number cannot be checked against anything. The
// employee cannot confirm the rise they were told about at their review, and
// nor can anybody they show it to.

/** A row of `hrms.salary_history`, in the shape this needs. */
export interface PayChange {
  previousSalaryMinor: bigint | string | null;
  newSalaryMinor: bigint | string;
  changePercent: string | number | null;
  currency: string;
  reason: string;
  effectiveOn: string | Date;
}

/**
 * Declared as a type alias rather than an interface on purpose.
 *
 * The document repository takes `TokenValues`, which is
 * `Record<string, string | number | null | undefined>`. TypeScript gives a
 * type alias an implicit index signature and an interface none, so an
 * interface here is not assignable to it and the call site would need a cast
 * — which would also silence a genuine mismatch if a token's type changed.
 */
export type CompensationLetterTokens = {
  previous_ctc: string;
  revised_ctc: string;
  change_summary: string;
  effective_date: string;
  revision_reason: string;
};

/** How the stored reason codes read on a letter somebody receives. */
const REASON_WORDING: Readonly<Record<string, string>> = {
  merit_increase: "Annual merit revision",
  promotion: "Promotion",
  market_adjustment: "Market adjustment",
  correction: "Correction to a previously recorded figure",
  retention: "Retention revision",
  role_change: "Change of role",
};

/**
 * Formats an amount held in minor units as Indian currency.
 *
 * Takes a bigint, or a string of one, and never a number: a JavaScript number
 * stops representing paise exactly somewhere past ninety lakh rupees, which is
 * well inside the range of salaries this will be asked to print.
 */
export function formatMinorAsCurrency(
  minor: bigint | string | null | undefined,
  currency = "INR"
): string {
  if (minor === null || minor === undefined || minor === "") return "—";

  let units: bigint;
  try {
    units = BigInt(minor) / 100n;
  } catch {
    return "—";
  }

  const negative = units < 0n;
  const absolute = negative ? -units : units;

  // Grouped by the Indian convention — last three digits, then pairs — rather
  // than by Intl, which needs a Number and would lose precision on the way in.
  const digits = absolute.toString();
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }

  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${negative ? "-" : ""}${symbol}${grouped}`;
}

/** `2026-09-15` or a Date, rendered as `15 September 2026`. */
export function formatLetterDate(value: string | Date): string {
  const text = typeof value === "string" ? value : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);

  let year: number;
  let month: number;
  let day: number;

  if (match) {
    // Parsed from the parts rather than through `new Date(string)`, which
    // treats a bare date as UTC midnight and then renders it a day early for
    // anybody west of it.
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    const date = value instanceof Date ? value : new Date(text);
    if (Number.isNaN(date.getTime())) return "—";
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
  }

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const name = months[month - 1];
  if (!name) return "—";
  return `${day} ${name} ${year}`;
}

/**
 * Describes the change between two figures in words an employee can check.
 *
 * States the amount and the percentage together. The percentage alone is what
 * people remember from the review; the amount is what they can verify against
 * a payslip.
 */
export function describeChange(change: PayChange): string {
  const previous = change.previousSalaryMinor;
  if (previous === null || previous === undefined || previous === "") {
    return "Newly recorded";
  }

  let difference: bigint;
  try {
    difference = BigInt(change.newSalaryMinor) - BigInt(previous);
  } catch {
    return "—";
  }

  if (difference === 0n) return "No change to the annual figure";

  const percent =
    change.changePercent === null || change.changePercent === undefined
      ? null
      : Number(change.changePercent);

  const magnitude = formatMinorAsCurrency(difference < 0n ? -difference : difference, change.currency);
  const direction = difference > 0n ? "increase" : "decrease";

  // A decrease is stated as one. Dressing a cut as a "revision of -8%" is the
  // kind of wording that makes somebody distrust every other number on the
  // page.
  return percent === null || Number.isNaN(percent)
    ? `${magnitude} ${direction}`
    : `${magnitude} ${direction} (${Math.abs(percent).toFixed(2)}%)`;
}

/** Everything the `compensation_revision` template needs that the employee record cannot supply. */
export function compensationLetterTokens(change: PayChange): CompensationLetterTokens {
  const reasonKey = String(change.reason ?? "").trim().toLowerCase();

  return {
    previous_ctc: formatMinorAsCurrency(change.previousSalaryMinor, change.currency),
    revised_ctc: formatMinorAsCurrency(change.newSalaryMinor, change.currency),
    change_summary: describeChange(change),
    effective_date: formatLetterDate(change.effectiveOn),
    // Falls back to the stored code with its underscores removed rather than
    // to "Revision": an unrecognised reason somebody typed by hand is more
    // informative than a word that says nothing.
    revision_reason:
      REASON_WORDING[reasonKey] ??
      (reasonKey ? reasonKey.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Revision"),
  };
}

/** The title the document is filed under, which is what the employee sees in their list. */
export function compensationLetterTitle(change: PayChange): string {
  return `Compensation revision — effective ${formatLetterDate(change.effectiveOn)}`;
}
