// ═══════════════════════════════════════════════════════════════════════
// HRMS DATA MODELS & TYPES
// Comprehensive type definitions for all HRMS modules
// ═══════════════════════════════════════════════════════════════════════

// ─── CORE TYPES ──────────────────────────────────────────────────────

export type UserRole = "admin" | "hr" | "manager" | "employee" | "viewer";
export type EmploymentType = "full_time" | "part_time" | "contract" | "intern" | "freelance";
export type Gender = "male" | "female" | "other" | "prefer_not_to_say";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
export type Priority = "low" | "medium" | "high" | "critical" | "urgent";
export type Severity = "info" | "low" | "medium" | "high" | "critical";

// ─── EMPLOYEE ────────────────────────────────────────────────────────

export interface Employee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  personalEmail?: string;
  phone?: string;
  avatar?: string;
  gender?: Gender;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  departmentId: string;
  departmentName: string;
  designation: string;
  reportingTo?: string;
  reportingToName?: string;
  employmentType: EmploymentType;
  status: "active" | "on_leave" | "probation" | "notice_period" | "terminated" | "inactive";
  joinDate: string;
  confirmationDate?: string;
  exitDate?: string;
  noticePeriod?: number;
  salary?: number;
  currency?: string;
  bankDetails?: BankDetails;
  emergencyContact?: EmergencyContact;
  skills?: string[];
  qualifications?: Qualification[];
  documents?: EmployeeDocument[];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BankDetails {
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  branch?: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
  email?: string;
}

export interface Qualification {
  degree: string;
  institution: string;
  year: number;
  grade?: string;
}

export interface EmployeeDocument {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
  uploadedAt: string;
  verified: boolean;
}

// ─── DEPARTMENT ──────────────────────────────────────────────────────

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  headId?: string;
  headName?: string;
  parentId?: string;
  employeeCount: number;
  budget?: number;
  costCenter?: string;
  organizationId: string;
  createdAt: string;
}

// ─── ATTENDANCE ──────────────────────────────────────────────────────

export type AttendanceStatus = "present" | "absent" | "late" | "half_day" | "on_leave" | "holiday" | "weekend" | "wfh";
export type ClockMethod = "biometric" | "web" | "mobile" | "manual" | "geo_fence";

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
  status: AttendanceStatus;
  totalHours?: number;
  overtimeHours?: number;
  breakDuration?: number;
  notes?: string;
  location?: string;
  method?: ClockMethod;
  ipAddress?: string;
  shiftId?: string;
  shiftCode?: string;
  lateBy?: number;
  earlyLeaveBy?: number;
  regularized?: boolean;
  regularizationReason?: string;
  organizationId: string;
  createdAt: string;
}

export interface AttendanceSummary {
  employeeId: string;
  month: number;
  year: number;
  totalDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  halfDays: number;
  leaveDays: number;
  wfhDays: number;
  holidays: number;
  weekends: number;
  avgWorkHours: number;
  totalOvertime: number;
  lossOfPay: number;
}

// ─── LEAVE ───────────────────────────────────────────────────────────

export type LeaveType = "casual" | "sick" | "earned" | "maternity" | "paternity" | "compensatory" | "unpaid" | "bereavement" | "wfh" | "marriage" | "study";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar?: string;
  leaveType: LeaveType;
  leaveTypeLabel: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  halfDay?: boolean;
  halfDayPeriod?: "first_half" | "second_half";
  reason: string;
  status: ApprovalStatus;
  appliedOn: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectionReason?: string;
  cancellationReason?: string;
  attachments?: string[];
  contactDuringLeave?: string;
  handoverTo?: string;
  overlap?: string[];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveBalance {
  employeeId: string;
  year: number;
  type: LeaveType;
  label: string;
  opening: number;
  accrued: number;
  used: number;
  pending: number;
  carryForward: number;
  lapsed: number;
  available: number;
}

export interface LeavePolicy {
  id: string;
  leaveType: LeaveType;
  label: string;
  annualQuota: number;
  carryForwardLimit: number;
  maxConsecutiveDays: number;
  minDaysNotice: number;
  proRataEnabled: boolean;
  encashmentAllowed: boolean;
  applicableGender?: Gender[];
  description?: string;
}

