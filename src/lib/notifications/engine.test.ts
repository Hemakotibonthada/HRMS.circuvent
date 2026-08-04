// @vitest-environment node
//
// The notification engine's failures are all "wrong thing sent, or not sent".
// These tests pin the rules that keep it useful rather than noisy: critical
// alerts always get through, ordinary ones respect the user's choices, and
// nothing is delivered twice.

import { describe, expect, it } from "vitest";
import {
  TEMPLATES,
  collapse,
  inQuietHours,
  planDispatch,
  render,
  selectChannels,
  type DispatchDecision,
  type UserPreferences,
} from "@/lib/notifications/engine";

const NOON_IST = new Date("2026-04-06T06:30:00Z"); // 12:00 in Asia/Kolkata
const MIDNIGHT_IST = new Date("2026-04-06T18:30:00Z"); // 00:00 next day IST

describe("render", () => {
  it("substitutes placeholders", () => {
    expect(render("Hello {{name}}, you have {{count}} items", { name: "Asha", count: 3 })).toBe(
      "Hello Asha, you have 3 items"
    );
  });

  it("renders an unknown token as empty rather than leaving braces visible", () => {
    // A message displaying its own template syntax reads as broken software.
    expect(render("Hi {{missing}}!", {})).toBe("Hi !");
  });

  it("substitutes a token appearing more than once", () => {
    expect(render("{{a}} and {{a}}", { a: "x" })).toBe("x and x");
  });

  it("renders zero rather than treating it as absent", () => {
    expect(render("{{n}} left", { n: 0 })).toBe("0 left");
  });
});

describe("templates", () => {
  it("declares a template for every type it keys", () => {
    for (const [key, template] of Object.entries(TEMPLATES)) {
      expect(template.type).toBe(key);
      expect(template.subject.length).toBeGreaterThan(0);
      expect(template.channels.length).toBeGreaterThan(0);
    }
  });

  it("treats payroll failure as critical on every urgent channel", () => {
    const t = TEMPLATES["payroll.failed"];
    expect(t.priority).toBe("critical");
    expect(t.channels).toContain("sms");
    expect(t.bypassBatching).toBe(true);
  });

  it("keeps low-priority social notices in-app only", () => {
    // Emailing everyone about every birthday is how people learn to ignore
    // notifications entirely.
    expect(TEMPLATES.birthday.channels).toEqual(["in_app"]);
    expect(TEMPLATES.work_anniversary.channels).toEqual(["in_app"]);
  });
});

describe("selectChannels", () => {
  it("removes muted channels", () => {
    const channels = selectChannels(TEMPLATES["leave.approved"], {
      userId: "u1",
      mutedChannels: ["email", "push"],
    });
    expect(channels).toEqual(["in_app"]);
  });

  it("never mutes in_app, which is the record of what happened", () => {
    const channels = selectChannels(TEMPLATES["leave.approved"], {
      userId: "u1",
      mutedChannels: ["in_app", "email", "push"],
    });
    expect(channels).toContain("in_app");
  });

  it("ignores muting for critical notifications", () => {
    const channels = selectChannels(TEMPLATES["payroll.failed"], {
      userId: "u1",
      mutedChannels: ["email", "push", "sms"],
    });
    expect(channels).toEqual(TEMPLATES["payroll.failed"].channels);
  });
});

describe("inQuietHours", () => {
  it("handles a window that wraps midnight", () => {
    // 22:00–08:00 is the normal case, and a naive range test gets it backwards.
    expect(inQuietHours(MIDNIGHT_IST, [22, 8])).toBe(true);
    expect(inQuietHours(NOON_IST, [22, 8])).toBe(false);
  });

  it("handles a window within one day", () => {
    expect(inQuietHours(NOON_IST, [11, 14])).toBe(true);
    expect(inQuietHours(NOON_IST, [13, 14])).toBe(false);
  });

  it("is false when no window is set or the window is empty", () => {
    expect(inQuietHours(MIDNIGHT_IST, undefined)).toBe(false);
    expect(inQuietHours(MIDNIGHT_IST, [8, 8])).toBe(false);
  });

  it("respects the user's timezone", () => {
    // The same instant is midnight in Kolkata and evening in London.
    expect(inQuietHours(MIDNIGHT_IST, [22, 8], "Asia/Kolkata")).toBe(true);
    expect(inQuietHours(MIDNIGHT_IST, [22, 8], "Europe/London")).toBe(false);
  });
});

