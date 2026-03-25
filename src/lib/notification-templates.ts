// ═══════════════════════════════════════════════════════════════
// EMAIL & NOTIFICATION TEMPLATE ENGINE
// Templates for all HRMS notifications, email content generation,
// notification routing, and scheduled notification management
// ═══════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────

export type NotificationChannel = "in_app" | "email" | "push" | "slack" | "sms";
export type NotificationPriority = "low" | "normal" | "high" | "urgent";
export type NotificationCategory = 
  | "leave" | "attendance" | "payroll" | "performance" | "expense" 
  | "helpdesk" | "training" | "announcement" | "recruitment" 
  | "onboarding" | "system" | "social" | "compliance" | "asset";

export interface NotificationTemplate {
  id: string;
  name: string;
  category: NotificationCategory;
  subject: string;
  body: string;
  channels: NotificationChannel[];
  priority: NotificationPriority;
  variables: string[];
  actionUrl?: string;
  actionLabel?: string;
}

export interface NotificationPayload {
  templateId: string;
  recipientId: string;
  recipientName: string;
  recipientEmail?: string;
  variables: Record<string, string>;
  triggerType: "immediate" | "scheduled" | "digest";
  scheduledAt?: string;
}

export interface NotificationPreferences {
  channels: Record<NotificationChannel, boolean>;
  categories: Record<NotificationCategory, { enabled: boolean; channels: NotificationChannel[] }>;
  quietHours: { enabled: boolean; start: string; end: string };
  digest: { enabled: boolean; frequency: "hourly" | "daily" | "weekly" };
}

// ─── Template Registry ───────────────────────────────────────

