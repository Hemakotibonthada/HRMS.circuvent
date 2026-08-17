/**
 * `YYYY-MM-DD` keys that mean the day a person is actually living in.
 *
 * The bug this exists to stop is `new Date().toISOString().split("T")[0]`,
 * which was scattered across the dashboard. `toISOString` renders in **UTC**,
 * so in Asia/Kolkata — this product's default zone, at UTC+5:30 — every call
 * between 00:00 and 05:30 IST returns *yesterday's* date. That is not an edge
 * case in an HR product: it is the early shift clocking in, the night shift
 * closing out, and the SLA clock on a grievance filed at 2am.
 *
 * Two different questions get two different functions, because they have two
 * different right answers:
 *
 *   - `dateKeyInZone` takes an *instant* (a real moment, e.g. `new Date()`)
 *     and asks what the calendar said in some zone at that moment.
 *   - `toLocalDateKey` takes a Date that was *constructed* from calendar
 *     parts (`new Date(2026, 5, 15)`), where the fields are already the
 *     answer and the instant is an artefact of the runner's zone.
 *
 * Using either one for the other's job reintroduces the off-by-one.
 */

/**
 * Falls back to IST, matching `DEFAULT_BUSINESS_HOURS` in `sla.ts` and the
 * quiet-hours default in `notifications/engine.ts`.
 */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar date in `timezone` at the given instant.
 *
 * `Intl` rather than manual offset arithmetic, for the reason `sla.ts` gives:
 * India is UTC+5:30 and half the world observes daylight saving, so a
 * hardcoded offset is correct only until the clocks change.
 */
export function dateKeyInZone(instant: Date, timezone: string = DEFAULT_TIMEZONE): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("dateKeyInZone needs a valid Date");
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Today's date in `timezone`. */
export function todayKey(timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return dateKeyInZone(now, timezone);
}

/**
 * The calendar date a Date object is *carrying*, read from its local fields.
 *
 * For dates built from parts — `new Date(year, month, day)` — the year, month
 * and day are the intended value and the underlying instant is incidental.
 * `toISOString` would convert that local midnight to UTC and land on the
 * previous day everywhere east of Greenwich.
 */
export function toLocalDateKey(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("toLocalDateKey needs a valid Date");
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Shifts a `YYYY-MM-DD` key by whole days.
 *
 * Parsed as UTC and moved in UTC so the arithmetic cannot be knocked sideways
 * by a daylight-saving transition in the runner's local zone: adding 7 days to
 * a local-midnight Date across a spring-forward boundary can otherwise land on
 * 23:00 the previous evening, and the key goes back a day.
 */
export function addDaysToKey(key: string, days: number): string {
  if (!KEY_PATTERN.test(key)) {
    throw new RangeError(`Expected a YYYY-MM-DD key, got "${key}"`);
  }
  if (!Number.isInteger(days)) {
    throw new RangeError("addDaysToKey only moves whole days");
  }

  const at = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) {
    throw new RangeError(`"${key}" is not a real date`);
  }

  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
