// ═══════════════════════════════════════════════════════════════
// PUBLIC HOLIDAYS — ANDHRA PRADESH
// ═══════════════════════════════════════════════════════════════
//
// The holidays observed in Andhra Pradesh that this product can state with
// certainty, 2026 to 2036, and an explicit account of the ones it cannot.
//
// A holiday calendar in an HR system is not decoration. Attendance is marked
// against it, leave is deducted in working days against it, and payroll pays
// against it — so a wrong date means somebody is marked absent on a day the
// office was shut, or loses a day of leave for a day they were never expected
// to work.
//
// The split below is by *how the date is determined*, because that is what
// decides whether it can be known here at all:
//
//   **Gregorian-fixed** — the same date every year by statute or commemoration.
//   Republic Day is the 26th of January because the Constitution came into
//   effect on that date in 1950.
//
//   **Solar** — fixed to the sun's position rather than the moon's. Sankranti
//   marks the sun entering Makara, which happens in mid-January every year and
//   drifts by roughly a day per seventy years, not a fortnight per year like a
//   lunar date. This is why the Telugu Sankranti block can be stated here and
//   Ugadi cannot.
//
//   **Lunisolar and Islamic** — not stated, deliberately. Telugu festivals
//   follow the Amanta lunisolar reckoning used in Andhra Pradesh, and Islamic
//   dates are announced on moon sighting rather than computed. Producing
//   plausible dates for either from memory would be fabrication acted on by
//   payroll.

export interface FixedHoliday {
  name: string;
  /** Telugu name, where the holiday has one in common use. */
  teluguName?: string;
  month: number;
  day: number;
  /** Gazetted holidays are closed days; restricted ones are chosen from a pool. */
  restricted: boolean;
  description: string;
}

/**
 * Holidays with a fixed Gregorian date, as observed in Andhra Pradesh.
 *
 * The Sankranti block is the Telugu new-harvest festival and is the state's
 * largest holiday — offices in Andhra Pradesh close for it in a way they do
 * not for Holi. It is included because Sankranti is solar: the sun's entry
 * into Makara falls on the 14th of January throughout this range, with the
 * transit occasionally late enough to put the observance on the 15th. The
 * three-day block covers the festival either way, which is how the state
 * calendar lists it.
 */
export const FIXED_HOLIDAYS: readonly FixedHoliday[] = [
  {
    name: "New Year's Day",
    month: 1,
    day: 1,
    restricted: true,
    description: "Widely observed; not a gazetted holiday in Andhra Pradesh.",
  },
  {
    name: "Bhogi",
    teluguName: "భోగి",
    month: 1,
    day: 13,
    restricted: false,
    description: "First day of the Sankranti festival. The old year's bonfire.",
  },
  {
    name: "Makara Sankranti",
    teluguName: "మకర సంక్రాంతి",
    month: 1,
    day: 14,
    restricted: false,
    description:
      "The harvest festival, marking the sun's entry into Makara. Solar rather " +
      "than lunar, so it holds to mid-January; the transit can fall late enough " +
      "for the observance to move to the 15th in some years.",
  },
  {
    name: "Kanuma",
    teluguName: "కనుమ",
    month: 1,
    day: 15,
    restricted: false,
    description: "Third day of Sankranti, honouring cattle and the harvest.",
  },
  {
    name: "Republic Day",
    teluguName: "గణతంత్ర దినోత్సవం",
    month: 1,
    day: 26,
    restricted: false,
    description: "The day the Constitution of India came into effect, in 1950.",
  },
  {
    name: "Ambedkar Jayanti",
    teluguName: "అంబేద్కర్ జయంతి",
    month: 4,
    day: 14,
    restricted: false,
    description: "The birth anniversary of B. R. Ambedkar, born 1891.",
  },
  {
    name: "Labour Day",
    month: 5,
    day: 1,
    restricted: false,
    description: "May Day. A public holiday in Andhra Pradesh.",
  },
  {
    name: "Independence Day",
    teluguName: "స్వాతంత్ర్య దినోత్సవం",
    month: 8,
    day: 15,
    restricted: false,
    description: "Independence from British rule, in 1947.",
  },
  {
    name: "Gandhi Jayanti",
    teluguName: "గాంధీ జయంతి",
    month: 10,
    day: 2,
    restricted: false,
    description: "The birth anniversary of Mohandas Karamchand Gandhi, born 1869.",
  },
  {
    name: "Andhra Pradesh Formation Day",
    teluguName: "ఆంధ్రప్రదేశ్ అవతరణ దినోత్సవం",
    month: 11,
    day: 1,
    restricted: true,
    description: "The formation of Andhra Pradesh under the States Reorganisation Act, 1956.",
  },
  {
    name: "Christmas Day",
    month: 12,
    day: 25,
    restricted: false,
    description: "Observed as a gazetted holiday.",
  },
] as const;

