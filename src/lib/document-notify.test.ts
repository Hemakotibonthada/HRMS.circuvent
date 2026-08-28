// The direction-of-travel tests are the ones that matter here: a candidate is
// an outsider to the company hiring them, and an internal notice carries other
// people's addresses.

import { describe, expect, it } from "vitest";
import {
  CANDIDATE_ROLE,
  REMINDER_DAYS_BEFORE,
  isCandidateSlot,
  needsReminder,
  recipientsFor,
  shouldRemind,
  wholeDaysBetween,
  type SignatorySlot,
} from "@/lib/document-notify";

const CANDIDATE: SignatorySlot = { email: "asha@example.test", role: "employee", name: "Asha Rao" };
const HR: SignatorySlot = { email: "people@acme.test", role: "hr", name: "People Ops" };
const LEGAL: SignatorySlot = { email: "legal@acme.test", role: "legal" };
const SLOTS = [CANDIDATE, HR, LEGAL];

const emails = (targets: { email: string }[]) => targets.map((t) => t.email).sort();

describe("who is the candidate", () => {
  it("is whoever holds the employee slot, whatever they will actually be", () => {
    expect(isCandidateSlot(CANDIDATE)).toBe(true);
    expect(CANDIDATE_ROLE).toBe("employee");
  });

  it("is not anybody on the company side", () => {
    expect(isCandidateSlot(HR)).toBe(false);
    expect(isCandidateSlot(LEGAL)).toBe(false);
  });
});

describe("a signature landing", () => {
  it("tells the company and not the candidate", () => {
    const targets = recipientsFor(SLOTS, "signed");
    expect(emails(targets)).toEqual(["legal@acme.test", "people@acme.test"]);
    expect(targets.every((t) => t.audience === "internal")).toBe(true);
  });

  it("does not tell the person who just signed", () => {
    const targets = recipientsFor(SLOTS, "signed", "people@acme.test");
    expect(emails(targets)).toEqual(["legal@acme.test"]);
  });

  it("ignores case and spacing when excluding the actor", () => {
    for (const actor of ["  People@Acme.test ", "PEOPLE@ACME.TEST"]) {
      expect(emails(recipientsFor(SLOTS, "signed", actor))).toEqual(["legal@acme.test"]);
    }
  });
});

describe("a completed envelope", () => {
  it("tells the candidate they are hired and the company it is closed", () => {
    const targets = recipientsFor(SLOTS, "completed");
    expect(emails(targets)).toEqual([
      "asha@example.test",
      "legal@acme.test",
      "people@acme.test",
    ]);
  });

  it("marks the candidate apart from the company", () => {
    const targets = recipientsFor(SLOTS, "completed");
    expect(targets.find((t) => t.email === "asha@example.test")?.audience).toBe("candidate");
    expect(targets.find((t) => t.email === "people@acme.test")?.audience).toBe("internal");
  });
});

describe("declining", () => {
  it("tells the company, not the candidate who just declined", () => {
    const targets = recipientsFor(SLOTS, "declined");
    expect(emails(targets)).toEqual(["legal@acme.test", "people@acme.test"]);
  });
});

describe("withdrawal and reminders", () => {
  it("go to the candidate alone", () => {
    for (const event of ["voided", "reminder"] as const) {
      const targets = recipientsFor(SLOTS, event);
      expect(emails(targets)).toEqual(["asha@example.test"]);
      expect(targets[0].audience).toBe("candidate");
    }
  });

  // An internal copy of a withdrawal tells the company something it decided.
  it("do not copy the company on its own decision", () => {
    expect(recipientsFor(SLOTS, "voided").some((t) => t.audience === "internal")).toBe(false);
  });
});

describe("addressing hygiene", () => {
  it("never sends the same person two copies", () => {
    const duplicated = [CANDIDATE, HR, { ...HR, role: "approver" }];
    expect(recipientsFor(duplicated, "signed")).toHaveLength(1);
  });

  it("treats differently-cased addresses as the same person", () => {
    const duplicated = [CANDIDATE, HR, { ...HR, email: "People@Acme.TEST", role: "approver" }];
    expect(recipientsFor(duplicated, "signed")).toHaveLength(1);
  });

  it("skips a slot with no address rather than sending to an empty string", () => {
    const targets = recipientsFor([CANDIDATE, { ...HR, email: "   " }], "signed");
    expect(targets).toHaveLength(0);
  });

  it("returns nothing when there is nobody on the right side", () => {
    expect(recipientsFor([CANDIDATE], "signed")).toEqual([]);
    expect(recipientsFor([HR], "voided")).toEqual([]);
  });
});

