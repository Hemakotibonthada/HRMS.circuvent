// ═══════════════════════════════════════════════════════════════
// INTERN LIFECYCLE — pure date rules
// ═══════════════════════════════════════════════════════════════
//
// The arithmetic behind "how many days until this internship ends" and
// "which reminder milestone is due today". Kept free of any database or
// `next/server` import — deliberately, and for two different reasons:
//
//  1. The interns page needs the exact same "days remaining" number the
//     reminder sweep uses, or the UI and the mailer can disagree about
//     whether someone is "2 days out" depending on which one rounds how.
//     One function, imported by both, is the only way that cannot happen.
//  2. `intern-reminders.ts` runs from the daily cron — no request, no
//     session — and this file has to be importable there without dragging in
//     `"use client"`-only or server-only code either way.
//
// No file in this module calls `new Date()` to compare two calendar dates.
// `new Date("2026-04-30") - new Date("2026-04-29")` looks right until the
// server runs in a timezone behind UTC, at which point both strings parse to
// the wrong local day and an internship that ends tomorrow reads as ending
// today. `benefits-client.ts`'s `daysUntil` hit exactly this bug for
// enrolment deadlines; this file uses the same UTC-epoch-day fix rather than
// reintroducing it for a second date field.

/**
 * How many days before the internship ends each reminder milestone fires.
 *
 * Two numbers by default: a fortnight out, when HR still has time to arrange
 * a conversion, extension or handover, and a final nudge close enough that
 * "the intern's last day is this week" cannot be missed in a busy inbox.
 * Configurable via `INTERN_REMINDER_LEAD_DAYS` (comma-separated integers)
 * because a company running a 2-week internship programme needs shorter
 * leads than these defaults — hardcoding them would make the reminder useless
 * for exactly the org whose interns leave soonest.
 */
const DEFAULT_REMINDER_LEAD_DAYS = [14, 3];

export function reminderLeadDays(): number[] {
  const configured = process.env.INTERN_REMINDER_LEAD_DAYS?.trim();
  if (!configured) return [...DEFAULT_REMINDER_LEAD_DAYS];

  const parsed = configured
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0);

  // A misconfigured value (empty, "abc", "-3") falls back rather than
  // running the sweep with zero milestones — silently sending no reminders
  // ever again is a worse failure than ignoring a typo in an env var.
  return parsed.length > 0 ? parsed : [...DEFAULT_REMINDER_LEAD_DAYS];
}

/**
 * Whole days from `todayISO` to `targetISO`, both `YYYY-MM-DD`. Negative
 * means the date has passed. See the header comment for why this is not
 * `new Date(a) - new Date(b)`.
 */
export function daysUntil(
  targetISO: string,
  todayISO: string = new Date().toISOString().slice(0, 10)
): number {
  const toEpochDay = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return toEpochDay(targetISO) - toEpochDay(todayISO);
}

/**
 * Which configured milestones are due for someone with `daysRemaining` days
 * left, i.e. reached but not yet passed.
 *
 * Deliberately "at or inside" the threshold (`daysRemaining <= lead`) rather
 * than "exactly equal to it". A cron that runs every day only ever sees each
 * lead time once, so equality would be enough on its own — but the Vercel
 * Hobby plan permits exactly one invocation of this route per day, and a
 * missed day (a deploy, an outage, an intern whose end date was set with only
 * a week left) must not silently skip the 14-day reminder forever because the
 * sweep never saw `daysRemaining === 14` land on a day it ran. The
 * `intern_reminder_log` unique key on (employee, leadDays) is what stops this
 * from re-firing on every subsequent day once it has gone out once — this
 * function only decides "has the threshold been reached", not "has it already
 * been sent".
 *
 * The lower bound excludes the internship's last day and beyond: a reminder
 * that "your internship ends in -2 days" after somebody has already left (or
 * converted, or been removed) is confusing rather than useful, and the row
 * that would have produced it is exactly the case `remove()` and
 * `convertToPermanent()` take the person out of the reminder sweep's
 * candidate list for anyway.
 */
export function dueLeadDays(
  daysRemaining: number,
  leadDays: number[] = reminderLeadDays()
): number[] {
  return leadDays.filter((lead) => daysRemaining >= 0 && daysRemaining <= lead);
}

/**
 * Human phrasing for "how long until the internship ends", shared by the
 * interns page badge and the reminder email body so the two never disagree
 * on wording for the same number.
 */
export function describeDaysRemaining(daysRemaining: number): string {
  if (daysRemaining < 0) {
    const overdue = Math.abs(daysRemaining);
    return `${overdue} day${overdue === 1 ? "" : "s"} past the expected end date`;
  }
  if (daysRemaining === 0) return "Last working day is today";
  return `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`;
}