/**
 * Other names the same day is filed under.
 *
 * Earlier seedings wrote "Dr Ambedkar Jayanti" where this module writes
 * "Ambedkar Jayanti", which leaves 14 April on the calendar twice — a duplicate
 * an employee sees as two holidays and a leave calculation counts once, so the
 * two disagree. Listed rather than matched by fuzzy string comparison, because
 * "Dasara" and "Dussehra" are the same day but "Bhogi" and "Kanuma" are not,
 * and no similarity measure knows the difference.
 */
export const HOLIDAY_ALIASES: Readonly<Record<string, string>> = {
  "Dr Ambedkar Jayanti": "Ambedkar Jayanti",
  "Dr. Ambedkar Jayanti": "Ambedkar Jayanti",
  "Dr. B.R. Ambedkar Jayanti": "Ambedkar Jayanti",
  Sankranti: "Makara Sankranti",
  "Makar Sankranti": "Makara Sankranti",
  Pongal: "Makara Sankranti",
  Dussehra: "Dasara",
  Vijayadashami: "Dasara",
  Diwali: "Deepavali",
  "Ganesh Chaturthi": "Vinayaka Chavithi",
  "Ram Navami": "Sri Rama Navami",
  Janmashtami: "Krishna Janmashtami",
  "Eid al-Fitr": "Ramzan (Eid al-Fitr)",
  "Eid al-Adha": "Bakrid (Eid al-Adha)",
};

/**
 * The canonical name for a holiday, or the name unchanged when it is already
 * canonical or unknown.
 */
export function canonicalName(name: string): string {
  return HOLIDAY_ALIASES[name.trim()] ?? name;
}

/**
 * Holidays whose date this module cannot compute, named so they can be asked
 * for rather than guessed.
 *
 * These are the ones Andhra Pradesh actually closes for beyond the fixed list,
 * so a calendar without them is visibly incomplete rather than quietly wrong.
 * Each carries why it moves, because that decides who can supply it: a
 * lunisolar date can be taken from a panchangam, while an Islamic date in
 * India is set by announcement and is not knowable years ahead by anyone.
 */
export interface MovableHoliday {
  name: string;
  teluguName?: string;
  calendar: "telugu-lunisolar" | "islamic" | "christian-computus";
  restricted: boolean;
  reason: string;
}

