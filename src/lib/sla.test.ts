// @vitest-environment node
//
// An SLA is measured in business time, not elapsed time. A breach report that
// gets that wrong is confidently, uniformly wrong, and the first person to
// check it by hand stops trusting the system. These tests pin the boundaries
// where that happens: Friday evening, holidays, and the clock stopping while
// the requester owes a reply.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_ESCALATIONS,
  DEFAULT_SLA,
  addBusinessMinutes,
  businessMinutesBetween,
  clockPaused,
  dueEscalations,
  escalationKey,
  raisePriority,
  slaStatus,
  type Priority,  type BusinessHours,
  type TicketTimeline,
} from "@/lib/sla";

// A fixed-offset zone keeps the assertions readable; the daylight-saving case
// is covered separately below.
const hours: BusinessHours = {
  days: {
    1: { open: "09:00", close: "18:00" },
    2: { open: "09:00", close: "18:00" },
    3: { open: "09:00", close: "18:00" },
    4: { open: "09:00", close: "18:00" },
    5: { open: "09:00", close: "18:00" },
  },
  timezone: "UTC",
  holidays: ["2026-04-08"],
};

/** 2026-04-06 is a Monday. */
function at(iso: string): Date {
  return new Date(`${iso}Z`);
}

describe("businessMinutesBetween", () => {
  it("counts minutes inside one working day", () => {
    expect(businessMinutesBetween(at("2026-04-06T10:00:00"), at("2026-04-06T12:00:00"), hours)).toBe(
      120
    );
  });

  it("ignores time before opening", () => {
    expect(businessMinutesBetween(at("2026-04-06T07:00:00"), at("2026-04-06T10:00:00"), hours)).toBe(
      60
    );
  });

  it("ignores time after closing", () => {
    expect(businessMinutesBetween(at("2026-04-06T17:00:00"), at("2026-04-06T23:00:00"), hours)).toBe(
      60
    );
  });

  it("spans two working days without counting the night", () => {
    // 17:00 Monday to 10:00 Tuesday is one hour plus one hour, not seventeen.
    expect(businessMinutesBetween(at("2026-04-06T17:00:00"), at("2026-04-07T10:00:00"), hours)).toBe(
      120
    );
  });

  it("skips the weekend", () => {
    // Friday 17:00 to Monday 10:00 is one hour plus one hour.
    expect(businessMinutesBetween(at("2026-04-10T17:00:00"), at("2026-04-13T10:00:00"), hours)).toBe(
      120
    );
  });

  it("skips a holiday", () => {
    // Tuesday 17:00 to Thursday 10:00, with Wednesday a holiday.
    expect(businessMinutesBetween(at("2026-04-07T17:00:00"), at("2026-04-09T10:00:00"), hours)).toBe(
      120
    );
  });

  it("counts a whole working day as its full length", () => {
    expect(businessMinutesBetween(at("2026-04-06T00:00:00"), at("2026-04-07T00:00:00"), hours)).toBe(
      540
    );
  });

  it("is zero when both instants fall outside working hours on the same day", () => {
    expect(businessMinutesBetween(at("2026-04-06T19:00:00"), at("2026-04-06T22:00:00"), hours)).toBe(
      0
    );
  });

  it("is zero across a whole weekend", () => {
    expect(businessMinutesBetween(at("2026-04-11T09:00:00"), at("2026-04-12T18:00:00"), hours)).toBe(
      0
    );
  });

  it("is zero when the end precedes the start", () => {
    expect(businessMinutesBetween(at("2026-04-06T12:00:00"), at("2026-04-06T10:00:00"), hours)).toBe(
      0
    );
  });

  it("treats a window that closes before it opens as closed", () => {
    // A configuration error would otherwise make every ticket that day
    // instantly breached.
    const broken: BusinessHours = {
      ...hours,
      days: { 1: { open: "18:00", close: "09:00" } },
    };
    expect(
      businessMinutesBetween(at("2026-04-06T10:00:00"), at("2026-04-06T17:00:00"), broken)
    ).toBe(0);
  });
});

