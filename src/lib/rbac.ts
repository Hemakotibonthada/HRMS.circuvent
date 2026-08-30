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
  // Separate from offboarding.view/manage even though they end at the same
  // checklist: offboarding.* is HR running the exit, resignation.* is the
  // employee-facing act of submitting one and a manager's ability to accept
  // a direct report's. An employee who can see their own resignation must
  // not thereby see the whole company's offboarding queue, and the split
  // mirrors leave.view/leave.apply vs leave.approve/leave.view_all exactly.
  | "resignation.view" | "resignation.apply" | "resignation.approve" | "resignation.view_all"
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
  // Separate from employees.* even though interns are rows in the same
  // table: employees.edit lets a manager fix a typo in someone's
  // designation, but converting an intern draws a new CV- code, changes
  // employmentType and fires a completion certificate — an action, not an
  // edit, so it gets its own permission the way offboarding.manage does
  // rather than piggybacking on employees.edit.
  | "interns.view" | "interns.manage"
  | "benefits.view" | "benefits.enroll"
  | "incidents.view" | "incidents.report" | "incidents.manage"
  | "goals.view" | "goals.create"
  | "timesheets.view" | "timesheets.log"
  | "letters.view" | "letters.generate"
  // Editing the templates letters/documents are generated from is a bigger
  // blast radius than generating one letter from an existing template — an
  // offer letter template mistake reaches every candidate offered after it,
  // not one. Deliberately its own permission, owner/admin/hr only, not
  // folded into letters.generate.
  | "templates.manage"
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
  "resignation.view", "resignation.apply", "resignation.approve", "resignation.view_all",
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
  "interns.view", "interns.manage",
  "benefits.view", "benefits.enroll",
  "incidents.view", "incidents.report", "incidents.manage",
  "goals.view", "goals.create",
  "timesheets.view", "timesheets.log",
  "letters.view", "letters.generate",
  "templates.manage",
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
  "resignation.view", "resignation.apply", "resignation.approve", "resignation.view_all",
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
  "interns.view", "interns.manage",
  "benefits.view", "benefits.enroll",
  "incidents.view", "incidents.report", "incidents.manage",
  "goals.view", "goals.create",
  "timesheets.view", "timesheets.log",
  "letters.view", "letters.generate",
  "templates.manage",
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
  "resignation.view", "resignation.apply",
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
  "resignation.approve", "resignation.view_all",
  "expenses.approve", "expenses.view_all",
  "performance.view", "performance.manage",
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
  // Gates the employee-facing "submit your resignation" page — distinct
  // from the `offboarding` entry above, which gates HR's exit-processing
  // view. Added in the same change that defines resignation.view so the
  // module/permission pair can never ship half-wired the way bankdetails
  // and benefits once did (see the comments on those two below).
  resignation: "resignation.view",
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
  interns: "interns.view",
  benefits: "benefits.view",
  incidents: "incidents.view",
  goals: "goals.view",
  timesheets: "timesheets.view",
  letters: "letters.view",
  // Paired with the permission in the same change that adds it: this repo
  // has shipped a permission with no MODULE_PERMISSION_MAP entry before
  // (see the bankdetails comment below) and the module was reachable only
  // by typing the URL directly. Adding one without the other reproduces
  // that bug a third time.
  templates: "templates.manage",
  competency: "competency.view",
  pip: "pip.view",
  engagement: "engagement.view",
  integrations: "integrations.view",
  locations: "locations.view",
  itrequests: "itrequests.view",
  parking: "parking.view",
  badges: "badges.view",
  hrcalendar: "dashboard.view",
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
  // No dedicated bankdetails.* permission exists, and none is needed: every
  // employee already has dashboard.view, and the route behind this page does
  // its own, stricter self-vs-other check (canWriteBankDetails /
  // canViewOthersBankDetails) rather than relying on a module permission to
  // scope who sees whose bank account. Without this entry the page would be
  // unreachable by anyone but an admin — MODULE_PERMISSION_MAP has no
  // wildcard, so an absent key fails closed in canAccessModule below.
  bankdetails: "dashboard.view",
  // Same reasoning as bankdetails above, and the same trap: an employee's own
  // letters and pay changes. Every employee has dashboard.view, and the route
  // behind the page (`/api/me/documents`) scopes strictly to the caller's own
  // employee record rather than trusting a module permission to do it.
  //
  // This page shipped without an entry and was therefore reachable only by an
  // admin — the one role that does not need it. The test below now walks the
  // route directory so the next page cannot repeat it.
  mydocuments: "dashboard.view",
  // An employee's own benefits enrolments. Found by the route-coverage test
  // below with no entry at all, which meant Self Service linked every
  // employee to a page that bounced them back to the dashboard. The
  // `/api/benefits/*` routes behind it already scope to the caller's own
  // record through `currentEmployeeId`.
  mybenefits: "dashboard.view",
  // The admin console. It was relying on the absent-key fallback to stay
  // admin-only, which produced the right outcome for the wrong reason —
  // indistinguishable from a page somebody forgot to map, which is precisely
  // what the two entries above turned out to be.
  //
  // Gated on `settings.manage`, not `settings.view`: employees and managers
  // both hold `settings.view` (they can open their own settings), so mapping
  // it there would have handed the admin console to everybody. Making the
  // fallback explicit is only an improvement if the permission chosen is
  // actually the restrictive one.
  admin: "settings.manage",
  calculator: "dashboard.view",
  vault: "documents.view",
  chatbot: "dashboard.view",
  selfservice: "dashboard.view",
  dataimport: "settings.view",
  notifications: "dashboard.view",
  "security-incidents": "audit.view",
  "security-devices": "assets.view",
  "security/incidents": "audit.view",
  "security/devices": "assets.view",
};

// ─── HELPER FUNCTIONS ────────────────────────────────────────

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * A role as the API layer sees it, which has an `owner` above `admin`.
 *
 * `ROLE_PERMISSIONS` has no `owner` entry, so passing one to `hasPermission`
 * silently returns false and denies the most privileged account in the
 * organization. Anything checking a permission against `ApiContext.role` must
 * come through here.
 */
export type PrivilegedRole = Role | "owner";

/** Permission check for an API-layer role. `owner` is never less than `admin`. */
export function roleHasPermission(role: PrivilegedRole, permission: Permission): boolean {
  return hasPermission(role === "owner" ? "admin" : role, permission);
}

/**
 * Whether this role may see another person's pay.
 *
 * Salary is the most sensitive field in the product and the permission model
 * withholds it from managers deliberately — a reporting line is not authority
 * to see someone's pay. Expressed as one function so that decision lives in a
 * single place rather than being re-derived as a role array at each route,
 * which is how `/api/employees` came to hand a manager the whole directory's
 * compensation while `/api/employees/[id]/direct-reports` stripped it.
 */
export function canViewOthersSalary(role: PrivilegedRole): boolean {
  return roleHasPermission(role, "payroll.view");
}

/**
 * Whether this role may see another employee's bank account and statutory
 * IDs.
 *
 * Reuses `payroll.view` rather than adding a bank-details-specific
 * permission: anyone trusted to see another person's salary figure is
 * already trusted with the account it is paid into, and a second permission
 * that always happens to be granted alongside the first would just be a
 * permission nobody could ever set differently from `payroll.view` — a
 * distinction with no behaviour behind it. This governs *reads* only; there
 * is no equivalent for writes; see `canWriteBankDetails` in
 * `lib/bank-details-rules.ts`, which every role fails except the account's
 * own owner.
 */
export function canViewOthersBankDetails(role: PrivilegedRole): boolean {
  return roleHasPermission(role, "payroll.view");
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