describe("who still needs chasing", () => {
  it("is the candidate who has not signed", () => {
    expect(needsReminder(CANDIDATE)).toBe(true);
  });

  it("is not one who has", () => {
    expect(needsReminder({ ...CANDIDATE, signedAt: "2026-04-01T10:00:00Z" })).toBe(false);
  });

  it("is never the company side", () => {
    expect(needsReminder(HR)).toBe(false);
  });
});

describe("whether to chase today", () => {
  const at = (iso: string) => new Date(iso);
  const offer = (over: Partial<{ status: string; expiresAt: string; signatures: SignatorySlot[] }> = {}) => ({
    status: "sent",
    expiresAt: "2026-05-01T00:00:00+05:30",
    signatures: [CANDIDATE, HR],
    ...over,
  });

  it("chases on each reminder day and no other", () => {
    for (const days of REMINDER_DAYS_BEFORE) {
      const day = new Date(Date.parse("2026-05-01T00:00:00+05:30") - days * 86_400_000);
      expect(shouldRemind(offer(), day).send, `${days} days before`).toBe(true);
    }
  });

  it("stays quiet on the days between", () => {
    for (const days of [10, 6, 5, 4, 2]) {
      const day = new Date(Date.parse("2026-05-01T00:00:00+05:30") - days * 86_400_000);
      expect(shouldRemind(offer(), day).send, `${days} days before`).toBe(false);
    }
  });

  it("stops once the offer has expired", () => {
    expect(shouldRemind(offer(), at("2026-05-02T09:00:00+05:30")).send).toBe(false);
  });

  it("does not chase a signed offer", () => {
    const signed = offer({ signatures: [{ ...CANDIDATE, signedAt: "2026-04-02T00:00:00Z" }, HR] });
    const result = shouldRemind(signed, at("2026-04-30T09:00:00+05:30"));
    expect(result.send).toBe(false);
    expect(result.reason).toContain("already signed");
  });

  it("does not chase a draft, a declined or a withdrawn offer", () => {
    for (const status of ["draft", "declined", "voided", "completed", "expired"]) {
      expect(shouldRemind(offer({ status }), at("2026-04-30T09:00:00+05:30")).send).toBe(false);
    }
  });

  it("does not chase towards a deadline that does not exist", () => {
    const result = shouldRemind(
      { status: "sent", signatures: [CANDIDATE], expiresAt: undefined },
      at("2026-04-30T09:00:00+05:30")
    );
    expect(result.send).toBe(false);
    expect(result.reason).toContain("No expiry");
  });

  // Whether a reminder goes out must not depend on the hour the job ran.
  it("gives the same answer whatever time of day the job runs", () => {
    for (const hour of ["00:05", "09:00", "13:30", "23:55"]) {
      const day = at(`2026-04-30T${hour}:00+05:30`);
      expect(shouldRemind(offer(), day).send, `at ${hour}`).toBe(true);
    }
  });
});

describe("counting days", () => {
  it("counts calendar days, not elapsed 24-hour periods", () => {
    const from = new Date("2026-04-30T18:00:00+05:30");
    const to = new Date("2026-05-01T09:00:00+05:30");
    expect(wholeDaysBetween(from, to)).toBe(1);
  });

  it("is zero on the same IST day, however far apart the clocks", () => {
    expect(
      wholeDaysBetween(new Date("2026-04-30T00:30:00+05:30"), new Date("2026-04-30T23:30:00+05:30"))
    ).toBe(0);
  });

  it("goes negative once the date has passed", () => {
    expect(
      wholeDaysBetween(new Date("2026-05-02T09:00:00+05:30"), new Date("2026-05-01T09:00:00+05:30"))
    ).toBe(-1);
  });

  // A UTC instant late in the evening is already tomorrow in IST. Counting in
  // UTC would put the reminder a day out for every offer.
  it("uses IST dates, not UTC ones", () => {
    const lateUtc = new Date("2026-04-30T19:00:00Z");
    const expiry = new Date("2026-05-01T00:00:00+05:30");
    expect(wholeDaysBetween(lateUtc, expiry)).toBe(0);
  });
});
