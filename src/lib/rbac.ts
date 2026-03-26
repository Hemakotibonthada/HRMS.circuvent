// ═══════════════════════════════════════════════════════════════
// ROLE-BASED ACCESS CONTROL (RBAC) CONFIGURATION
// Defines permissions, module access, and action rights per role
// ═══════════════════════════════════════════════════════════════

export type Role = "admin" | "hr" | "manager" | "employee";

export type Permission =
  | "dashboard.view"
  | "employees.view" | "employees.create" | "employees.edit" | "employees.delete"
  | "departments.view" | "departments.manage"
  | "attendance.view" | "attendance.view_all" | "attendance.manage"
  | "leave.view" | "leave.apply" | "leave.approve" | "leave.view_all"
  | "payroll.view" | "payroll.view_own" | "payroll.process"
  | "payslip.view_own"
  | "recruitment.view" | "recruitment.manage"
  | "performance.view" | "performance.view_own" | "performance.manage"
  | "training.view" | "training.enroll" | "training.manage"
  | "onboarding.view" | "onboarding.manage"
  | "offboarding.view" | "offboarding.manage"
  | "documents.view" | "documents.upload" | "documents.manage"
  | "reports.view" | "reports.export"
  | "settings.view" | "settings.manage"
  | "billing.view" | "billing.manage"
  | "announcements.view" | "announcements.create"
  | "expenses.view" | "expenses.submit" | "expenses.approve" | "expenses.view_all"
  | "holidays.view"
  | "helpdesk.view" | "helpdesk.submit" | "helpdesk.manage"
  | "assets.view" | "assets.manage"
  | "shifts.view" | "shifts.manage"
  | "audit.view"
  | "teams.view"
  | "awards.view" | "awards.give"
  | "surveys.view" | "surveys.create" | "surveys.respond"
  | "travel.view" | "travel.apply" | "travel.approve"
  | "meetings.view" | "meetings.book"
  | "visitors.view" | "visitors.manage"
  | "referrals.view" | "referrals.submit"
  | "policies.view"
  | "overtime.view" | "overtime.log" | "overtime.approve"
  | "wfh.view" | "wfh.apply" | "wfh.approve"
  | "feedback.view" | "feedback.submit"
  | "knowledgebase.view"
  | "wellness.view" | "wellness.enroll"
  | "celebrations.view"
  | "loans.view" | "loans.apply" | "loans.manage"
  | "tax.view" | "tax.declare"
  | "directory.view"
  | "orgchart.view"
  | "compliance.view" | "compliance.manage"
  | "grievances.view" | "grievances.submit" | "grievances.manage"
  | "succession.view"
  | "workforce.view"
  | "contractors.view" | "contractors.manage"
  | "benefits.view" | "benefits.enroll"
  | "incidents.view" | "incidents.report" | "incidents.manage"
  | "goals.view" | "goals.create"
  | "timesheets.view" | "timesheets.log"
  | "letters.view" | "letters.generate"
  | "competency.view"
  | "pip.view" | "pip.manage"
  | "engagement.view"
  | "analytics.view"
  | "intelligence.view"
  | "integrations.view" | "integrations.manage"
  | "locations.view" | "locations.manage"
  | "itrequests.view" | "itrequests.submit" | "itrequests.manage"
  | "parking.view" | "parking.manage"
  | "badges.view";

// ─── ROLE → PERMISSIONS MAP ──────────────────────────────────

