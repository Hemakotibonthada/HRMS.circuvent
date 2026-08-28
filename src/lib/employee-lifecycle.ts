// ═══════════════════════════════════════════════════════════════
// EMPLOYEE LIFECYCLE MANAGEMENT
// Complete lifecycle from hiring to exit — onboarding workflows,
// probation management, role transitions, and offboarding
// ═══════════════════════════════════════════════════════════════

import { computeSettlement, type DayBasis, type ExitReason } from "./settlement";
import type { Minor } from "./statutory-india";

// ─── Lifecycle Stages ────────────────────────────────────────

export type LifecycleStage =
  | "candidate" | "offered" | "pre_boarding" | "onboarding"
  | "probation" | "confirmed" | "active" | "promoted"
  | "transferred" | "on_sabbatical" | "notice_period"
  | "offboarding" | "exited" | "alumni";

export interface LifecycleEvent {
  stage: LifecycleStage;
  date: string;
  description: string;
  performedBy: string;
  metadata?: Record<string, unknown>;
}

export interface OnboardingChecklist {
  phase: string;
  phaseName: string;
  phaseOrder: number;
  tasks: OnboardingTask[];
  dueByDay: number;
}

export interface OnboardingTask {
  id: string;
  title: string;
  description: string;
  assignee: "hr" | "it" | "manager" | "buddy" | "self" | "admin" | "finance";
  dueDay: number;
  mandatory: boolean;
  completed: boolean;
  completedDate?: string;
  category: string;
}

export interface OffboardingChecklist {
  step: number;
  stepName: string;
  tasks: OffboardingTask[];
  assignee: string;
  completed: boolean;
}

export interface OffboardingTask {
  id: string;
  title: string;
  completed: boolean;
  completedDate?: string;
  assignee: string;
  notes?: string;
}

/** One line of a settlement — an earning or a deduction, always labelled. */
export interface SettlementLineItem {
  code: string;
  label: string;
  amount: number;
  note?: string;
}

export interface SettlementComponents {
  /** Calendar days in the month the exit date falls in, and how many of them were worked. */
  daysInFinalMonth: number;
  daysWorkedInFinalMonth: number;
  /** The final month's salary line, pulled out for convenience — it is also in `earnings`. */
  proratedFinalSalary: number;
  earnings: SettlementLineItem[];
  deductions: SettlementLineItem[];
  totalEarnings: number;
  totalDeductions: number;
  /**
   * Positive when the company owes the employee, negative when the employee
   * owes the company. Deliberately not clamped to zero — see `settlement.ts`
   * for why writing off what's owed by silently flooring it is worse than
   * showing an uncomfortable negative number.
   */
  netSettlement: number;
  employeeOwes: boolean;
  gratuityYearsOfService: number;
  gratuityEligible: boolean;
  /** Everything a reviewer should read before this settlement is paid. */
  notes: string[];
}

// ─── Onboarding Templates ────────────────────────────────────

