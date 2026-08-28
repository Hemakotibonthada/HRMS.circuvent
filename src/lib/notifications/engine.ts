// ═══════════════════════════════════════════════════════════════
// NOTIFICATION ENGINE — routing, templating, batching
// ═══════════════════════════════════════════════════════════════
// Notifications today are written straight into a Firestore collection and
// rendered in-app. There is no email, no push, no per-user preference and no
// way to stop a bulk action from sending five hundred separate messages.
//
// This decides *what to send, to whom, over which channel*. Actually
// delivering is a transport's job (Resend for email, Expo for push, a gateway
// for SMS), so this module stays pure and testable.
//
// The rules that matter:
//
//  * Users control their channels. An HR system that emails someone about
//    every timesheet change trains them to ignore it, which is how the one
//    urgent notification gets missed.
//  * Critical notifications ignore quiet hours and digest batching. A payroll
//    failure at 2am is worth waking someone for; a birthday reminder is not.
//  * Nothing is sent twice. Retries and at-least-once queues make duplicate
//    dispatch the default unless it is explicitly prevented.

export type Channel = "in_app" | "email" | "push" | "sms" | "slack" | "teams" | "whatsapp";

export type NotificationPriority = "low" | "medium" | "high" | "critical";

export type NotificationType =
  | "leave.applied"
  | "leave.approved"
  | "leave.rejected"
  | "expense.submitted"
  | "expense.approved"
  | "payslip.released"
  | "payroll.failed"
  | "interview.scheduled"
  | "review.due"
  | "approval.pending"
  | "approval.escalated"
  | "announcement.published"
  | "document.expiring"
  | "birthday"
  | "work_anniversary"
  | "resignation.submitted"
  | "resignation.accepted"
  | "resignation.lwd_adjusted";

export interface NotificationTemplate {
  type: NotificationType;
  priority: NotificationPriority;
  /** Channels this type may use, before user preferences are applied. */
  channels: Channel[];
  subject: string;
  body: string;
  actionUrl?: string;
  /** Exempt from digest batching and quiet hours. */
  bypassBatching?: boolean;
}

export interface UserPreferences {
  userId: string;
  /** Channels the user has switched off entirely. */
  mutedChannels?: Channel[];
  /** Notification types the user has switched off. */
  mutedTypes?: NotificationType[];
  /** Local hours during which non-critical messages are held, e.g. [22, 8]. */
  quietHours?: [number, number];
  timezone?: string;
  /** Collect non-urgent messages into a periodic digest. */
  digest?: "off" | "hourly" | "daily";
}

export interface NotificationRequest {
  type: NotificationType;
  recipientId: string;
  /** Values substituted into the template. */
  data: Record<string, string | number>;
  /** Deduplication key. Repeats within the window are dropped. */
  idempotencyKey?: string;
  actionUrl?: string;
}

export interface DispatchDecision {
  recipientId: string;
  type: NotificationType;
  priority: NotificationPriority;
  channels: Channel[];
  subject: string;
  body: string;
  actionUrl?: string;
  /** When to send. Later than now if held for quiet hours or a digest. */
  sendAt: Date;
  /** Set when nothing will be sent, for observability. */
  suppressedReason?: "muted_type" | "all_channels_muted" | "duplicate";
}

// ─── Templates ───────────────────────────────────────────────