const ADMIN_PERMISSIONS: Permission[] = [
  // Admin has ALL permissions
  "dashboard.view",
  "employees.view", "employees.create", "employees.edit", "employees.delete",
  "departments.view", "departments.manage",
  "attendance.view", "attendance.view_all", "attendance.manage",
  "leave.view", "leave.apply", "leave.approve", "leave.view_all",
  "payroll.view", "payroll.view_own", "payroll.process",
  "payslip.view_own",
  "recruitment.view", "recruitment.manage",
  "performance.view", "performance.view_own", "performance.manage",
  "training.view", "training.enroll", "training.manage",
  "onboarding.view", "onboarding.manage",
  "offboarding.view", "offboarding.manage",
  "documents.view", "documents.upload", "documents.manage",
  "reports.view", "reports.export",
  "settings.view", "settings.manage",
  "billing.view", "billing.manage",
  "announcements.view", "announcements.create",
  "expenses.view", "expenses.submit", "expenses.approve", "expenses.view_all",
  "holidays.view",
  "helpdesk.view", "helpdesk.submit", "helpdesk.manage",
  "assets.view", "assets.manage",
  "shifts.view", "shifts.manage",
  "audit.view",
  "teams.view",
  "awards.view", "awards.give",
  "surveys.view", "surveys.create", "surveys.respond",
  "travel.view", "travel.apply", "travel.approve",
  "meetings.view", "meetings.book",
  "visitors.view", "visitors.manage",
  "referrals.view", "referrals.submit",
  "policies.view",
  "overtime.view", "overtime.log", "overtime.approve",
  "wfh.view", "wfh.apply", "wfh.approve",
  "feedback.view", "feedback.submit",
  "knowledgebase.view",
  "wellness.view", "wellness.enroll",
  "celebrations.view",
  "loans.view", "loans.apply", "loans.manage",
  "tax.view", "tax.declare",
  "directory.view",
  "orgchart.view",
  "compliance.view", "compliance.manage",
  "grievances.view", "grievances.submit", "grievances.manage",
  "succession.view",
  "workforce.view",
  "contractors.view", "contractors.manage",
  "benefits.view", "benefits.enroll",
  "incidents.view", "incidents.report", "incidents.manage",
  "goals.view", "goals.create",
  "timesheets.view", "timesheets.log",
  "letters.view", "letters.generate",
  "competency.view",
  "pip.view", "pip.manage",
  "engagement.view",
  "analytics.view",
  "intelligence.view",
  "integrations.view", "integrations.manage",
  "locations.view", "locations.manage",
  "itrequests.view", "itrequests.submit", "itrequests.manage",
  "parking.view", "parking.manage",
  "badges.view",
];

const HR_PERMISSIONS: Permission[] = [
  "dashboard.view",
  "employees.view", "employees.create", "employees.edit",
  "departments.view", "departments.manage",
  "attendance.view", "attendance.view_all", "attendance.manage",
  "leave.view", "leave.apply", "leave.approve", "leave.view_all",
  "payroll.view", "payroll.view_own", "payroll.process",
  "payslip.view_own",
  "recruitment.view", "recruitment.manage",
  "performance.view", "performance.view_own", "performance.manage",
  "training.view", "training.enroll", "training.manage",
  "onboarding.view", "onboarding.manage",
  "offboarding.view", "offboarding.manage",
  "documents.view", "documents.upload", "documents.manage",
  "reports.view", "reports.export",
  "settings.view",
  "announcements.view", "announcements.create",
  "expenses.view", "expenses.submit", "expenses.approve", "expenses.view_all",
  "holidays.view",
  "helpdesk.view", "helpdesk.submit", "helpdesk.manage",
  "assets.view",
  "shifts.view", "shifts.manage",
  "teams.view",
  "awards.view", "awards.give",
  "surveys.view", "surveys.create", "surveys.respond",
  "travel.view", "travel.apply", "travel.approve",
  "meetings.view", "meetings.book",
  "visitors.view", "visitors.manage",
  "referrals.view", "referrals.submit",
  "policies.view",
  "overtime.view", "overtime.log", "overtime.approve",
  "wfh.view", "wfh.apply", "wfh.approve",
  "feedback.view", "feedback.submit",
  "knowledgebase.view",
  "wellness.view", "wellness.enroll",
  "celebrations.view",
  "loans.view", "loans.apply", "loans.manage",
  "tax.view", "tax.declare",
  "directory.view",
  "orgchart.view",
  "compliance.view", "compliance.manage",
  "grievances.view", "grievances.submit", "grievances.manage",
  "succession.view",
  "workforce.view",
  "contractors.view",
  "benefits.view", "benefits.enroll",
  "incidents.view", "incidents.report", "incidents.manage",
  "goals.view", "goals.create",
  "timesheets.view", "timesheets.log",
  "letters.view", "letters.generate",
  "competency.view",
  "pip.view", "pip.manage",
  "engagement.view",
  "analytics.view",
  "badges.view",
  "locations.view",
  "itrequests.view", "itrequests.submit",
  "parking.view",
];

const EMPLOYEE_PERMISSIONS: Permission[] = [
  "dashboard.view",
  "attendance.view",
  "leave.view", "leave.apply",
  "payslip.view_own",
  "performance.view_own",
  "training.view", "training.enroll",
  "documents.view",
  "announcements.view",
  "expenses.view", "expenses.submit",
  "holidays.view",
  "helpdesk.view", "helpdesk.submit",
  "teams.view",
  "surveys.view", "surveys.respond",
  "travel.view", "travel.apply",
  "meetings.view", "meetings.book",
  "referrals.view", "referrals.submit",
  "policies.view",
  "overtime.view", "overtime.log",
  "wfh.view", "wfh.apply",
  "feedback.view", "feedback.submit",
  "knowledgebase.view",
  "wellness.view", "wellness.enroll",
  "celebrations.view",
  "loans.view", "loans.apply",
  "tax.view", "tax.declare",
  "directory.view",
  "orgchart.view",
  "benefits.view", "benefits.enroll",
  "incidents.view", "incidents.report",
  "goals.view", "goals.create",
  "timesheets.view", "timesheets.log",
  "badges.view",
  "settings.view",
  "itrequests.view", "itrequests.submit",
  "parking.view",
];

