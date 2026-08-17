"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Inbox, Plus, Search, FileText, Users, CalendarDays,
  Clock, DollarSign, Target, Award, Briefcase, Package,
  GraduationCap, Headphones, Building2, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════
// DATA EMPTY STATE COMPONENT
// Shown when a module has no records yet — encourages first action
// ═══════════════════════════════════════════════════════════════

interface DataEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  compact?: boolean;
}

export function DataEmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  className,
  compact = false,
}: DataEmptyStateProps) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center text-center",
      compact ? "py-8" : "py-16",
      className
    )}>
      <div className={cn(
        "rounded-2xl bg-muted/50 flex items-center justify-center mb-4",
        compact ? "h-12 w-12" : "h-16 w-16"
      )}>
        <Icon className={cn("text-muted-foreground/40", compact ? "h-6 w-6" : "h-8 w-8")} />
      </div>
      <h3 className={cn("font-semibold text-muted-foreground", compact ? "text-sm" : "text-lg")}>
        {title}
      </h3>
      <p className={cn("text-muted-foreground mt-1 max-w-sm", compact ? "text-xs" : "text-sm")}>
        {description}
      </p>
      {actionLabel && onAction && (
        <Button
          className="mt-4 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
          onClick={onAction}
          size={compact ? "sm" : "default"}
        >
          <Plus className="h-4 w-4" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────

export function DataLoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i} className="animate-pulse">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 rounded bg-muted" />
              <div className="h-2 w-2/3 rounded bg-muted" />
            </div>
            <div className="h-6 w-16 rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Module Empty State Presets ───────────────────────────────

export const EMPTY_STATES = {
  employees: { icon: Users, title: "No employees yet", description: "Add your first employee to get started with HR management.", actionLabel: "Add Employee" },
  departments: { icon: Building2, title: "No departments configured", description: "Create departments to organize your workforce.", actionLabel: "Add Department" },
  leave: { icon: CalendarDays, title: "No leave requests", description: "Leave requests from your team will appear here.", actionLabel: "Apply Leave" },
  attendance: { icon: Clock, title: "No attendance records", description: "Clock-in records will appear here once employees start logging time." },
  payroll: { icon: DollarSign, title: "No payroll data", description: "Process your first payroll cycle to see salary records here.", actionLabel: "Process Payroll" },
  expenses: { icon: FileText, title: "No expense claims", description: "Submit expense claims for reimbursement.", actionLabel: "Submit Expense" },
  recruitment: { icon: Briefcase, title: "No job postings", description: "Create job postings to start hiring.", actionLabel: "Post Job" },
  helpdesk: { icon: Headphones, title: "No tickets", description: "Create support tickets for IT or HR queries.", actionLabel: "Create Ticket" },
  training: { icon: GraduationCap, title: "No courses available", description: "Add training courses for your team.", actionLabel: "Add Course" },
  performance: { icon: Target, title: "No review cycles", description: "Start a performance review cycle to track goals.", actionLabel: "Start Review" },
  goals: { icon: Target, title: "No goals set", description: "Create OKRs and goals to track performance.", actionLabel: "Create Goal" },
  assets: { icon: Package, title: "No assets registered", description: "Register hardware and software assets.", actionLabel: "Add Asset" },
  announcements: { icon: FileText, title: "No announcements", description: "Post company-wide announcements here.", actionLabel: "Create Announcement" },
  teams: { icon: Users, title: "No teams created", description: "Create teams to group employees.", actionLabel: "Create Team" },
  documents: { icon: FileText, title: "No documents", description: "Upload HR documents, policies, and templates.", actionLabel: "Upload Document" },
  surveys: { icon: FileText, title: "No surveys", description: "Create employee surveys to gather feedback.", actionLabel: "Create Survey" },
  feedback: { icon: FileText, title: "No feedback yet", description: "Employee suggestions and feedback will appear here.", actionLabel: "Submit Feedback" },
  travel: { icon: FileText, title: "No travel requests", description: "Submit travel requests for business trips.", actionLabel: "New Request" },
  wfh: { icon: Building2, title: "No WFH requests", description: "Request work from home days here.", actionLabel: "Request WFH" },
  overtime: { icon: Clock, title: "No overtime records", description: "Log overtime hours for approval.", actionLabel: "Log Overtime" },
  loans: { icon: DollarSign, title: "No loan records", description: "Apply for salary advances or loans.", actionLabel: "Apply for Loan" },
  meetings: { icon: CalendarDays, title: "No bookings", description: "Book meeting rooms for your sessions.", actionLabel: "Book Room" },
  visitors: { icon: Users, title: "No visitor records", description: "Pre-register visitors for office visits.", actionLabel: "Register Visitor" },
  referrals: { icon: Users, title: "No referrals", description: "Refer candidates for open positions.", actionLabel: "Refer Someone" },
  holidays: { icon: CalendarDays, title: "No holidays configured", description: "Add company holidays for the year.", actionLabel: "Add Holiday" },
  policies: { icon: FileText, title: "No policies", description: "Upload company policies for employees.", actionLabel: "Add Policy" },
  notifications: { icon: Inbox, title: "No notifications", description: "You are all caught up!" },
  audit: { icon: FileText, title: "No audit records", description: "System activity logs will appear here." },
  incidents: { icon: FileText, title: "No incidents reported", description: "Safety and workplace incident reports appear here.", actionLabel: "Report Incident" },
  celebrations: { icon: Award, title: "No celebrations", description: "Birthdays, anniversaries, and milestones appear here." },
  shifts: { icon: Clock, title: "No shifts configured", description: "Create shift schedules for your team.", actionLabel: "Create Shift" },
  awards: { icon: Award, title: "No awards yet", description: "Recognize employee achievements with awards.", actionLabel: "Create Award" },
  knowledgebase: { icon: FileText, title: "No articles yet", description: "Build your knowledge base with helpful articles.", actionLabel: "Add Article" },
  grievances: { icon: FileText, title: "No grievances filed", description: "Employee grievance reports will appear here.", actionLabel: "File Grievance" },
  wellness: { icon: Inbox, title: "No wellness programs", description: "Create wellness initiatives for your team.", actionLabel: "Add Program" },
  badges: { icon: Award, title: "No badges created", description: "Create badges to recognize employee achievements.", actionLabel: "Create Badge" },
  analytics: { icon: Inbox, title: "No data for analytics", description: "Analytics will populate as you add employees, expenses, and leave records." },
  onboarding: { icon: Users, title: "No new joiners", description: "New hire onboarding tasks will appear here when employees are added." },
  orgchart: { icon: Users, title: "No org structure", description: "Add employees and departments to build the org chart." },
  generic: { icon: Inbox, title: "No data available", description: "Records will appear here when added." },
} as const;

// ─── Store Connection Hook ───────────────────────────────────

import { startSync } from "@/stores/unified-store";
import type { COLLECTIONS } from "@/lib/collection-service";

export function useFirestoreSync(
  collectionName: string,
  store: { loading: boolean; initialized: boolean; setLoading: (v: boolean) => void; setItems: (items: unknown[]) => void; setInitialized: (v: boolean) => void }
) {
  useEffect(() => {
    if (store.initialized) return;
    startSync(collectionName, store as Parameters<typeof startSync>[1]);
    return () => { /* cleanup handled by stopSync */ };
  }, [collectionName, store]);
}
