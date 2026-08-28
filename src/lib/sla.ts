// ═══════════════════════════════════════════════════════════════
// SLA ENGINE
// ═══════════════════════════════════════════════════════════════
// Business-hours clocks, pause on customer wait, escalation and breach.
// Pure, so it tests without a database.
//
// The whole difficulty of an SLA is that it is measured in *business* time,
// not elapsed time. A ticket raised at 17:55 on a Friday with a four-hour
// response target is not breached at 21:55 — it is due mid-morning on Monday.
// Getting that wrong produces a breach report that is confidently, uniformly
// wrong, and the first person to check it by hand stops trusting the system.
//
// The second difficulty: the clock must stop while the requester owes a reply.
// Otherwise every ticket waiting on information from the person who raised it
// breaches, and the team is measured on somebody else's response time.

export interface BusinessHours {
  /** Per ISO weekday, 1 = Monday. Absent means closed that day. */
  days: Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, { open: string; close: string }>>;
  /** IANA zone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** Dates the desk is closed regardless of weekday. */
  holidays: string[];
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  days: {
    1: { open: "09:00", close: "18:00" },
    2: { open: "09:00", close: "18:00" },
    3: { open: "09:00", close: "18:00" },
    4: { open: "09:00", close: "18:00" },
    5: { open: "09:00", close: "18:00" },
  },
  timezone: "Asia/Kolkata",
  holidays: [],
};

export type Priority = "urgent" | "high" | "normal" | "low";

export interface SlaPolicy {
  id: string;
  name: string;
  /** Minutes of business time to first response, by priority. */
  responseMinutes: Record<Priority, number>;
  /** Minutes of business time to resolution, by priority. */
  resolutionMinutes: Record<Priority, number>;
  /** Urgent tickets often run against the clock around the calendar. */
  roundTheClockPriorities: Priority[];
  businessHours: BusinessHours;
}

export const DEFAULT_SLA: SlaPolicy = {
  id: "default",
  name: "Standard",
  responseMinutes: { urgent: 60, high: 240, normal: 480, low: 1440 },
  resolutionMinutes: { urgent: 240, high: 1440, normal: 2880, low: 5760 },
  roundTheClockPriorities: ["urgent"],
  businessHours: DEFAULT_BUSINESS_HOURS,
};

// ─── Calendar arithmetic ─────────────────────────────────────

/**
 * The wall-clock date and time in the policy's zone.
 *
 * `Intl` rather than manual offset arithmetic, because India is UTC+5:30 and
 * half the world observes daylight saving. A hardcoded offset is correct until
 * the clocks change, and then every SLA in that region is an hour wrong.
 */
function zoned(instant: Date, timezone: string): { date: string; minutes: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((p) => [p.type, p.value])
  );

  const date = `${parts.year}-${parts.month}-${parts.day}`;
  // "24" appears at midnight in some locales' 24-hour formatting.
  const hour = Number(parts.hour) % 24;
  const minutes = hour * 60 + Number(parts.minute);

  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { date, minutes, weekday: day === 0 ? 7 : day };
}

function toMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) throw new Error("Times must be HH:MM");
  return h * 60 + m;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Open and close minutes for a date, or null if the desk is closed. */
function windowFor(
  date: string,
  hours: BusinessHours
): { open: number; close: number } | null {
  if (hours.holidays.includes(date)) return null;

  const weekday = isoWeekday(date) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const day = hours.days[weekday];
  if (!day) return null;

  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  // A window that closes before it opens is a configuration error that would
  // otherwise make every ticket on that day instantly breached.
  if (close <= open) return null;

  return { open, close };
}

/**
 * Business minutes between two instants.
 *
 * Walks day by day rather than trying to compute it in closed form. A closed
 * form has to special-case the first day, the last day, weekends, holidays and
 * the case where both instants fall on the same day — and it gets one of them
 * wrong. At a year's span this loop runs 365 times, which is nothing.
 */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  hours: BusinessHours
): number {
  if (to <= from) return 0;

  const start = zoned(from, hours.timezone);
  const end = zoned(to, hours.timezone);

  let total = 0;
  let date = start.date;
  let guard = 0;

  while (date <= end.date) {
    // A ticket open for more than ten years is a data error, and an unbounded
    // loop over it would hang the request rather than report it.
    if (++guard > 3_700) break;

    const window = windowFor(date, hours);
    if (window) {
      const dayStart = date === start.date ? Math.max(window.open, start.minutes) : window.open;
      const dayEnd = date === end.date ? Math.min(window.close, end.minutes) : window.close;

      if (dayEnd > dayStart) total += dayEnd - dayStart;
    }

    date = addDays(date, 1);
  }

  return total;
}

