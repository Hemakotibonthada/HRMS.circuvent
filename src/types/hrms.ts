// ═══════════════════════════════════════════════════════════════
// HRMS TYPE DEFINITIONS — COMPREHENSIVE
// All entity types, enums, utility types, and API contracts
// for the Circuvent HRMS application
// ═══════════════════════════════════════════════════════════════

// ─── Core Enums ──────────────────────────────────────────────

export type EmployeeStatus = "active" | "inactive" | "on_leave" | "terminated" | "probation" | "notice_period" | "suspended";
export type Gender = "male" | "female" | "non_binary" | "prefer_not_to_say";
export type MaritalStatus = "single" | "married" | "divorced" | "widowed";
export type EmploymentType = "full_time" | "part_time" | "contract" | "intern" | "consultant" | "freelance";
export type BloodGroup = "A+" | "A-" | "B+" | "B-" | "O+" | "O-" | "AB+" | "AB-";

export type LeaveType = "casual" | "sick" | "earned" | "maternity" | "paternity" | "bereavement" | "comp_off" | "wfh" | "half_day" | "unpaid";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled" | "auto_approved";

export type AttendanceStatus = "present" | "absent" | "half_day" | "wfh" | "on_leave" | "late" | "early_out" | "holiday";
export type ShiftType = "morning" | "general" | "evening" | "night" | "flexible" | "rotational";

export type PayrollStatus = "draft" | "processing" | "processed" | "paid" | "failed" | "on_hold";
export type PayComponent = "basic" | "hra" | "da" | "special_allowance" | "bonus" | "overtime" | "pf" | "esi" | "professional_tax" | "income_tax" | "loan_recovery" | "other";

export type PerformanceRating = 1 | 2 | 3 | 4 | 5;
export type GoalStatus = "not_started" | "in_progress" | "on_track" | "at_risk" | "behind" | "completed" | "cancelled";
export type ReviewStatus = "pending_self" | "pending_manager" | "pending_peer" | "pending_calibration" | "completed";

export type RecruitmentStage = "applied" | "screening" | "phone_screen" | "technical" | "culture_fit" | "hr_round" | "offer" | "accepted" | "joined" | "rejected" | "withdrawn";
export type JobStatus = "draft" | "open" | "on_hold" | "closed" | "cancelled";
export type JobType = "permanent" | "contract" | "intern";

export type TicketPriority = "low" | "medium" | "high" | "urgent" | "critical";
export type TicketStatus = "open" | "in_progress" | "waiting" | "escalated" | "resolved" | "closed" | "reopened";
export type TicketCategory = "it_support" | "hr_query" | "payroll" | "facilities" | "hardware" | "software" | "access" | "finance" | "general";

export type ExpenseCategory = "travel" | "equipment" | "training" | "software" | "books" | "events" | "client_meeting" | "marketing" | "office_supplies" | "other";
export type ExpenseStatus = "draft" | "pending" | "approved" | "rejected" | "reimbursed" | "under_review" | "partially_paid";

export type AssetType = "laptop" | "monitor" | "phone" | "tablet" | "printer" | "keyboard" | "mouse" | "headset" | "webcam" | "docking_station" | "accessories" | "furniture" | "other";
export type AssetStatus = "available" | "assigned" | "maintenance" | "retired" | "lost" | "damaged" | "disposed";
export type AssetCondition = "excellent" | "good" | "fair" | "poor" | "non_functional";

export type TrainingType = "self_paced" | "instructor_led" | "workshop" | "certification" | "webinar" | "mentorship" | "on_the_job";
export type TrainingStatus = "draft" | "active" | "upcoming" | "completed" | "cancelled" | "archived";
export type CourseLevel = "beginner" | "intermediate" | "advanced" | "expert";

export type WorkflowStatus = "active" | "draft" | "paused" | "archived" | "completed";
export type ApprovalAction = "approve" | "reject" | "send_back" | "delegate" | "escalate";

export type NotificationType = "info" | "success" | "warning" | "error" | "action_required";
export type NotificationChannel = "in_app" | "email" | "sms" | "push" | "slack";

// ─── Core Entities ───────────────────────────────────────────

