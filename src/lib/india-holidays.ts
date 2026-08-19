// ═══════════════════════════════════════════════════════════════
// INDIAN PUBLIC HOLIDAYS
// ═══════════════════════════════════════════════════════════════
//
// The holidays this product can state with certainty, 2026 to 2036, and an
// explicit account of the ones it cannot.
//
// This distinction is the whole design. A holiday calendar in an HR system is
// not decoration: attendance is marked against it, leave is deducted in
// working days against it, and payroll pays against it. A wrong date means
// somebody is marked absent on a day the office was shut, or loses a day of
// leave for a day they were never expected to work.
//
// So the module is split in two.
//
// **Fixed-date holidays** fall on the same date every year by statute. Republic
// Day is the 26th of January because the Constitution came into effect on that
// date in 1950; it will be the 26th of January in 2036. These are generated,
// not typed, so there is no transcription to get wrong.
//
// **Movable holidays** — Diwali, Holi, Eid, Good Friday, and the rest — are
// not stated here at all, and that is deliberate rather than an omission.
// Hindu festivals follow a lunisolar calendar whose dates differ between the
// Amanta and Purnimanta reckonings used in different states. Islamic dates
// depend on the Hijri calendar and, in India, on official moon sighting, so
// they are announced rather than computed and can move by a day at short
// notice. Christian moveable feasts follow the computus.
//
// Producing plausible-looking dates for any of those from memory would be
// fabrication of exactly the kind this codebase has been cleaning out — and
// more consequential than most, because a fabricated holiday is acted on by
// payroll. `MOVABLE_HOLIDAYS` names them so the calendar can show what is
// missing and ask for it, which is honest and useful; inventing the dates
// would be neither.

export interface FixedHoliday {
  name: string;
  month: number;
  day: number;
  /** Gazetted holidays are closed days; restricted ones are chosen from a pool. */
  restricted: boolean;
  description: string;
}

/**
 * Holidays that fall on the same date every year.
 *
 * Only the three national gazetted holidays are truly universal across India;
 * the rest below are widely observed and are marked restricted so a tenant
 * chooses rather than inherits them.
 */
export const FIXED_HOLIDAYS: readonly FixedHoliday[] = [
  {
    name: "Republic Day",
    month: 1,
    day: 26,
    restricted: false,
    description: "The day the Constitution of India came into effect, in 1950.",
  },
  {
    name: "Independence Day",
    month: 8,
    day: 15,
    restricted: false,
    description: "Independence from British rule, in 1947.",
  },
  {
    name: "Gandhi Jayanti",
    month: 10,
    day: 2,
    restricted: false,
    description: "The birth anniversary of Mohandas Karamchand Gandhi, born 1869.",
  },
  {
    name: "Christmas Day",
    month: 12,
    day: 25,
    restricted: false,
    description: "Observed nationally as a gazetted holiday.",
  },
  {
    name: "New Year's Day",
    month: 1,
    day: 1,
    restricted: true,
    description: "Widely observed; not a national gazetted holiday.",
  },
  {
    name: "Labour Day",
    month: 5,
    day: 1,
    restricted: true,
    description:
      "May Day. A public holiday in several states including Tamil Nadu, Kerala, " +
      "Karnataka, Maharashtra, Telangana and West Bengal, rather than nationally.",
  },
  {
    name: "Ambedkar Jayanti",
    month: 4,
    day: 14,
    restricted: true,
    description: "The birth anniversary of B. R. Ambedkar, born 1891.",
  },
] as const;

/**
 * Holidays whose date this module cannot compute, named so they can be asked
 * for rather than guessed.
 *
 * Each carries why it moves, because the reason determines who can supply it:
 * a lunisolar date can be taken from an ephemeris, while an Islamic one in
 * India is set by announcement and is not knowable years ahead at all.
 */
export interface MovableHoliday {
  name: string;
  /** Which reckoning determines the date. */
  calendar: "hindu-lunisolar" | "islamic" | "christian-computus" | "sikh" | "regional";
  restricted: boolean;
  reason: string;
}