/**
 * The instant a number of business minutes from now falls due.
 *
 * A ticket raised at 17:55 on a Friday with a four-hour target is due
 * mid-morning on Monday, not at 21:55 the same evening.
 */
export function addBusinessMinutes(
  from: Date,
  minutes: number,
  hours: BusinessHours
): Date {
  if (minutes <= 0) return new Date(from);

  const start = zoned(from, hours.timezone);
  let remaining = minutes;
  let date = start.date;
  let cursor = start.minutes;
  let guard = 0;

  while (remaining > 0) {
    if (++guard > 3_700) {
      // Every day closed would otherwise loop forever. Returning the input
      // makes the ticket immediately due, which is visible; hanging is not.
      throw new Error("The business calendar has no open days in the next ten years");
    }

    const window = windowFor(date, hours);

    if (window) {
      const from_ = date === start.date ? Math.max(window.open, cursor) : window.open;
      const available = window.close - from_;

      if (available > 0) {
        if (remaining <= available) {
          return instantAt(date, from_ + remaining, hours.timezone);
        }
        remaining -= available;
      }
    }

    date = addDays(date, 1);
    cursor = 0;
  }

  return instantAt(date, 0, hours.timezone);
}

/**
 * Converts a local date and minute-of-day back to an instant.
 *
 * Done by probing the offset at that moment rather than assuming one, so it
 * stays correct across a daylight-saving transition.
 */
function instantAt(date: string, minuteOfDay: number, timezone: string): Date {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;

  const naive = new Date(
    `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`
  );

  // The zone's offset at that instant, found by asking what wall-clock time
  // the naive instant corresponds to and correcting by the difference.
  const check = zoned(naive, timezone);
  const naiveMinutes = hour * 60 + minute;
  const offset = check.minutes - naiveMinutes + dayDelta(check.date, date) * 1440;

  return new Date(naive.getTime() - offset * 60_000);
}

function dayDelta(a: string, b: string): number {
  return Math.round(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000
  );
}

// ─── Ticket clock ────────────────────────────────────────────

export type TicketState =
  | "new"
  | "open"
  | "pending_requester"
  | "pending_third_party"
  | "resolved"
  | "closed";

export interface TicketTimeline {
  createdAt: Date;
  firstRespondedAt?: Date;
  resolvedAt?: Date;
  priority: Priority;
  /**
   * Spans where the clock was stopped.
   *
   * The clock stops while the requester owes a reply. Otherwise every ticket
   * waiting on information breaches, and the team is measured on somebody
   * else's response time.
   */
  pauses: { from: Date; to?: Date }[];
}

export interface SlaStatus {
  responseDueAt: Date;
  resolutionDueAt: Date;
  responseElapsedMinutes: number;
  resolutionElapsedMinutes: number;
  responseRemainingMinutes: number;
  resolutionRemainingMinutes: number;
  responseBreached: boolean;
  resolutionBreached: boolean;
  /** Fraction of the target consumed, for the "approaching breach" view. */
  responseConsumed: number;
  resolutionConsumed: number;
  pausedMinutes: number;
  isPaused: boolean;
}

/**
 * Where a ticket stands against its SLA.
 *
 * Response and resolution are tracked independently. A ticket answered inside
 * ten minutes and then left for a week has met one target and missed the
 * other, and collapsing them into a single "SLA met" flag loses the half that
 * matters.
 */
export function slaStatus(
  ticket: TicketTimeline,
  policy: SlaPolicy,
  now: Date
): SlaStatus {
  const roundTheClock = policy.roundTheClockPriorities.includes(ticket.priority);

  // An urgent ticket runs against the calendar, not the office diary — which
  // is exactly what makes it urgent.
  const hours: BusinessHours = roundTheClock
    ? {
        days: {
          1: { open: "00:00", close: "24:00" },
          2: { open: "00:00", close: "24:00" },
          3: { open: "00:00", close: "24:00" },
          4: { open: "00:00", close: "24:00" },
          5: { open: "00:00", close: "24:00" },
          6: { open: "00:00", close: "24:00" },
          7: { open: "00:00", close: "24:00" },
        },
        timezone: policy.businessHours.timezone,
        holidays: [],
      }
    : policy.businessHours;

  const responseTarget = policy.responseMinutes[ticket.priority];
  const resolutionTarget = policy.resolutionMinutes[ticket.priority];

  const responseStop = ticket.firstRespondedAt ?? now;
  const resolutionStop = ticket.resolvedAt ?? now;

  const pausedBeforeResponse = pausedMinutesIn(
    ticket.pauses,
    ticket.createdAt,
    responseStop,
    hours
  );
  const pausedBeforeResolution = pausedMinutesIn(
    ticket.pauses,
    ticket.createdAt,
    resolutionStop,
    hours
  );

  const responseElapsedMinutes = Math.max(
    0,
    businessMinutesBetween(ticket.createdAt, responseStop, hours) - pausedBeforeResponse
  );
  const resolutionElapsedMinutes = Math.max(
    0,
    businessMinutesBetween(ticket.createdAt, resolutionStop, hours) - pausedBeforeResolution
  );

  // The due instant shifts out by however long the clock was stopped, so a
  // paused ticket's deadline moves rather than silently passing.
  const responseDueAt = addBusinessMinutes(
    ticket.createdAt,
    responseTarget + pausedBeforeResponse,
    hours
  );
  const resolutionDueAt = addBusinessMinutes(
    ticket.createdAt,
    resolutionTarget + pausedBeforeResolution,
    hours
  );

  return {
    responseDueAt,
    resolutionDueAt,
    responseElapsedMinutes,
    resolutionElapsedMinutes,
    responseRemainingMinutes: responseTarget - responseElapsedMinutes,
    resolutionRemainingMinutes: resolutionTarget - resolutionElapsedMinutes,
    responseBreached: responseElapsedMinutes > responseTarget,
    resolutionBreached: resolutionElapsedMinutes > resolutionTarget,
    responseConsumed: responseTarget === 0 ? 1 : responseElapsedMinutes / responseTarget,
    resolutionConsumed:
      resolutionTarget === 0 ? 1 : resolutionElapsedMinutes / resolutionTarget,
    pausedMinutes: pausedBeforeResolution,
    isPaused: ticket.pauses.some((p) => !p.to),
  };
}

