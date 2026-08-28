// ═══════════════════════════════════════════════════════════════
// HELPDESK RULES — vocabulary, SLA phrasing and form validation
// ═══════════════════════════════════════════════════════════════
// Pure and tested. Three jobs, and each one has a trap in it.
//
// The state vocabulary must not silently drop a state the server knows and
// this build does not. A ticket whose status renders as blank is one the
// person believes nobody has touched.
//
// The SLA phrase is the only number on the screen that a person plans around
// — "someone will look at this before I leave" — so an overdue ticket has to
// say overdue rather than counting down past zero into a negative "due in".
//
// The validation mirrors the server's Zod schema exactly. Client validation
// that is *stricter* rejects things the server would have taken; validation
// that is looser sends a round trip to be told what the phone already knew,
// on a form somebody is filling in one-handed.

export type TicketState =
  | "new"
  | "open"
  | "pending_requester"
  | "pending_third_party"
  | "resolved"
  | "closed";

export type TicketPriority = "urgent" | "high" | "normal" | "low";

export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

export interface TicketDraft {
  subject: string;
  body: string;
}

export type TicketField = "subject" | "body";

const STATE_LABEL: Record<TicketState, string> = {
  new: "New",
  open: "In progress",
  pending_requester: "Waiting for you",
  pending_third_party: "Waiting on someone else",
  resolved: "Resolved",
  closed: "Closed",
};

const STATE_TONE: Record<TicketState, Tone> = {
  new: "info",
  open: "info",
  // The one state that needs the requester to do something. It is the only
  // one drawn in the attention colour, so that a list of six tickets shows at
  // a glance which is waiting on them.
  pending_requester: "warning",
  pending_third_party: "neutral",
  resolved: "success",
  closed: "neutral",
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const PRIORITY_TONE: Record<TicketPriority, Tone> = {
  urgent: "danger",
  high: "warning",
  normal: "neutral",
  low: "neutral",
};

/** Priorities a requester may choose, most severe first. */
export const SELECTABLE_PRIORITIES: readonly TicketPriority[] = [
  "urgent",
  "high",
  "normal",
  "low",
];

function humanise(value: string): string {
  const spaced = value.replace(/_/g, " ").trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A state as a word.
 *
 * An unrecognised state is made readable rather than replaced with "Unknown"
 * or hidden. It is still the truth about the ticket, and the reader can act on
 * "Escalated" without this build having heard of it.
 */
export function stateLabel(state: string): string {
  return STATE_LABEL[state as TicketState] ?? humanise(state) ?? "Unknown";
}

/** Unknown states are neutral: a colour guess is a claim nobody checked. */
export function stateTone(state: string): Tone {
  return STATE_TONE[state as TicketState] ?? "neutral";
}

export function priorityLabel(priority: string): string {
  return PRIORITY_LABEL[priority as TicketPriority] ?? humanise(priority) ?? "Normal";
}

export function priorityTone(priority: string): Tone {
  return PRIORITY_TONE[priority as TicketPriority] ?? "neutral";
}

/** True once a ticket needs nothing further from anyone. */
export function isSettled(state: string): boolean {
  return state === "resolved" || state === "closed";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2 hours", "1 day", "45 minutes" — a span, with no direction implied. */
function span(ms: number): string {
  if (ms < MINUTE) return "less than a minute";

  if (ms < HOUR) {
    const minutes = Math.round(ms / MINUTE);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }

  if (ms < 2 * DAY) {
    const hours = Math.round(ms / HOUR);
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  const days = Math.round(ms / DAY);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export interface DueState {
  text: string;
  tone: Tone;
  overdue: boolean;
}

/**
 * How the resolution deadline should read.
 *
 * `breached` is the server's own verdict and wins over the arithmetic. The
 * clock pauses while a ticket waits on the requester, so a deadline that looks
 * past on a phone may not have been missed — and telling somebody their
 * request is overdue when the helpdesk is waiting on *them* is both wrong and
 * the opposite of useful.
 *
 * Returns undefined when there is no deadline to report, so the caller renders
 * nothing rather than an empty row where a time belongs.
 */
export function dueState(
  dueAt: string | undefined,
  now: Date,
  breached = false,
  settled = false
): DueState | undefined {
  // A settled ticket has no deadline left to run. Counting down on a resolved
  // ticket invites somebody to chase one that is already done.
  if (settled) return undefined;
  if (!dueAt) return undefined;

  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return undefined;

  const remaining = due - now.getTime();

  if (breached || remaining < 0) {
    return {
      text: `Overdue by ${span(Math.abs(remaining))}`,
      tone: "danger",
      overdue: true,
    };
  }

  return {
    text: `Due in ${span(remaining)}`,
    // Inside two hours it becomes worth looking at, so it stops being grey.
    tone: remaining <= 2 * HOUR ? "warning" : "neutral",
    overdue: false,
  };
}

/**
 * Validates a new ticket against the same bounds the server enforces.
 *
 * The limits are the server's: subject trimmed to 3–200 characters, body
 * trimmed to 1–20,000. Trimmed on both sides, because a subject of five
 * spaces passes a naive length check here and is rejected there.
 */
export function validateTicket(draft: TicketDraft): Partial<Record<TicketField, string>> {
  const errors: Partial<Record<TicketField, string>> = {};

  const subject = draft.subject.trim();
  if (subject.length < 3) {
    errors.subject = "Give the ticket a subject of at least three characters";
  } else if (subject.length > 200) {
    errors.subject = "Keep the subject under 200 characters";
  }

  const body = draft.body.trim();
  if (body.length < 1) {
    errors.body = "Describe the problem, however briefly";
  } else if (body.length > 20_000) {
    errors.body = "This is too long to send. Attach the detail to a reply instead.";
  }

  return errors;
}
