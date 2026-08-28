import { describe, expect, it } from "vitest";
import {
  ANSWERABLE_QUESTIONS,
  detectIntent,
  formatHolidays,
  formatLeaveBalance,
  navigationAnswer,
  unknownAnswer,
  type Intent,
  type LeaveBalance,
} from "@/lib/assistant";

describe("detectIntent", () => {
  it("recognises the questions the suggestion chips offer", () => {
    // A chip that produces "I do not have an answer for that" is worse than
    // no chip.
    for (const question of ANSWERABLE_QUESTIONS) {
      expect(detectIntent(question), question).not.toBe("unknown");
    }
  });

  it("separates asking a balance from applying", () => {
    // "apply for leave" contains "leave"; order matters in the rule list.
    expect(detectIntent("What is my leave balance?")).toBe("leave_balance");
    expect(detectIntent("How do I apply for leave?")).toBe("apply_leave");
  });

  it("matches a few natural phrasings", () => {
    expect(detectIntent("how many leaves do I have left")).toBe("leave_balance");
    expect(detectIntent("when is the next public holiday")).toBe("holidays");
    expect(detectIntent("my laptop issue needs IT support")).toBe("helpdesk");
    expect(detectIntent("I want to claim reimbursement")).toBe("expenses");
  });

  it("is unknown for something it cannot answer", () => {
    expect(detectIntent("who won the cricket match")).toBe("unknown");
    expect(detectIntent("")).toBe("unknown");
  });
});

describe("navigation answers", () => {
  const navigable: Intent[] = [
    "apply_leave",
    "payslip",
    "salary_structure",
    "expenses",
    "wfh",
    "helpdesk",
    "performance",
    "training",
    "onboarding",
    "referral",
  ];

  it("exists for every navigable intent", () => {
    for (const intent of navigable) {
      const answer = navigationAnswer(intent);
      expect(answer, intent).not.toBeNull();
      expect(answer!.actions.length, intent).toBeGreaterThan(0);
    }
  });

  it("never claims a source, because nothing was read", () => {
    // The old assistant attached "Leave Management System" to invented text.
    // That is what turned a wrong answer into a believable one.
    for (const intent of navigable) {
      expect(navigationAnswer(intent)!.source, intent).toBeUndefined();
    }
  });

  it("states no figures — a figure here would be a claim", () => {
    // Policy numbers are per-organisation configuration. Reciting one from
    // memory is how somebody files a claim that gets rejected.
    for (const intent of navigable) {
      const { content } = navigationAnswer(intent)!;
      // Allow none at all: currency amounts, percentages, day counts.
      expect(content, intent).not.toMatch(/₹\s?[\d,]+/);
      expect(content, intent).not.toMatch(/\b\d+(\.\d+)?\s?%/);
      expect(content, intent).not.toMatch(/\b\d+\s?(days?|hrs?|hours?)\b/i);
      expect(content, intent).not.toMatch(/\b\d+(\.\d+)?\s?\/\s?5\b/);
    }
  });

  it("returns null for intents that must be fetched instead", () => {
    expect(navigationAnswer("leave_balance")).toBeNull();
    expect(navigationAnswer("holidays")).toBeNull();
    expect(navigationAnswer("unknown")).toBeNull();
  });
});

describe("unknownAnswer", () => {
  it("says plainly that it does not know", () => {
    const answer = unknownAnswer("what is my bonus");
    expect(answer.kind).toBe("unknown");
    expect(answer.content).toMatch(/do not have an answer/i);
  });

  it("offers a route to a real answer rather than a paragraph of guesses", () => {
    expect(unknownAnswer("anything").actions.map((a) => a.href)).toContain("/helpdesk");
  });

  it("claims no source", () => {
    expect(unknownAnswer("anything").source).toBeUndefined();
  });
});