export interface Employee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  personalEmail?: string;
  dateOfBirth: string;
  gender: Gender;
  maritalStatus: MaritalStatus;
  bloodGroup?: BloodGroup;
  nationality: string;
  address: Address;
  emergencyContact: EmergencyContact;
  department: string;
  departmentId: string;
  designation: string;
  grade: string;
  reportingManager: string;
  reportingManagerId: string;
  joiningDate: string;
  confirmationDate?: string;
  resignationDate?: string;
  lastWorkingDate?: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  role: string;
  skills: string[];
  avatar?: string;
  bankDetails: BankDetails;
  documents: EmployeeDocument[];
  compensation: Compensation;
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
  email?: string;
}

export interface BankDetails {
  accountName: string;
  accountNumber: string;
  bankName: string;
  branchName: string;
  ifscCode: string;
  panNumber: string;
  uanNumber?: string;
  aadhaarNumber?: string;
}

export interface EmployeeDocument {
  id: string;
  type: string;
  name: string;
  url: string;
  uploadedAt: string;
  verified: boolean;
  expiryDate?: string;
}

export interface Compensation {
  ctc: number;
  basicPay: number;
  hra: number;
  specialAllowance: number;
  otherAllowances: number;
  variablePay: number;
  pfEmployer: number;
  gratuity: number;
  insurance: number;
  lastRevisedDate?: string;
  nextReviewDate?: string;
}

// ─── Department ──────────────────────────────────────────────

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string;
  headId: string;
  headName: string;
  parentDepartmentId?: string;
  location: string;
  budget: number;
  headcount: number;
  activeCount: number;
  openPositions: number;
  status: "active" | "inactive";
  createdAt: string;
  costCenter?: string;
}

// ─── Leave ───────────────────────────────────────────────────

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  leaveType: LeaveType;
  fromDate: string;
  toDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  appliedOn: string;
  approvedBy?: string;
  approvedOn?: string;
  comments?: string;
  attachments?: string[];
  isHalfDay?: boolean;
  halfDaySession?: "first_half" | "second_half";
}

export interface LeaveBalance {
  leaveType: LeaveType;
  total: number;
  used: number;
  pending: number;
  balance: number;
  carryForward: number;
  lapsed: number;
}

export interface LeavePolicy {
  leaveType: LeaveType;
  name: string;
  totalDays: number;
  carryForwardMax: number;
  encashmentAllowed: boolean;
  probationAllowed: boolean;
  maxConsecutiveDays: number;
  documentRequired: boolean;
  documentRequiredAfterDays: number;
  applicableGender: Gender | "all";
  noticeRequired: number;
}

// ─── Attendance ──────────────────────────────────────────────

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
  status: AttendanceStatus;
  workedHours: number;
  overtimeHours: number;
  breakDuration: number;
  shift: ShiftType;
  location: string;
  source: "biometric" | "web" | "mobile" | "manual";
  regularization?: {
    reason: string;
    requestedClockIn: string;
    requestedClockOut: string;
    status: "pending" | "approved" | "rejected";
    approvedBy?: string;
  };
  notes?: string;
}

// ─── Payroll ─────────────────────────────────────────────────

export interface PayrollEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  month: string;
  year: number;
  status: PayrollStatus;
  earnings: PayrollComponent[];
  deductions: PayrollComponent[];
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  workingDays: number;
  presentDays: number;
  lop: number;
  processedBy?: string;
  processedAt?: string;
  paidAt?: string;
  transactionRef?: string;
}

export interface PayrollComponent {
  type: PayComponent;
  label: string;
  amount: number;
  isFixed: boolean;
}

// ─── Recruitment ─────────────────────────────────────────────

export interface JobPosting {
  id: string;
  title: string;
  department: string;
  location: string;
  employmentType: JobType;
  experience: { min: number; max: number };
  salaryRange: { min: number; max: number };
  description: string;
  responsibilities: string[];
  requirements: string[];
  niceToHave: string[];
  skills: string[];
  status: JobStatus;
  hiringManager: string;
  recruiter: string;
  openings: number;
  applicants: number;
  postedDate: string;
  closingDate?: string;
  urgent: boolean;
}

export interface Candidate {
  id: string;
  jobId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  currentCompany?: string;
  currentRole?: string;
  experience: number;
  expectedCTC: number;
  currentCTC: number;
  noticePeriod: number;
  resume: string;
  stage: RecruitmentStage;
  rating: number;
  source: string;
  appliedDate: string;
  notes: string[];
  interviews: Interview[];
}

