// ═══════════════════════════════════════════════════════════════════════
// FORM VALIDATION & UTILITIES
// Comprehensive validation rules for all HRMS forms
// ═══════════════════════════════════════════════════════════════════════

export type ValidationRule = {
  validate: (value: unknown, formValues?: Record<string, unknown>) => boolean;
  message: string;
};

export type FieldValidation = ValidationRule[];

// ─── BASIC VALIDATORS ────────────────────────────────────────────────

export const required = (fieldName: string): ValidationRule => ({
  validate: (value) => {
    if (typeof value === "string") return value.trim().length > 0;
    if (typeof value === "number") return true;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined;
  },
  message: `${fieldName} is required`,
});

export const minLength = (min: number, fieldName: string): ValidationRule => ({
  validate: (value) => typeof value === "string" && value.length >= min,
  message: `${fieldName} must be at least ${min} characters`,
});

export const maxLength = (max: number, fieldName: string): ValidationRule => ({
  validate: (value) => typeof value === "string" && value.length <= max,
  message: `${fieldName} must not exceed ${max} characters`,
});

export const email = (): ValidationRule => ({
  validate: (value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  message: "Please enter a valid email address",
});

export const phone = (): ValidationRule => ({
  validate: (value) => typeof value === "string" && /^\+?[\d\s-]{10,15}$/.test(value.replace(/\s/g, "")),
  message: "Please enter a valid phone number",
});

export const minValue = (min: number, fieldName: string): ValidationRule => ({
  validate: (value) => typeof value === "number" && value >= min,
  message: `${fieldName} must be at least ${min}`,
});

export const maxValue = (max: number, fieldName: string): ValidationRule => ({
  validate: (value) => typeof value === "number" && value <= max,
  message: `${fieldName} must not exceed ${max}`,
});

export const pattern = (regex: RegExp, message: string): ValidationRule => ({
  validate: (value) => typeof value === "string" && regex.test(value),
  message,
});

export const dateNotPast = (fieldName: string): ValidationRule => ({
  validate: (value) => {
    if (typeof value !== "string") return false;
    const date = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
  },
  message: `${fieldName} cannot be in the past`,
});

export const dateNotFuture = (fieldName: string): ValidationRule => ({
  validate: (value) => {
    if (typeof value !== "string") return false;
    const date = new Date(value);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date <= today;
  },
  message: `${fieldName} cannot be in the future`,
});

export const dateBefore = (otherField: string, otherLabel: string): ValidationRule => ({
  validate: (value, formValues) => {
    if (typeof value !== "string" || !formValues) return true;
    const otherValue = formValues[otherField];
    if (typeof otherValue !== "string") return true;
    return new Date(value) <= new Date(otherValue);
  },
  message: `Must be before ${otherLabel}`,
});

export const dateAfter = (otherField: string, otherLabel: string): ValidationRule => ({
  validate: (value, formValues) => {
    if (typeof value !== "string" || !formValues) return true;
    const otherValue = formValues[otherField];
    if (typeof otherValue !== "string") return true;
    return new Date(value) >= new Date(otherValue);
  },
  message: `Must be after ${otherLabel}`,
});

export const passwordStrength = (): ValidationRule => ({
  validate: (value) => {
    if (typeof value !== "string") return false;
    return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
  },
  message: "Password must be 8+ chars with upper, lower, number, and special character",
});

export const panNumber = (): ValidationRule => ({
  validate: (value) => typeof value === "string" && /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(value.toUpperCase()),
  message: "Please enter a valid PAN number (e.g., ABCDE1234F)",
});

export const aadhaar = (): ValidationRule => ({
  validate: (value) => typeof value === "string" && /^\d{12}$/.test(value.replace(/\s/g, "")),
  message: "Please enter a valid 12-digit Aadhaar number",
});

export const ifscCode = (): ValidationRule => ({
  validate: (value) => typeof value === "string" && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value.toUpperCase()),
  message: "Please enter a valid IFSC code",
});

export const employeeId = (): ValidationRule => ({
  validate: (value) => typeof value === "string" && /^[A-Z]{2,4}\d{3,6}$/.test(value.toUpperCase()),
  message: "Please enter a valid employee ID (e.g., EMP001)",
});

export const url = (): ValidationRule => ({
  validate: (value) => {
    if (typeof value !== "string" || value === "") return true;
    try { new URL(value); return true; } catch { return false; }
  },
  message: "Please enter a valid URL",
});

export const fileSize = (maxMB: number): ValidationRule => ({
  validate: (value) => {
    if (!(value instanceof File)) return true;
    return value.size <= maxMB * 1024 * 1024;
  },
  message: `File size must not exceed ${maxMB}MB`,
});

export const fileType = (allowedTypes: string[]): ValidationRule => ({
  validate: (value) => {
    if (!(value instanceof File)) return true;
    const ext = value.name.split(".").pop()?.toLowerCase() || "";
    return allowedTypes.includes(ext);
  },
  message: `Allowed file types: ${allowedTypes.join(", ")}`,
});