export const ONBOARDING_TEMPLATE: OnboardingChecklist[] = [
  {
    phase: "pre_boarding",
    phaseName: "Pre-boarding",
    phaseOrder: 1,
    dueByDay: 0,
    tasks: [
      { id: "ob_01", title: "Send welcome email with joining instructions", description: "Include joining date, time, location, dress code, what to bring", assignee: "hr", dueDay: -7, mandatory: true, completed: false, category: "Communication" },
      { id: "ob_02", title: "Share employee handbook & policies", description: "Digital copy of company handbook, leave policy, code of conduct", assignee: "hr", dueDay: -5, mandatory: true, completed: false, category: "Documentation" },
      { id: "ob_03", title: "Order laptop and setup email account", description: "Procure hardware, create corporate email, set up access", assignee: "it", dueDay: -3, mandatory: true, completed: false, category: "IT Setup" },
      { id: "ob_04", title: "Prepare workstation and access card", description: "Desk assignment, access card, parking if applicable", assignee: "admin", dueDay: -2, mandatory: true, completed: false, category: "Facilities" },
      { id: "ob_05", title: "Create payroll record and bank details", description: "Add to payroll system, verify bank account, PAN, Aadhaar", assignee: "finance", dueDay: -1, mandatory: true, completed: false, category: "Finance" },
      { id: "ob_06", title: "Assign onboarding buddy", description: "Designate experienced team member as onboarding buddy", assignee: "manager", dueDay: -1, mandatory: true, completed: false, category: "Team" },
    ],
  },
  {
    phase: "week_1",
    phaseName: "Week 1: Welcome & Orientation",
    phaseOrder: 2,
    dueByDay: 7,
    tasks: [
      { id: "ob_07", title: "Day 1 Orientation & Welcome Session", description: "Company overview, values, culture introduction, office tour", assignee: "hr", dueDay: 1, mandatory: true, completed: false, category: "Orientation" },
      { id: "ob_08", title: "Team Introduction & Buddy Meeting", description: "Meet the team, 1:1 with manager, buddy introduction", assignee: "manager", dueDay: 1, mandatory: true, completed: false, category: "Team" },
      { id: "ob_09", title: "IT Setup & Tool Access", description: "Laptop handover, email setup, Slack/Teams, VPN, development tools", assignee: "it", dueDay: 1, mandatory: true, completed: false, category: "IT Setup" },
      { id: "ob_10", title: "HR Paperwork & Document Submission", description: "ID proof, address proof, education certificates, PAN, Aadhaar", assignee: "self", dueDay: 2, mandatory: true, completed: false, category: "Documentation" },
      { id: "ob_11", title: "POSH Training Enrollment", description: "Register for mandatory POSH compliance training", assignee: "hr", dueDay: 3, mandatory: true, completed: false, category: "Compliance" },
      { id: "ob_12", title: "Code Repository & Project Access", description: "GitHub/GitLab access, project repos, documentation", assignee: "manager", dueDay: 3, mandatory: true, completed: false, category: "IT Setup" },
      { id: "ob_13", title: "Codebase & Architecture Walkthrough", description: "Tech stack overview, architecture docs, coding standards", assignee: "buddy", dueDay: 5, mandatory: true, completed: false, category: "Technical" },
      { id: "ob_14", title: "First 1:1 with Manager", description: "Expectations, 30-60-90 day plan, goals discussion", assignee: "manager", dueDay: 5, mandatory: true, completed: false, category: "Check-in" },
    ],
  },
  {
    phase: "month_1",
    phaseName: "Month 1: Integration & Learning",
    phaseOrder: 3,
    dueByDay: 30,
    tasks: [
      { id: "ob_15", title: "Complete Security Awareness Training", description: "Information security policies, data handling, access controls", assignee: "self", dueDay: 10, mandatory: true, completed: false, category: "Compliance" },
      { id: "ob_16", title: "Submit First Pull Request / Deliverable", description: "Complete a small task independently, submit for review", assignee: "self", dueDay: 10, mandatory: false, completed: false, category: "Technical" },
      { id: "ob_17", title: "2-Week Check-in with Manager", description: "Progress review, feedback collection, blockers discussion", assignee: "manager", dueDay: 14, mandatory: true, completed: false, category: "Check-in" },
      { id: "ob_18", title: "Attend Team Sprint/Planning Sessions", description: "Participate in agile ceremonies, understand workflow", assignee: "self", dueDay: 14, mandatory: true, completed: false, category: "Team" },
      { id: "ob_19", title: "Complete POSH Training", description: "Finish mandatory POSH compliance training and assessment", assignee: "self", dueDay: 21, mandatory: true, completed: false, category: "Compliance" },
      { id: "ob_20", title: "30-Day HR Check-in", description: "HR feedback session, onboarding experience survey", assignee: "hr", dueDay: 30, mandatory: true, completed: false, category: "Check-in" },
    ],
  },
  {
    phase: "month_2_3",
    phaseName: "Month 2-3: Deep Integration",
    phaseOrder: 4,
    dueByDay: 90,
    tasks: [
      { id: "ob_21", title: "60-Day Manager Review", description: "Performance assessment, skill development feedback", assignee: "manager", dueDay: 60, mandatory: true, completed: false, category: "Check-in" },
      { id: "ob_22", title: "Knowledge Sharing Session", description: "Present a tech talk or share learnings with the team", assignee: "self", dueDay: 60, mandatory: false, completed: false, category: "Team" },
      { id: "ob_23", title: "Set Quarterly Performance Goals", description: "Define OKRs and key results for first full quarter", assignee: "self", dueDay: 75, mandatory: true, completed: false, category: "Performance" },
      { id: "ob_24", title: "90-Day Probation Review", description: "Final probation assessment, confirmation recommendation", assignee: "manager", dueDay: 90, mandatory: true, completed: false, category: "Check-in" },
      { id: "ob_25", title: "HR Probation Review & Confirmation", description: "Formal probation completion, confirmation letter", assignee: "hr", dueDay: 90, mandatory: true, completed: false, category: "HR" },
    ],
  },
];

