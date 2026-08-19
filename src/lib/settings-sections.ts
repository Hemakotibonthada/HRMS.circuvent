// ═══════════════════════════════════════════════════════════════
// SETTINGS SECTIONS
// ═══════════════════════════════════════════════════════════════
// Which panels a person may open. Two audiences share the /settings route: an
// administrator configuring the organisation, and everyone else adjusting
// their own preferences.
//
// This lives outside the page so the rule is testable. It previously existed
// only as a hardcoded array rendered unconditionally, so an employee opening
// Settings saw company details, the org-wide security policy, the role matrix,
// data retention and billing — all of it looking editable.

import {
  Bell,
  Building2,
  CreditCard,
  Database,
  Key,
  Settings,
  Shield,
  Webhook,
  Zap,
} from "lucide-react";

export interface SettingSection {
  id: string;
  label: string;
  icon: typeof Settings;
  description: string;
  /** Requires `settings.manage`, which only an administrator holds. */
  adminOnly: boolean;
}

export const SETTING_SECTIONS: SettingSection[] = [
  {
    id: "organization",
    label: "Organization",
    icon: Building2,
    description: "Company details, branding, and regional settings",
    adminOnly: true,
  },
  {
    id: "security",
    label: "Security",
    icon: Shield,
    description: "Your sign-in and two-factor settings",
    adminOnly: false,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    description: "Email, push, and in-app notification preferences",
    adminOnly: false,
  },
  { id: "modules", label: "Modules", icon: Zap, description: "Enable/disable HRMS modules and features", adminOnly: true },
  { id: "roles", label: "Roles & Permissions", icon: Key, description: "Role definitions and permission matrix", adminOnly: true },
  { id: "data", label: "Data Management", icon: Database, description: "Backup, export, retention, and cleanup", adminOnly: true },
  { id: "integrations", label: "Integrations", icon: Webhook, description: "Third-party service connections and APIs", adminOnly: true },
  { id: "billing", label: "Billing", icon: CreditCard, description: "Subscription, invoices, and payment methods", adminOnly: true },
];

/** The sections a caller may see, given whether they hold `settings.manage`. */
export function visibleSections(canManage: boolean): SettingSection[] {
  return SETTING_SECTIONS.filter((section) => canManage || !section.adminOnly);
}

/**
 * Resolves the panel to render.
 *
 * Returned rather than corrected in an effect: an effect runs after the first
 * paint, so a non-admin would see a restricted panel flash up before it was
 * swapped out.
 */
export function resolveSection(requested: string, canManage: boolean): string {
  const allowed = visibleSections(canManage);
  return allowed.some((s) => s.id === requested) ? requested : allowed[0].id;
}