// ─── VALIDATION RUNNER ───────────────────────────────────────────────

export function validateField(value: unknown, rules: ValidationRule[], formValues?: Record<string, unknown>): string | null {
  for (const rule of rules) {
    if (!rule.validate(value, formValues)) {
      return rule.message;
    }
  }
  return null;
}

export function validateForm(
  values: Record<string, unknown>,
  schema: Record<string, ValidationRule[]>
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [field, rules] of Object.entries(schema)) {
    const error = validateField(values[field], rules, values);
    if (error) errors[field] = error;
  }
  return errors;
}

export function isFormValid(errors: Record<string, string>): boolean {
  return Object.keys(errors).length === 0;
}

// ─── PRE-BUILT VALIDATION SCHEMAS ────────────────────────────────────

export const EMPLOYEE_SCHEMA: Record<string, ValidationRule[]> = {
  firstName: [required("First name"), minLength(2, "First name"), maxLength(50, "First name")],
  lastName: [required("Last name"), minLength(2, "Last name"), maxLength(50, "Last name")],
  email: [required("Email"), email()],
  phone: [phone()],
  department: [required("Department")],
  designation: [required("Designation")],
  joinDate: [required("Join date")],
  employmentType: [required("Employment type")],
};

export const LEAVE_SCHEMA: Record<string, ValidationRule[]> = {
  leaveType: [required("Leave type")],
  startDate: [required("Start date"), dateNotPast("Start date")],
  endDate: [required("End date"), dateAfter("startDate", "start date")],
  reason: [required("Reason"), minLength(10, "Reason")],
};

export const EXPENSE_SCHEMA: Record<string, ValidationRule[]> = {
  category: [required("Category")],
  amount: [required("Amount"), minValue(1, "Amount")],
  description: [required("Description"), minLength(5, "Description")],
  date: [required("Date"), dateNotFuture("Expense date")],
};

export const JOB_POSTING_SCHEMA: Record<string, ValidationRule[]> = {
  title: [required("Job title"), minLength(5, "Title")],
  department: [required("Department")],
  location: [required("Location")],
  experience: [required("Experience")],
  description: [required("Description"), minLength(50, "Description")],
};

export const CANDIDATE_SCHEMA: Record<string, ValidationRule[]> = {
  name: [required("Candidate name"), minLength(2, "Name")],
  email: [required("Email"), email()],
  position: [required("Position")],
  experience: [required("Experience")],
};

export const TICKET_SCHEMA: Record<string, ValidationRule[]> = {
  title: [required("Title"), minLength(5, "Title")],
  category: [required("Category")],
  priority: [required("Priority")],
  description: [required("Description"), minLength(10, "Description")],
};

export const TRAVEL_SCHEMA: Record<string, ValidationRule[]> = {
  purpose: [required("Purpose"), minLength(5, "Purpose")],
  from: [required("Departure city")],
  to: [required("Destination city")],
  startDate: [required("Start date"), dateNotPast("Start date")],
  endDate: [required("End date"), dateAfter("startDate", "start date")],
  budget: [required("Budget"), minValue(100, "Budget")],
};

export const ANNOUNCEMENT_SCHEMA: Record<string, ValidationRule[]> = {
  title: [required("Title"), minLength(5, "Title"), maxLength(200, "Title")],
  content: [required("Content"), minLength(20, "Content")],
  priority: [required("Priority")],
};

export const GRIEVANCE_SCHEMA: Record<string, ValidationRule[]> = {
  title: [required("Title"), minLength(10, "Title")],
  category: [required("Category")],
  severity: [required("Severity")],
  description: [required("Description"), minLength(20, "Description")],
};

export const FEEDBACK_SCHEMA: Record<string, ValidationRule[]> = {
  type: [required("Feedback type")],
  title: [required("Title"), minLength(5, "Title")],
  content: [required("Content"), minLength(10, "Content")],
};

export const LOAN_SCHEMA: Record<string, ValidationRule[]> = {
  type: [required("Loan type")],
  amount: [required("Amount"), minValue(5000, "Amount"), maxValue(1000000, "Amount")],
  tenure: [required("Tenure"), minValue(1, "Tenure"), maxValue(60, "Tenure")],
  purpose: [required("Purpose"), minLength(5, "Purpose")],
};

export const WFH_SCHEMA: Record<string, ValidationRule[]> = {
  startDate: [required("Start date"), dateNotPast("Start date")],
  endDate: [required("End date"), dateAfter("startDate", "start date")],
  location: [required("Location")],
  reason: [required("Reason"), minLength(5, "Reason")],
};

export const VISITOR_SCHEMA: Record<string, ValidationRule[]> = {
  name: [required("Visitor name"), minLength(2, "Name")],
  company: [required("Company")],
  purpose: [required("Purpose")],
  host: [required("Host employee")],
  date: [required("Visit date")],
};

