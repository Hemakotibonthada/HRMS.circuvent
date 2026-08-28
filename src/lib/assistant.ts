// ═══════════════════════════════════════════════════════════════
// HR ASSISTANT
// ═══════════════════════════════════════════════════════════════
// A navigator, not an oracle.
//
// The assistant this replaces answered "What is my leave balance?" with
// hardcoded numbers — "Casual Leave: 6 remaining … 36 leave days remaining
// this year" — and cited "Leave Management System" as its source. It did the
// same for performance, reporting a fabricated "Final Rating: 4.1/5 (Exceeds
// Expectations)", and for a learning budget, and for training recommended
// "based on your role".
//
// None of it was real. An employee asking a question the product invites them
// to ask received a confident, specific, sourced answer about their own record
// that had been typed into a constant months earlier — and planned around it.
//
// The rule here is narrow and absolute: **never state a fact about a person
// that has not been fetched.** Two kinds of answer are allowed.
//
//   fetched     Real data, pulled from the API when the question is asked.
//               Leave balances and holidays qualify; both have routes.
//
//   navigation  "Here is where that lives", with a link. No figures.
//
// A question that cannot be answered either way gets an honest "I cannot see
// that" rather than a plausible paragraph. Policy figures — approval limits,
// notice periods, bonus amounts — are deliberately *not* recited: they are
// per-organization configuration, and a wrong one quoted confidently is how
// somebody submits a claim that gets rejected.

export type AnswerKind = "fetched" | "navigation" | "unknown";

export interface AssistantAction {
  label: string;
  href: string;
}

export interface AssistantAnswer {
  kind: AnswerKind;
  content: string;
  actions: AssistantAction[];
  /**
   * Present only on `fetched` answers, naming what was actually read.
   *
   * The old version attached "sources" to invented text, which is the part
   * that turned a wrong answer into a believable one.
   */
  source?: string;
}

export type Intent =
  | "leave_balance"
  | "holidays"
  | "payslip"
  | "apply_leave"
  | "expenses"
  | "wfh"
  | "helpdesk"
  | "performance"
  | "training"
  | "onboarding"
  | "salary_structure"
  | "referral"
  | "unknown";

interface IntentRule {
  intent: Intent;
  /** All of these must appear, or any single one when `any` is set. */
  any: string[];
}

// Ordered: the first match wins, so narrower intents come first. "apply for
// leave" must not be swallowed by "leave".
const INTENT_RULES: IntentRule[] = [
  { intent: "leave_balance", any: ["leave balance", "leave remaining", "leaves left", "how many leaves"] },
  { intent: "apply_leave", any: ["apply leave", "apply for leave", "book leave", "request leave", "take leave"] },
  { intent: "holidays", any: ["holiday", "public holiday", "festival list", "holiday calendar"] },
  { intent: "payslip", any: ["payslip", "pay slip", "salary credited", "salary slip"] },
  { intent: "salary_structure", any: ["salary structure", "ctc", "salary component", "salary breakup"] },
  { intent: "expenses", any: ["expense", "reimburs", "claim money", "spent on"] },
  { intent: "wfh", any: ["wfh", "work from home", "remote work", "hybrid"] },
  { intent: "helpdesk", any: ["vpn", "helpdesk", "ticket", "it support", "laptop issue"] },
  { intent: "performance", any: ["performance", "appraisal", "review cycle", "my rating", "goals"] },
  { intent: "training", any: ["training", "course", "learning", "certification"] },
  { intent: "onboarding", any: ["onboarding", "new joiner", "first day", "joining formalit"] },
  { intent: "referral", any: ["referral", "refer a friend", "refer someone"] },
];

export function detectIntent(query: string): Intent {
  const q = query.toLowerCase();
  for (const rule of INTENT_RULES) {
    if (rule.any.some((phrase) => q.includes(phrase))) return rule.intent;
  }
  return "unknown";
}

// ─── Navigation answers ──────────────────────────────────────
// Where something lives. No figures, because a figure here is a claim.

