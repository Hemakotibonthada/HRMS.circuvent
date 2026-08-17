import { describe, expect, it } from "vitest";
import {
  dueState,
  isSettled,
  priorityLabel,
  priorityTone,
  SELECTABLE_PRIORITIES,
  stateLabel,
  stateTone,
  validateTicket,
} from "./helpdesk-rules";

const NOW = new Date("2026-03-10T12:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("stateLabel", () => {
  it("writes the known states in words a requester understands", () => {
    expect(stateLabel("new")).toBe("New");
    expect(stateLabel("open")).toBe("In progress");
    expect(stateLabel("pending_third_party")).toBe("Waiting on someone else");
    expect(stateLabel("resolved")).toBe("Resolved");
  });

  it("says who is being waited on, rather than just 'pending'", () => {
    // The difference between "we are working on it" and "we cannot continue
    // until you reply" is the whole reason someone opens this screen.
    expect(stateLabel("pending_requester")).toBe("Waiting for you");
  });

  it("makes an unknown state readable instead of hiding it", () => {
    // A ticket whose status renders blank is one the person believes nobody
    // has touched.
    expect(stateLabel("escalated_to_vendor")).toBe("Escalated to vendor");
  });
});

describe("stateTone", () => {
  it("marks only the state that needs the requester", () => {
    expect(stateTone("pending_requester")).toBe("warning");
    expect(stateTone("open")).toBe("info");
    expect(stateTone("pending_third_party")).toBe("neutral");
    expect(stateTone("resolved")).toBe("success");
  });

  it("stays neutral for a state it does not know", () => {
    expect(stateTone("escalated_to_vendor")).toBe("neutral");
  });
});

describe("priority", () => {
  it("labels and tones the known priorities", () => {
    expect(priorityLabel("urgent")).toBe("Urgent");
    expect(priorityTone("urgent")).toBe("danger");
    expect(priorityTone("high")).toBe("warning");
    expect(priorityTone("low")).toBe("neutral");
  });

  it("offers exactly the four the server accepts, most severe first", () => {
    // Matches the API's z.enum. An option here the server rejects is a form
    // that fails on submit for a reason the person cannot see.
    expect([...SELECTABLE_PRIORITIES]).toEqual(["urgent", "high", "normal", "low"]);
  });

  it("falls back readably for an unknown priority", () => {
    expect(priorityLabel("blocker")).toBe("Blocker");
    expect(priorityTone("blocker")).toBe("neutral");
  });
});

describe("isSettled", () => {
  it("is true once nothing further is needed", () => {
    expect(isSettled("resolved")).toBe(true);
    expect(isSettled("closed")).toBe(true);
  });

  it("is false while the ticket is live", () => {
    expect(isSettled("new")).toBe(false);
    expect(isSettled("pending_requester")).toBe(false);
  });
});

describe("dueState", () => {
  it("counts down while there is time left", () => {
    expect(dueState(at(3 * HOUR), NOW)?.text).toBe("Due in 3 hours");
    expect(dueState(at(45 * MINUTE), NOW)?.text).toBe("Due in 45 minutes");
    expect(dueState(at(3 * DAY), NOW)?.text).toBe("Due in 3 days");
  });

  it("switches to hours below two days and days above", () => {
    expect(dueState(at(30 * HOUR), NOW)?.text).toBe("Due in 30 hours");
    expect(dueState(at(4 * DAY), NOW)?.text).toBe("Due in 4 days");
  });

  it("says overdue rather than counting past zero", () => {
    // The failure being prevented: "Due in -2 hours".
    const state = dueState(at(-2 * HOUR), NOW);
    expect(state?.text).toBe("Overdue by 2 hours");
    expect(state?.overdue).toBe(true);
    expect(state?.tone).toBe("danger");
  });

  it("trusts the server's breach verdict over its own arithmetic", () => {
    // The SLA clock pauses while a ticket waits on the requester, so a
    // deadline that looks past on a phone may not have been missed. The
    // server knows about the pauses; this does not.
    const notYet = dueState(at(-3 * HOUR), NOW, false);
    expect(notYet?.overdue).toBe(true);

    const breachedButFuture = dueState(at(3 * HOUR), NOW, true);
    expect(breachedButFuture?.overdue).toBe(true);
    expect(breachedButFuture?.text).toMatch(/^Overdue by/);
  });

  it("turns amber inside the last two hours", () => {
    expect(dueState(at(90 * MINUTE), NOW)?.tone).toBe("warning");
    expect(dueState(at(6 * HOUR), NOW)?.tone).toBe("neutral");
  });

  it("reports nothing for a settled ticket", () => {
    // Counting down on a resolved ticket invites somebody to chase one that
    // is already done.
    expect(dueState(at(-5 * HOUR), NOW, true, true)).toBeUndefined();
    expect(dueState(at(5 * HOUR), NOW, false, true)).toBeUndefined();
  });

  it("reports nothing rather than a blank when there is no deadline", () => {
    expect(dueState(undefined, NOW)).toBeUndefined();
    expect(dueState("", NOW)).toBeUndefined();
    expect(dueState("not a date", NOW)).toBeUndefined();
  });

  it("does not round a few seconds down to zero", () => {
    expect(dueState(at(20_000), NOW)?.text).toBe("Due in less than a minute");
    expect(dueState(at(-20_000), NOW)?.text).toBe("Overdue by less than a minute");
  });

  it("uses the singular for exactly one", () => {
    expect(dueState(at(HOUR), NOW)?.text).toBe("Due in 1 hour");
    expect(dueState(at(DAY * 3), NOW)?.text).toBe("Due in 3 days");
    expect(dueState(at(MINUTE), NOW)?.text).toBe("Due in 1 minute");
  });
});

describe("validateTicket", () => {
  const good = { subject: "Laptop will not charge", body: "It stopped last night." };

  it("accepts a complete ticket", () => {
    expect(validateTicket(good)).toEqual({});
  });

  it("requires a subject of at least three characters", () => {
    expect(validateTicket({ ...good, subject: "" }).subject).toBeDefined();
    expect(validateTicket({ ...good, subject: "ab" }).subject).toBeDefined();
    expect(validateTicket({ ...good, subject: "abc" }).subject).toBeUndefined();
  });

  it("trims before measuring, as the server does", () => {
    // A subject of five spaces passes a naive length check here and is
    // rejected there, which reads as the app losing the ticket.
    expect(validateTicket({ ...good, subject: "     " }).subject).toBeDefined();
    expect(validateTicket({ ...good, body: "   " }).body).toBeDefined();
  });

  it("requires a body", () => {
    expect(validateTicket({ ...good, body: "" }).body).toBeDefined();
    expect(validateTicket({ ...good, body: "x" }).body).toBeUndefined();
  });

  it("holds the same upper bounds as the server", () => {
    expect(validateTicket({ ...good, subject: "a".repeat(200) }).subject).toBeUndefined();
    expect(validateTicket({ ...good, subject: "a".repeat(201) }).subject).toBeDefined();
    expect(validateTicket({ ...good, body: "a".repeat(20_000) }).body).toBeUndefined();
    expect(validateTicket({ ...good, body: "a".repeat(20_001) }).body).toBeDefined();
  });

  it("reports every problem at once", () => {
    // Not one at a time. A form that reveals its next objection only after
    // the last is fixed is filled in three times.
    const errors = validateTicket({ subject: "", body: "" });
    expect(Object.keys(errors).sort()).toEqual(["body", "subject"]);
  });
});