describe("planDispatch", () => {
  const request = {
    type: "leave.approved" as const,
    recipientId: "u1",
    data: { leaveType: "casual", startDate: "2026-04-10", endDate: "2026-04-12", approverName: "Ben" },
  };

  it("renders subject and body from the template", () => {
    const decision = planDispatch(request, undefined, NOON_IST);
    expect(decision.subject).toBe("Your leave has been approved");
    expect(decision.body).toContain("casual");
    expect(decision.body).toContain("Ben");
  });

  it("sends immediately outside quiet hours", () => {
    const decision = planDispatch(request, { userId: "u1" }, NOON_IST);
    expect(decision.sendAt).toEqual(NOON_IST);
    expect(decision.suppressedReason).toBeUndefined();
  });

  it("suppresses a muted type", () => {
    const decision = planDispatch(request, { userId: "u1", mutedTypes: ["leave.approved"] }, NOON_IST);
    expect(decision.suppressedReason).toBe("muted_type");
    expect(decision.channels).toEqual([]);
  });

  it("will not let a muted type hide a critical alert", () => {
    const decision = planDispatch(
      { type: "payroll.failed", recipientId: "u1", data: { month: "April", year: 2026, error: "x" } },
      { userId: "u1", mutedTypes: ["payroll.failed"], mutedChannels: ["email", "sms"] },
      NOON_IST
    );
    expect(decision.suppressedReason).toBeUndefined();
    expect(decision.channels).toContain("sms");
  });

  it("holds a non-urgent message until quiet hours end", () => {
    const prefs: UserPreferences = { userId: "u1", quietHours: [22, 8], timezone: "Asia/Kolkata" };
    const decision = planDispatch(
      { type: "review.due", recipientId: "u1", data: { dueDate: "2026-04-20" } },
      prefs,
      MIDNIGHT_IST
    );
    expect(decision.sendAt.getTime()).toBeGreaterThan(MIDNIGHT_IST.getTime());
  });

  it("ignores quiet hours for a critical alert", () => {
    const decision = planDispatch(
      { type: "payroll.failed", recipientId: "u1", data: { month: "April", year: 2026, error: "x" } },
      { userId: "u1", quietHours: [22, 8] },
      MIDNIGHT_IST
    );
    expect(decision.sendAt).toEqual(MIDNIGHT_IST);
  });

  it("ignores quiet hours for a payslip, which people plan around", () => {
    const decision = planDispatch(
      { type: "payslip.released", recipientId: "u1", data: { month: "April", year: 2026, netPay: 1, currency: "INR" } },
      { userId: "u1", quietHours: [22, 8] },
      MIDNIGHT_IST
    );
    expect(decision.sendAt).toEqual(MIDNIGHT_IST);
  });

  it("defers a low-priority message into the digest window", () => {
    const decision = planDispatch(
      { type: "announcement.published", recipientId: "u1", data: { title: "T", summary: "S" } },
      { userId: "u1", digest: "daily" },
      NOON_IST
    );
    expect(decision.sendAt.getTime()).toBe(NOON_IST.getTime() + 86_400_000);
  });

  it("drops a duplicate by idempotency key", () => {
    // Queues are at-least-once, so a retry would otherwise send twice.
    const decision = planDispatch(
      { ...request, idempotencyKey: "leave-1-approved" },
      undefined,
      NOON_IST,
      new Set(["leave-1-approved"])
    );
    expect(decision.suppressedReason).toBe("duplicate");
  });

  it("throws on an unknown notification type", () => {
    expect(() =>
      planDispatch({ type: "nope" as never, recipientId: "u1", data: {} }, undefined, NOON_IST)
    ).toThrow(/No template/);
  });
});

describe("collapse", () => {
  function decision(over: Partial<DispatchDecision> = {}): DispatchDecision {
    return {
      recipientId: "mgr-1",
      type: "leave.applied",
      priority: "medium",
      channels: ["in_app"],
      subject: "Asha requested casual leave",
      body: "…",
      sendAt: new Date("2026-04-06T10:00:00Z"),
      ...over,
    };
  }

  it("merges several medium-priority notices of the same type", () => {
    const merged = collapse([decision(), decision({ subject: "Ben requested sick leave" }), decision()]);
    expect(merged).toHaveLength(1);
    expect(merged[0].subject).toContain("3");
    expect(merged[0].body.split("\n")).toHaveLength(3);
  });

  it("keeps high and critical notices separate", () => {
    // Each urgent event needs its own alert, not a rolled-up count.
    const merged = collapse([
      decision({ priority: "high" }),
      decision({ priority: "high" }),
      decision({ priority: "critical" }),
    ]);
    expect(merged).toHaveLength(3);
  });

  it("does not merge across recipients or types", () => {
    const merged = collapse([
      decision(),
      decision({ recipientId: "mgr-2" }),
      decision({ type: "expense.submitted" }),
    ]);
    expect(merged).toHaveLength(3);
  });

  it("drops suppressed decisions", () => {
    expect(collapse([decision({ suppressedReason: "muted_type" })])).toHaveLength(0);
  });

  it("uses the earliest send time so collapsing never delays anything", () => {
    const early = new Date("2026-04-06T09:00:00Z");
    const merged = collapse([decision(), decision({ sendAt: early }), decision()]);
    expect(merged[0].sendAt).toEqual(early);
  });

  it("leaves a single notice untouched", () => {
    const one = decision();
    expect(collapse([one])[0]).toEqual(one);
  });
});