// ─── Offboarding Templates ───────────────────────────────────

export const OFFBOARDING_TEMPLATE: OffboardingChecklist[] = [
  {
    step: 1,
    stepName: "Resignation & Acceptance",
    tasks: [
      { id: "off_01", title: "Resignation letter received", completed: false, assignee: "HR" },
      { id: "off_02", title: "Manager acknowledgment", completed: false, assignee: "Manager" },
      { id: "off_03", title: "Notice period confirmed", completed: false, assignee: "HR" },
      { id: "off_04", title: "Last working day finalized", completed: false, assignee: "HR" },
    ],
    assignee: "HR",
    completed: false,
  },
  {
    step: 2,
    stepName: "Knowledge Transfer",
    tasks: [
      { id: "off_05", title: "KT plan created", completed: false, assignee: "Manager" },
      { id: "off_06", title: "Documentation handover", completed: false, assignee: "Employee" },
      { id: "off_07", title: "Project transition completed", completed: false, assignee: "Manager" },
      { id: "off_08", title: "Client handoff (if applicable)", completed: false, assignee: "Manager" },
    ],
    assignee: "Manager",
    completed: false,
  },
  {
    step: 3,
    stepName: "IT Asset & Access Revocation",
    tasks: [
      { id: "off_09", title: "Laptop returned", completed: false, assignee: "IT" },
      { id: "off_10", title: "ID card & access badge returned", completed: false, assignee: "Admin" },
      { id: "off_11", title: "Email account deactivated", completed: false, assignee: "IT" },
      { id: "off_12", title: "VPN & system access revoked", completed: false, assignee: "IT" },
      { id: "off_13", title: "Software licenses reclaimed", completed: false, assignee: "IT" },
    ],
    assignee: "IT",
    completed: false,
  },
  {
    step: 4,
    stepName: "Financial Clearance",
    tasks: [
      { id: "off_14", title: "Pending expenses cleared", completed: false, assignee: "Finance" },
      { id: "off_15", title: "Loan recovery processed", completed: false, assignee: "Finance" },
      { id: "off_16", title: "No-dues certificate from all departments", completed: false, assignee: "HR" },
      { id: "off_17", title: "Final salary processed", completed: false, assignee: "Finance" },
    ],
    assignee: "Finance",
    completed: false,
  },
  {
    step: 5,
    stepName: "Exit Interview & Documentation",
    tasks: [
      { id: "off_18", title: "Exit interview conducted", completed: false, assignee: "HR" },
      { id: "off_19", title: "Exit survey completed", completed: false, assignee: "Employee" },
      { id: "off_20", title: "Experience letter generated", completed: false, assignee: "HR" },
      { id: "off_21", title: "Relieving letter generated", completed: false, assignee: "HR" },
    ],
    assignee: "HR",
    completed: false,
  },
  {
    step: 6,
    stepName: "Full & Final Settlement",
    tasks: [
      { id: "off_22", title: "Settlement calculated", completed: false, assignee: "Finance" },
      { id: "off_23", title: "Settlement approved by manager", completed: false, assignee: "Manager" },
      { id: "off_24", title: "Settlement approved by HR", completed: false, assignee: "HR" },
      { id: "off_25", title: "Final payment processed", completed: false, assignee: "Finance" },
      { id: "off_26", title: "Form 16 / tax documents shared", completed: false, assignee: "Finance" },
      { id: "off_27", title: "PF transfer details shared", completed: false, assignee: "Finance" },
    ],
    assignee: "Finance",
    completed: false,
  },
];

// ─── Settlement Calculator ───────────────────────────────────
//
// This used to be a self-contained calculator: no proration (a full month
// was paid out no matter which day of the month someone left on — leaving on
// the 2nd and leaving on the 28th earned the same basic pay), notice pay and
// notice recovery computed from the same shortfall and so always cancelling
// out (nobody was ever actually recovered from, nor actually paid in lieu),
// and a final `Math.max(0, netSettlement)` that wrote off any debt an
// employee owed the company by quietly floor-ing it to zero. None of that
// was exercised by anything — `calculateSettlement` had no callers anywhere
// in this codebase — so it went unnoticed.
//
// `settlement.ts` already solves all three problems correctly (proration,
// independent notice recovery, an unclamped signed net) and is unit-tested
// on its own. Rather than re-solve them here a second time with a second
// chance to get them wrong, this function is now a thin rupee-facing
// wrapper: it works out the final month's proration, converts rupees to the
// paise (`Minor`) that `computeSettlement` deals in, and converts the result
// back. The only genuine logic left in this file is proration itself.

