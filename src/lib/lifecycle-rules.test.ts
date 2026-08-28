import { describe, expect, it } from "vitest";
import {
  blockingTasks,
  canComplete,
  canTransitionJourney,
  dueDateFor,
  groupByPhase,
  overdueTasks,
  progressOf,
  validateTemplate,
  type JourneyStatus,
  type LifecycleTaskState,
} from "@/lib/lifecycle-rules";

function task(overrides: Partial<LifecycleTaskState> = {}): LifecycleTaskState {
  return {
    taskKey: overrides.taskKey ?? "t1",
    title: overrides.title ?? "Issue laptop",
    phase: overrides.phase ?? "day1",
    phaseOrder: overrides.phaseOrder ?? 1,
    assignee: overrides.assignee ?? "it",
    mandatory: overrides.mandatory ?? false,
    dueOffsetDays: overrides.dueOffsetDays ?? 0,
    completed: overrides.completed ?? false,
  };
}

describe("progressOf", () => {
  it("is zero for an empty checklist rather than NaN", () => {
    expect(progressOf([])).toEqual({
      total: 0,
      completed: 0,
      percent: 0,
      mandatoryTotal: 0,
      mandatoryCompleted: 0,
    });
  });

  it("counts completion", () => {
    const p = progressOf([
      task({ taskKey: "a", completed: true }),
      task({ taskKey: "b", completed: true }),
      task({ taskKey: "c" }),
      task({ taskKey: "d" }),
    ]);
    expect(p.total).toBe(4);
    expect(p.completed).toBe(2);
    expect(p.percent).toBe(50);
  });

  it("reaches 100 only when everything is done", () => {
    const all = [task({ taskKey: "a", completed: true }), task({ taskKey: "b", completed: true })];
    expect(progressOf(all).percent).toBe(100);
  });

  it("does not round up to 100 while a task is outstanding", () => {
    // 199 of 200 rounds to 100 and reads as finished. It is not.
    const tasks = Array.from({ length: 200 }, (_, i) =>
      task({ taskKey: `t${i}`, completed: i < 199 })
    );
    expect(progressOf(tasks).percent).toBe(99);
  });

  it("tracks mandatory tasks separately", () => {
    const p = progressOf([
      task({ taskKey: "a", mandatory: true, completed: true }),
      task({ taskKey: "b", mandatory: true }),
      task({ taskKey: "c", completed: true }),
    ]);
    expect(p.mandatoryTotal).toBe(2);
    expect(p.mandatoryCompleted).toBe(1);
  });
});

describe("blockingTasks", () => {
  it("returns the outstanding mandatory tasks", () => {
    const blocking = blockingTasks([
      task({ taskKey: "a", mandatory: true, completed: true }),
      task({ taskKey: "b", mandatory: true, title: "Revoke access" }),
      task({ taskKey: "c", title: "Farewell lunch" }),
    ]);
    expect(blocking.map((t) => t.taskKey)).toEqual(["b"]);
  });

  it("ignores optional tasks however many are outstanding", () => {
    expect(blockingTasks([task({ taskKey: "a" }), task({ taskKey: "b" })])).toEqual([]);
  });

  it("names what is blocking, not merely that something is", () => {
    // A boolean would say "you cannot finish" without saying why.
    const blocking = blockingTasks([
      task({ taskKey: "off_9", title: "Access revoked", mandatory: true }),
    ]);
    expect(blocking[0].title).toBe("Access revoked");
  });
});

describe("canComplete", () => {
  it("refuses while a mandatory clearance is outstanding", () => {
    const tasks = [task({ taskKey: "a", title: "Access revoked", mandatory: true })];
    expect(canComplete("in_progress", tasks)).toBe(false);
  });

  it("allows once the mandatory tasks are done", () => {
    const tasks = [
      task({ taskKey: "a", mandatory: true, completed: true }),
      task({ taskKey: "b" }),
    ];
    expect(canComplete("in_progress", tasks)).toBe(true);
  });

  it("refuses on a journey that is already finished", () => {
    expect(canComplete("completed", [])).toBe(false);
    expect(canComplete("cancelled", [])).toBe(false);
  });
});

describe("canTransitionJourney", () => {
  it("allows completing or cancelling an open journey", () => {
    expect(canTransitionJourney("in_progress", "completed")).toBe(true);
    expect(canTransitionJourney("in_progress", "cancelled")).toBe(true);
  });

  it("never reopens a finished journey", () => {
    // Reopening an exit would let the clearance record be rewritten after the
    // fact, which is exactly what stops it being evidence.
    const statuses: JourneyStatus[] = ["in_progress", "completed", "cancelled"];
    for (const to of statuses) {
      expect(canTransitionJourney("completed", to), `completed -> ${to}`).toBe(false);
      expect(canTransitionJourney("cancelled", to), `cancelled -> ${to}`).toBe(false);
    }
  });

  it("refuses to complete twice", () => {
    expect(canTransitionJourney("completed", "completed")).toBe(false);
  });
});