export const MOVABLE_HOLIDAYS: readonly MovableHoliday[] = [
  { name: "Holi", calendar: "hindu-lunisolar", restricted: false, reason: "Phalguna Purnima; varies with the lunisolar calendar." },
  { name: "Diwali", calendar: "hindu-lunisolar", restricted: false, reason: "Kartika Amavasya; varies with the lunisolar calendar." },
  { name: "Dussehra", calendar: "hindu-lunisolar", restricted: false, reason: "Ashvina Shukla Dashami." },
  { name: "Maha Shivaratri", calendar: "hindu-lunisolar", restricted: false, reason: "Phalguna Krishna Chaturdashi." },
  { name: "Ram Navami", calendar: "hindu-lunisolar", restricted: false, reason: "Chaitra Shukla Navami." },
  { name: "Janmashtami", calendar: "hindu-lunisolar", restricted: false, reason: "Bhadrapada Krishna Ashtami." },
  { name: "Ganesh Chaturthi", calendar: "hindu-lunisolar", restricted: true, reason: "Bhadrapada Shukla Chaturthi." },
  { name: "Raksha Bandhan", calendar: "hindu-lunisolar", restricted: true, reason: "Shravana Purnima." },
  { name: "Mahavir Jayanti", calendar: "hindu-lunisolar", restricted: false, reason: "Chaitra Shukla Trayodashi." },
  { name: "Buddha Purnima", calendar: "hindu-lunisolar", restricted: false, reason: "Vaisakha Purnima." },
  { name: "Guru Nanak Jayanti", calendar: "sikh", restricted: false, reason: "Kartik Purnima, by the Nanakshahi calendar." },
  { name: "Eid al-Fitr", calendar: "islamic", restricted: false, reason: "1 Shawwal. Announced on moon sighting; not fixed in advance." },
  { name: "Eid al-Adha", calendar: "islamic", restricted: false, reason: "10 Dhu al-Hijjah. Announced on moon sighting." },
  { name: "Muharram", calendar: "islamic", restricted: false, reason: "10 Muharram. Announced on moon sighting." },
  { name: "Milad-un-Nabi", calendar: "islamic", restricted: false, reason: "12 Rabi al-Awwal. Announced on moon sighting." },
  { name: "Good Friday", calendar: "christian-computus", restricted: false, reason: "The Friday before Easter, by the computus." },
] as const;

export interface GeneratedHoliday {
  name: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  year: number;
  restricted: boolean;
  description: string;
  /** True when the date fell on a weekend and was not moved. */
  onWeekend: boolean;
}

/** Years this module will generate for. */
export const SUPPORTED_YEARS = { first: 2026, last: 2036 } as const;

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Whether a date falls on a Saturday or Sunday.
 *
 * Parsed with an explicit UTC suffix. `new Date("2026-01-26")` is already UTC
 * midnight, but `new Date(2026, 0, 26)` is local — mixing the two is how a
 * holiday lands on the wrong weekday for half the world, and this product runs
 * on servers in UTC serving users in IST.
 */
export function fallsOnWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The fixed-date holidays for one year.
 *
 * Generated rather than transcribed. Eleven years of seven holidays is
 * seventy-seven rows, and a hand-written table of those is a typo waiting to
 * mark somebody absent.
 *
 * Indian public holidays are not moved when they fall on a weekend — there is
 * no "observed on the following Monday" convention as there is in the UK or
 * the US — so the date is reported as it falls, with `onWeekend` set so a
 * calendar can show it without implying a day off that nobody gets.
 */
export function holidaysFor(year: number): GeneratedHoliday[] {
  return FIXED_HOLIDAYS.map((holiday) => {
    const date = iso(year, holiday.month, holiday.day);
    return {
      name: holiday.name,
      date,
      year,
      restricted: holiday.restricted,
      description: holiday.description,
      onWeekend: fallsOnWeekend(date),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Every fixed holiday across the supported range. */
export function allHolidays(
  from: number = SUPPORTED_YEARS.first,
  to: number = SUPPORTED_YEARS.last
): GeneratedHoliday[] {
  const out: GeneratedHoliday[] = [];
  for (let year = from; year <= to; year++) out.push(...holidaysFor(year));
  return out;
}

/**
 * What is missing for a year, so the calendar can say so.
 *
 * A holiday list that silently contains only the fixed dates looks complete
 * and is not — an employee planning around it would take leave on Diwali. This
 * is what lets the screen say "16 festival dates still to be confirmed" rather
 * than quietly showing seven holidays as though that were the year.
 */
export function missingFor(year: number): MovableHoliday[] {
  void year;
  return [...MOVABLE_HOLIDAYS];
}