/**
 * Number of calendar days in a given month.
 *
 * `new Date(year, month, 0).getDate()` would do this in one line, but every
 * other date computation touching payroll in this codebase (see
 * `monthsBetween` in statutory-india.ts) deliberately avoids round-tripping
 * through `Date` — a runtime timezone or a DST boundary can shift a
 * constructed `Date` by a day, and a day shifted here changes what somebody
 * is paid. An explicit table with an explicit leap-year rule cannot do that.
 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return [1, 3, 5, 7, 8, 10, 12].includes(month) ? 31 : 30;
}

/**
 * Whole calendar days from `from` up to `to`.
 *
 * Written as a bounded day-by-day walk rather than a closed-form
 * (Julian-day / civil-from-days) formula, for the same reason
 * `monthsBetween` in statutory-india.ts is a loop over months rather than an
 * epoch subtraction: HR date ranges span at most a few years, so the loop
 * costs nothing, and every step of it can be checked by a human against a
 * calendar. A closed-form formula that is off by one is off by one silently
 * forever; a loop that is wrong is wrong in a way a single printed month
 * will show.
 *
 * Signed and not clamped to zero: a `to` before `from` returns a negative
 * number rather than reading as zero, so a resignation whose agreed last
 * working day is somehow before it was submitted — a data-entry mistake, not
 * a valid state — surfaces as a visibly wrong number instead of silently
 * being treated as "notice fully served".
 */