export const MOVABLE_HOLIDAYS: readonly MovableHoliday[] = [
  {
    name: "Ugadi",
    teluguName: "ఉగాది",
    calendar: "telugu-lunisolar",
    restricted: false,
    reason: "Telugu new year. Chaitra Shukla Pratipada by the Amanta reckoning.",
  },
  {
    name: "Sri Rama Navami",
    teluguName: "శ్రీ రామ నవమి",
    calendar: "telugu-lunisolar",
    restricted: false,
    reason: "Chaitra Shukla Navami.",
  },
  {
    name: "Maha Shivaratri",
    teluguName: "మహా శివరాత్రి",
    calendar: "telugu-lunisolar",
    restricted: false,
    reason: "Magha Krishna Chaturdashi by the Amanta reckoning.",
  },
  {
    name: "Varalakshmi Vratam",
    teluguName: "వరలక్ష్మీ వ్రతం",
    calendar: "telugu-lunisolar",
    restricted: true,
    reason: "The Friday before Shravana Purnima.",
  },
  {
    name: "Krishna Janmashtami",
    teluguName: "శ్రీ కృష్ణ జన్మాష్టమి",
    calendar: "telugu-lunisolar",
    restricted: true,
    reason: "Shravana Krishna Ashtami.",
  },
  {
    name: "Vinayaka Chavithi",
    teluguName: "వినాయక చవితి",
    calendar: "telugu-lunisolar",
    restricted: false,
    reason: "Bhadrapada Shukla Chaturthi.",
  },
  {
    name: "Dasara",
    teluguName: "దసరా",
    calendar: "telugu-lunisolar",
    restricted: false,
    reason: "Ashvina Shukla Dashami. Andhra Pradesh closes for several days around it.",
  },
  {
    name: "Deepavali",
    teluguName: "దీపావళి",
    calendar: "telugu-lunisolar",
    restricted: false,
    reason: "Ashvina Amavasya by the Amanta reckoning.",
  },
  {
    name: "Atla Tadde",
    teluguName: "అట్ల తద్ది",
    calendar: "telugu-lunisolar",
    restricted: true,
    reason: "Ashvina Krishna Tadiya.",
  },
  {
    name: "Karthika Pournami",
    teluguName: "కార్తీక పౌర్ణమి",
    calendar: "telugu-lunisolar",
    restricted: true,
    reason: "Kartika Purnima.",
  },
  {
    name: "Ramzan (Eid al-Fitr)",
    calendar: "islamic",
    restricted: false,
    reason: "1 Shawwal. Announced on moon sighting; not fixed in advance.",
  },
  {
    name: "Bakrid (Eid al-Adha)",
    calendar: "islamic",
    restricted: false,
    reason: "10 Dhu al-Hijjah. Announced on moon sighting.",
  },
  {
    name: "Muharram",
    calendar: "islamic",
    restricted: false,
    reason: "10 Muharram. Announced on moon sighting.",
  },
  {
    name: "Milad-un-Nabi",
    calendar: "islamic",
    restricted: true,
    reason: "12 Rabi al-Awwal. Announced on moon sighting.",
  },
  {
    name: "Good Friday",
    calendar: "christian-computus",
    restricted: false,
    reason: "The Friday before Easter, by the computus.",
  },
] as const;

export interface GeneratedHoliday {
  name: string;
  teluguName?: string;
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
 * Parsed with an explicit UTC suffix. Mixing `new Date("2026-01-26")`, which is
 * UTC midnight, with `new Date(2026, 0, 26)`, which is local, is how a holiday
 * lands on the wrong weekday — and this product runs on servers in UTC serving
 * users in IST.
 */
export function fallsOnWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The fixed-date holidays for one year.
 *
 * Generated rather than transcribed. Eleven years of eleven holidays is a
 * hundred and twenty-one rows, and a hand-written table of those is a typo
 * waiting to mark somebody absent.
 *
 * Indian public holidays are not moved when they fall on a weekend — there is
 * no "observed on the following Monday" convention — so the date is reported as
 * it falls, with `onWeekend` set so a calendar can show it without implying a
 * day off that nobody gets.
 */
export function holidaysFor(year: number): GeneratedHoliday[] {
  return FIXED_HOLIDAYS.map((holiday) => {
    const date = iso(year, holiday.month, holiday.day);
    return {
      name: holiday.name,
      teluguName: holiday.teluguName,
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
 * A list that silently contains only the fixed dates looks complete and is not:
 * an employee planning around it would book leave on Ugadi or Dasara, which are
 * among the days Andhra Pradesh most reliably closes for. This is what lets the
 * screen say "15 festival dates still to be confirmed" rather than showing
 * eleven holidays as though that were the year.
 */
export function missingFor(year: number): MovableHoliday[] {
  void year;
  return [...MOVABLE_HOLIDAYS];
}