export interface Interview {
  id: string;
  candidateId: string;
  type: "phone_screen" | "technical" | "system_design" | "culture_fit" | "hr" | "bar_raiser";
  interviewerName: string;
  scheduledAt: string;
  duration: number;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  rating?: PerformanceRating;
  feedback?: string;
  recommendation?: "strong_hire" | "hire" | "no_hire" | "strong_no_hire";
}

// ─── Performance ─────────────────────────────────────────────

export interface PerformanceReview {
  id: string;
  cycleId: string;
  employeeId: string;
  employeeName: string;
  managerId: string;
  managerName: string;
  period: string;
  status: ReviewStatus;
  selfRating?: PerformanceRating;
  managerRating?: PerformanceRating;
  peerRatings?: { reviewerId: string; rating: PerformanceRating }[];
  finalRating?: PerformanceRating;
  goals: PerformanceGoal[];
  strengths: string[];
  areasForImprovement: string[];
  managerComments?: string;
  employeeComments?: string;
  developmentPlan?: string;
  promotionRecommendation?: boolean;
  completedAt?: string;
}

export interface PerformanceGoal {
  id: string;
  title: string;
  description: string;
  category: "business" | "development" | "operational";
  weight: number;
  targetValue?: number;
  actualValue?: number;
  progress: number;
  status: GoalStatus;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  milestones?: { title: string; dueDate: string; completed: boolean }[];
}

export interface ReviewCycle {
  id: string;
  name: string;
  type: "quarterly" | "mid_year" | "annual" | "probation";
  startDate: string;
  endDate: string;
  selfReviewDeadline: string;
  managerReviewDeadline: string;
  calibrationDeadline: string;
  status: "planning" | "self_review" | "manager_review" | "calibration" | "completed";
  participants: number;
  completionRate: number;
}

// ─── Training ────────────────────────────────────────────────

export interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  type: TrainingType;
  instructor: string;
  duration: number;
  modules: CourseModule[];
  level: CourseLevel;
  status: TrainingStatus;
  skills: string[];
  rating: number;
  reviewCount: number;
  enrolledCount: number;
  completionCount: number;
  maxEnrollment?: number;
  startDate?: string;
  endDate?: string;
  mandatory: boolean;
  certificateProvided: boolean;
  cost?: number;
  thumbnail?: string;
  createdAt: string;
}

export interface CourseModule {
  id: string;
  title: string;
  description: string;
  duration: number;
  type: "video" | "reading" | "quiz" | "assignment" | "live_session";
  order: number;
  content?: string;
}

export interface Enrollment {
  id: string;
  courseId: string;
  employeeId: string;
  enrolledAt: string;
  completedAt?: string;
  progress: number;
  score?: number;
  certificateUrl?: string;
  status: "enrolled" | "in_progress" | "completed" | "dropped";
  moduleProgress: Record<string, boolean>;
}

// ─── Helpdesk ────────────────────────────────────────────────

export interface Ticket {
  id: string;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  reporterId: string;
  reporterName: string;
  reporterDepartment: string;
  assigneeId?: string;
  assigneeName?: string;
  sla: number;
  slaDeadline: string;
  slaBreached: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  closedAt?: string;
  firstResponseAt?: string;
  messages: TicketMessage[];
  tags: string[];
  attachments: string[];
  satisfaction?: 1 | 2 | 3 | 4 | 5;
}

export interface TicketMessage {
  id: string;
  senderId: string;
  senderName: string;
  message: string;
  isInternal: boolean;
  isAgent: boolean;
  createdAt: string;
  attachments?: string[];
}

// ─── Assets ──────────────────────────────────────────────────

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  brand: string;
  model: string;
  serialNumber: string;
  purchaseDate: string;
  warrantyEndDate: string;
  purchasePrice: number;
  currentValue: number;
  depreciationRate: number;
  status: AssetStatus;
  condition: AssetCondition;
  assignedToId?: string;
  assignedToName?: string;
  assignedDepartment?: string;
  assignedDate?: string;
  location: string;
  notes?: string;
  maintenanceHistory: MaintenanceRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceRecord {
  id: string;
  type: "repair" | "upgrade" | "inspection" | "replacement";
  description: string;
  cost: number;
  vendor?: string;
  date: string;
  completedDate?: string;
  status: "scheduled" | "in_progress" | "completed";
}

