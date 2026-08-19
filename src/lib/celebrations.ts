// ═══════════════════════════════════════════════════════════════
// CELEBRATIONS — whose day is coming up
// ═══════════════════════════════════════════════════════════════
//
// Birthdays and work anniversaries recur, which makes them slightly harder than
// they look. A birthday on 3 January is *three weeks away* when viewed on 12
// December, and comparing full dates puts it eleven months away instead — so
// the screen shows nothing for the whole of December and everybody misses it.
//
// This module compares month and day only, walking forward day by day from
// today. Walking rather than arithmetic because it costs nothing over a
// horizon of weeks and it is obviously correct across a year boundary and a
// leap year, which the arithmetic version is not.
//
// ─── On 29 February ───
//
// A birthday on 29 February does not occur in most years. Nothing here invents
// a substitute date: an employee whose birthday is 29 February is shown on 29
// February, and in other years is not shown at all. Silently moving them to the
// 28th or the 1st is a decision about somebody's identity that a payroll system
// has no business making on their behalf, and either choice offends somebody.

/** A date as YYYY-MM-DD. */
export type IsoDate = string;

export function toIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export interface Occurrence {
  /** True when the day falls within the horizon. */
  soon: boolean;
  /** The date it next falls on, as YYYY-MM-DD. Empty when it does not. */
  on: IsoDate;
}

/**
 * When a recurring day next falls, within a horizon.
 *
 * `monthDay` is the MM-DD taken from a birth or join date. `from` is today.
 */
export function nextOccurrence(
  monthDay: string,
  from: Date,
  horizonDays: number
): Occurrence {
  const month = Number(monthDay.slice(0, 2));
  const day = Number(monthDay.slice(3, 5));

  if (!Number.isInteger(month) || !Number.isInteger(day)) return { soon: false, on: "" };
  if (month < 1 || month > 12 || day < 1 || day > 31) return { soon: false, on: "" };

  for (let i = 0; i <= horizonDays; i++) {
    const probe = new Date(from);
    probe.setUTCDate(probe.getUTCDate() + i);
    if (probe.getUTCMonth() + 1 === month && probe.getUTCDate() === day) {
      return { soon: true, on: toIso(probe) };
    }
  }

  return { soon: false, on: "" };
}

export interface PersonDay {
  employeeId: string;
  name: string;
  designation: string;
  /** Birth date or join date, as YYYY-MM-DD. */
  date: IsoDate | null;
}

export interface Birthday {
  employeeId: string;
  name: string;
  designation: string;
  on: IsoDate;
  isToday: boolean;
}

/**
 * Upcoming birthdays.
 *
 * The birth **year is deliberately not carried through**. Day and month are
 * what a colleague needs in order to say happy birthday; the year is somebody's
 * age, and an HR system publishing that across a company is a disclosure nobody
 * agreed to and which several jurisdictions treat as a protected characteristic.
 */
export function upcomingBirthdays(
  people: readonly PersonDay[],
  from: Date,
  horizonDays: number
): Birthday[] {
  const today = toIso(from);

  return people
    .filter((p) => p.date)
    .map((p) => {
      const { soon, on } = nextOccurrence(p.date!.slice(5, 10), from, horizonDays);
      return soon
        ? {
            employeeId: p.employeeId,
            name: p.name,
            designation: p.designation,
            on,
            isToday: on === today,
          }
        : null;
    })
    .filter((b): b is Birthday => b !== null)
    .sort((a, b) => a.on.localeCompare(b.on));
}

export interface Anniversary extends Birthday {
  years: number;
}

/**
 * Upcoming work anniversaries.
 *
 * The year *is* carried here, because length of service is a fact about the job
 * rather than about the person, and "ten years today" is the whole reason for
 * mentioning it.
 *
 * Somebody's joining day itself is not an anniversary — a new starter is not
 * celebrating nought years — so anything below one year is dropped.
 */
export function upcomingAnniversaries(
  people: readonly PersonDay[],
  from: Date,
  horizonDays: number
): Anniversary[] {
  const today = toIso(from);

  return people
    .filter((p) => p.date)
    .map((p) => {
      const joined = p.date!;
      const { soon, on } = nextOccurrence(joined.slice(5, 10), from, horizonDays);
      if (!soon) return null;

      const years = Number(on.slice(0, 4)) - Number(joined.slice(0, 4));
      if (years < 1) return null;

      return {
        employeeId: p.employeeId,
        name: p.name,
        designation: p.designation,
        on,
        years,
        isToday: on === today,
      };
    })
    .filter((a): a is Anniversary => a !== null)
    .sort((a, b) => a.on.localeCompare(b.on));
}
