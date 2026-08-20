// The reminder sweep's date arithmetic, tested without a database or a
// cron invocation. `intern-reminders.test.ts` covers the claim-and-send
// orchestration; this file only covers "is a milestone due today".

import { describe, expect, it, afterEach } from "vitest";
import {
  daysUntil,
  describeDaysRemaining,
  dueLeadDays,
  reminderLeadDays,
} from "@/lib/intern-lifecycle";

describe("daysUntil", () => {
  it("counts whole days forward", () => {
    expect(daysUntil("2026-04-30", "2026-04-16")).toBe(14);
    expect(daysUntil("2026-04-19", "2026-04-16")).toBe(3);
  });

  it("is negative once the date has passed", () => {
    expect(daysUntil("2026-04-10", "2026-04-16")).toBe(-6);
  });

  it("is zero on the day itself", () => {
    expect(daysUntil("2026-04-16", "2026-04-16")).toBe(0);
  });

  it("does not shift across a month or year boundary", () => {
    // A naive `new Date(a) - new Date(b)` in local time can be off by one
    // here if the runner's timezone is behind UTC — the whole reason this
    // is computed from UTC-anchored y/m/d components instead.
    expect(daysUntil("2027-01-01", "2026-12-30")).toBe(2);
  });
});

describe("reminderLeadDays", () => {
  afterEach(() => {
    delete process.env.INTERN_REMINDER_LEAD_DAYS;
  });

  it("defaults to 14 and 3 days out", () => {
    expect(reminderLeadDays()).toEqual([14, 3]);
  });

  it("reads a configured comma-separated list", () => {
    process.env.INTERN_REMINDER_LEAD_DAYS = "30, 7, 1";
    expect(reminderLeadDays()).toEqual([30, 7, 1]);
  });

  it("falls back to the default rather than running with zero milestones", () => {
    // A typo that parses to nothing must not silently turn the reminder
    // feature off — that is a much harder failure to notice than a wrong
    // lead time would be.
    process.env.INTERN_REMINDER_LEAD_DAYS = "not-a-number";
    expect(reminderLeadDays()).toEqual([14, 3]);

    process.env.INTERN_REMINDER_LEAD_DAYS = "-5, abc";
    expect(reminderLeadDays()).toEqual([14, 3]);
  });
});

describe("dueLeadDays", () => {
  it("is due once the threshold is reached", () => {
    expect(dueLeadDays(14, [14, 3])).toEqual([14]);
    // At daysRemaining = 3, the 14-day threshold has also been reached (and
    // passed) — both come back "due" here; it is the caller's claim table,
    // not this function, that stops the 14-day reminder going out twice.
    expect(dueLeadDays(3, [14, 3])).toEqual([14, 3]);
  });

  it("stays due if a cron day was missed and the countdown ran past the exact number", () => {
    // The sweep only runs once a day; if it skipped the day `daysRemaining`
    // was exactly 14 (a deploy, an outage), the 14-day milestone must not be
    // lost forever the next time it runs at daysRemaining = 13.
    expect(dueLeadDays(13, [14, 3])).toEqual([14]);
  });

  it("can be due for more than one milestone at once after a long gap", () => {
    expect(dueLeadDays(2, [14, 3])).toEqual([14, 3]);
  });

  it("is not due before the earliest lead time", () => {
    expect(dueLeadDays(20, [14, 3])).toEqual([]);
  });

  it("is not due once the end date itself has passed", () => {
    // A reminder that "your internship ends in -4 days" for someone who has
    // already converted or been removed is noise, not a nudge.
    expect(dueLeadDays(-4, [14, 3])).toEqual([]);
  });
});

describe("describeDaysRemaining", () => {
  it("describes the future, today and the past distinctly", () => {
    expect(describeDaysRemaining(5)).toBe("5 days remaining");
    expect(describeDaysRemaining(1)).toBe("1 day remaining");
    expect(describeDaysRemaining(0)).toBe("Last working day is today");
    expect(describeDaysRemaining(-1)).toBe("1 day past the expected end date");
    expect(describeDaysRemaining(-3)).toBe("3 days past the expected end date");
  });
});