// Manager: employee perms + team approval + limited analytics
const MANAGER_PERMISSIONS: Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  "employees.view",
  "attendance.view_all",
  "leave.approve", "leave.view_all",
  "expenses.approve", "expenses.view_all",
  "performance.view", "performance.manage",
  "goals.create",
  "overtime.approve",
  "wfh.approve",
  "travel.approve",
  "reports.view",
  "analytics.view",
  "awards.view", "awards.give",
  "departments.view",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ADMIN_PERMISSIONS,
  hr: HR_PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  employee: EMPLOYEE_PERMISSIONS,
};

// ─── MODULE → REQUIRED PERMISSION ───────────────────────────

export const MODULE_PERMISSION_MAP: Record<string, Permission> = {
  dashboard: "dashboard.view",
  employees: "employees.view",
  departments: "departments.view",
  attendance: "attendance.view",
  attendancehub: "attendance.view",
  leave: "leave.view",
  leavehub: "leave.view",
  payroll: "payroll.view",
  payslip: "payslip.view_own",
  recruitment: "recruitment.view",
  ats: "recruitment.view",
  performance: "performance.view_own",
  performancesuite: "performance.view_own",
  reviews: "performance.view_own",
  training: "training.view",
  lms: "training.view",
  onboarding: "onboarding.view",
  onboardinghub: "onboarding.view",
  offboarding: "offboarding.view",
  documents: "documents.view",
  reports: "reports.view",
  analytics: "analytics.view",
  intelligence: "intelligence.view",
  settings: "settings.view",
  billing: "billing.view",
  announcements: "announcements.view",
  expenses: "expenses.view",
  expensehub: "expenses.view",
  holidays: "holidays.view",
  helpdesk: "helpdesk.view",
  assets: "assets.view",
  shifts: "shifts.view",
  audit: "audit.view",
  teams: "teams.view",
  awards: "awards.view",
  surveys: "surveys.view",
  travel: "travel.view",
  meetings: "meetings.view",
  visitors: "visitors.view",
  referrals: "referrals.view",
  policies: "policies.view",
  overtime: "overtime.view",
  wfh: "wfh.view",
  feedback: "feedback.view",
  knowledgebase: "knowledgebase.view",
  wellness: "wellness.view",
  celebrations: "celebrations.view",
  loans: "loans.view",
  tax: "tax.view",
  directory: "directory.view",
  orgchart: "orgchart.view",
  compliance: "compliance.view",
  compliancehub: "compliance.view",
  grievances: "grievances.view",
  succession: "succession.view",
  workforce: "workforce.view",
  contractors: "contractors.view",
  benefits: "benefits.view",
  incidents: "incidents.view",
  goals: "goals.view",
  timesheets: "timesheets.view",
  letters: "letters.view",
  competency: "competency.view",
  pip: "pip.view",
  engagement: "engagement.view",
  integrations: "integrations.view",
  locations: "locations.view",
  itrequests: "itrequests.view",
  parking: "parking.view",
  badges: "badges.view",
  hrcalendar: "dashboard.view",
  settlement: "offboarding.view",
  interviews: "recruitment.view",
  profile: "dashboard.view",
  resourceplanner: "reports.view",
  culturehub: "dashboard.view",
  workflows: "settings.view",
  wall: "dashboard.view",
  orghealth: "analytics.view",
  compensation: "payroll.view",
  provisioning: "assets.view",
  journey: "dashboard.view",
  myprofile: "dashboard.view",
  calculator: "dashboard.view",
  vault: "documents.view",
  chatbot: "dashboard.view",
  selfservice: "dashboard.view",
  dataimport: "settings.view",
  notifications: "dashboard.view",
};

// ─── HELPER FUNCTIONS ────────────────────────────────────────

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function canAccessModule(role: Role, moduleId: string): boolean {
  const requiredPermission = MODULE_PERMISSION_MAP[moduleId];
  if (!requiredPermission) {
    // Fail-closed: unknown modules require admin access
    return role === "admin";
  }
  return hasPermission(role, requiredPermission);
}

export function getRoleLabel(role: Role): string {
  const labels: Record<Role, string> = {
    admin: "Administrator",
    hr: "HR Manager",
    manager: "Team Manager",
    employee: "Employee",
  };
  return labels[role] || role;
}

export function getRoleBadgeColor(role: Role): string {
  const colors: Record<Role, string> = {
    admin: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    hr: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
    manager: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    employee: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  };
  return colors[role] || "";
}