// ─── PAYROLL ─────────────────────────────────────────────────────────

export type PayrollStatus = "draft" | "processing" | "processed" | "approved" | "paid" | "on_hold" | "error";

export interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  month: number;
  year: number;
  basicSalary: number;
  hra: number;
  conveyanceAllowance: number;
  specialAllowance: number;
  medicalAllowance: number;
  performanceBonus: number;
  shiftAllowance: number;
  otherEarnings: number;
  grossSalary: number;
  providentFund: number;
  professionalTax: number;
  incomeTax: number;
  healthInsurance: number;
  loanEMI: number;
  otherDeductions: number;
  totalDeductions: number;
  netSalary: number;
  status: PayrollStatus;
  processedAt?: string;
  paidAt?: string;
  paymentMethod?: string;
  transactionId?: string;
  organizationId: string;
  createdAt: string;
}

// ─── RECRUITMENT ─────────────────────────────────────────────────────

export type JobStatus = "draft" | "open" | "closed" | "on_hold" | "filled";
export type ApplicationStage = "applied" | "screening" | "phone_screen" | "technical" | "culture_fit" | "offer" | "hired" | "rejected" | "withdrawn";

export interface JobPosting {
  id: string;
  title: string;
  departmentId: string;
  departmentName: string;
  location: string;
  locationType: "onsite" | "remote" | "hybrid";
  employmentType: EmploymentType;
  experience: string;
  salaryRange?: { min: number; max: number; currency: string };
  description: string;
  requirements: string[];
  responsibilities: string[];
  benefits?: string[];
  status: JobStatus;
  applicantCount: number;
  postedBy: string;
  postedByName: string;
  hiringManager: string;
  hiringManagerName: string;
  urgency: Priority;
  closingDate?: string;
  tags?: string[];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  id: string;
  jobId: string;
  jobTitle: string;
  name: string;
  email: string;
  phone?: string;
  currentCompany?: string;
  currentDesignation?: string;
  experience: string;
  skills: string[];
  source: string;
  stage: ApplicationStage;
  rating: number;
  resumeUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  coverLetter?: string;
  expectedSalary?: string;
  noticePeriod?: string;
  currentSalary?: string;
  interviewScore?: number;
  notes?: string;
  feedback?: InterviewFeedback[];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewFeedback {
  interviewerId: string;
  interviewerName: string;
  stage: string;
  date: string;
  rating: number;
  strengths: string[];
  weaknesses: string[];
  recommendation: "strong_hire" | "hire" | "no_hire" | "strong_no_hire";
  comments: string;
}

// ─── PERFORMANCE ─────────────────────────────────────────────────────

export type ReviewStatus = "not_started" | "self_review" | "peer_review" | "manager_review" | "calibration" | "completed";
export type GoalStatus = "not_started" | "in_progress" | "at_risk" | "completed" | "deferred" | "cancelled";

export interface PerformanceReview {
  id: string;
  employeeId: string;
  employeeName: string;
  reviewCycleId: string;
  cycleName: string;
  period: string;
  selfRating?: number;
  selfComments?: string;
  managerRating?: number;
  managerComments?: string;
  overallRating?: number;
  calibratedRating?: number;
  peerReviews: PeerReview[];
  competencyRatings: CompetencyRating[];
  status: ReviewStatus;
  goals: PerformanceGoal[];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PeerReview {
  reviewerId: string;
  reviewerName: string;
  rating: number;
  comments?: string;
  status: "pending" | "completed";
  submittedAt?: string;
}

export interface CompetencyRating {
  competency: string;
  selfRating: number;
  managerRating?: number;
  comments?: string;
}

export interface PerformanceGoal {
  id: string;
  title: string;
  description?: string;
  category: "business" | "individual" | "team" | "learning";
  priority: Priority;
  status: GoalStatus;
  progress: number;
  weight: number;
  startDate: string;
  dueDate: string;
  keyResults: KeyResult[];
  alignedTo?: string;
}

export interface KeyResult {
  title: string;
  target: string;
  current: string;
  progress: number;
  unit?: string;
}

// ─── EXPENSE ─────────────────────────────────────────────────────────

export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "reimbursed" | "partially_paid";
export type ExpenseCategory = "travel" | "meals" | "equipment" | "software" | "training" | "office" | "books" | "communication" | "other";

export interface ExpenseClaim {
  id: string;
  employeeId: string;
  employeeName: string;
  category: ExpenseCategory;
  subCategory?: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  receipt: boolean;
  receiptUrl?: string;
  status: ExpenseStatus;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectionReason?: string;
  project?: string;
  billable: boolean;
  paymentMethod: string;
  merchant?: string;
  location?: string;
  taxAmount?: number;
  reimbursedAt?: string;
  transactionId?: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

// ─── TRAINING / LMS ──────────────────────────────────────────────────

export type CourseStatus = "draft" | "upcoming" | "in_progress" | "completed" | "archived" | "cancelled";
export type CourseType = "online" | "classroom" | "hybrid" | "self_paced" | "workshop" | "webinar";
export type CourseLevel = "beginner" | "intermediate" | "advanced" | "expert";

export interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  instructor: string;
  instructorTitle?: string;
  duration: string;
  type: CourseType;
  level: CourseLevel;
  enrolled: number;
  maxCapacity: number;
  rating: number;
  reviews: number;
  completionRate: number;
  skills: string[];
  certification: boolean;
  mandatory: boolean;
  startDate?: string;
  endDate?: string;
  status: CourseStatus;
  modules: CourseModule[];
  prerequisites?: string[];
  tags?: string[];
  thumbnail?: string;
  organizationId: string;
  createdAt: string;
}

export interface CourseModule {
  id: string;
  title: string;
  description?: string;
  duration: string;
  type: "video" | "reading" | "quiz" | "assignment" | "live_session";
  completed: boolean;
  completedAt?: string;
  order: number;
}

export interface CourseEnrollment {
  id: string;
  courseId: string;
  employeeId: string;
  progress: number;
  status: "enrolled" | "in_progress" | "completed" | "dropped";
  enrolledAt: string;
  completedAt?: string;
  certificateUrl?: string;
  score?: number;
}

// ─── COMPLIANCE ──────────────────────────────────────────────────────

export type ComplianceStatus = "compliant" | "at_risk" | "non_compliant" | "upcoming" | "in_progress" | "expired";

export interface ComplianceItem {
  id: string;
  title: string;
  category: string;
  regulation: string;
  description: string;
  deadline: string;
  owner: string;
  ownerDept: string;
  progress: number;
  total: number;
  completed: number;
  status: ComplianceStatus;
  riskLevel: Severity;
  lastAudit?: string;
  nextAudit?: string;
  documents: ComplianceDocument[];
  organizationId: string;
}

export interface ComplianceDocument {
  name: string;
  status: "verified" | "pending" | "expired" | "rejected";
  uploadedAt?: string;
  expiresAt?: string;
}

// ─── HELPDESK ────────────────────────────────────────────────────────

export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed" | "reopened";
export type TicketCategory = "it_support" | "hr" | "payroll" | "facilities" | "equipment" | "ethics" | "other";

export interface Ticket {
  id: string;
  title: string;
  description: string;
  category: TicketCategory;
  priority: Priority;
  status: TicketStatus;
  reporterId: string;
  reporterName: string;
  assigneeId?: string;
  assigneeName?: string;
  assigneeTeam?: string;
  replies: TicketReply[];
  attachments?: string[];
  slaDeadline?: string;
  resolvedAt?: string;
  satisfaction?: number;
  tags?: string[];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketReply {
  id: string;
  authorId: string;
  authorName: string;
  message: string;
  isInternal: boolean;
  attachments?: string[];
  createdAt: string;
}

// ─── ASSET ───────────────────────────────────────────────────────────

export type AssetStatus = "available" | "assigned" | "maintenance" | "retired" | "lost" | "damaged";
export type AssetCategory = "laptop" | "monitor" | "phone" | "tablet" | "peripheral" | "furniture" | "vehicle" | "software_license";

export interface Asset {
  id: string;
  assetTag: string;
  name: string;
  category: AssetCategory;
  brand?: string;
  model?: string;
  serialNumber: string;
  purchaseDate: string;
  purchaseAmount: number;
  currentValue?: number;
  warranty?: string;
  assignedTo?: string;
  assignedToName?: string;
  departmentId?: string;
  departmentName?: string;
  location?: string;
  status: AssetStatus;
  condition: "new" | "good" | "fair" | "poor";
  notes?: string;
  maintenanceHistory?: MaintenanceRecord[];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceRecord {
  id: string;
  date: string;
  type: "repair" | "upgrade" | "inspection" | "replacement";
  description: string;
  cost: number;
  vendor?: string;
  completedAt?: string;
}

// ─── ANNOUNCEMENT ────────────────────────────────────────────────────

export interface Announcement {
  id: string;
  title: string;
  content: string;
  htmlContent?: string;
  priority: Priority;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  authorRole?: string;
  departmentId?: string;
  departmentName?: string;
  pinned: boolean;
  publishedAt: string;
  expiresAt?: string;
  likes: number;
  comments: number;
  views: number;
  tags?: string[];
  attachments?: string[];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

// ─── ORGANIZATION ────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  industry?: string;
  size?: string;
  website?: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  timezone: string;
  currency: string;
  dateFormat: string;
  fiscalYearStart: number;
  ownerId: string;
  plan: "starter" | "professional" | "enterprise";
  maxEmployees: number;
  features: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── AUDIT ───────────────────────────────────────────────────────────

export type AuditAction = "create" | "update" | "delete" | "login" | "logout" | "export" | "import" | "approve" | "reject" | "escalate";
export type AuditModule = "employee" | "leave" | "attendance" | "payroll" | "recruitment" | "performance" | "training" | "expense" | "asset" | "setting" | "auth" | "compliance";

export interface AuditLog {
  id: string;
  action: AuditAction;
  module: AuditModule;
  userId: string;
  userName: string;
  userRole: UserRole;
  targetId?: string;
  targetType?: string;
  targetName?: string;
  description: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  ipAddress?: string;
  userAgent?: string;
  severity: Severity;
  organizationId: string;
  createdAt: string;
}

// ─── NOTIFICATION ────────────────────────────────────────────────────

export type NotificationType = "leave" | "attendance" | "payroll" | "recruitment" | "performance" | "training" | "expense" | "announcement" | "system" | "reminder" | "approval";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  recipientId: string;
  senderId?: string;
  senderName?: string;
  read: boolean;
  readAt?: string;
  actionUrl?: string;
  actionLabel?: string;
  priority?: Priority;
  expiresAt?: string;
  organizationId: string;
  createdAt: string;
}

// ─── WORKFLOW ─────────────────────────────────────────────────────────

export type WorkflowStatus = "pending" | "in_review" | "approved" | "rejected" | "escalated" | "cancelled";

export interface WorkflowInstance {
  id: string;
  type: "leave" | "expense" | "travel" | "asset_request" | "loan" | "wfh" | "overtime";
  requesterId: string;
  requesterName: string;
  currentStep: number;
  totalSteps: number;
  status: WorkflowStatus;
  approvalChain: ApprovalStep[];
  metadata: Record<string, unknown>;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalStep {
  step: number;
  approverId: string;
  approverName: string;
  approverRole: string;
  status: "pending" | "approved" | "rejected" | "skipped";
  comments?: string;
  actionAt?: string;
}

// ─── REPORT ──────────────────────────────────────────────────────────

export interface ReportConfig {
  id: string;
  name: string;
  description: string;
  module: AuditModule;
  type: "tabular" | "chart" | "dashboard" | "summary";
  filters: ReportFilter[];
  columns: ReportColumn[];
  schedule?: ReportSchedule;
  favorite: boolean;
  sharedWith: string[];
  createdBy: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportFilter {
  field: string;
  operator: "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "in" | "between" | "contains";
  value: unknown;
  label: string;
}

export interface ReportColumn {
  field: string;
  label: string;
  type: "string" | "number" | "date" | "boolean" | "currency" | "percentage";
  sortable: boolean;
  filterable: boolean;
  width?: number;
  format?: string;
}

export interface ReportSchedule {
  frequency: "daily" | "weekly" | "monthly" | "quarterly";
  recipients: string[];
  format: "csv" | "excel" | "pdf";
  enabled: boolean;
  nextRun: string;
}
