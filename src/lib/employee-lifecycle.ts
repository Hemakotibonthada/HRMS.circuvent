// ═══════════════════════════════════════════════════════════════
// EMPLOYEE LIFECYCLE MANAGEMENT
// Complete lifecycle from hiring to exit — onboarding workflows,
// probation management, role transitions, and offboarding
// ═══════════════════════════════════════════════════════════════

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

export interface SettlementComponents {
  basicPay: number;
  earnedLeaveEncashment: number;
  gratuity: number;
  noticePay: number;
  bonus: number;
  deductions: {
    noticeRecovery: number;
    loanOutstanding: number;
    assetRecovery: number;
    otherDeductions: number;
  };
  totalEarnings: number;
  totalDeductions: number;
  netSettlement: number;
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

export function calculateSettlement(params: {
  basicPay: number;
  earnedLeaveBalance: number;
  yearsOfService: number;
  noticePeriodDays: number;
  noticePeriodServed: number;
  pendingLoans: number;
  assetRecovery: number;
  otherDeductions: number;
  bonusPending: number;
}): SettlementComponents {
  const {
    basicPay, earnedLeaveBalance, yearsOfService,
    noticePeriodDays, noticePeriodServed, pendingLoans,
    assetRecovery, otherDeductions, bonusPending,
  } = params;

  const dailyRate = basicPay / 30;
  
  // Earned leave encashment
  const earnedLeaveEncashment = Math.round(earnedLeaveBalance * dailyRate);
  
  // Gratuity (basic * 15 * years / 26) — eligible after 5 years
  const gratuity = yearsOfService >= 5 
    ? Math.round((basicPay * 15 * yearsOfService) / 26)
    : 0;
  
  // Notice pay (if shortfall in serving notice)
  const noticeShortfall = Math.max(0, noticePeriodDays - noticePeriodServed);
  const noticePay = Math.round(noticeShortfall * dailyRate);
  
  // Notice recovery (if employee didn't serve full notice, company can deduct)
  const noticeRecovery = noticeShortfall > 0 ? Math.round(noticeShortfall * dailyRate) : 0;
  
  const totalEarnings = basicPay + earnedLeaveEncashment + gratuity + noticePay + bonusPending;
  const totalDeductions = noticeRecovery + pendingLoans + assetRecovery + otherDeductions;
  const netSettlement = totalEarnings - totalDeductions;

  return {
    basicPay,
    earnedLeaveEncashment,
    gratuity,
    noticePay,
    bonus: bonusPending,
    deductions: {
      noticeRecovery,
      loanOutstanding: pendingLoans,
      assetRecovery,
      otherDeductions,
    },
    totalEarnings,
    totalDeductions,
    netSettlement: Math.max(0, netSettlement),
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