describe("addBusinessMinutes", () => {
  it("adds within the same day", () => {
    const due = addBusinessMinutes(at("2026-04-06T10:00:00"), 120, hours);
    expect(due.toISOString()).toBe("2026-04-06T12:00:00.000Z");
  });

  it("rolls over to the next working morning", () => {
    // 17:00 Monday plus two hours is 10:00 Tuesday, not 19:00 Monday.
    const due = addBusinessMinutes(at("2026-04-06T17:00:00"), 120, hours);
    expect(due.toISOString()).toBe("2026-04-07T10:00:00.000Z");
  });

  it("rolls a Friday evening ticket over the weekend", () => {
    // The case that makes a naive implementation obviously wrong: raised at
    // 17:55 on a Friday with a four-hour target, due mid-morning on Monday.
    const due = addBusinessMinutes(at("2026-04-10T17:55:00"), 240, hours);
    expect(due.toISOString()).toBe("2026-04-13T12:55:00.000Z");
  });

  it("starts from opening time when raised before the desk opens", () => {
    const due = addBusinessMinutes(at("2026-04-06T06:00:00"), 60, hours);
    expect(due.toISOString()).toBe("2026-04-06T10:00:00.000Z");
  });

  it("lands exactly at closing when the target exactly fills the day", () => {
    // 17:00 plus sixty minutes is 18:00, the moment the desk closes. Rolling
    // this to the next morning would give the team an hour they did not have.
    const due = addBusinessMinutes(at("2026-04-06T17:00:00"), 60, hours);
    expect(due.toISOString()).toBe("2026-04-06T18:00:00.000Z");
  });

  it("skips a holiday", () => {
    // Tuesday 17:00 plus two hours: one hour before Tuesday's close,
    // Wednesday is a holiday, so the second hour lands on Thursday morning.
    const due = addBusinessMinutes(at("2026-04-07T17:00:00"), 120, hours);
    expect(due.toISOString()).toBe("2026-04-09T10:00:00.000Z");
  });

  it("returns the start for a zero target", () => {
    const start = at("2026-04-06T10:00:00");
    expect(addBusinessMinutes(start, 0, hours).getTime()).toBe(start.getTime());
  });

  it("throws rather than hanging when no day is ever open", () => {
    const closed: BusinessHours = { days: {}, timezone: "UTC", holidays: [] };
    expect(() => addBusinessMinutes(at("2026-04-06T10:00:00"), 60, closed)).toThrow(
      /no open days/
    );
  });

  it("is the inverse of businessMinutesBetween", () => {
    const start = at("2026-04-06T10:30:00");
    const due = addBusinessMinutes(start, 600, hours);
    expect(businessMinutesBetween(start, due, hours)).toBe(600);
  });
});

describe("time zones", () => {
  const kolkata: BusinessHours = { ...hours, timezone: "Asia/Kolkata" };

  it("respects a half-hour offset zone", () => {
    // 09:00 IST is 03:30 UTC. A ticket at 04:00 UTC is half an hour into the
    // working day.
    expect(
      businessMinutesBetween(at("2026-04-06T04:00:00"), at("2026-04-06T05:00:00"), kolkata)
    ).toBe(60);
  });

  it("does not count time before the local opening", () => {
    // 02:00 UTC is 07:30 IST, before the desk opens.
    expect(
      businessMinutesBetween(at("2026-04-06T02:00:00"), at("2026-04-06T04:00:00"), kolkata)
    ).toBe(30);
  });

  it("stays correct across a daylight-saving transition", () => {
    // London moves to BST on 2026-03-29. A hardcoded offset would put every
    // SLA in the region an hour out from that morning onwards.
    const london: BusinessHours = { ...hours, timezone: "Europe/London" };
    const due = addBusinessMinutes(at("2026-03-27T16:00:00"), 180, london);

    // Friday 16:00 UTC is 16:00 GMT, two hours before close. The remaining
    // hour lands at 10:00 BST on Monday, which is 09:00 UTC — an offset-blind
    // implementation would say 10:00 UTC.
    expect(due.toISOString()).toBe("2026-03-30T09:00:00.000Z");
  });
});

