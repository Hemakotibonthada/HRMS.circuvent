"use client";

import { useState } from "react";
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
import {
  Settings, Building2, Users, Shield, Bell, Palette, Globe,
  Lock, Mail, Key, Database, Clock, Calendar, Save, RotateCcw,
  CheckCircle2, AlertTriangle, Eye, EyeOff, Plus, Trash2,
  Download, Upload, ChevronRight, Zap, Monitor, Smartphone, MessageSquare,
  HardDrive, Cloud, Webhook, FileText, CreditCard, Heart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════
// ADVANCED SETTINGS PANEL
// Organization settings, security, notifications, branding,
// integrations, modules, roles, audit, data management
// ═══════════════════════════════════════════════════════════════

interface SettingSection { id: string; label: string; icon: typeof Settings; description: string; }

const SECTIONS: SettingSection[] = [
  { id: "organization", label: "Organization", icon: Building2, description: "Company details, branding, and regional settings" },
  { id: "security", label: "Security", icon: Shield, description: "Passwords, 2FA, sessions, and access controls" },
  { id: "notifications", label: "Notifications", icon: Bell, description: "Email, push, and in-app notification preferences" },
  { id: "modules", label: "Modules", icon: Zap, description: "Enable/disable HRMS modules and features" },
  { id: "roles", label: "Roles & Permissions", icon: Key, description: "Role definitions and permission matrix" },
  { id: "data", label: "Data Management", icon: Database, description: "Backup, export, retention, and cleanup" },
  { id: "integrations", label: "Integrations", icon: Webhook, description: "Third-party service connections and APIs" },
  { id: "billing", label: "Billing", icon: CreditCard, description: "Subscription, invoices, and payment methods" },
];

const MODULES_LIST = [
  { id: "employees", name: "Employee Management", enabled: true, description: "Core employee directory and profiles", core: true },
  { id: "attendance", name: "Attendance & Time", enabled: true, description: "Clock in/out, timesheets, shifts", core: true },
  { id: "leave", name: "Leave Management", enabled: true, description: "Leave applications and approvals", core: true },
  { id: "payroll", name: "Payroll & Compensation", enabled: true, description: "Salary processing and payslips", core: true },
  { id: "recruitment", name: "Recruitment & ATS", enabled: true, description: "Job postings and candidate tracking", core: false },
  { id: "performance", name: "Performance Management", enabled: true, description: "Reviews, goals, and OKRs", core: false },
  { id: "training", name: "Training & LMS", enabled: true, description: "Courses, certifications, learning paths", core: false },
  { id: "expenses", name: "Expense Management", enabled: true, description: "Claims, approvals, reimbursements", core: false },
  { id: "helpdesk", name: "Helpdesk & Ticketing", enabled: true, description: "Employee support tickets", core: false },
  { id: "assets", name: "Asset Management", enabled: true, description: "Hardware and software inventory", core: false },
  { id: "onboarding", name: "Onboarding", enabled: true, description: "New hire workflows and checklists", core: false },
  { id: "offboarding", name: "Offboarding", enabled: true, description: "Exit management and clearance", core: false },
  { id: "analytics", name: "HR Analytics", enabled: true, description: "Workforce intelligence dashboards", core: false },
  { id: "engagement", name: "Engagement & Culture", enabled: true, description: "Kudos, surveys, culture hub", core: false },
  { id: "workflows", name: "Workflow Automation", enabled: false, description: "Custom approval workflows", core: false },
  { id: "chatbot", name: "HR AI Assistant", enabled: true, description: "AI-powered HR chatbot", core: false },
  { id: "documents", name: "Document Management", enabled: true, description: "File storage and versioning", core: false },
  { id: "compliance", name: "Compliance", enabled: true, description: "Regulatory compliance tracking", core: false },
];

const ROLES = [
  { id: "admin", name: "Administrator", count: 2, color: "from-red-500 to-orange-500", permissions: 65 },
  { id: "hr", name: "HR Manager", count: 3, color: "from-violet-500 to-purple-600", permissions: 48 },
  { id: "manager", name: "Department Manager", count: 8, color: "from-blue-500 to-cyan-500", permissions: 25 },
  { id: "employee", name: "Employee", count: 114, color: "from-emerald-500 to-green-600", permissions: 12 },
];

const INTEGRATIONS = [
  { name: "Google Workspace", status: "connected", icon: "🔵", type: "SSO", lastSync: "2 min ago" },
  { name: "Slack", status: "connected", icon: "💬", type: "Communication", lastSync: "5 min ago" },
  { name: "Razorpay", status: "connected", icon: "💳", type: "Payments", lastSync: "1 hr ago" },
  { name: "Zoho Books", status: "disconnected", icon: "📑", type: "Accounting", lastSync: "Never" },
  { name: "BambooHR", status: "disconnected", icon: "🎋", type: "HRIS", lastSync: "Never" },
  { name: "Jira", status: "connected", icon: "📋", type: "Project Management", lastSync: "10 min ago" },
  { name: "GitHub", status: "connected", icon: "🐙", type: "Development", lastSync: "30 min ago" },
  { name: "Twilio", status: "disconnected", icon: "📱", type: "SMS", lastSync: "Never" },
];

const DATA_RETENTION = [
  { type: "Employee Records", retention: "7 years after exit", size: "245 MB", records: 145 },
  { type: "Payroll Data", retention: "10 years", size: "180 MB", records: 1728 },
  { type: "Attendance Logs", retention: "3 years", size: "420 MB", records: 45000 },
  { type: "Leave Records", retention: "5 years", size: "85 MB", records: 3200 },
  { type: "Documents", retention: "Until deleted", size: "1.2 GB", records: 890 },
  { type: "Audit Logs", retention: "5 years", size: "320 MB", records: 28000 },
  { type: "Chat/Messages", retention: "1 year", size: "45 MB", records: 5600 },
];

const GRADIENTS = ["from-violet-500 to-purple-600","from-blue-500 to-cyan-500","from-emerald-500 to-green-600","from-amber-500 to-orange-500","from-pink-500 to-rose-600","from-teal-500 to-cyan-600","from-indigo-500 to-blue-600","from-red-500 to-orange-500"];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("organization");
  const [modules, setModules] = useState(MODULES_LIST);
  const [showPassword, setShowPassword] = useState(false);
  const [orgSettings, setOrgSettings] = useState({
    name: "Circuvent Technologies Pvt. Ltd.", domain: "circuvent.com",
    industry: "Information Technology", size: "51-200", founded: "2021",
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

  const toggleModule = (id: string) => {
    const mod = modules.find(m => m.id === id);
    if (mod?.core) { toast.error("Core modules cannot be disabled"); return; }
    setModules(prev => prev.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m));
    toast.success(`Module ${mod?.enabled ? "disabled" : "enabled"}`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-slide-up">
        <div><h1 className="text-2xl font-bold tracking-tight">Settings</h1><p className="text-muted-foreground text-sm mt-0.5">Organization configuration & preferences</p></div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2" onClick={() => toast.success("All settings saved!")}><Save className="h-4 w-4" />Save Changes</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Section Navigation */}
        <Card className="h-fit">
          <CardContent className="p-2">
            {SECTIONS.map(section => (
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
                  <div className="space-y-2"><Label>Company Name</Label><Input value={orgSettings.name} onChange={e => setOrgSettings(p => ({ ...p, name: e.target.value }))} /></div>
                  <div className="space-y-2"><Label>Domain</Label><Input value={orgSettings.domain} onChange={e => setOrgSettings(p => ({ ...p, domain: e.target.value }))} /></div>
                  <div className="space-y-2"><Label>Industry</Label><Select value={orgSettings.industry} onValueChange={v => setOrgSettings(p => ({ ...p, industry: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Information Technology","Finance","Healthcare","Education","Manufacturing","Retail","Consulting"].map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Company Size</Label><Select value={orgSettings.size} onValueChange={v => setOrgSettings(p => ({ ...p, size: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["1-10","11-50","51-200","201-500","500+"].map(s => <SelectItem key={s} value={s}>{s} employees</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Founded</Label><Input value={orgSettings.founded} onChange={e => setOrgSettings(p => ({ ...p, founded: e.target.value }))} /></div>
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
              <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-red-500" />Authentication</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {[
                    { label: "Two-Factor Authentication", desc: "Require 2FA for all users", key: "twoFactor" as const },
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
            <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" />HRMS Modules ({modules.filter(m => m.enabled).length}/{modules.length} active)</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {modules.map((mod, i) => (
                  <div key={mod.id} className={cn("flex items-center justify-between rounded-lg border p-3 transition-all", !mod.enabled && "opacity-60")}>
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]} text-white shadow-sm`}><Zap className="h-3.5 w-3.5" /></div>
                      <div><div className="flex items-center gap-1.5"><p className="text-xs font-medium">{mod.name}</p>{mod.core && <Badge className="text-[7px] bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-0">Core</Badge>}</div><p className="text-[10px] text-muted-foreground">{mod.description}</p></div>
                    </div>
                    <Switch checked={mod.enabled} onCheckedChange={() => toggleModule(mod.id)} disabled={mod.core} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ─── Roles ─── */}
          {activeSection === "roles" && (
            <Card><CardHeader className="flex-row items-center justify-between py-3"><CardTitle className="text-sm flex items-center gap-2"><Key className="h-4 w-4 text-indigo-500" />Roles ({ROLES.length})</CardTitle><Button size="sm" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-1 text-xs"><Plus className="h-3 w-3" />Add Role</Button></CardHeader>
              <CardContent className="space-y-3">
                {ROLES.map(role => (
                  <div key={role.id} className="flex items-center gap-4 rounded-lg border p-4 hover:shadow-sm transition-all">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${role.color} text-white shadow-md`}><Shield className="h-5 w-5" /></div>
                    <div className="flex-1"><h3 className="text-sm font-semibold">{role.name}</h3><div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground"><span>{role.count} users</span><span>{role.permissions} permissions</span></div></div>
                    <Button variant="outline" size="sm" className="text-xs gap-1"><Settings className="h-3 w-3" />Configure</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ─── Data Management ─── */}
          {activeSection === "data" && (
            <>
              <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-emerald-500" />Data Retention Policies</CardTitle></CardHeader>
                <CardContent><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b"><th className="text-left py-2 font-semibold">Data Type</th><th className="text-left py-2 font-semibold">Retention</th><th className="text-right py-2 font-semibold">Size</th><th className="text-right py-2 font-semibold">Records</th></tr></thead><tbody>{DATA_RETENTION.map(d => (<tr key={d.type} className="border-b last:border-0"><td className="py-2.5">{d.type}</td><td className="py-2.5 text-muted-foreground">{d.retention}</td><td className="py-2.5 text-right font-medium">{d.size}</td><td className="py-2.5 text-right">{d.records.toLocaleString()}</td></tr>))}</tbody></table></div></CardContent>
              </Card>
              <Card><CardHeader className="py-3"><CardTitle className="text-sm">Backup & Recovery</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-xs font-medium">Last Backup</p><p className="text-[10px] text-muted-foreground">Mar 25, 2026 at 3:00 AM (Automatic)</p></div><Badge className="status-active text-[9px] border-0">Healthy</Badge></div>
                  <div className="flex gap-2"><Button variant="outline" size="sm" className="text-xs gap-1"><Download className="h-3 w-3" />Export All Data</Button><Button variant="outline" size="sm" className="text-xs gap-1"><Upload className="h-3 w-3" />Import Data</Button><Button variant="outline" size="sm" className="text-xs gap-1 text-red-600"><Trash2 className="h-3 w-3" />Purge Old Data</Button></div>
                </CardContent>
              </Card>
            </>
          )}

          {/* ─── Integrations ─── */}
          {activeSection === "integrations" && (
            <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Webhook className="h-4 w-4 text-teal-500" />Connected Services</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {INTEGRATIONS.map(int => (
                  <div key={int.name} className="flex items-center gap-4 rounded-lg border p-3 hover:shadow-sm transition-all">
                    <span className="text-2xl">{int.icon}</span>
                    <div className="flex-1"><div className="flex items-center gap-2"><p className="text-xs font-semibold">{int.name}</p><Badge variant="outline" className="text-[8px]">{int.type}</Badge></div><p className="text-[10px] text-muted-foreground">Last sync: {int.lastSync}</p></div>
                    <Badge className={cn("text-[9px] border-0", int.status === "connected" ? "status-active" : "status-inactive")}>{int.status}</Badge>
                    <Button variant="outline" size="sm" className="text-xs">{int.status === "connected" ? "Configure" : "Connect"}</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
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
