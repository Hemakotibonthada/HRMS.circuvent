import { MODULES, type NavItem } from "@/lib/constants";
import { portalAllowsModule, type HrmsPortal } from "@/lib/hrms-portals";

export const HRMS_FEATURE_GROUPS = [
  { id: "personal", label: "My workspace", description: "Your profile, documents and self-service", modules: ["selfservice", "myprofile", "profile", "mydocuments", "journey"] },
  { id: "people", label: "People", description: "Your organization and employee lifecycle", modules: ["employees", "departments", "teams", "directory", "orgchart", "interns", "contractors", "onboarding", "onboardinghub", "offboarding", "resignation", "workforce"] },
  { id: "time", label: "Time & leave", description: "Attendance, leave and working schedules", modules: ["attendance", "attendancehub", "leave", "leavehub", "holidays", "shifts", "timesheets", "overtime", "wfh", "hrcalendar"] },
  { id: "pay", label: "Pay & benefits", description: "Pay, expenses and employee benefits", modules: ["payslip", "payroll", "compensation", "bankdetails", "benefits", "mybenefits", "expenses", "expensehub", "loans", "tax", "travel"] },
  { id: "talent", label: "Talent & growth", description: "Hiring, learning and performance", modules: ["recruitment", "ats", "careers", "interviews", "performance", "performancesuite", "reviews", "training", "lms", "goals", "awards", "referrals", "competency", "pip", "succession"] },
  { id: "connect", label: "Connect", description: "Team news, culture and feedback", modules: ["announcements", "wall", "culturehub", "surveys", "feedback", "wellness", "celebrations", "meetings", "engagement"] },
  { id: "operations", label: "Operations", description: "Support, policies, reporting and administration", modules: ["helpdesk", "itrequests", "knowledgebase", "policies", "documents", "templates", "reports", "analytics", "orghealth", "resourceplanner", "settings", "workflows", "assets", "provisioning", "visitors", "dataimport", "admin", "billing", "audit", "security", "chatbot"] },
] as const;

export interface HrmsNavigationGroup { id: string; label: string; description: string; items: NavItem[] }
export function navigationGroups(portal: HrmsPortal, role: string): HrmsNavigationGroup[] {
  const visible = MODULES.filter(item => item.id !== "dashboard" && portalAllowsModule(portal, item.href.slice(1), role));
  const assigned = new Set<string>();
  const groups: HrmsNavigationGroup[] = HRMS_FEATURE_GROUPS.map(group => ({
    ...group,
    items: visible.filter(item => {
      if (assigned.has(item.id) || !(group.modules as readonly string[]).includes(item.href.split("/")[1])) return false;
      assigned.add(item.id);
      return true;
    }),
  })).filter(group => group.items.length > 0);
  const remaining = visible.filter(item => !assigned.has(item.id));
  if (remaining.length) groups.push({ id: "more", label: "More tools", description: "Additional workspace features", items: remaining });
  return groups;
}

export function activeNavigationGroup(groups: HrmsNavigationGroup[], pathname: string): HrmsNavigationGroup | undefined {
  const segment = pathname.split("/")[1];
  const definition = HRMS_FEATURE_GROUPS.find(group => (group.modules as readonly string[]).includes(segment));
  return groups.find(group => group.id === definition?.id || group.items.some(item => pathname === item.href || pathname.startsWith(`${item.href}/`)));
}