describe("dueDateFor", () => {
  it("counts forward for onboarding", () => {
    expect(dueDateFor("2026-06-01", 0)).toBe("2026-06-01");
    expect(dueDateFor("2026-06-01", 7)).toBe("2026-06-08");
  });

  it("counts backward for pre-boarding and pre-exit tasks", () => {
    expect(dueDateFor("2026-06-01", -3)).toBe("2026-05-29");
  });

  it("rolls over months and years", () => {
    expect(dueDateFor("2026-01-31", 1)).toBe("2026-02-01");
    expect(dueDateFor("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("knows 2028 is a leap year", () => {
    expect(dueDateFor("2028-02-28", 1)).toBe("2028-02-29");
    expect(dueDateFor("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("survives a spring-forward transition", () => {
    // Local-midnight arithmetic can land on 23:00 the evening before and lose
    // a day. UTC cannot.
    expect(dueDateFor("2026-03-28", 1)).toBe("2026-03-29");
    expect(dueDateFor("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("rejects a malformed anchor or a fractional offset", () => {
    expect(() => dueDateFor("01-06-2026", 1)).toThrow(RangeError);
    expect(() => dueDateFor("2026-13-01", 1)).toThrow(RangeError);
    expect(() => dueDateFor("2026-06-01", 1.5)).toThrow(RangeError);
  });
});

describe("overdueTasks", () => {
  const anchor = "2026-06-01";

  it("lists outstanding tasks past their due date", () => {
    const overdue = overdueTasks(
      [
        task({ taskKey: "a", dueOffsetDays: 0 }),
        task({ taskKey: "b", dueOffsetDays: 30 }),
      ],
      anchor,
      "2026-06-10"
    );
    expect(overdue.map((t) => t.taskKey)).toEqual(["a"]);
  });

  it("does not call a completed task overdue", () => {
    // Something finished late is finished. Listing it forever trains people to
    // ignore the list.
    const overdue = overdueTasks(
      [task({ taskKey: "a", dueOffsetDays: 0, completed: true })],
      anchor,
      "2026-06-10"
    );
    expect(overdue).toEqual([]);
  });

  it("is not overdue on the due date itself", () => {
    expect(overdueTasks([task({ dueOffsetDays: 0 })], anchor, "2026-06-01")).toEqual([]);
  });
});

describe("groupByPhase", () => {
  it("orders phases by their declared order, not alphabetically", () => {
    const grouped = groupByPhase([
      task({ taskKey: "a", phase: "week1", phaseOrder: 2 }),
      task({ taskKey: "b", phase: "preboarding", phaseOrder: 1 }),
      task({ taskKey: "c", phase: "month1", phaseOrder: 3 }),
    ]);
    expect(grouped.map((g) => g.phase)).toEqual(["preboarding", "week1", "month1"]);
  });

  it("collects tasks into their phase", () => {
    const grouped = groupByPhase([
      task({ taskKey: "a", phase: "day1", phaseOrder: 1 }),
      task({ taskKey: "b", phase: "day1", phaseOrder: 1 }),
      task({ taskKey: "c", phase: "week1", phaseOrder: 2 }),
    ]);
    expect(grouped[0].tasks.map((t) => t.taskKey)).toEqual(["a", "b"]);
    expect(grouped[1].tasks.map((t) => t.taskKey)).toEqual(["c"]);
  });

  it("takes the lowest order a phase claims, so one bad row cannot move it", () => {
    const grouped = groupByPhase([
      task({ taskKey: "a", phase: "day1", phaseOrder: 1 }),
      task({ taskKey: "b", phase: "day1", phaseOrder: 99 }),
      task({ taskKey: "c", phase: "week1", phaseOrder: 2 }),
    ]);
    expect(grouped.map((g) => g.phase)).toEqual(["day1", "week1"]);
  });

  it("is stable for phases sharing an order", () => {
    const grouped = groupByPhase([
      task({ taskKey: "a", phase: "beta", phaseOrder: 1 }),
      task({ taskKey: "b", phase: "alpha", phaseOrder: 1 }),
    ]);
    expect(grouped.map((g) => g.phase)).toEqual(["alpha", "beta"]);
  });
});

describe("validateTemplate", () => {
  const good = [
    task({ taskKey: "a", mandatory: true }),
    task({ taskKey: "b" }),
  ];

  it("accepts a well-formed checklist", () => {
    expect(validateTemplate(good)).toEqual({ ok: true, errors: [] });
  });

  it("rejects an empty checklist", () => {
    const result = validateTemplate([]);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("A checklist needs at least one task");
  });

  it("names a duplicate key rather than leaving it to the unique index", () => {
    const result = validateTemplate([task({ taskKey: "a", mandatory: true }), task({ taskKey: "a" })]);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Duplicate task key "a"');
  });

  it("requires at least one mandatory task", () => {
    // Otherwise the checklist can be completed while entirely untouched, and
    // its completion means nothing.
    const result = validateTemplate([task({ taskKey: "a" })]);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("A checklist needs at least one mandatory task");
  });

  it("requires a title on every task", () => {
    const result = validateTemplate([task({ taskKey: "a", title: "  ", mandatory: true })]);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Task "a" needs a title');
  });

  it("collects every problem rather than stopping at the first", () => {
    const result = validateTemplate([task({ taskKey: "", title: "" })]);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the exit clearance story", () => {
  it("cannot be completed until access is actually revoked", () => {
    // The scenario that motivated all of this: the old page let an admin tick
    // boxes into React state and told them it saved. Nothing here allows a
    // journey to close while the record says access is still live.
    const tasks = [
      task({ taskKey: "off_1", title: "Laptop returned", mandatory: true, completed: true }),
      task({ taskKey: "off_2", title: "Access revoked", mandatory: true, completed: false }),
      task({ taskKey: "off_3", title: "Farewell lunch", mandatory: false, completed: false }),
    ];

    expect(canComplete("in_progress", tasks)).toBe(false);
    expect(blockingTasks(tasks).map((t) => t.title)).toEqual(["Access revoked"]);
    expect(progressOf(tasks).percent).toBe(33);

    const revoked = tasks.map((t) =>
      t.taskKey === "off_2" ? { ...t, completed: true } : t
    );
    expect(canComplete("in_progress", revoked)).toBe(true);
    // Still not 100%: the farewell lunch is outstanding, and the number should
    // say so even though it does not block.
    expect(progressOf(revoked).percent).toBe(67);
  });
});
