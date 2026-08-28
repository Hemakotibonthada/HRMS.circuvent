// Web helpdesk vocabulary — mirrors mobile/src/lib/helpdesk-rules.ts

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

export function stateLabel(state: string): string {
  return STATE_LABEL[state as TicketState] ?? humanise(state) ?? "Unknown";
}

export function stateTone(state: string): Tone {
  return STATE_TONE[state as TicketState] ?? "neutral";
}

export function priorityLabel(priority: string): string {
  return PRIORITY_LABEL[priority as TicketPriority] ?? humanise(priority) ?? "Normal";
}

export function priorityTone(priority: string): Tone {
  return PRIORITY_TONE[priority as TicketPriority] ?? "neutral";
}

export function isSettled(state: string): boolean {
  return state === "resolved" || state === "closed";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

export function dueState(
  dueAt: string | undefined,
  now: Date,
  breached = false,
  settled = false
): DueState | undefined {
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
    tone: remaining <= 2 * HOUR ? "warning" : "neutral",
    overdue: false,
  };
}

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

export const TONE_BADGE: Record<Tone, string> = {
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
};