// ─── Expenses ────────────────────────────────────────────────

export interface ExpenseClaim {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  title: string;
  category: ExpenseCategory;
  totalAmount: number;
  currency: string;
  status: ExpenseStatus;
  submittedDate: string;
  approvedDate?: string;
  approvedBy?: string;
  reimbursedDate?: string;
  lineItems: ExpenseLineItem[];
  receipts: string[];
  comments?: string;
  rejectionReason?: string;
  projectCode?: string;
  costCenter?: string;
}

export interface ExpenseLineItem {
  id: string;
  description: string;
  amount: number;
  date: string;
  category: ExpenseCategory;
  hasReceipt: boolean;
  receiptUrl?: string;
}

// ─── Notifications ───────────────────────────────────────────

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  channel: NotificationChannel;
  recipientId: string;
  senderId?: string;
  read: boolean;
  actionUrl?: string;
  actionLabel?: string;
  createdAt: string;
  readAt?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

// ─── Organization ────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  legalName: string;
  domain: string;
  industry: string;
  size: string;
  founded: string;
  headquarters: Address;
  phone: string;
  email: string;
  website: string;
  logo?: string;
  gstin?: string;
  pan?: string;
  cin?: string;
  subscription: SubscriptionPlan;
  settings: OrganizationSettings;
  createdAt: string;
}

export interface SubscriptionPlan {
  plan: "starter" | "professional" | "enterprise";
  maxEmployees: number;
  features: string[];
  billingCycle: "monthly" | "annual";
  pricePerEmployee: number;
  currency: string;
  startDate: string;
  endDate: string;
  status: "active" | "trial" | "expired" | "cancelled";
}

export interface OrganizationSettings {
  timezone: string;
  dateFormat: string;
  currency: string;
  workWeek: number[];
  workingHoursPerDay: number;
  financialYearStart: number;
  enableBiometric: boolean;
  enableGPS: boolean;
  enableSelfService: boolean;
  passwordPolicy: {
    minLength: number;
    requireUppercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    expiryDays: number;
  };
  leaveEncashmentAllowed: boolean;
  compOffExpiryDays: number;
  overtimeMultiplier: number;
  probationDays: number;
  noticePeriodDays: number;
}

// ─── Audit ───────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: "create" | "read" | "update" | "delete" | "login" | "logout" | "export" | "import";
  module: string;
  entityType: string;
  entityId: string;
  description: string;
  changes?: { field: string; oldValue: unknown; newValue: unknown }[];
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}

// ─── API Response Types ──────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  errors?: ApiError[];
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  field?: string;
  message: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ListQueryParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  filters?: Record<string, string>;
}

// ─── Dashboard Widget Types ──────────────────────────────────

export interface DashboardWidget {
  id: string;
  type: "stat" | "chart" | "list" | "table" | "progress" | "calendar";
  title: string;
  size: "sm" | "md" | "lg" | "xl";
  position: { row: number; col: number };
  config: Record<string, unknown>;
  visible: boolean;
}

export interface StatWidget {
  label: string;
  value: string | number;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon?: string;
  color?: string;
}

// ─── Report Types ────────────────────────────────────────────

export interface Report {
  id: string;
  name: string;
  category: string;
  description: string;
  type: "standard" | "custom";
  format: ("pdf" | "excel" | "csv" | "ppt")[];
  lastGenerated?: string;
  frequency?: "daily" | "weekly" | "monthly" | "quarterly" | "on_demand";
  parameters?: ReportParameter[];
  createdBy: string;
}

export interface ReportParameter {
  name: string;
  label: string;
  type: "text" | "date" | "daterange" | "select" | "multiselect" | "number";
  required: boolean;
  options?: { label: string; value: string }[];
  defaultValue?: string;
}

export interface ScheduledReport {
  id: string;
  reportId: string;
  reportName: string;
  schedule: string;
  format: string;
  recipients: string[];
  nextRunAt: string;
  lastRunAt?: string;
  active: boolean;
}
