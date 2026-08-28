// ═══════════════════════════════════════════════════════════════
// MONEY FORMATTING
// ═══════════════════════════════════════════════════════════════
// Display only. Nothing here does arithmetic, and nothing that calls it
// should either: storage is bigint minor units precisely because floats lose
// money, and the API hands the client an already-converted float. Summing
// those on a phone would reintroduce exactly the error the bigint exists to
// prevent — so a total is asked of the server, never computed here.
//
// Indian digit grouping is not Western grouping. 1234567 is 12,34,567 —
// twelve lakh thirty-four thousand — because the first group from the right
// is three digits and every group after it is two. `Intl.NumberFormat` with
// en-IN knows this; hand-rolled grouping every three digits does not, and
// produces a number that reads as a different amount to the person whose
// salary it is.

/** Formats an amount in major units for display, with the currency symbol. */
export function formatMoney(amount: number, currency = "INR", locale = "en-IN"): string {
  if (!Number.isFinite(amount)) {
    // A NaN salary has happened in this codebase before — `Infinity × 0` in
    // the payroll engine, from a month with zero working days. Printing "NaN"
    // where a net pay belongs is alarming and useless; an em dash at least
    // reads as "not available".
    return "—";
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** The same, without the currency symbol, for columns that label it once. */
export function formatAmount(amount: number, locale = "en-IN"): string {
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * A payroll period as a label.
 *
 * Months are 1-12 here, matching the database column, not the 0-11 that
 * `Date` uses. Mixing the two conventions labels December's payslip as
 * January's, and a payslip showing the wrong month is the kind of thing that
 * ends up with finance.
 */
export function formatPeriod(month: number | undefined, year: number | undefined): string {
  if (month === undefined || year === undefined) return "Unknown period";
  if (!Number.isInteger(month) || month < 1 || month > 12) return "Unknown period";
  if (!Number.isInteger(year) || year < 1900 || year > 2999) return "Unknown period";
  return `${MONTHS[month - 1]} ${year}`;
}

/** Short form, for a dense list. */
export function formatPeriodShort(month: number | undefined, year: number | undefined): string {
  if (formatPeriod(month, year) === "Unknown period") return "Unknown period";
  // Re-read the entry rather than casting: the guard above proves the month is
  // in range, but a cast asserts that to the compiler instead of showing it,
  // and stays "true" if the guard is ever loosened.
  const name = month === undefined ? undefined : MONTHS[month - 1];
  return name === undefined ? "Unknown period" : `${name.slice(0, 3)} ${year}`;
}
