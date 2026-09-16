import { canAccessModule, type Role } from "@/lib/rbac";

// Portals select an experience, never an organization or a permission grant.
export const HRMS_PORTALS = {
  hrms: { name: "HRMS administration", host: "hrms.circuvent.com", description: "Your complete people operations workspace." },
  employee: { name: "Employee portal", host: "employee.circuvent.com", description: "Your working day, documents and benefits in one place." },
  intern: { name: "Intern portal", host: "intern.circuvent.com", description: "Track your time, build your skills and stay connected to your team." },
  hr: { name: "HR portal", host: "hr.circuvent.com", description: "Manage the employee journey, from onboarding to payroll." },
  manager: { name: "Manager portal", host: "manager.circuvent.com", description: "Support your team, review requests and track performance." },
} as const;
export type HrmsPortal = keyof typeof HRMS_PORTALS;
export const PORTAL_HEADER = "x-hrms-portal";

export function portalForHost(host: string, development = false): HrmsPortal {
  const hostname = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  for (const [id, portal] of Object.entries(HRMS_PORTALS)) {
    if (hostname === portal.host || (development && hostname === `${id}.localhost`)) return id as HrmsPortal;
  }
  return "hrms";
}

export function normalizeHrmsRole(role: string): Role | null {
  if (role === "owner") return "admin";
  return ["admin", "hr", "manager", "employee"].includes(role) ? role as Role : null;
}

export function canEnterPortal(portal: HrmsPortal, role: string): boolean {
  const normalized = normalizeHrmsRole(role);
  if (!normalized) return false;
  if (portal === "hr") return normalized === "admin" || normalized === "hr";
  if (portal === "manager") return ["admin", "hr", "manager"].includes(normalized);
  return true;
}

export function canEnterInternPortal(role: string, employmentType: string | null | undefined): boolean {
  return ["owner", "admin", "hr"].includes(role) || (canEnterPortal("intern", role) && employmentType === "intern");
}

const PERSONAL = ["workspace", "dashboard", "selfservice", "myprofile", "profile", "attendance", "leave", "payslip", "mydocuments", "documents", "mybenefits", "benefits", "bankdetails", "tax", "expenses", "holidays", "training", "lms", "performance", "goals", "timesheets", "announcements", "teams", "directory", "orgchart", "policies", "helpdesk", "itrequests", "notifications", "settings", "resignation", "overtime", "wfh", "travel", "loans", "surveys", "feedback", "knowledgebase", "wellness", "celebrations", "badges", "meetings", "referrals", "incidents", "culturehub", "wall", "journey"];
const INTERN = PERSONAL.filter(id => !["loans", "tax", "benefits", "mybenefits", "wellness", "referrals"].includes(id));
const MANAGER = [...PERSONAL, "employees", "departments", "reports", "analytics", "awards"];

export function portalAllowsModule(portal: HrmsPortal, moduleId: string, role: string): boolean {
  const normalized = normalizeHrmsRole(role);
  if (!normalized || !canEnterPortal(portal, role)) return false;
  if (moduleId === "workspace") return true;
  if (!canAccessModule(normalized, moduleId)) return false;
  if (portal === "hrms") return true;
  // Cap the surface by the portal's audience, even when an admin previews it.
  if (portal === "hr") return canAccessModule("hr", moduleId);
  const modules = portal === "employee" ? PERSONAL : portal === "intern" ? INTERN : MANAGER;
  return modules.includes(moduleId);
}

export function portalHome(portal: HrmsPortal): string { return portal === "hrms" ? "/dashboard" : "/workspace"; }
export function safePortalPath(raw: string | null | undefined, fallback = "/workspace"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}

/** Exact configured portal origins only; never trust X-Forwarded-Host. */
export function rolePortalOrigin(url: string): string | null {
  const parsed = new URL(url);
  const portal = portalForHost(parsed.hostname, process.env.NODE_ENV !== "production");
  if (portal === "hrms") return null;
  if (parsed.protocol === "https:" && parsed.port === "" && parsed.hostname === HRMS_PORTALS[portal].host) return parsed.origin;
  if (process.env.NODE_ENV !== "production" && parsed.protocol === "http:" && parsed.hostname === `${portal}.localhost`) return parsed.origin;
  return null;
}

/** Next dev may expose its bind address in req.url; Host carries the selected virtual host. */
export function requestPortalOrigin(request: Request): string | null {
  const host = request.headers.get("host");
  if (!host) return rolePortalOrigin(request.url);
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return null;
  const protocol = process.env.NODE_ENV === "production" ? "https:" : new URL(request.url).protocol;
  return rolePortalOrigin(`${protocol}//${host}`);
}