describe("slaStatus", () => {
  const policy = { ...DEFAULT_SLA, businessHours: hours, roundTheClockPriorities: [] as Priority[] };

  function ticket(over: Partial<TicketTimeline> = {}): TicketTimeline {
    return {
      createdAt: at("2026-04-06T10:00:00"),
      priority: "normal",
      pauses: [],
      ...over,
    };
  }

  it("computes elapsed business time against the target", () => {
    const status = slaStatus(ticket(), policy, at("2026-04-06T12:00:00"));
    expect(status.responseElapsedMinutes).toBe(120);
    expect(status.responseRemainingMinutes).toBe(360);
    expect(status.responseBreached).toBe(false);
  });

  it("stops the response clock at the first reply", () => {
    const status = slaStatus(
      ticket({ firstRespondedAt: at("2026-04-06T11:00:00") }),
      policy,
      at("2026-04-08T15:00:00")
    );
    expect(status.responseElapsedMinutes).toBe(60);
  });

  it("tracks response and resolution independently", () => {
    // A ticket answered in ten minutes and then left for a week met one target
    // and missed the other; a single 'SLA met' flag loses the half that
    // matters.
    const status = slaStatus(
      ticket({ firstRespondedAt: at("2026-04-06T10:10:00") }),
      policy,
      at("2026-04-17T17:00:00")
    );

    expect(status.responseBreached).toBe(false);
    expect(status.resolutionBreached).toBe(true);
  });

  it("reports a breach once the target is exceeded", () => {
    const status = slaStatus(ticket(), policy, at("2026-04-07T15:00:00"));
    expect(status.responseBreached).toBe(true);
  });

  it("does not breach overnight, because the clock is not running", () => {
    // The whole point of business hours: 10:00 Monday to 09:30 Tuesday is
    // 8.5 hours of office time, not 23.5.
    const status = slaStatus(ticket(), policy, at("2026-04-07T09:30:00"));
    expect(status.responseElapsedMinutes).toBe(510);
    expect(status.responseBreached).toBe(true);

    const earlier = slaStatus(ticket(), policy, at("2026-04-06T17:00:00"));
    expect(earlier.responseElapsedMinutes).toBe(420);
    expect(earlier.responseBreached).toBe(false);
  });

  it("stops the clock while the requester owes a reply", () => {
    // Otherwise every ticket waiting on information breaches, and the team is
    // measured on somebody else's response time.
    const paused = slaStatus(
      ticket({
        pauses: [{ from: at("2026-04-06T11:00:00"), to: at("2026-04-06T15:00:00") }],
      }),
      policy,
      at("2026-04-06T17:00:00")
    );

    expect(paused.pausedMinutes).toBe(240);
    expect(paused.resolutionElapsedMinutes).toBe(180);
  });

  it("pushes the due time out by the paused duration", () => {
    const unpaused = slaStatus(ticket(), policy, at("2026-04-06T17:00:00"));
    const paused = slaStatus(
      ticket({
        pauses: [{ from: at("2026-04-06T11:00:00"), to: at("2026-04-06T13:00:00") }],
      }),
      policy,
      at("2026-04-06T17:00:00")
    );

    expect(paused.responseDueAt.getTime()).toBeGreaterThan(unpaused.responseDueAt.getTime());
  });

  it("treats an unclosed pause as still running", () => {
    const status = slaStatus(
      ticket({ pauses: [{ from: at("2026-04-06T11:00:00") }] }),
      policy,
      at("2026-04-06T15:00:00")
    );

    expect(status.isPaused).toBe(true);
    expect(status.responseElapsedMinutes).toBe(60);
  });

  it("only counts pause time inside working hours", () => {
    const status = slaStatus(
      ticket({
        pauses: [{ from: at("2026-04-06T17:00:00"), to: at("2026-04-07T09:00:00") }],
      }),
      policy,
      at("2026-04-07T12:00:00")
    );

    // The pause spans one closing hour and no more.
    expect(status.pausedMinutes).toBe(60);
  });

  it("runs an urgent ticket against the calendar, not the office diary", () => {
    // Which is exactly what makes it urgent.
    const roundTheClock = { ...policy, roundTheClockPriorities: ["urgent"] as Priority[] };
    const status = slaStatus(
      ticket({ priority: "urgent" }),
      roundTheClock,
      at("2026-04-06T22:00:00")
    );

    expect(status.responseElapsedMinutes).toBe(720);
    expect(status.responseBreached).toBe(true);
  });

  it("reports consumption as a fraction, for the approaching-breach view", () => {
    const status = slaStatus(ticket(), policy, at("2026-04-06T14:00:00"));
    expect(status.responseConsumed).toBeCloseTo(240 / 480, 5);
  });

  it("never reports negative elapsed time", () => {
    const status = slaStatus(
      ticket({ pauses: [{ from: at("2026-04-06T09:00:00"), to: at("2026-04-06T18:00:00") }] }),
      policy,
      at("2026-04-06T12:00:00")
    );
    expect(status.responseElapsedMinutes).toBeGreaterThanOrEqual(0);
  });
});