export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  // Leave
  {
    id: "leave_applied",
    name: "Leave Applied",
    category: "leave",
    subject: "Leave Request: {{employeeName}} - {{leaveType}}",
    body: "{{employeeName}} has applied for {{leaveType}} from {{fromDate}} to {{toDate}} ({{days}} day(s)). Reason: {{reason}}. Please review and take action.",
    channels: ["in_app", "email"],
    priority: "normal",
    variables: ["employeeName", "leaveType", "fromDate", "toDate", "days", "reason"],
    actionUrl: "/leave",
    actionLabel: "Review Request",
  },
  {
    id: "leave_approved",
    name: "Leave Approved",
    category: "leave",
    subject: "Leave Approved: {{leaveType}} ({{fromDate}} - {{toDate}})",
    body: "Your {{leaveType}} request from {{fromDate}} to {{toDate}} has been approved by {{approverName}}.",
    channels: ["in_app", "email", "push"],
    priority: "normal",
    variables: ["leaveType", "fromDate", "toDate", "approverName"],
    actionUrl: "/leave",
    actionLabel: "View Details",
  },
  {
    id: "leave_rejected",
    name: "Leave Rejected",
    category: "leave",
    subject: "Leave Rejected: {{leaveType}} ({{fromDate}} - {{toDate}})",
    body: "Your {{leaveType}} request from {{fromDate}} to {{toDate}} has been rejected by {{approverName}}. Reason: {{rejectionReason}}",
    channels: ["in_app", "email", "push"],
    priority: "high",
    variables: ["leaveType", "fromDate", "toDate", "approverName", "rejectionReason"],
    actionUrl: "/leave",
    actionLabel: "View Details",
  },

  // Attendance
  {
    id: "clock_reminder",
    name: "Clock-in Reminder",
    category: "attendance",
    subject: "Clock-in Reminder",
    body: "Good morning {{employeeName}}! Don't forget to clock in. Current time: {{currentTime}}.",
    channels: ["push"],
    priority: "low",
    variables: ["employeeName", "currentTime"],
    actionUrl: "/attendance",
    actionLabel: "Clock In",
  },
  {
    id: "late_arrival",
    name: "Late Arrival Alert",
    category: "attendance",
    subject: "Late Arrival: {{employeeName}}",
    body: "{{employeeName}} clocked in late at {{clockInTime}} (expected by {{expectedTime}}). This is the {{lateCount}}th late arrival this month.",
    channels: ["in_app"],
    priority: "normal",
    variables: ["employeeName", "clockInTime", "expectedTime", "lateCount"],
  },
  {
    id: "regularization_request",
    name: "Regularization Request",
    category: "attendance",
    subject: "Attendance Regularization: {{employeeName}}",
    body: "{{employeeName}} has requested attendance regularization for {{date}}. Reason: {{reason}}.",
    channels: ["in_app", "email"],
    priority: "normal",
    variables: ["employeeName", "date", "reason"],
    actionUrl: "/attendance",
    actionLabel: "Review",
  },

  // Payroll
  {
    id: "payroll_processed",
    name: "Payroll Processed",
    category: "payroll",
    subject: "{{month}} {{year}} Salary Credited",
    body: "Your salary for {{month}} {{year}} has been processed. Net Pay: ₹{{netPay}}. Amount credited to {{bankAccount}}.",
    channels: ["in_app", "email", "push"],
    priority: "high",
    variables: ["month", "year", "netPay", "bankAccount"],
    actionUrl: "/payslip",
    actionLabel: "View Payslip",
  },
  {
    id: "payslip_available",
    name: "Payslip Available",
    category: "payroll",
    subject: "Payslip Available: {{month}} {{year}}",
    body: "Your payslip for {{month}} {{year}} is now available for download.",
    channels: ["in_app", "email"],
    priority: "normal",
    variables: ["month", "year"],
    actionUrl: "/payslip",
    actionLabel: "Download",
  },

  // Performance
  {
    id: "review_cycle_start",
    name: "Review Cycle Started",
    category: "performance",
    subject: "Performance Review Cycle: {{cycleName}}",
    body: "The {{cycleName}} performance review cycle has started. Self-assessment deadline: {{deadline}}. Please complete your goals and self-review.",
    channels: ["in_app", "email", "push"],
    priority: "high",
    variables: ["cycleName", "deadline"],
    actionUrl: "/performance",
    actionLabel: "Start Review",
  },
  {
    id: "goal_deadline",
    name: "Goal Deadline Approaching",
    category: "performance",
    subject: "Goal Deadline: {{goalTitle}}",
    body: "Your goal \"{{goalTitle}}\" is due in {{daysLeft}} days ({{dueDate}}). Current progress: {{progress}}%.",
    channels: ["in_app", "push"],
    priority: "normal",
    variables: ["goalTitle", "daysLeft", "dueDate", "progress"],
    actionUrl: "/goals",
    actionLabel: "Update Progress",
  },
  {
    id: "feedback_received",
    name: "Feedback Received",
    category: "performance",
    subject: "New Feedback from {{senderName}}",
    body: "You have received new feedback from {{senderName}}: \"{{feedbackPreview}}\"",
    channels: ["in_app", "email"],
    priority: "normal",
    variables: ["senderName", "feedbackPreview"],
    actionUrl: "/performance",
    actionLabel: "View Feedback",
  },

  // Expense
  {
    id: "expense_submitted",
    name: "Expense Submitted",
    category: "expense",
    subject: "Expense Claim: {{employeeName}} - ₹{{amount}}",
    body: "{{employeeName}} has submitted an expense claim of ₹{{amount}} for {{category}}. Description: {{description}}.",
    channels: ["in_app", "email"],
    priority: "normal",
    variables: ["employeeName", "amount", "category", "description"],
    actionUrl: "/expenses",
    actionLabel: "Review",
  },
  {
    id: "expense_approved",
    name: "Expense Approved",
    category: "expense",
    subject: "Expense Approved: ₹{{amount}}",
    body: "Your expense claim of ₹{{amount}} for {{category}} has been approved by {{approverName}}. Reimbursement will be processed with next payroll.",
    channels: ["in_app", "email"],
    priority: "normal",
    variables: ["amount", "category", "approverName"],
    actionUrl: "/expenses",
    actionLabel: "View",
  },

  // Helpdesk
  {
    id: "ticket_created",
    name: "Ticket Created",
    category: "helpdesk",
    subject: "Support Ticket: {{ticketId}} - {{subject}}",
    body: "Your support ticket #{{ticketId}} has been created. Category: {{category}}, Priority: {{priority}}. Our team will respond within the SLA timeline.",
    channels: ["in_app", "email"],
    priority: "normal",
    variables: ["ticketId", "subject", "category", "priority"],
    actionUrl: "/helpdesk",
    actionLabel: "Track Ticket",
  },
  {
    id: "ticket_resolved",
    name: "Ticket Resolved",
    category: "helpdesk",
    subject: "Ticket Resolved: {{ticketId}}",
    body: "Your support ticket #{{ticketId}} (\"{{subject}}\") has been resolved. Resolution: {{resolution}}. Please rate your experience.",
    channels: ["in_app", "email", "push"],
    priority: "normal",
    variables: ["ticketId", "subject", "resolution"],
    actionUrl: "/helpdesk",
    actionLabel: "Rate Experience",
  },
  {
    id: "ticket_assigned",
    name: "Ticket Assigned",
    category: "helpdesk",
    subject: "Ticket Assigned: {{ticketId}}",
    body: "Ticket #{{ticketId}} (\"{{subject}}\") has been assigned to you. Priority: {{priority}}, SLA: {{sla}}.",
    channels: ["in_app", "push"],
    priority: "high",
    variables: ["ticketId", "subject", "priority", "sla"],
    actionUrl: "/helpdesk",
    actionLabel: "View Ticket",
  },

  // Training
  {
    id: "training_enrolled",
    name: "Training Enrolled",
    category: "training",
    subject: "Enrolled: {{courseName}}",
    body: "You have been enrolled in \"{{courseName}}\" ({{duration}}). Start Date: {{startDate}}. Instructor: {{instructor}}.",
    channels: ["in_app", "email"],
    priority: "normal",
    variables: ["courseName", "duration", "startDate", "instructor"],
    actionUrl: "/training",
    actionLabel: "Start Course",
  },
  {
    id: "training_reminder",
    name: "Training Deadline Reminder",
    category: "training",
    subject: "Training Deadline: {{courseName}}",
    body: "Reminder: \"{{courseName}}\" must be completed by {{deadline}}. Current progress: {{progress}}%.",
    channels: ["in_app", "email", "push"],
    priority: "high",
    variables: ["courseName", "deadline", "progress"],
    actionUrl: "/training",
    actionLabel: "Continue",
  },
  {
    id: "certification_expiring",
    name: "Certification Expiring",
    category: "training",
    subject: "Certification Expiring: {{certName}}",
    body: "Your {{certName}} certification will expire on {{expiryDate}} ({{daysLeft}} days remaining). Please renew it.",
    channels: ["in_app", "email"],
    priority: "high",
    variables: ["certName", "expiryDate", "daysLeft"],
    actionUrl: "/training",
    actionLabel: "Renew",
  },

  // Announcements
  {
    id: "new_announcement",
    name: "New Announcement",
    category: "announcement",
    subject: "{{announcementTitle}}",
    body: "New company announcement by {{author}}: {{preview}}",
    channels: ["in_app", "email", "push"],
    priority: "normal",
    variables: ["announcementTitle", "author", "preview"],
    actionUrl: "/announcements",
    actionLabel: "Read More",
  },

  // Recruitment
  {
    id: "interview_scheduled",
    name: "Interview Scheduled",
    category: "recruitment",
    subject: "Interview: {{candidateName}} for {{position}}",
    body: "Interview scheduled for {{candidateName}} applying for {{position}}. Date: {{interviewDate}}, Time: {{interviewTime}}, Panel: {{panelMembers}}.",
    channels: ["in_app", "email"],
    priority: "high",
    variables: ["candidateName", "position", "interviewDate", "interviewTime", "panelMembers"],
    actionUrl: "/interviews",
    actionLabel: "View Details",
  },
  {
    id: "candidate_applied",
    name: "New Application",
    category: "recruitment",
    subject: "New Application: {{candidateName}} for {{position}}",
    body: "{{candidateName}} has applied for {{position}}. Experience: {{experience}} years. Source: {{source}}.",
    channels: ["in_app"],
    priority: "normal",
    variables: ["candidateName", "position", "experience", "source"],
    actionUrl: "/recruitment",
    actionLabel: "Review",
  },

  // Onboarding
  {
    id: "welcome_new_hire",
    name: "Welcome New Hire",
    category: "onboarding",
    subject: "Welcome to {{companyName}}, {{employeeName}}!",
    body: "Welcome to {{companyName}}! We are excited to have you join as {{designation}} in {{department}}. Your onboarding starts on {{joiningDate}}. Your buddy is {{buddyName}}.",
    channels: ["email"],
    priority: "high",
    variables: ["companyName", "employeeName", "designation", "department", "joiningDate", "buddyName"],
    actionUrl: "/onboarding",
    actionLabel: "Start Onboarding",
  },
  {
    id: "onboarding_task",
    name: "Onboarding Task Reminder",
    category: "onboarding",
    subject: "Onboarding Task: {{taskName}}",
    body: "Reminder: Please complete your onboarding task \"{{taskName}}\" by {{dueDate}}. Phase: {{phase}}.",
    channels: ["in_app", "email", "push"],
    priority: "normal",
    variables: ["taskName", "dueDate", "phase"],
    actionUrl: "/onboarding",
    actionLabel: "Complete Task",
  },

  // System
  {
    id: "password_expiry",
    name: "Password Expiring",
    category: "system",
    subject: "Password Expiring in {{daysLeft}} Days",
    body: "Your password will expire in {{daysLeft}} days. Please update it to maintain account security.",
    channels: ["in_app", "email", "push"],
    priority: "urgent",
    variables: ["daysLeft"],
    actionUrl: "/settings",
    actionLabel: "Change Password",
  },
  {
    id: "login_alert",
    name: "New Login Detected",
    category: "system",
    subject: "New Login from {{location}}",
    body: "A new login to your account was detected from {{location}} ({{ipAddress}}) at {{timestamp}}. If this was not you, change your password immediately.",
    channels: ["email", "push"],
    priority: "urgent",
    variables: ["location", "ipAddress", "timestamp"],
    actionUrl: "/settings",
    actionLabel: "Secure Account",
  },

  // Social / Recognition
  {
    id: "kudos_received",
    name: "Kudos Received",
    category: "social",
    subject: "🌟 Kudos from {{senderName}}!",
    body: "{{senderName}} gave you kudos: \"{{message}}\" for {{coreValue}}.",
    channels: ["in_app", "push"],
    priority: "normal",
    variables: ["senderName", "message", "coreValue"],
    actionUrl: "/wall",
    actionLabel: "View",
  },
  {
    id: "birthday_wish",
    name: "Birthday Wish",
    category: "social",
    subject: "🎂 Happy Birthday, {{employeeName}}!",
    body: "Wishing you a wonderful birthday! The team at {{companyName}} wishes you all the best.",
    channels: ["in_app", "email"],
    priority: "low",
    variables: ["employeeName", "companyName"],
  },
  {
    id: "work_anniversary",
    name: "Work Anniversary",
    category: "social",
    subject: "🎉 Happy {{years}} Year Anniversary, {{employeeName}}!",
    body: "Congratulations on completing {{years}} years at {{companyName}}! Thank you for your dedication and contributions.",
    channels: ["in_app", "email"],
    priority: "normal",
    variables: ["employeeName", "years", "companyName"],
  },

  // Compliance
  {
    id: "compliance_due",
    name: "Compliance Due",
    category: "compliance",
    subject: "Compliance Deadline: {{complianceName}}",
    body: "{{complianceName}} is due by {{deadline}}. {{daysLeft}} days remaining. Please ensure completion to remain compliant.",
    channels: ["in_app", "email", "push"],
    priority: "urgent",
    variables: ["complianceName", "deadline", "daysLeft"],
    actionUrl: "/compliance",
    actionLabel: "Complete Now",
  },
  {
    id: "policy_updated",
    name: "Policy Updated",
    category: "compliance",
    subject: "Policy Updated: {{policyName}}",
    body: "The company policy \"{{policyName}}\" has been updated to version {{version}}. Please review and acknowledge.",
    channels: ["in_app", "email"],
    priority: "high",
    variables: ["policyName", "version"],
    actionUrl: "/policies",
    actionLabel: "Review & Acknowledge",
  },

  // Assets
  {
    id: "asset_assigned",
    name: "Asset Assigned",
    category: "asset",
    subject: "Asset Assigned: {{assetName}}",
    body: "{{assetName}} ({{assetType}}, S/N: {{serialNumber}}) has been assigned to you. Please acknowledge receipt.",
    channels: ["in_app", "email"],
    priority: "normal",
    variables: ["assetName", "assetType", "serialNumber"],
    actionUrl: "/assets",
    actionLabel: "Acknowledge",
  },
  {
    id: "asset_return_reminder",
    name: "Asset Return Reminder",
    category: "asset",
    subject: "Please Return: {{assetName}}",
    body: "Please return {{assetName}} ({{assetType}}) as part of your {{reason}}. Return deadline: {{deadline}}.",
    channels: ["in_app", "email"],
    priority: "high",
    variables: ["assetName", "assetType", "reason", "deadline"],
    actionUrl: "/assets",
    actionLabel: "Initiate Return",
  },
];

