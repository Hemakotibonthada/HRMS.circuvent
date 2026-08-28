import { describe, expect, it } from "vitest";
import {
  countByFilter,
  matchesFilter,
  presenceOf,
  type Presence,
} from "./team-presence";

const punchedAt = new Date("2026-08-20T03:31:00Z");

describe("what to say about a colleague's day", () => {
  it("puts leave above everything else", () => {
    // Including above a stray punch, so a manager is not sent to chase
    // somebody who booked the day off a fortnight ago.
    expect(
      presenceOf({
        onLeave: true,
        record: { status: "present", clockInAt: punchedAt, lateByMinutes: 40 },
        isToday: true,
      })
    ).toBe("on_leave");
  });

  it("does not call a punch late when nothing measured it", () => {
    // late_by_minutes is NOT NULL DEFAULT 0, so "not late" and "no shift to
    // compare against" are the same value. Neither may produce an accusation.
    expect(
      presenceOf({
        onLeave: false,
        record: { status: "present", clockInAt: punchedAt, lateByMinutes: 0 },
        isToday: true,
      })
    ).toBe("in");
  });

  it("calls it late on either signal", () => {
    expect(
      presenceOf({
        onLeave: false,
        record: { status: "present", clockInAt: punchedAt, lateByMinutes: 12 },
        isToday: true,
      })
    ).toBe("late");

    expect(
      presenceOf({
        onLeave: false,
        record: { status: "late", clockInAt: punchedAt, lateByMinutes: 0 },
        isToday: true,
      })
    ).toBe("late");
  });

  it("separates a day still running from one that has finished", () => {
    // The same absence of a punch means "might still arrive" today and
    // "did not come in" yesterday. Saying "not in yet" about last Tuesday is
    // how a real absence goes unnoticed.
    expect(presenceOf({ onLeave: false, record: null, isToday: true })).toBe("not_in");
    expect(presenceOf({ onLeave: false, record: null, isToday: false })).toBe("absent");
  });

  it("does not report a holiday as an absence", () => {
    expect(
      presenceOf({
        onLeave: false,
        record: { status: "holiday", clockInAt: null, lateByMinutes: 0 },
        isToday: false,
      })
    ).toBe("off");

    expect(
      presenceOf({
        onLeave: false,
        record: { status: "weekend", clockInAt: null, lateByMinutes: 0 },
        isToday: false,
      })
    ).toBe("off");
  });

  it("trusts a record that already says on leave", () => {
    expect(
      presenceOf({
        onLeave: false,
        record: { status: "on_leave", clockInAt: null, lateByMinutes: 0 },
        isToday: true,
      })
    ).toBe("on_leave");
  });

  it("counts working from home as in once they punch", () => {
    expect(
      presenceOf({
        onLeave: false,
        record: { status: "wfh", clockInAt: punchedAt, lateByMinutes: 0 },
        isToday: true,
      })
    ).toBe("in");
  });
});

describe("the filters on the team screen", () => {
  const everyone: Presence[] = ["in", "in", "late", "not_in", "absent", "on_leave", "off"];

  it("keeps a past absence in the same bucket as today's no-show", () => {
    // Otherwise the bucket empties as soon as the manager looks at yesterday,
    // which is exactly when an unexplained absence matters.
    expect(matchesFilter("absent", "not_in")).toBe(true);
    expect(matchesFilter("not_in", "not_in")).toBe(true);
  });

  it("does not fold late arrivals into on time", () => {
    expect(matchesFilter("late", "in")).toBe(false);
    expect(matchesFilter("in", "late")).toBe(false);
  });

  it("leaves leave and days off out of every bucket but all", () => {
    for (const filter of ["in", "late", "not_in"] as const) {
      expect(matchesFilter("on_leave", filter)).toBe(false);
      expect(matchesFilter("off", filter)).toBe(false);
    }
    expect(matchesFilter("on_leave", "all")).toBe(true);
  });

  it("counts each bucket", () => {
    expect(countByFilter(everyone)).toEqual({ all: 7, in: 2, late: 1, not_in: 2 });
  });
});
