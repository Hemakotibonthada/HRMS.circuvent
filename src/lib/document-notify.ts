// ═══════════════════════════════════════════════════════════════
// WHO GETS TOLD WHAT, WHEN A DOCUMENT MOVES
// ═══════════════════════════════════════════════════════════════
//
// The routing decision, separated from the sending so it can be tested without
// SMTP and without a database.
//
// Last time round five email bodies were written and one was wired. The other
// four — the reminder, the acceptance, the internal signed notice and the
// withdrawal — sat in the module as dead exports, which is the same shape as
// every other defect in this product: something that reads as finished and
// does nothing. Putting the routing here, with a test per event, is what makes
// "is this actually sent?" a question the suite answers.
//
// The rule that matters most is the direction of travel. A candidate is an
// outsider to the company that is hiring them:
//
//   - Internal notices go to internal signatories only. They get forwarded
//     around a company as a matter of routine, and they carry the other
//     signatories' addresses.
//   - Nothing sent to a candidate names anyone else's address, and nothing
//     sent to a candidate carries another person's signing link — a link is a
//     working credential for that person's contract.
//
// Everything below is decided from the document's own signature slots, which
// are set by HR when the offer is generated. Nothing is taken from the request:
// the signing endpoint is public, and a body field naming a recipient would be
// an open relay.

export type DocumentEvent = "signed" | "completed" | "declined" | "voided" | "reminder";

export interface SignatorySlot {
  email: string;
  role: string;
  name?: string;
  signedAt?: string;
}

export interface NotifyTarget {
  email: string;
  name?: string;
  role: string;
  /** Which side of the company the recipient is on. */
  audience: "candidate" | "internal";
}

/**
 * The signatory role that belongs to the person being hired.
 *
 * `buildSlots` names this slot "employee" for every offer, including the ones
 * for people who will never be employees — a contractor and an intern both
 * sign in the "employee" slot. Rather than spread that assumption across the
 * routes, it is named once here.
 */
export const CANDIDATE_ROLE = "employee";

export function isCandidateSlot(slot: SignatorySlot): boolean {
  return slot.role === CANDIDATE_ROLE;
}

/**
 * Who should hear about this event.
 *
 * `actorEmail` is the person who caused it, and is excluded: telling someone
 * they have just signed something is noise, and it is the kind of noise that
 * teaches people to filter the whole sender.
 */
export function recipientsFor(
  slots: SignatorySlot[],
  event: DocumentEvent,
  actorEmail?: string
): NotifyTarget[] {
  const normalise = (email: string) => email.trim().toLowerCase();
  const actor = actorEmail ? normalise(actorEmail) : undefined;

  const targets: NotifyTarget[] = [];
  const seen = new Set<string>();

  const add = (slot: SignatorySlot, audience: NotifyTarget["audience"]) => {
    const email = normalise(slot.email);
    if (!email || email === actor || seen.has(email)) return;
    seen.add(email);
    targets.push({ email: slot.email.trim(), name: slot.name, role: slot.role, audience });
  };

  switch (event) {
    // One signature landed and others are still outstanding. Only the company
    // needs to know; the candidate finds out when it is complete.
    case "signed":
    case "declined":
      for (const slot of slots) if (!isCandidateSlot(slot)) add(slot, "internal");
      break;

    // Everyone signed. The candidate is told they are hired, and the company
    // is told the envelope is closed.
    case "completed":
      for (const slot of slots) {
        add(slot, isCandidateSlot(slot) ? "candidate" : "internal");
      }
      break;

    // Withdrawal and reminders concern the candidate alone. An internal copy of
    // a withdrawal tells the company something it already decided.
    case "voided":
    case "reminder":
      for (const slot of slots) if (isCandidateSlot(slot)) add(slot, "candidate");
      break;
  }

  return targets;
}

/** A reminder is only worth sending to somebody who has not yet signed. */
export function needsReminder(slot: SignatorySlot): boolean {
  return isCandidateSlot(slot) && !slot.signedAt;
}

export interface ReminderDecision {
  send: boolean;
  reason: string;
  daysLeft?: number;
}

/**
 * Whether an outstanding offer should be chased today.
 *
 * Sent on fixed days before expiry rather than daily. A candidate who is
 * thinking about it does not need a message every morning, and an offer that
 * generates seven emails reads as desperate from one side and as a broken
 * system from the other.
 *
 * Dates are compared as whole IST days. Using elapsed milliseconds would make
 * the reminder land or not depending on the hour the job happened to run.
 */
export const REMINDER_DAYS_BEFORE = [7, 3, 1] as const;

export function shouldRemind(
  document: { status: string; expiresAt?: string; signatures: SignatorySlot[] },
  today: Date
): ReminderDecision {
  if (!["sent", "viewed"].includes(document.status)) {
    return { send: false, reason: `Status is ${document.status}` };
  }

  if (!document.signatures.some(needsReminder)) {
    return { send: false, reason: "The candidate has already signed" };
  }

  if (!document.expiresAt) {
    return { send: false, reason: "No expiry, so nothing to chase towards" };
  }

  const daysLeft = wholeDaysBetween(today, new Date(document.expiresAt));

  if (daysLeft < 0) return { send: false, reason: "Already expired" };
  if (!REMINDER_DAYS_BEFORE.includes(daysLeft as 1 | 3 | 7)) {
    return { send: false, reason: `${daysLeft} days left, not a reminder day`, daysLeft };
  }

  return { send: true, reason: `${daysLeft} days left`, daysLeft };
}

/**
 * Whole days between two instants, counted in IST.
 *
 * `Math.floor(ms / 86_400_000)` counts elapsed 24-hour periods, not calendar
 * days: run at 09:00 against an expiry at 23:59 the next day, it reports 1 day
 * left, and run at 18:00 the same day it reports 0. The reminder then depends
 * on when the job started rather than what the date is.
 */
export function wholeDaysBetween(from: Date, to: Date): number {
  const key = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  const start = Date.parse(`${key(from)}T00:00:00Z`);
  const end = Date.parse(`${key(to)}T00:00:00Z`);

  return Math.round((end - start) / 86_400_000);
}