export const TEMPLATES: Record<NotificationType, NotificationTemplate> = {
  "leave.applied": {
    type: "leave.applied",
    priority: "medium",
    channels: ["in_app", "email"],
    subject: "{{employeeName}} requested {{leaveType}} leave",
    body: "{{employeeName}} has applied for {{totalDays}} day(s) of {{leaveType}} leave from {{startDate}} to {{endDate}}.",
    actionUrl: "/leave",
  },
  "leave.approved": {
    type: "leave.approved",
    priority: "high",
    channels: ["in_app", "email", "push"],
    subject: "Your leave has been approved",
    body: "Your {{leaveType}} leave from {{startDate}} to {{endDate}} was approved by {{approverName}}.",
    actionUrl: "/leave",
  },
  "leave.rejected": {
    type: "leave.rejected",
    priority: "high",
    channels: ["in_app", "email", "push"],
    subject: "Your leave was not approved",
    body: "Your {{leaveType}} leave from {{startDate}} to {{endDate}} was declined. Reason: {{reason}}",
    actionUrl: "/leave",
  },
  "expense.submitted": {
    type: "expense.submitted",
    priority: "medium",
    channels: ["in_app", "email"],
    subject: "{{employeeName}} submitted an expense claim",
    body: "{{employeeName}} submitted {{currency}} {{amount}} for {{category}}.",
    actionUrl: "/expenses",
  },
  "expense.approved": {
    type: "expense.approved",
    priority: "medium",
    channels: ["in_app", "push"],
    subject: "Expense claim approved",
    body: "Your claim for {{currency}} {{amount}} was approved and will be reimbursed.",
    actionUrl: "/expenses",
  },
  "payslip.released": {
    type: "payslip.released",
    priority: "high",
    channels: ["in_app", "email", "push"],
    subject: "Your payslip for {{month}} is ready",
    body: "Your payslip for {{month}} {{year}} is available. Net pay: {{currency}} {{netPay}}.",
    actionUrl: "/payslip",
    // People plan around payday; holding this for a digest is unhelpful.
    bypassBatching: true,
  },
  "payroll.failed": {
    type: "payroll.failed",
    priority: "critical",
    channels: ["in_app", "email", "push", "sms"],
    subject: "Payroll run failed for {{month}} {{year}}",
    body: "The payroll run for {{month}} {{year}} failed: {{error}}. Payment will not go out until this is resolved.",
    actionUrl: "/payroll",
    bypassBatching: true,
  },
  "interview.scheduled": {
    type: "interview.scheduled",
    priority: "high",
    channels: ["in_app", "email", "push"],
    subject: "Interview scheduled with {{candidateName}}",
    body: "{{round}} interview with {{candidateName}} on {{scheduledAt}}.",
    actionUrl: "/interviews",
  },
  "review.due": {
    type: "review.due",
    priority: "medium",
    channels: ["in_app", "email"],
    subject: "Performance review due {{dueDate}}",
    body: "Your {{reviewType}} review for {{cycleName}} is due on {{dueDate}}.",
    actionUrl: "/reviews",
  },
  "approval.pending": {
    type: "approval.pending",
    priority: "medium",
    channels: ["in_app", "email"],
    subject: "{{count}} item(s) awaiting your approval",
    body: "You have {{count}} request(s) waiting for a decision.",
    actionUrl: "/dashboard",
  },
  "approval.escalated": {
    type: "approval.escalated",
    priority: "high",
    channels: ["in_app", "email", "push"],
    subject: "Approval escalated to you",
    body: "A {{entityType}} request has been waiting {{overdueByHours}} hour(s) past its deadline and was escalated to you.",
    actionUrl: "/dashboard",
    bypassBatching: true,
  },
  "announcement.published": {
    type: "announcement.published",
    priority: "low",
    channels: ["in_app"],
    subject: "{{title}}",
    body: "{{summary}}",
    actionUrl: "/announcements",
  },
  "document.expiring": {
    type: "document.expiring",
    priority: "medium",
    channels: ["in_app", "email"],
    subject: "{{documentName}} expires on {{expiresOn}}",
    body: "Your {{documentName}} expires on {{expiresOn}}. Please upload a current copy.",
    actionUrl: "/documents",
  },
  birthday: {
    type: "birthday",
    priority: "low",
    channels: ["in_app"],
    subject: "It's {{employeeName}}'s birthday",
    body: "Wish {{employeeName}} a happy birthday.",
    actionUrl: "/celebrations",
  },
  work_anniversary: {
    type: "work_anniversary",
    priority: "low",
    channels: ["in_app"],
    subject: "{{employeeName}} completes {{years}} year(s) today",
    body: "{{employeeName}} joined {{years}} year(s) ago today.",
    actionUrl: "/celebrations",
  },
  // The three notifications below go to whoever needs to act or is affected,
  // not always the same person: submission tells the manager there is a
  // decision to make, acceptance and an adjusted date tell the employee what
  // was decided. High priority and bypassBatching for the same reason
  // leave's decision notifications are: a resignation sitting unread in a
  // digest is how "submitted three weeks ago, still not accepted" happens.
  "resignation.submitted": {
    type: "resignation.submitted",
    priority: "high",
    channels: ["in_app", "email"],
    subject: "{{employeeName}} has submitted their resignation",
    body: "{{employeeName}} intends to leave on {{intendedLastWorkingDay}}. Reason given: {{reason}}. This needs your acceptance before notice and the last working day are confirmed.",
    actionUrl: "/resignation",
    bypassBatching: true,
  },
  "resignation.accepted": {
    type: "resignation.accepted",
    priority: "high",
    channels: ["in_app", "email"],
    subject: "Your resignation has been accepted",
    body: "Your resignation was accepted by {{approverName}}. Your agreed last working day is {{agreedLastWorkingDay}}.",
    actionUrl: "/resignation",
    bypassBatching: true,
  },
  "resignation.lwd_adjusted": {
    type: "resignation.lwd_adjusted",
    priority: "high",
    channels: ["in_app", "email"],
    subject: "Your last working day has been updated",
    body: "{{adjustedByName}} has changed your agreed last working day to {{newLastWorkingDay}}.",
    actionUrl: "/resignation",
    bypassBatching: true,
  },
};

/**
 * Substitutes `{{token}}` placeholders.
 *
 * An unresolved token renders as an empty string rather than leaving `{{foo}}`
 * visible — a notification that displays its own template syntax reads as
 * broken software, which is worse than a slightly terse sentence.
 */
