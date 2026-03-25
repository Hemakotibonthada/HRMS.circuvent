export type UserRole = "owner" | "admin" | "hr_manager" | "manager" | "employee" | "viewer";
export type SubscriptionPlan = "starter" | "professional" | "enterprise";
export type SubscriptionStatus = "active" | "trial" | "past_due" | "cancelled" | "expired";

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  avatar?: string;
  organizationId?: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  industry?: string;
  size?: string;
  website?: string;
  address?: string;
  city?: string;
  country?: string;
  timezone?: string;
  currency?: string;
  ownerId: string;
  adminIds: string[];
  memberIds: string[];
  subscriptionId?: string;
  plan: SubscriptionPlan;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  organizationId: string;
  ownerId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  maxEmployees: number;
  currentEmployees: number;
  pricePerEmployee: number;
  currency: string;
  billingCycle: "monthly" | "yearly";
  trialEndsAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type EmployeeStatus = "active" | "on_leave" | "probation" | "notice_period" | "terminated" | "inactive";
export type EmploymentType = "full_time" | "part_time" | "contract" | "intern" | "freelance";
export type Gender = "male" | "female" | "other" | "prefer_not_to_say";

export interface Employee {
  id: string;
  uid?: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatar?: string;
  gender?: Gender;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  country?: string;
  departmentId?: string;
  departmentName?: string;
  designation: string;
  reportingTo?: string;
  reportingToName?: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  joinDate: string;
  confirmationDate?: string;
  exitDate?: string;
  salary?: number;
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
  };
  emergencyContact?: {
    name: string;
    phone: string;
    relation: string;
  };
  skills?: string[];
  documents?: EmployeeDocument[];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeDocument {
  id: string;
  name: string;
  type: string;
  url: string;
  uploadedAt: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  headId?: string;
  headName?: string;
  parentId?: string;
  employeeCount: number;
  organizationId: string;
  createdAt: string;
}

export type AttendanceStatus = "present" | "absent" | "half_day" | "late" | "on_leave" | "holiday" | "weekend";

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
  notes?: string;
  location?: string;
  organizationId: string;
  createdAt: string;
}

export type LeaveType = "casual" | "sick" | "earned" | "maternity" | "paternity" | "compensatory" | "unpaid" | "bereavement";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar?: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectionReason?: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveBalance {
  employeeId: string;
  year: number;
  casual: { total: number; used: number; pending: number };
  sick: { total: number; used: number; pending: number };
  earned: { total: number; used: number; pending: number };
  maternity: { total: number; used: number; pending: number };
  paternity: { total: number; used: number; pending: number };
  compensatory: { total: number; used: number; pending: number };
  unpaid: { total: number; used: number; pending: number };
}

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
  bonus: number;
  grossSalary: number;
  providentFund: number;
  professionalTax: number;
  incomeTax: number;
  otherDeductions: number;
  totalDeductions: number;
  netSalary: number;
  status: "draft" | "processed" | "paid" | "on_hold";
  paidAt?: string;
  organizationId: string;
  createdAt: string;
}

export type JobStatus = "draft" | "open" | "closed" | "on_hold";
export type ApplicationStatus = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";

export interface JobPosting {
  id: string;
  title: string;
  departmentId?: string;
  departmentName?: string;
  location: string;
  type: EmploymentType;
  experience: string;
  salary?: { min: number; max: number; currency: string };
  description: string;
  requirements: string[];
  responsibilities: string[];
  benefits?: string[];
  status: JobStatus;
  applicantCount: number;
  postedBy: string;
  postedByName: string;
  closingDate?: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Applicant {
  id: string;
  jobId: string;
  jobTitle: string;
  name: string;
  email: string;
  phone?: string;
  resumeUrl?: string;
  coverLetter?: string;
  experience: string;
  currentCompany?: string;
  skills: string[];
  status: ApplicationStatus;
  rating?: number;
  notes?: string;
  interviewDate?: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export type ReviewCycle = "quarterly" | "half_yearly" | "annual";
export type ReviewStatus = "pending" | "self_review" | "manager_review" | "completed";

export interface PerformanceReview {
  id: string;
  employeeId: string;
  employeeName: string;
  reviewerId: string;
  reviewerName: string;
  cycle: ReviewCycle;
  period: string;
  selfRating?: number;
  managerRating?: number;
  overallRating?: number;
  strengths?: string;
  areasOfImprovement?: string;
  goals?: ReviewGoal[];
  status: ReviewStatus;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewGoal {
  id: string;
  title: string;
  description?: string;
  targetDate: string;
  progress: number;
  status: "not_started" | "in_progress" | "completed" | "deferred";
}

export interface TrainingCourse {
  id: string;
  title: string;
  description: string;
  category: string;
  instructor?: string;
  duration: string;
  startDate?: string;
  endDate?: string;
  maxParticipants?: number;
  enrolledCount: number;
  status: "upcoming" | "in_progress" | "completed" | "cancelled";
  type: "online" | "classroom" | "hybrid";
  materials?: string[];
  organizationId: string;
  createdAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  departmentId?: string;
  pinned: boolean;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingChecklist {
  id: string;
  employeeId: string;
  employeeName: string;
  tasks: OnboardingTask[];
  progress: number;
  assignedBy: string;
  assignedByName: string;
  startDate: string;
  dueDate: string;
  status: "pending" | "in_progress" | "completed";
  organizationId: string;
  createdAt: string;
}

export interface OnboardingTask {
  id: string;
  title: string;
  description?: string;
  category: "documentation" | "system_access" | "training" | "introduction" | "equipment";
  completed: boolean;
  completedAt?: string;
  assignee?: string;
}

export interface AwardRecognition {
  id: string;
  recipientId: string;
  recipientName: string;
  recipientAvatar?: string;
  awardType: "employee_of_month" | "spot_award" | "team_award" | "innovation" | "leadership" | "custom";
  title: string;
  description: string;
  awardedBy: string;
  awardedByName: string;
  date: string;
  organizationId: string;
  createdAt: string;
}

export interface HRDocument {
  id: string;
  title: string;
  description?: string;
  category: "policy" | "template" | "form" | "handbook" | "contract" | "other";
  fileUrl: string;
  fileType: string;
  fileSize: number;
  version: number;
  uploadedBy: string;
  uploadedByName: string;
  departmentId?: string;
  isPublic: boolean;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}