/** Business minutes of pause falling inside a window. */
function pausedMinutesIn(
  pauses: { from: Date; to?: Date }[],
  windowStart: Date,
  windowEnd: Date,
  hours: BusinessHours
): number {
  return pauses.reduce((total, pause) => {
    const from = pause.from > windowStart ? pause.from : windowStart;
    const to = (pause.to ?? windowEnd) < windowEnd ? (pause.to ?? windowEnd) : windowEnd;

    if (to <= from) return total;
    return total + businessMinutesBetween(from, to, hours);
  }, 0);
}

// ─── Escalation ──────────────────────────────────────────────

export interface EscalationRule {
  /** Fires once this fraction of the target is consumed. 1.0 is the breach. */
  atConsumed: number;
  /** Which clock this watches. */
  target: "response" | "resolution";
  action: "notify_assignee" | "notify_manager" | "reassign" | "raise_priority";
  /** Who to tell, for the notify actions. */
  notifyRole?: string;
}

export const DEFAULT_ESCALATIONS: EscalationRule[] = [
  { atConsumed: 0.5, target: "response", action: "notify_assignee" },
  { atConsumed: 0.8, target: "response", action: "notify_manager" },
  { atConsumed: 1.0, target: "response", action: "raise_priority" },
  { atConsumed: 0.8, target: "resolution", action: "notify_manager" },
  { atConsumed: 1.0, target: "resolution", action: "notify_manager" },
];

export interface EscalationEvent {
  rule: EscalationRule;
  target: "response" | "resolution";
  action: EscalationRule["action"];
  consumed: number;
}

/**
 * Which escalations are now due.
 *
 * `alreadyFired` is required rather than optional: an escalation engine that
 * re-fires on every poll sends the same manager the same warning every minute
 * until they mute the channel, at which point they also miss the real one.
 */
export function dueEscalations(
  status: SlaStatus,
  rules: EscalationRule[],
  alreadyFired: string[]
): EscalationEvent[] {
  const fired = new Set(alreadyFired);

  return rules
    .filter((rule) => {
      const consumed =
        rule.target === "response" ? status.responseConsumed : status.resolutionConsumed;
      return consumed >= rule.atConsumed;
    })
    .filter((rule) => !fired.has(escalationKey(rule)))
    .map((rule) => ({
      rule,
      target: rule.target,
      action: rule.action,
      consumed:
        rule.target === "response" ? status.responseConsumed : status.resolutionConsumed,
    }));
}

/** A stable identifier for an escalation, so it fires exactly once. */
export function escalationKey(rule: EscalationRule): string {
  return `${rule.target}:${rule.atConsumed}:${rule.action}`;
}

/**
 * Whether a state change stops or starts the clock.
 *
 * Waiting on a third party is deliberately NOT a pause. The requester does not
 * care which supplier the desk is waiting for, and treating it as a pause lets
 * a ticket sit indefinitely while reporting as healthy.
 */
export function clockPaused(state: TicketState): boolean {
  return state === "pending_requester";
}

/** Priority one step up, for an escalation that raises it. */
export function raisePriority(priority: Priority): Priority {
  const ladder: Priority[] = ["low", "normal", "high", "urgent"];
  const index = ladder.indexOf(priority);
  return index < 0 || index === ladder.length - 1 ? priority : ladder[index + 1];
}