// ─── Template Renderer ───────────────────────────────────────

export function renderTemplate(template: NotificationTemplate, variables: Record<string, string>): { subject: string; body: string } {
  let subject = template.subject;
  let body = template.body;

  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    subject = subject.replace(regex, value);
    body = body.replace(regex, value);
  });

  return { subject, body };
}

// ─── Notification Router ─────────────────────────────────────

export function getTemplateById(templateId: string): NotificationTemplate | undefined {
  return NOTIFICATION_TEMPLATES.find(t => t.id === templateId);
}

export function getTemplatesByCategory(category: NotificationCategory): NotificationTemplate[] {
  return NOTIFICATION_TEMPLATES.filter(t => t.category === category);
}

export function getTemplateSummary(): Array<{ category: NotificationCategory; count: number; templates: string[] }> {
  const categoryMap = new Map<NotificationCategory, string[]>();
  NOTIFICATION_TEMPLATES.forEach(t => {
    const existing = categoryMap.get(t.category) || [];
    existing.push(t.name);
    categoryMap.set(t.category, existing);
  });
  return Array.from(categoryMap.entries()).map(([category, templates]) => ({
    category,
    count: templates.length,
    templates,
  })).sort((a, b) => b.count - a.count);
}

// ─── Default Preferences ─────────────────────────────────────

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: {
    in_app: true,
    email: true,
    push: true,
    slack: false,
    sms: false,
  },
  categories: {
    leave: { enabled: true, channels: ["in_app", "email"] },
    attendance: { enabled: true, channels: ["in_app"] },
    payroll: { enabled: true, channels: ["in_app", "email", "push"] },
    performance: { enabled: true, channels: ["in_app", "email"] },
    expense: { enabled: true, channels: ["in_app", "email"] },
    helpdesk: { enabled: true, channels: ["in_app", "email"] },
    training: { enabled: true, channels: ["in_app", "email"] },
    announcement: { enabled: true, channels: ["in_app", "email", "push"] },
    recruitment: { enabled: true, channels: ["in_app", "email"] },
    onboarding: { enabled: true, channels: ["in_app", "email"] },
    system: { enabled: true, channels: ["in_app", "email", "push"] },
    social: { enabled: true, channels: ["in_app"] },
    compliance: { enabled: true, channels: ["in_app", "email", "push"] },
    asset: { enabled: true, channels: ["in_app", "email"] },
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "08:00",
  },
  digest: {
    enabled: false,
    frequency: "daily",
  },
};

// ─── Notification Builder ────────────────────────────────────

export function buildNotification(payload: NotificationPayload): {
  title: string;
  message: string;
  type: string;
  category: NotificationCategory;
  recipientId: string;
  read: boolean;
  starred: boolean;
  timestamp: string;
  actionUrl?: string;
  actionLabel?: string;
} | null {
  const template = getTemplateById(payload.templateId);
  if (!template) return null;

  const { subject, body } = renderTemplate(template, payload.variables);

  return {
    title: subject,
    message: body,
    type: template.priority === "urgent" ? "error" : template.priority === "high" ? "warning" : "info",
    category: template.category,
    recipientId: payload.recipientId,
    read: false,
    starred: false,
    timestamp: new Date().toISOString(),
    actionUrl: template.actionUrl,
    actionLabel: template.actionLabel,
  };
}