export const INCIDENT_SCHEMA: Record<string, ValidationRule[]> = {
  title: [required("Title"), minLength(5, "Title")],
  category: [required("Category")],
  severity: [required("Severity")],
  location: [required("Location")],
  description: [required("Description"), minLength(20, "Description")],
};

export const SURVEY_SCHEMA: Record<string, ValidationRule[]> = {
  title: [required("Title"), minLength(5, "Title")],
  description: [required("Description"), minLength(10, "Description")],
  deadline: [required("Deadline"), dateNotPast("Deadline")],
};

export const ROOM_BOOKING_SCHEMA: Record<string, ValidationRule[]> = {
  room: [required("Room")],
  purpose: [required("Purpose"), minLength(3, "Purpose")],
  date: [required("Date"), dateNotPast("Date")],
  startTime: [required("Start time")],
  endTime: [required("End time")],
};

export const TIMESHEET_SCHEMA: Record<string, ValidationRule[]> = {
  project: [required("Project")],
  task: [required("Task description"), minLength(3, "Task")],
  hours: [required("Hours"), minValue(0.5, "Hours"), maxValue(16, "Hours")],
  date: [required("Date")],
};

export const REFERRAL_SCHEMA: Record<string, ValidationRule[]> = {
  candidateName: [required("Candidate name"), minLength(2, "Name")],
  candidateEmail: [required("Email"), email()],
  position: [required("Position")],
  relationship: [required("Relationship")],
};

export const OVERTIME_SCHEMA: Record<string, ValidationRule[]> = {
  date: [required("Date")],
  hours: [required("Hours"), minValue(0.5, "Hours"), maxValue(8, "Hours")],
  reason: [required("Reason"), minLength(5, "Reason")],
};

export const ASSET_SCHEMA: Record<string, ValidationRule[]> = {
  name: [required("Asset name"), minLength(2, "Name")],
  category: [required("Category")],
  serialNumber: [required("Serial number")],
  purchaseDate: [required("Purchase date")],
  value: [required("Value"), minValue(0, "Value")],
};

export const BANK_DETAILS_SCHEMA: Record<string, ValidationRule[]> = {
  bankName: [required("Bank name")],
  accountNumber: [required("Account number"), minLength(8, "Account number")],
  ifscCode: [required("IFSC code"), ifscCode()],
};

export const TAX_DECLARATION_SCHEMA: Record<string, ValidationRule[]> = {
  panNumber: [required("PAN number"), panNumber()],
  regime: [required("Tax regime")],
};

// ─── FORM HELPERS ────────────────────────────────────────────────────

export function getFieldError(errors: Record<string, string>, field: string): string | undefined {
  return errors[field];
}

export function hasFieldError(errors: Record<string, string>, field: string): boolean {
  return !!errors[field];
}

export function clearFieldError(errors: Record<string, string>, field: string): Record<string, string> {
  const newErrors = { ...errors };
  delete newErrors[field];
  return newErrors;
}

export function formatCurrency(amount: number, currency = "INR"): string {
  if (currency === "INR") return "₹" + amount.toLocaleString("en-IN");
  if (currency === "USD") return "$" + amount.toLocaleString("en-US");
  return `${currency} ${amount.toLocaleString()}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function generateEmployeeId(): string {
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `EMP${num}`;
}

export function calculateLeaveDays(startDate: string, endDate: string, halfDay = false): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (halfDay) return 0.5;
  let days = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) days++; // Exclude weekends
    current.setDate(current.getDate() + 1);
  }
  return days;
}

export function calculateTenure(joinDate: string): string {
  const start = new Date(joinDate);
  const now = new Date();
  const years = now.getFullYear() - start.getFullYear();
  const months = now.getMonth() - start.getMonth();
  const totalMonths = years * 12 + months;
  if (totalMonths < 12) return `${totalMonths} months`;
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  return m > 0 ? `${y} yr ${m} mo` : `${y} years`;
}

export function calculateAge(dob: string): number {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

export function calculateEMI(principal: number, annualRate: number, tenureMonths: number): number {
  const monthlyRate = annualRate / 12 / 100;
  if (monthlyRate === 0) return principal / tenureMonths;
  const emi = principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths) / (Math.pow(1 + monthlyRate, tenureMonths) - 1);
  return Math.round(emi);
}

export function calculateNetSalary(gross: number, deductions: Record<string, number>): number {
  const totalDeductions = Object.values(deductions).reduce((sum, val) => sum + val, 0);
  return gross - totalDeductions;
}

export function getFinancialYear(date?: Date): string {
  const d = date || new Date();
  const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `FY ${year}-${(year + 1).toString().slice(-2)}`;
}

export function getQuarter(date?: Date): string {
  const d = date || new Date();
  const month = d.getMonth();
  if (month >= 0 && month <= 2) return "Q4";
  if (month >= 3 && month <= 5) return "Q1";
  if (month >= 6 && month <= 8) return "Q2";
  return "Q3";
}

export function getWorkingDays(month: number, year: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) workingDays++;
  }
  return workingDays;
}