export function render(template: string, data: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = data[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

// ─── Channel selection ───────────────────────────────────────

/**
 * Channels to use after preferences.
 *
 * Critical notifications ignore muting: someone who silenced email must still
 * hear that payroll failed. Everything else is the user's choice.
 */
export function selectChannels(
  template: NotificationTemplate,
  preferences: UserPreferences | undefined
): Channel[] {
  if (template.priority === "critical") return template.channels;
  const muted = new Set(preferences?.mutedChannels ?? []);
  // in_app is never muted — it is the record of what happened, not an
  // interruption, and the notifications page would otherwise lie.
  return template.channels.filter((c) => c === "in_app" || !muted.has(c));
}

/** Local hour in the user's timezone, defaulting to IST. */
function localHour(at: Date, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(at)
  );
}

/**
 * True when `at` falls inside the user's quiet hours.
 *
 * The window normally wraps midnight (22 to 8), so a simple range test is
 * wrong for the majority case.
 */
export function inQuietHours(
  at: Date,
  quietHours: [number, number] | undefined,
  timezone = "Asia/Kolkata"
): boolean {
  if (!quietHours) return false;
  const [from, to] = quietHours;
  if (from === to) return false;

  const hour = localHour(at, timezone);
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Next moment outside quiet hours. */
function afterQuietHours(at: Date, quietHours: [number, number], timezone: string): Date {
  const target = quietHours[1];
  const candidate = new Date(at);

  // Step forward an hour at a time rather than computing an offset, which
  // keeps this correct across DST transitions and timezone edge cases.
  for (let i = 0; i < 48; i++) {
    candidate.setTime(candidate.getTime() + 3_600_000);
    if (localHour(candidate, timezone) === target) {
      candidate.setMinutes(0, 0, 0);
      return candidate;
    }
  }
  return at;
}

const DIGEST_DELAY_MS: Record<NonNullable<UserPreferences["digest"]>, number> = {
  off: 0,
  hourly: 3_600_000,
  daily: 86_400_000,
};

/**
 * Decides whether, when and how to deliver one notification.
 *
 * `seenKeys` carries idempotency keys already dispatched. Queues are
 * at-least-once, so without this a retry sends the same message twice.
 */
export function planDispatch(
  request: NotificationRequest,
  preferences: UserPreferences | undefined,
  now: Date = new Date(),
  seenKeys: ReadonlySet<string> = new Set()
): DispatchDecision {
  const template = TEMPLATES[request.type];
  if (!template) throw new Error(`No template for notification type "${request.type}"`);

  const base: DispatchDecision = {
    recipientId: request.recipientId,
    type: request.type,
    priority: template.priority,
    channels: [],
    subject: render(template.subject, request.data),
    body: render(template.body, request.data),
    actionUrl: request.actionUrl ?? template.actionUrl,
    sendAt: now,
  };

  if (request.idempotencyKey && seenKeys.has(request.idempotencyKey)) {
    return { ...base, suppressedReason: "duplicate" };
  }

  // Critical types cannot be muted; checked before the type mute so a silenced
  // "payroll" category cannot hide a payroll failure.
  if (template.priority !== "critical" && preferences?.mutedTypes?.includes(request.type)) {
    return { ...base, suppressedReason: "muted_type" };
  }

  const channels = selectChannels(template, preferences);
  if (channels.length === 0) {
    return { ...base, suppressedReason: "all_channels_muted" };
  }

  const timezone = preferences?.timezone ?? "Asia/Kolkata";
  let sendAt = now;

  if (!template.bypassBatching && template.priority !== "critical") {
    if (inQuietHours(now, preferences?.quietHours, timezone)) {
      sendAt = afterQuietHours(now, preferences!.quietHours!, timezone);
    } else if (preferences?.digest && preferences.digest !== "off") {
      sendAt = new Date(now.getTime() + DIGEST_DELAY_MS[preferences.digest]);
    }
  }

  return { ...base, channels, sendAt };
}

/**
 * Collapses many notifications of one type into a single summary.
 *
 * Approving thirty leave requests should tell the employee thirty times, but
 * tell the manager once. Without this, a bulk action is indistinguishable from
 * spam.
 */
export function collapse(decisions: DispatchDecision[]): DispatchDecision[] {
  const groups = new Map<string, DispatchDecision[]>();

  for (const decision of decisions) {
    if (decision.suppressedReason) continue;
    // Never collapse anything urgent: each critical event needs its own alert.
    if (decision.priority === "critical" || decision.priority === "high") {
      groups.set(`${decision.recipientId}:${decision.type}:${groups.size}`, [decision]);
      continue;
    }
    const key = `${decision.recipientId}:${decision.type}`;
    groups.set(key, [...(groups.get(key) ?? []), decision]);
  }

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const first = group[0];
    return {
      ...first,
      subject: `${group.length} ${first.type.replace(/\./g, " ")} updates`,
      body: group.map((d) => `• ${d.subject}`).join("\n"),
      // The earliest send time, so collapsing never delays anything further
      // than it would have gone on its own.
      sendAt: group.reduce((min, d) => (d.sendAt < min ? d.sendAt : min), first.sendAt),
    };
  });
}