export function daysBetween(from: string, to: string): number {
  const parse = (value: string): [number, number, number] => {
    const parts = value.split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
      throw new Error("Dates must be YYYY-MM-DD");
    }
    return [parts[0], parts[1], parts[2]];
  };

  parse(from);
  parse(to);
  const reversed = to < from;
  let [y, m, d] = parse(reversed ? to : from);
  const stop = reversed ? from : to;

  const iso = (yy: number, mm: number, dd: number) =>
    `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;

  let count = 0;
  while (iso(y, m, d) < stop) {
    d += 1;
    if (d > daysInMonth(y, m)) {
      d = 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    count += 1;
  }
  return reversed ? -count : count;
}

export interface FinalMonthProration {
  year: number;
  month: number;
  daysInMonth: number;
  /** The first payable day of the final month — day 1, unless join and exit fall in the same month. */
  startDay: number;
  daysWorked: number;
}

/**
 * How many of the final month's calendar days are payable.
 *
 * The default assumption is that whoever is leaving was on the payroll for
 * the whole month up to the exit date, so counting starts at day 1 — this is
 * the actual proration risk the rest of the settlement depends on: someone
 * who leaves on the 12th is owed 12 days, someone who leaves on the 30th is
 * owed the whole month, and someone whose "last working day" was itself a
 * non-working day (a Sunday, a holiday) is still owed pay up to and
 * including it, because the settlement counts calendar days elapsed, not
 * days actually worked at a desk.
 *
 * The one case that breaks the "counting starts at day 1" assumption is
 * somebody who joins and leaves inside the same calendar month — counting
 * from day 1 would pay them for days before they were ever employed here.
 * That is the only reason `joinDate` is a parameter at all.
 */
export function finalMonthProration(joinDate: string, exitDate: string): FinalMonthProration {
  const exitParts = exitDate.split("-").map(Number);
  const joinParts = joinDate.split("-").map(Number);
  if (exitParts.length !== 3 || joinParts.length !== 3 || [...exitParts, ...joinParts].some((n) => Number.isNaN(n))) {
    throw new Error("Dates must be YYYY-MM-DD");
  }
  const [exitYear, exitMonth, exitDay] = exitParts;
  const [joinYear, joinMonth, joinDay] = joinParts;

  const totalDays = daysInMonth(exitYear, exitMonth);
  const sameMonthJoin = joinYear === exitYear && joinMonth === exitMonth;
  const startDay = sameMonthJoin ? joinDay : 1;
  const daysWorked = Math.max(0, Math.min(exitDay, totalDays) - startDay + 1);

  return { year: exitYear, month: exitMonth, daysInMonth: totalDays, startDay, daysWorked };
}

const toMinor = (rupees: number): Minor => BigInt(Math.round(rupees * 100));
const fromMinor = (minor: Minor): number => Number(minor) / 100;
const toMinorOrUndefined = (rupees: number | undefined): Minor | undefined =>
  rupees === undefined ? undefined : toMinor(rupees);

export interface SettlementCalculationInput {
  joinDate: string;
  /** Last day of employment — the agreed last working day, once one exists. */
  exitDate: string;
  reason: ExitReason;

  /** Last drawn monthly figures, in rupees. */
  monthlyBasicPay: number;
  monthlyGrossPay: number;

  /** Notice, in days, from policy — see offboarding-resignation.ts for how this is worked out. */
  noticePeriodDays: number;
  noticeServedDays: number;
  /** The shortfall was forgiven rather than recovered — this codebase's stand-in for "paid in lieu"; see the module note in offboarding-exit.ts. */
  noticeWaived?: boolean;

  encashableLeaveDays: number;
  leaveEncashmentBasis: DayBasis;
  noticeRecoveryOnGross?: boolean;

  /** Everything below is optional and defaults to nothing owed either way. */
  outstandingLoan?: number;
  unreturnedAsset?: number;
  otherRecovery?: number;
  pendingReimbursement?: number;
  bonusPayable?: number;
  professionalTax?: number;
  tds?: number;
  gratuityCeiling?: number;
}

/**
 * Full and final settlement, in rupees.
 *
 * Delegates every rupee of arithmetic to `computeSettlement` in
 * settlement.ts, which is the tested, signed-net, no-magic-clamping engine —
 * this function's only job is proration (working out how many of the final
 * month's days are payable, which `computeSettlement` needs but does not
 * compute itself) and the rupee ⇄ paise conversion at the boundary.
 */
export function calculateSettlement(input: SettlementCalculationInput): SettlementComponents {
  const proration = finalMonthProration(input.joinDate, input.exitDate);

  const settlement = computeSettlement({
    joinDate: input.joinDate,
    exitDate: input.exitDate,
    reason: input.reason,
    monthlyBasicPlusDaMinor: toMinor(input.monthlyBasicPay),
    monthlyGrossMinor: toMinor(input.monthlyGrossPay),
    daysWorkedInFinalMonth: proration.daysWorked,
    daysInFinalMonth: proration.daysInMonth,
    noticePeriodDays: input.noticePeriodDays,
    noticeServedDays: input.noticeServedDays,
    noticeWaived: input.noticeWaived,
    encashableLeaveDays: input.encashableLeaveDays,
    leaveEncashmentBasis: input.leaveEncashmentBasis,
    noticeRecoveryOnGross: input.noticeRecoveryOnGross,
    outstandingLoanMinor: toMinorOrUndefined(input.outstandingLoan),
    unreturnedAssetMinor: toMinorOrUndefined(input.unreturnedAsset),
    otherRecoveryMinor: toMinorOrUndefined(input.otherRecovery),
    pendingReimbursementMinor: toMinorOrUndefined(input.pendingReimbursement),
    bonusPayableMinor: toMinorOrUndefined(input.bonusPayable),
    professionalTaxMinor: toMinorOrUndefined(input.professionalTax),
    tdsMinor: toMinorOrUndefined(input.tds),
    gratuityCeilingMinor: toMinorOrUndefined(input.gratuityCeiling),
  });

  const finalSalaryLine = settlement.earnings.find((line) => line.code === "final_salary");

  return {
    daysInFinalMonth: proration.daysInMonth,
    daysWorkedInFinalMonth: proration.daysWorked,
    proratedFinalSalary: finalSalaryLine ? fromMinor(finalSalaryLine.amountMinor) : 0,
    earnings: settlement.earnings.map((line) => ({
      code: line.code, label: line.label, amount: fromMinor(line.amountMinor), note: line.note,
    })),
    deductions: settlement.deductions.map((line) => ({
      code: line.code, label: line.label, amount: fromMinor(line.amountMinor), note: line.note,
    })),
    totalEarnings: fromMinor(settlement.totalEarningsMinor),
    totalDeductions: fromMinor(settlement.totalDeductionsMinor),
    netSettlement: fromMinor(settlement.netPayableMinor),
    employeeOwes: settlement.employeeOwes,
    gratuityYearsOfService: settlement.gratuity.yearsOfService,
    gratuityEligible: settlement.gratuity.isEligible,
    notes: settlement.notes,
  };
}

// ─── Lifecycle Helpers ───────────────────────────────────────

export function getLifecycleStageConfig(stage: LifecycleStage): {
  label: string;
  color: string;
  icon: string;
  description: string;
} {
  const configs: Record<LifecycleStage, { label: string; color: string; icon: string; description: string }> = {
    candidate: { label: "Candidate", color: "bg-gray-100 text-gray-700", icon: "👤", description: "Application under review" },
    offered: { label: "Offered", color: "bg-blue-100 text-blue-700", icon: "📧", description: "Offer letter sent" },
    pre_boarding: { label: "Pre-boarding", color: "bg-cyan-100 text-cyan-700", icon: "📋", description: "Pre-joining preparations" },
    onboarding: { label: "Onboarding", color: "bg-violet-100 text-violet-700", icon: "🎓", description: "Induction in progress" },
    probation: { label: "Probation", color: "bg-amber-100 text-amber-700", icon: "⏳", description: "Probation period" },
    confirmed: { label: "Confirmed", color: "bg-emerald-100 text-emerald-700", icon: "✅", description: "Probation completed" },
    active: { label: "Active", color: "bg-green-100 text-green-700", icon: "🟢", description: "Full-time active employee" },
    promoted: { label: "Promoted", color: "bg-purple-100 text-purple-700", icon: "⬆️", description: "Recently promoted" },
    transferred: { label: "Transferred", color: "bg-indigo-100 text-indigo-700", icon: "🔄", description: "Department/location transfer" },
    on_sabbatical: { label: "Sabbatical", color: "bg-teal-100 text-teal-700", icon: "🏖️", description: "On extended leave" },
    notice_period: { label: "Notice Period", color: "bg-orange-100 text-orange-700", icon: "⚠️", description: "Serving notice" },
    offboarding: { label: "Offboarding", color: "bg-red-100 text-red-700", icon: "📤", description: "Exit process in progress" },
    exited: { label: "Exited", color: "bg-gray-100 text-gray-500", icon: "👋", description: "Left the organization" },
    alumni: { label: "Alumni", color: "bg-sky-100 text-sky-700", icon: "🎓", description: "Part of alumni network" },
  };
  return configs[stage] || configs.active;
}

export function getOnboardingProgress(checklist: OnboardingChecklist[]): {
  totalTasks: number;
  completedTasks: number;
  percentage: number;
  currentPhase: string;
  phaseProgress: Array<{ phase: string; completed: number; total: number; percentage: number }>;
} {
  const allTasks = checklist.flatMap(c => c.tasks);
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter(t => t.completed).length;
  const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Find current phase (first incomplete phase)
  const currentPhase = checklist.find(c => c.tasks.some(t => !t.completed))?.phaseName || "Complete";

  const phaseProgress = checklist.map(c => ({
    phase: c.phaseName,
    completed: c.tasks.filter(t => t.completed).length,
    total: c.tasks.length,
    percentage: c.tasks.length > 0 ? Math.round((c.tasks.filter(t => t.completed).length / c.tasks.length) * 100) : 0,
  }));

  return { totalTasks, completedTasks, percentage, currentPhase, phaseProgress };
}

export function getOffboardingProgress(checklist: OffboardingChecklist[]): {
  totalSteps: number;
  completedSteps: number;
  totalTasks: number;
  completedTasks: number;
  percentage: number;
  currentStep: string;
} {
  const allTasks = checklist.flatMap(c => c.tasks);
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter(t => t.completed).length;
  const totalSteps = checklist.length;
  const completedSteps = checklist.filter(c => c.tasks.every(t => t.completed)).length;
  const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const currentStep = checklist.find(c => c.tasks.some(t => !t.completed))?.stepName || "Complete";

  return { totalSteps, completedSteps, totalTasks, completedTasks, percentage, currentStep };
}

// ─── Indian Tax Helpers ──────────────────────────────────────

export function calculateIncomeTax(annualIncome: number, regime: "old" | "new" = "new"): {
  taxableIncome: number;
  tax: number;
  cess: number;
  totalTax: number;
  effectiveRate: number;
  slabBreakdown: Array<{ slab: string; rate: number; tax: number }>;
} {
  if (regime === "new") {
    return calculateNewRegimeTax(annualIncome);
  }
  return calculateOldRegimeTax(annualIncome);
}

function calculateNewRegimeTax(income: number) {
  const standardDeduction = 75000;
  const taxableIncome = Math.max(0, income - standardDeduction);
  
  const slabs = [
    { limit: 400000, rate: 0 },
    { limit: 800000, rate: 5 },
    { limit: 1200000, rate: 10 },
    { limit: 1600000, rate: 15 },
    { limit: 2000000, rate: 20 },
    { limit: 2400000, rate: 25 },
    { limit: Infinity, rate: 30 },
  ];

  let tax = 0;
  let remaining = taxableIncome;
  let prevLimit = 0;
  const slabBreakdown: Array<{ slab: string; rate: number; tax: number }> = [];

  for (const slab of slabs) {
    const slabAmount = Math.min(remaining, slab.limit - prevLimit);
    if (slabAmount <= 0) break;
    const slabTax = Math.round(slabAmount * slab.rate / 100);
    tax += slabTax;
    remaining -= slabAmount;
    slabBreakdown.push({
      slab: `₹${(prevLimit / 100000).toFixed(1)}L - ₹${slab.limit === Infinity ? "∞" : (slab.limit / 100000).toFixed(1) + "L"}`,
      rate: slab.rate,
      tax: slabTax,
    });
    prevLimit = slab.limit;
  }

  // Section 87A rebate
  if (taxableIncome <= 700000) tax = 0;

  const cess = Math.round(tax * 0.04);
  const totalTax = tax + cess;
  const effectiveRate = income > 0 ? Math.round((totalTax / income) * 1000) / 10 : 0;

  return { taxableIncome, tax, cess, totalTax, effectiveRate, slabBreakdown };
}

function calculateOldRegimeTax(income: number) {
  const standardDeduction = 50000;
  const taxableIncome = Math.max(0, income - standardDeduction);

  const slabs = [
    { limit: 250000, rate: 0 },
    { limit: 500000, rate: 5 },
    { limit: 1000000, rate: 20 },
    { limit: Infinity, rate: 30 },
  ];

  let tax = 0;
  let remaining = taxableIncome;
  let prevLimit = 0;
  const slabBreakdown: Array<{ slab: string; rate: number; tax: number }> = [];

  for (const slab of slabs) {
    const slabAmount = Math.min(remaining, slab.limit - prevLimit);
    if (slabAmount <= 0) break;
    const slabTax = Math.round(slabAmount * slab.rate / 100);
    tax += slabTax;
    remaining -= slabAmount;
    slabBreakdown.push({
      slab: `₹${(prevLimit / 100000).toFixed(1)}L - ₹${slab.limit === Infinity ? "∞" : (slab.limit / 100000).toFixed(1) + "L"}`,
      rate: slab.rate,
      tax: slabTax,
    });
    prevLimit = slab.limit;
  }

  // Section 87A rebate
  if (taxableIncome <= 500000) tax = 0;

  const cess = Math.round(tax * 0.04);
  const totalTax = tax + cess;
  const effectiveRate = income > 0 ? Math.round((totalTax / income) * 1000) / 10 : 0;

  return { taxableIncome, tax, cess, totalTax, effectiveRate, slabBreakdown };
}

export function calculateSalaryBreakdown(ctc: number) {
  const monthly = {
    basic: Math.round(ctc * 0.40 / 12),
    hra: Math.round(ctc * 0.20 / 12),
    specialAllowance: Math.round(ctc * 0.18 / 12),
    otherAllowances: Math.round(ctc * 0.02 / 12),
  };
  const gross = monthly.basic + monthly.hra + monthly.specialAllowance + monthly.otherAllowances;

  const deductions = {
    pf: Math.min(Math.round(monthly.basic * 0.12), 1800),
    professionalTax: 200,
    incomeTax: 0, // Computed separately
  };

  const employer = {
    pf: Math.min(Math.round(monthly.basic * 0.12), 1800),
    gratuity: Math.round(monthly.basic * 0.0481),
    insurance: Math.round(ctc * 0.015 / 12),
  };

  return { monthly, gross, deductions, employer, ctc, annualGross: gross * 12 };
}