describe("formatLeaveBalance", () => {
  const balances: LeaveBalance[] = [
    { leaveType: "Casual", available: 6, used: 4, pending: 2 },
    { leaveType: "Sick", available: 10, used: 2, pending: 0 },
  ];

  it("reports what was fetched, and totals it", () => {
    const answer = formatLeaveBalance(balances, 2026);
    expect(answer.kind).toBe("fetched");
    expect(answer.content).toContain("Casual");
    expect(answer.content).toContain("6 available");
    expect(answer.content).toContain("**16 day");
  });

  it("names pending days, which are already reserved", () => {
    // Someone reading "6 available" needs to know two more are spoken for, or
    // they will plan around a number that is about to change.
    expect(formatLeaveBalance(balances, 2026).content).toContain("2 pending approval");
  });

  it("cites the source it actually read", () => {
    expect(formatLeaveBalance(balances, 2026).source).toBe("Leave balances");
  });

  it("says nothing is recorded rather than inventing an allocation", () => {
    const answer = formatLeaveBalance([], 2026);
    expect(answer.content).toMatch(/No leave balances are recorded/i);
    // The failure mode being avoided: a plausible default like "12 casual".
    expect(answer.content).not.toMatch(/\b1[02]\b/);
  });

  it("handles a single day without saying '1 days'", () => {
    const one = formatLeaveBalance([{ leaveType: "Comp Off", available: 1, used: 0, pending: 0 }], 2026);
    expect(one.content).toContain("**1 day**");
  });
});

describe("formatHolidays", () => {
  const holidays = [
    { name: "Republic Day", holidayDate: "2026-01-26", isOptional: false },
    { name: "Holi", holidayDate: "2026-03-04", isOptional: false },
    { name: "Diwali", holidayDate: "2026-11-08", isOptional: true },
  ];

  it("lists only holidays that have not passed", () => {
    const answer = formatHolidays(holidays, "2026-06-01");
    expect(answer.content).toContain("Diwali");
    expect(answer.content).not.toContain("Republic Day");
    expect(answer.content).not.toContain("Holi");
  });

  it("includes one falling today", () => {
    expect(formatHolidays(holidays, "2026-03-04").content).toContain("Holi");
  });

  it("marks optional holidays, which are not days off by default", () => {
    expect(formatHolidays(holidays, "2026-06-01").content).toContain("optional");
  });

  it("orders them chronologically", () => {
    const answer = formatHolidays(holidays, "2026-01-01");
    expect(answer.content.indexOf("Republic Day")).toBeLessThan(answer.content.indexOf("Holi"));
    expect(answer.content.indexOf("Holi")).toBeLessThan(answer.content.indexOf("Diwali"));
  });

  it("says the calendar is empty rather than inventing festivals", () => {
    const answer = formatHolidays([], "2026-06-01");
    expect(answer.content).toMatch(/no upcoming holidays/i);
    // Word boundaries: "Holi" is a substring of "holidays", and the message
    // legitimately contains that word.
    expect(answer.content).not.toMatch(/\b(Diwali|Holi|Republic Day)\b/i);
  });

  it("cites the source it actually read", () => {
    expect(formatHolidays(holidays, "2026-01-01").source).toBe("Holiday calendar");
  });
});

describe("the guarantee that motivated this module", () => {
  it("no answer states a personal fact without having fetched it", () => {
    // The previous assistant answered "What is my leave balance?" with
    // hardcoded numbers and cited "Leave Management System", and reported a
    // fabricated performance rating of 4.1/5. Anything carrying a figure about
    // a person must be `fetched`; everything else must not carry figures.
    const everyNavigable: Intent[] = [
      "apply_leave",
      "payslip",
      "salary_structure",
      "expenses",
      "wfh",
      "helpdesk",
      "performance",
      "training",
      "onboarding",
      "referral",
    ];

    for (const intent of everyNavigable) {
      const answer = navigationAnswer(intent)!;
      expect(answer.kind, intent).toBe("navigation");
      expect(answer.source, intent).toBeUndefined();
    }

    // And the fetched ones only exist as functions over real input.
    expect(formatLeaveBalance([], 2026).kind).toBe("fetched");
    expect(formatHolidays([], "2026-01-01").kind).toBe("fetched");
  });
});