const NAVIGATION: Record<Exclude<Intent, "leave_balance" | "holidays" | "unknown">, AssistantAnswer> = {
  apply_leave: {
    kind: "navigation",
    content:
      "You can apply for leave from Leave Management. Pick the type and dates, and it goes to your reporting manager for approval — your balance is checked at that point, so you will be told immediately if a request would overdraw it.",
    actions: [{ label: "Apply for leave", href: "/leave" }],
  },
  payslip: {
    kind: "navigation",
    content:
      "Your payslips are on the Payslip page — earnings, deductions and net pay for each month, with a download for each one. Only released payslips appear there: a run that is still being corrected is deliberately hidden rather than shown and then changed.",
    actions: [
      { label: "View payslips", href: "/payslip" },
      { label: "Tax details", href: "/tax" },
    ],
  },
  salary_structure: {
    kind: "navigation",
    content:
      "Your salary structure — the split across basic, HRA, allowances and the statutory deductions — is shown on your payslip for any released month. I do not quote the components here, because they vary by organisation and grade and a figure from memory would be worth nothing to you.",
    actions: [{ label: "View payslips", href: "/payslip" }],
  },
  expenses: {
    kind: "navigation",
    content:
      "Expense claims are on the Expenses page. File one with a line per item and it goes for approval; the category limit is checked when you submit, so you will be told before it is filed rather than after.",
    actions: [{ label: "Claim an expense", href: "/expenses" }],
  },
  wfh: {
    kind: "navigation",
    content:
      "Work-from-home requests are on the WFH page. Your organisation's policy — who is eligible and how many days — is set by your HR team, so check the policy document rather than taking a number from me.",
    actions: [
      { label: "Request WFH", href: "/wfh" },
      { label: "Company policies", href: "/policies" },
    ],
  },
  helpdesk: {
    kind: "navigation",
    content:
      "Raise a ticket on the Helpdesk page and it goes to whichever team handles that category, with an SLA attached. For VPN and laptop problems, pick the IT category so it routes correctly the first time.",
    actions: [{ label: "Raise a ticket", href: "/helpdesk" }],
  },
  performance: {
    kind: "navigation",
    content:
      "Your reviews, ratings and goals are on the Performance page. I do not repeat ratings here — a rating is between you and your manager, and one quoted second-hand by an assistant is worse than no answer.",
    actions: [
      { label: "My performance", href: "/performance" },
      { label: "My goals", href: "/goals" },
    ],
  },
  training: {
    kind: "navigation",
    content:
      "Courses, your enrolments and anything mandatory with a deadline are on the Training page.",
    actions: [{ label: "Browse training", href: "/training" }],
  },
  onboarding: {
    kind: "navigation",
    content:
      "Welcome. Your onboarding checklist is on the Onboarding page — it shows every task, who owns it, and what is still outstanding. It is the real list your HR team is working from, so ticking something there is what marks it done.",
    actions: [
      { label: "My onboarding", href: "/onboarding" },
      { label: "Documents", href: "/documents" },
    ],
  },
  referral: {
    kind: "navigation",
    content:
      "The referral programme is on the Referrals page, where you can submit someone and follow their progress. Bonus amounts are configured per role by your HR team, so the page is the place to read them.",
    actions: [{ label: "Refer someone", href: "/referrals" }],
  },
};

export function navigationAnswer(intent: Intent): AssistantAnswer | null {
  if (intent === "unknown" || intent === "leave_balance" || intent === "holidays") return null;
  return NAVIGATION[intent];
}

export function unknownAnswer(query: string): AssistantAnswer {
  return {
    kind: "unknown",
    content:
      `I do not have an answer for "${query.trim()}".\n\n` +
      "I can look up your leave balance and the holiday calendar, and point you to the right page for payslips, expenses, leave, helpdesk, performance, training, onboarding and referrals. " +
      "For anything else, the knowledge base or a ticket to HR will get you a real answer.",
    actions: [
      { label: "Knowledge base", href: "/knowledgebase" },
      { label: "Ask HR", href: "/helpdesk" },
    ],
  };
}

// ─── Fetched answers ─────────────────────────────────────────

export interface LeaveBalance {
  leaveType: string;
  available: number;
  used: number;
  pending: number;
}

/**
 * Formats a real balance.
 *
 * Says "no balances recorded" when the list is empty rather than inventing a
 * default allocation — an employee whose balances have not been set up needs
 * to know that, not a plausible number.
 */
export function formatLeaveBalance(balances: LeaveBalance[], year: number): AssistantAnswer {
  if (balances.length === 0) {
    return {
      kind: "fetched",
      content: `No leave balances are recorded against your account for ${year}. That usually means they have not been allocated yet — your HR team can set them up.`,
      actions: [{ label: "Ask HR", href: "/helpdesk" }],
      source: "Leave balances",
    };
  }

  const lines = balances.map(
    (b) =>
      `• **${b.leaveType}** — ${b.available} available` +
      (b.pending > 0 ? ` (${b.pending} pending approval)` : "")
  );

  const total = balances.reduce((sum, b) => sum + b.available, 0);

  return {
    kind: "fetched",
    content:
      `Your leave balance for ${year}:\n\n${lines.join("\n")}\n\n` +
      `That is **${total} day${total === 1 ? "" : "s"}** available in total. ` +
      "Pending days are already reserved against a request that has not been decided yet.",
    actions: [{ label: "Apply for leave", href: "/leave" }],
    source: "Leave balances",
  };
}

export interface Holiday {
  name: string;
  holidayDate: string;
  isOptional: boolean;
}

/** Formats the real holiday calendar, upcoming first. */
export function formatHolidays(holidays: Holiday[], today: string): AssistantAnswer {
  const upcoming = holidays
    .filter((h) => h.holidayDate >= today)
    .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate))
    .slice(0, 8);

  if (upcoming.length === 0) {
    return {
      kind: "fetched",
      content:
        "There are no upcoming holidays on the calendar. If that looks wrong, the year's list may not have been published yet.",
      actions: [{ label: "Holiday calendar", href: "/holidays" }],
      source: "Holiday calendar",
    };
  }

  const lines = upcoming.map((h) => {
    const date = new Date(`${h.holidayDate}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return `• ${date} — ${h.name}${h.isOptional ? " _(optional)_" : ""}`;
  });

  return {
    kind: "fetched",
    content: `The next holidays on your calendar:\n\n${lines.join("\n")}`,
    actions: [{ label: "Full calendar", href: "/holidays" }],
    source: "Holiday calendar",
  };
}

/** What the assistant can genuinely look up, for the suggestion chips. */
export const ANSWERABLE_QUESTIONS = [
  "What is my leave balance?",
  "What are the upcoming holidays?",
  "How do I apply for leave?",
  "Where is my payslip?",
  "How do I claim an expense?",
  "How do I raise an IT ticket?",
] as const;
