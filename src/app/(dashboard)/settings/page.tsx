"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { TwoFactorSettings } from "@/components/two-factor-settings";
import { IntegrationsPanel } from "@/components/integrations-panel";
import {
  Building2, Users, Shield, Bell, Palette, Globe,
  Lock, Mail, Key, Database, Clock, Calendar, Save, RotateCcw,
  CheckCircle2, AlertTriangle, Eye, EyeOff,
  Upload, ChevronRight, Zap, Monitor, Smartphone, MessageSquare,
  HardDrive, Cloud, Webhook, FileText, CreditCard, Heart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import { visibleSections, resolveSection } from "@/lib/settings-sections";
import { ROLE_PERMISSIONS, getRoleLabel, type Role } from "@/lib/rbac";

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════
// Two audiences share this route. An administrator configures the
// organisation; everyone else adjusts their own preferences. It used to show
// the first to both — an employee opening it saw company details, the
// org-wide security policy, the role matrix, data retention and billing, all
// of it editable-looking. RBAC already draws the line (`settings.manage` is
// admin-only, `settings.view` is universal); this page simply ignored it.
//
// Which sections each audience sees lives in lib/settings-sections.ts, so the
// rule can be tested without rendering the page.


// Every module here used to carry a real-looking `enabled` flag rendered as
// a working Switch, plus a "core" flag that made some switches disabled-on.
// Nothing outside this file ever read that flag: which modules an employee
// can actually reach is decided by MODULE_PERMISSION_MAP in lib/rbac.ts, a
// role-based allow-list. So toggling "Payroll & Compensation" off here made
// it look disabled while payroll stayed fully reachable for everyone — a
// switch that lies about what it controls is worse than no switch, so this
// is now a read-only catalog of what the product includes. "compliance" is
// also gone from the list: its standalone page was fabricated (deleted from
// (dashboard)/compliance) and the one real implementation,
// (dashboard)/compliancehub, has no nav entry, so listing it as an available
// module would claim a feature nobody can currently reach.
const MODULES_LIST = [
  { id: "employees", name: "Employee Management", description: "Core employee directory and profiles" },
  { id: "attendance", name: "Attendance & Time", description: "Clock in/out, timesheets, shifts" },
  { id: "leave", name: "Leave Management", description: "Leave applications and approvals" },
  { id: "payroll", name: "Payroll & Compensation", description: "Salary processing and payslips" },
  { id: "recruitment", name: "Recruitment & ATS", description: "Job postings and candidate tracking" },
  { id: "performance", name: "Performance Management", description: "Reviews, goals, and OKRs" },
  { id: "training", name: "Training & LMS", description: "Courses, certifications, learning paths" },
  { id: "expenses", name: "Expense Management", description: "Claims, approvals, reimbursements" },
  { id: "helpdesk", name: "Helpdesk & Ticketing", description: "Employee support tickets" },
  { id: "assets", name: "Asset Management", description: "Hardware and software inventory" },
  { id: "onboarding", name: "Onboarding", description: "New hire workflows and checklists" },
  { id: "offboarding", name: "Offboarding", description: "Exit management and clearance" },
  { id: "analytics", name: "HR Analytics", description: "Workforce intelligence dashboards" },
  { id: "engagement", name: "Engagement & Culture", description: "Kudos, surveys, culture hub" },
  { id: "workflows", name: "Workflow Automation", description: "Custom approval workflows" },
  { id: "chatbot", name: "HR AI Assistant", description: "AI-powered HR chatbot" },
  { id: "documents", name: "Document Management", description: "File storage and versioning" },
];

// Names and permission counts used to be hardcoded here ("65/48/25/12
// permissions") and didn't match the real grant lists at all. They now come
// from getRoleLabel() and ROLE_PERMISSIONS[role].length in lib/rbac.ts, the
// actual compiled-in role definitions, so this can't drift from reality
// again. The "N users" figure that used to sit next to them (2/3/8/114) is
// removed rather than replaced with a real one: nothing queries employee
// counts per role today, and inventing another plausible-looking number
// would repeat the exact mistake this pass exists to fix.
const ROLES: { id: Role; color: string }[] = [
  { id: "admin", color: "from-red-500 to-orange-500" },
  { id: "hr", color: "from-violet-500 to-purple-600" },
  { id: "manager", color: "from-blue-500 to-cyan-500" },
  { id: "employee", color: "from-emerald-500 to-green-600" },
];

const GRADIENTS = ["from-violet-500 to-purple-600","from-blue-500 to-cyan-500","from-emerald-500 to-green-600","from-amber-500 to-orange-500","from-pink-500 to-rose-600","from-teal-500 to-cyan-600","from-indigo-500 to-blue-600","from-red-500 to-orange-500"];

export default function SettingsPage() {
  const { can } = useRBAC();
  const canManage = can("settings.manage");

  // Employees and managers get the two sections that are actually about them:
  // their own second factor, and their own notification preferences.
  const sections = useMemo(() => visibleSections(canManage), [canManage]);

  const [requestedSection, setRequestedSection] = useState("organization");
  const activeSection = resolveSection(requestedSection, canManage);
  const setActiveSection = setRequestedSection;

  const [showPassword, setShowPassword] = useState(false);
  // name/domain/industry/size/founded used to default to Circuvent's own
  // details ("Circuvent Technologies Pvt. Ltd.", "circuvent.com", founded
  // "2021"). This page isn't scoped to any one tenant, so every other
  // company that signed up would open Settings and see the vendor's own
  // company information sitting in the fields as if it were already
  // configured for them — worse than a missing feature, since it's actively
  // wrong for every customer but one. Left blank rather than guessing at a
  // real value: there is no organization-settings endpoint this form reads
  // from yet, so there's nothing honest to prefill these five fields with.
  // The remaining fields default to values that match this app's actual
  // schema defaults (db/schema/identity.ts), not to another company's
  // identity, so they're left as reasonable starting points.
  const [orgSettings, setOrgSettings] = useState({
    name: "", domain: "",
    industry: "", size: "", founded: "",
    timezone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY", currency: "INR",
    language: "English", fiscalYearStart: "April", workWeek: "Mon-Fri",
    workHours: "9:00 AM - 6:00 PM", probation: "90 days", notice: "60 days",
  });
  const [securitySettings, setSecuritySettings] = useState({
    twoFactor: true, sso: true, passwordExpiry: 90,
    sessionTimeout: 30, ipWhitelist: false, minPasswordLength: 8,
    lockoutAttempts: 5, auditLogging: true,
  });
  const [notifSettings, setNotifSettings] = useState({
    emailEnabled: true, pushEnabled: true, slackEnabled: true,
    digestFrequency: "daily", quietHoursEnabled: false,
    quietStart: "22:00", quietEnd: "08:00",
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {canManage ? "Organization configuration & preferences" : "Your preferences"}
          </p>
        </div>
        {canManage && (
          // Organization/Security/Notifications below are all editable, but
          // nothing ever persists them — there was no request behind this
          // button, so "All settings saved!" confirmed a write that never
          // happened. Disabled and relabelled rather than left clickable:
          // real persistence for security policy would also mean enforcing
          // it (session timeout, password rules) inside lib/auth, which is
          // out of scope here.
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 opacity-50 cursor-not-allowed" disabled title="Settings are not persisted yet"><Save className="h-4 w-4" />Save Changes (not available yet)</Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Section Navigation */}
        <Card className="h-fit">
          <CardContent className="p-2">
            {sections.map(section => (
              <button key={section.id} className={cn("flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-left transition-all", activeSection === section.id ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400" : "hover:bg-muted/50")} onClick={() => setActiveSection(section.id)}>
                <section.icon className={cn("h-4 w-4 shrink-0", activeSection === section.id ? "text-violet-600" : "text-muted-foreground")} />
                <div className="min-w-0"><p className="text-xs font-medium truncate">{section.label}</p><p className="text-[9px] text-muted-foreground truncate">{section.description}</p></div>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Settings Content */}
        <div className="space-y-6">
          {/* ─── Organization ─── */}
          {activeSection === "organization" && (
            <>
              <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-violet-500" />Company Information</CardTitle></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Company Name</Label><Input value={orgSettings.name} onChange={e => setOrgSettings(p => ({ ...p, name: e.target.value }))} placeholder="Your company's name" /></div>
                  <div className="space-y-2"><Label>Domain</Label><Input value={orgSettings.domain} onChange={e => setOrgSettings(p => ({ ...p, domain: e.target.value }))} placeholder="yourcompany.com" /></div>
                  <div className="space-y-2"><Label>Industry</Label><Select value={orgSettings.industry} onValueChange={v => setOrgSettings(p => ({ ...p, industry: v }))}><SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger><SelectContent>{["Information Technology","Finance","Healthcare","Education","Manufacturing","Retail","Consulting"].map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Company Size</Label><Select value={orgSettings.size} onValueChange={v => setOrgSettings(p => ({ ...p, size: v }))}><SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger><SelectContent>{["1-10","11-50","51-200","201-500","500+"].map(s => <SelectItem key={s} value={s}>{s} employees</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Founded</Label><Input value={orgSettings.founded} onChange={e => setOrgSettings(p => ({ ...p, founded: e.target.value }))} placeholder="e.g. 2021" /></div>
                  <div className="space-y-2"><Label>Logo</Label><div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/50"><Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" /><p className="text-[10px] text-muted-foreground">Upload company logo</p></div></div>
                </CardContent>
              </Card>
              <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4 text-blue-500" />Regional Settings</CardTitle></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Timezone</Label><Select value={orgSettings.timezone} onValueChange={v => setOrgSettings(p => ({ ...p, timezone: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Asia/Kolkata","America/New_York","Europe/London","Asia/Singapore"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Date Format</Label><Select value={orgSettings.dateFormat} onValueChange={v => setOrgSettings(p => ({ ...p, dateFormat: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["DD/MM/YYYY","MM/DD/YYYY","YYYY-MM-DD"].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Currency</Label><Select value={orgSettings.currency} onValueChange={v => setOrgSettings(p => ({ ...p, currency: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["INR","USD","EUR","GBP","SGD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Language</Label><Select value={orgSettings.language} onValueChange={v => setOrgSettings(p => ({ ...p, language: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["English","Hindi","Tamil","Telugu","Kannada"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Fiscal Year Start</Label><Select value={orgSettings.fiscalYearStart} onValueChange={v => setOrgSettings(p => ({ ...p, fiscalYearStart: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["January","April","July","October"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Work Week</Label><Select value={orgSettings.workWeek} onValueChange={v => setOrgSettings(p => ({ ...p, workWeek: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Mon-Fri","Mon-Sat","Sun-Thu","Custom"].map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent></Select></div>
                </CardContent>
              </Card>
              <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-amber-500" />Work Policies</CardTitle></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Work Hours</Label><Input value={orgSettings.workHours} onChange={e => setOrgSettings(p => ({ ...p, workHours: e.target.value }))} /></div>
                  <div className="space-y-2"><Label>Probation Period</Label><Select value={orgSettings.probation} onValueChange={v => setOrgSettings(p => ({ ...p, probation: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["30 days","60 days","90 days","180 days"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Notice Period</Label><Select value={orgSettings.notice} onValueChange={v => setOrgSettings(p => ({ ...p, notice: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["15 days","30 days","60 days","90 days"].map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent></Select></div>
                </CardContent>
              </Card>
            </>
          )}

          {/* ─── Security ─── */}
          {activeSection === "security" && (
            <>
              {/* The caller's own second factor. Everything else on this tab is
                  an organisation-wide policy; this one acts on the person
                  reading it, which is why it sits first and separate. */}
              <TwoFactorSettings />
              {canManage && (
              <>
              <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-red-500" />Organisation policy</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {[
                    { label: "Two-Factor Authentication", desc: "Require 2FA for every user in the organisation", key: "twoFactor" as const },
                    { label: "Single Sign-On (SSO)", desc: "Allow login via Google/Microsoft SSO", key: "sso" as const },
                    { label: "IP Whitelisting", desc: "Restrict access to specific IP addresses", key: "ipWhitelist" as const },
                    { label: "Audit Logging", desc: "Log all user actions for compliance", key: "auditLogging" as const },
                  ].map(setting => (
                    <div key={setting.key} className="flex items-center justify-between rounded-lg border p-3">
                      <div><p className="text-xs font-medium">{setting.label}</p><p className="text-[10px] text-muted-foreground">{setting.desc}</p></div>
                      <Switch checked={securitySettings[setting.key]} onCheckedChange={checked => setSecuritySettings(p => ({ ...p, [setting.key]: checked }))} />
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Lock className="h-4 w-4 text-amber-500" />Password Policy</CardTitle></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Min Password Length</Label><Input type="number" value={securitySettings.minPasswordLength} onChange={e => setSecuritySettings(p => ({ ...p, minPasswordLength: parseInt(e.target.value) || 8 }))} /></div>
                  <div className="space-y-2"><Label>Password Expiry (days)</Label><Input type="number" value={securitySettings.passwordExpiry} onChange={e => setSecuritySettings(p => ({ ...p, passwordExpiry: parseInt(e.target.value) || 90 }))} /></div>
                  <div className="space-y-2"><Label>Session Timeout (min)</Label><Input type="number" value={securitySettings.sessionTimeout} onChange={e => setSecuritySettings(p => ({ ...p, sessionTimeout: parseInt(e.target.value) || 30 }))} /></div>
                  <div className="space-y-2"><Label>Lockout After (attempts)</Label><Input type="number" value={securitySettings.lockoutAttempts} onChange={e => setSecuritySettings(p => ({ ...p, lockoutAttempts: parseInt(e.target.value) || 5 }))} /></div>
                </CardContent>
              </Card>
              </>
              )}
            </>
          )}

          {/* ─── Notifications ─── */}
          {activeSection === "notifications" && (
            <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Bell className="h-4 w-4 text-blue-500" />Notification Channels</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "Email Notifications", desc: "Send notifications via email", key: "emailEnabled" as const, icon: Mail },
                  { label: "Push Notifications", desc: "Browser push notifications", key: "pushEnabled" as const, icon: Smartphone },
                  { label: "Slack Integration", desc: "Send notifications to Slack channels", key: "slackEnabled" as const, icon: MessageSquare },
                ].map(ch => (
                  <div key={ch.key} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3"><ch.icon className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs font-medium">{ch.label}</p><p className="text-[10px] text-muted-foreground">{ch.desc}</p></div></div>
                    <Switch checked={notifSettings[ch.key]} onCheckedChange={checked => setNotifSettings(p => ({ ...p, [ch.key]: checked }))} />
                  </div>
                ))}
                <Separator />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Digest Frequency</Label><Select value={notifSettings.digestFrequency} onValueChange={v => setNotifSettings(p => ({ ...p, digestFrequency: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["realtime","hourly","daily","weekly"].map(f => <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>)}</SelectContent></Select></div>
                  <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-xs font-medium">Quiet Hours</p><p className="text-[10px] text-muted-foreground">{notifSettings.quietStart} - {notifSettings.quietEnd}</p></div><Switch checked={notifSettings.quietHoursEnabled} onCheckedChange={checked => setNotifSettings(p => ({ ...p, quietHoursEnabled: checked }))} /></div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ─── Modules ─── */}
          {activeSection === "modules" && (
            <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" />HRMS Modules ({MODULES_LIST.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {MODULES_LIST.map((mod, i) => (
                  <div key={mod.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]} text-white shadow-sm`}><Zap className="h-3.5 w-3.5" /></div>
                    <div><p className="text-xs font-medium">{mod.name}</p><p className="text-[10px] text-muted-foreground">{mod.description}</p></div>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground pt-1">Access to each module is controlled by role permissions, not by a switch on this page.</p>
              </CardContent>
            </Card>
          )}

          {/* ─── Roles ─── */}
          {activeSection === "roles" && (
            <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Key className="h-4 w-4 text-indigo-500" />Roles ({ROLES.length})</CardTitle></CardHeader>
              {/*
                "Add Role" and a per-role "Configure" button used to sit here,
                neither with a handler, next to a "2/3/8/114 users" figure
                nothing ever queried. Removed rather than wired up: roles are
                a fixed, compiled-in set (see the Role type in lib/rbac.ts),
                not a dynamic system a customer can extend or reconfigure, so
                both buttons promised a capability that doesn't exist
                anywhere in the product, not just on this screen.
              */}
              <CardContent className="space-y-3">
                {ROLES.map(role => (
                  <div key={role.id} className="flex items-center gap-4 rounded-lg border p-4">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${role.color} text-white shadow-md`}><Shield className="h-5 w-5" /></div>
                    <div className="flex-1"><h3 className="text-sm font-semibold">{getRoleLabel(role.id)}</h3><p className="mt-0.5 text-[10px] text-muted-foreground">{ROLE_PERMISSIONS[role.id].length} permissions granted</p></div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ─── Data Management ─── */}
          {activeSection === "data" && (
            <>
              <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-emerald-500" />Data Retention Policies</CardTitle></CardHeader>
                <CardContent>
                  {/*
                    This table used to list seven data types (Employee Records,
                    Payroll Data, Attendance Logs, ...), each with an invented
                    retention period, storage size and record count -- e.g.
                    "Attendance Logs, 3 years, 420 MB, 45,000 records". Nothing
                    in this codebase measures table sizes or row counts per
                    data type, so every figure was made up, and would still
                    have been wrong the moment a real measurement existed to
                    check it against. An admin using this page to judge
                    whether the company is past a retention limit deserves
                    "not tracked yet," not a confident, invented number.
                  */}
                  <p className="text-xs text-muted-foreground">Retention periods, storage size and record counts are not measured yet, so there is nothing real to show here.</p>
                </CardContent>
              </Card>
              <Card><CardHeader className="py-3"><CardTitle className="text-sm">Backup & Recovery</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {/*
                    This used to read "Mar 25, 2026 at 3:00 AM (Automatic)" with a permanent
                    green "Healthy" badge -- a string with no backup job behind it, shown with
                    total confidence at the exact moment someone opens this page to decide
                    whether the company's data is recoverable. That is the one moment where a
                    comforting guess is worse than no answer at all. No process on this page
                    (or anywhere in HRMS) has ever written a real backup timestamp here, so the
                    honest state is "unknown," not a plausible-looking date. The backup tool
                    that now actually runs against this database lives in
                    Auth.circuvent/scripts/backup and writes a manifest (runs/latest.json) with
                    real timestamps and row counts; this page is a separate app/deployment with
                    no filesystem or network access to that manifest today, so it cannot show
                    the real value yet either -- surfacing that gap honestly here rather than
                    inventing a fix for it.
                  */}
                  <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-xs font-medium">Last Backup</p><p className="text-[10px] text-muted-foreground">No backup has been recorded for this environment</p></div><Badge className="status-inactive text-[9px] border-0">Unknown</Badge></div>
                  {/*
                    Export All Data / Import Data / Purge Old Data used to sit
                    here with no onClick at all -- clicking any of them did
                    nothing, silently. There is no bulk export, bulk import or
                    purge endpoint anywhere in the API for them to call, so
                    they are removed rather than kept as buttons that look
                    actionable and are not.
                  */}
                </CardContent>
              </Card>
            </>
          )}

          {/* ─── Integrations ─── */}
          {activeSection === "integrations" && (
            <>
            <IntegrationsPanel />

            {/*
              This card used to show HRMS/CV-365/Mail as three separately
              databased apps, each with a permanent green "Primary"/"Connected"
              badge nothing here ever checked, plus a "Sync Behavior" list
              describing a Firebase Auth fan-out that copied every new hire
              into CV-365's and Mail's own Firestore databases. The header
              comment on /api/sync/bulk explains that fan-out no longer
              exists: identity is now a single shared schema all three apps
              read directly, Mail has moved to Postgres, and Firebase is being
              retired. Three confident status badges for connections nothing
              measured were already the "assert, don't measure" problem this
              pass looks for; leaving them describe a sync mechanism that no
              longer runs would have made them wrong twice over. The button
              below calls the same real endpoint and now reads the response
              shape it actually returns instead of fields (`synced`, `total`)
              that endpoint stopped sending, which is why the old button's
              success toast rendered as "Synced undefined/undefined employees."
            */}
            <Card className="mt-4">
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Webhook className="h-4 w-4 text-violet-500" />Cross-App Account Coverage</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">HRMS, CV-365 and Mail.circuvent read the same identity records directly, so there is no separate database to keep in sync. This checks which employees have a usable sign-in account.</p>
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => {
                  fetch("/api/sync/bulk", { method: "POST" }).then(r => r.json()).then(d => {
                    if (!d.success) { toast.error(d.error || "Could not check account coverage"); return; }
                    toast.success(`${d.summary.withWorkEmail} of ${d.summary.employees} employees have a sign-in account`);
                    if (d.needsAttention) toast.warning(d.needsAttention);
                  }).catch(() => toast.error("Could not reach the account check"));
                }}>
                  <Webhook className="h-3 w-3" />Check Account Coverage
                </Button>
              </CardContent>
            </Card>
            </>
          )}

          {/* ─── Billing ─── */}
          {activeSection === "billing" && (
            <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><CreditCard className="h-4 w-4 text-pink-500" />Subscription</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 p-5 text-white">
                  <div className="flex items-center justify-between"><div><p className="text-sm font-bold">Professional Plan</p><p className="text-xs text-white/70">127 of 200 employees used</p></div><Badge className="bg-white/20 text-white border-0">Active</Badge></div>
                  <div className="mt-3 flex items-end gap-1"><span className="text-3xl font-bold">$8</span><span className="text-sm text-white/70 mb-1">/employee/month</span></div>
                  <p className="text-xs text-white/70 mt-1">Billed annually · Next invoice: Apr 1, 2026</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">{[{ l: "Monthly Cost", v: "$1,016" },{ l: "Employees", v: "127" },{ l: "Storage Used", v: "2.5 GB" }].map(s => (<div key={s.l} className="rounded-lg border p-3"><p className="text-[9px] text-muted-foreground">{s.l}</p><p className="text-sm font-bold">{s.v}</p></div>))}</div>
                <div className="flex gap-2"><Button variant="outline" size="sm" className="text-xs">Change Plan</Button><Button variant="outline" size="sm" className="text-xs">View Invoices</Button><Button variant="outline" size="sm" className="text-xs">Update Payment</Button></div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