describe("dueEscalations", () => {
  const status = {
    responseConsumed: 0.85,
    resolutionConsumed: 0.2,
  } as Parameters<typeof dueEscalations>[0];

  it("fires the rules whose threshold is passed", () => {
    const events = dueEscalations(status, DEFAULT_ESCALATIONS, []);
    expect(events.map((e) => e.rule.atConsumed)).toEqual([0.5, 0.8]);
  });

  it("does not fire a rule that has already fired", () => {
    // An engine that re-fires on every poll sends the same manager the same
    // warning every minute until they mute the channel — at which point they
    // also miss the real one.
    const first = dueEscalations(status, DEFAULT_ESCALATIONS, []);
    const keys = first.map((e) => escalationKey(e.rule));

    expect(dueEscalations(status, DEFAULT_ESCALATIONS, keys)).toEqual([]);
  });

  it("fires nothing below every threshold", () => {
    const early = { responseConsumed: 0.1, resolutionConsumed: 0.1 } as typeof status;
    expect(dueEscalations(early, DEFAULT_ESCALATIONS, [])).toEqual([]);
  });

  it("fires the breach rules at full consumption", () => {
    const breached = { responseConsumed: 1.2, resolutionConsumed: 1.5 } as typeof status;
    const events = dueEscalations(breached, DEFAULT_ESCALATIONS, []);
    expect(events).toHaveLength(DEFAULT_ESCALATIONS.length);
  });

  it("gives each rule a distinct key", () => {
    const keys = DEFAULT_ESCALATIONS.map(escalationKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("clockPaused", () => {
  it("pauses while the requester owes a reply", () => {
    expect(clockPaused("pending_requester")).toBe(true);
  });

  it("does not pause while waiting on a third party", () => {
    // The requester does not care which supplier the desk is waiting for, and
    // treating it as a pause lets a ticket sit indefinitely while reporting
    // as healthy.
    expect(clockPaused("pending_third_party")).toBe(false);
  });

  it("does not pause an open ticket", () => {
    expect(clockPaused("open")).toBe(false);
    expect(clockPaused("new")).toBe(false);
  });
});

describe("raisePriority", () => {
  it("steps up one level", () => {
    expect(raisePriority("low")).toBe("normal");
    expect(raisePriority("normal")).toBe("high");
    expect(raisePriority("high")).toBe("urgent");
  });

  it("stops at the top", () => {
    expect(raisePriority("urgent")).toBe("urgent");
  });
});

describe("DEFAULT_BUSINESS_HOURS", () => {
  it("is closed at the weekend", () => {
    expect(DEFAULT_BUSINESS_HOURS.days[6]).toBeUndefined();
    expect(DEFAULT_BUSINESS_HOURS.days[7]).toBeUndefined();
  });
});
