// ═══════════════════════════════════════════════════════════════
// MINOR-UNIT MONEY
// ═══════════════════════════════════════════════════════════════
// Exact arithmetic on money, as bigint paise, carried across the API as
// strings because JSON has no bigint.
//
// The database stores bigint minor units for a reason the payroll repository
// spells out: floats lose money, and on a payroll of a few thousand people
// those errors accumulate into a reconciliation finance cannot close. But the
// DTOs converted to a float at the boundary — `Number(minor) / 100` — and the
// comment on the type said the result "must never be summed or compared for
// equality on the client". That is a rule a type cannot enforce and a reviewer
// has to remember, and it was already being broken: the payroll dashboard adds
// every payslip's net pay together to render the headline "Net Payroll" figure.
//
// So the minor units travel too. A client that needs a total adds the strings
// here and gets an exact answer; a client that only prints one value can still
// use the float. Nothing has to be rewritten to benefit, and anything that
// needs to be exact now can be.
//
// Why not send the float alone and round at the end? Because the error is not
// in the rounding, it is in the addition. 0.1 + 0.2 is 0.30000000000000004
// before anything rounds it, and a `Number` stops being able to represent
// whole paise above ₹90,071,992,547,409.91 — which sounds absurd until it is
// a company-wide annual gross in paise.

/** A whole number of paise, as a decimal string. Never a float. */
export type MinorUnits = string;

const MINOR_PATTERN = /^-?\d+$/;

/** Parses a minor-unit string into an exact bigint. */
export function parseMinor(value: MinorUnits | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;

  const trimmed = value.trim();
  if (!MINOR_PATTERN.test(trimmed)) {
    throw new RangeError(`"${value}" is not a whole number of minor units`);
  }
  return BigInt(trimmed);
}

/** Serialises minor units for JSON. */
export function toMinor(value: bigint | null | undefined): MinorUnits {
  return (value ?? 0n).toString();
}

/**
 * Adds minor-unit amounts exactly.
 *
 * This is the function that makes carrying minor units worth anything: it is
 * the operation the float version got wrong.
 */
export function sumMinor(values: Iterable<MinorUnits | bigint | null | undefined>): MinorUnits {
  let total = 0n;
  for (const value of values) total += parseMinor(value);
  return total.toString();
}

/** Subtracts `b` from `a`, exactly. */
export function subtractMinor(a: MinorUnits | bigint, b: MinorUnits | bigint): MinorUnits {
  return (parseMinor(a) - parseMinor(b)).toString();
}

/**
 * Minor units as an exact decimal string — "123456789" → "1234567.89".
 *
 * Built with bigint division so it is exact at any magnitude, unlike
 * `Number(minor) / 100`.
 */
export function minorToDecimalString(value: MinorUnits | bigint): string {
  const minor = parseMinor(value);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;

  const major = abs / 100n;
  const paise = abs % 100n;

  return `${negative ? "-" : ""}${major}.${paise.toString().padStart(2, "0")}`;
}

/**
 * Minor units as a float, for display only.
 *
 * Exactly what the repository used to do at the DTO boundary, kept so callers
 * that only ever print one number keep working. Do not add these together —
 * that is what `sumMinor` is for.
 */
export function minorToMajor(value: MinorUnits | bigint): number {
  return Number(minorToDecimalString(value));
}

/**
 * Whether this engine's `Intl` can format an exact decimal string.
 *
 * ES2023 added string arguments to `Intl.NumberFormat.prototype.format`, which
 * formats the digits as written instead of converting to a float first. Node
 * and current browsers have it; older JavaScript engines — React Native's
 * Hermes among them, depending on build — do not, and would render "NaN" where
 * a salary belongs. Detected once rather than assumed.
 */
const SUPPORTS_EXACT_FORMAT = (() => {
  try {
    return new Intl.NumberFormat("en-IN").format("1.5" as unknown as number) === "1.5";
  } catch {
    return false;
  }
})();

/**
 * Formats minor units for display, exactly, with the currency symbol.
 *
 * Indian digit grouping is not Western grouping: 1234567 is 12,34,567, because
 * the first group from the right is three digits and every group after it is
 * two. `Intl` with en-IN knows that; grouping every three digits by hand
 * produces a number that reads as a different amount to the person whose
 * salary it is.
 */
export function formatMinor(
  value: MinorUnits | bigint,
  currency = "INR",
  locale = "en-IN"
): string {
  let decimal: string;
  try {
    decimal = minorToDecimalString(value);
  } catch {
    // A malformed amount is not worth throwing over in a render path; the
    // payroll engine has produced NaN net pay before, and an em dash at least
    // reads as "not available".
    return "—";
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return SUPPORTS_EXACT_FORMAT
    ? formatter.format(decimal as unknown as number)
    : formatter.format(Number(decimal));
}
