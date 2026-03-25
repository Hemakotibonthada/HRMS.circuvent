// ═══════════════════════════════════════════════════════════════
// HR FORM VALIDATION LIBRARY
// Comprehensive validation utilities, schemas, and helpers
// for all HRMS form inputs with Indian-specific validations
// ═══════════════════════════════════════════════════════════════

// ─── Core Validation Types ───────────────────────────────────

export type ValidationResult = { valid: true } | { valid: false; message: string };
export type Validator<T = string> = (value: T, fieldName?: string) => ValidationResult;

export function valid(): ValidationResult {
  return { valid: true };
}

export function invalid(message: string): ValidationResult {
  return { valid: false, message };
}

// ─── String Validators ───────────────────────────────────────

export function required(value: string, fieldName = "This field"): ValidationResult {
  if (!value || value.trim().length === 0) return invalid(`${fieldName} is required`);
  return valid();
}

export function minLength(min: number): Validator {
  return (value, fieldName = "Value") => {
    if (value.length < min) return invalid(`${fieldName} must be at least ${min} characters`);
    return valid();
  };
}

export function maxLength(max: number): Validator {
  return (value, fieldName = "Value") => {
    if (value.length > max) return invalid(`${fieldName} must be at most ${max} characters`);
    return valid();
  };
}

export function pattern(regex: RegExp, message: string): Validator {
  return (value) => {
    if (!regex.test(value)) return invalid(message);
    return valid();
  };
}

export function isEmail(value: string): ValidationResult {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return invalid("Invalid email address");
  return valid();
}

export function isCorporateEmail(value: string, domain: string): ValidationResult {
  const emailResult = isEmail(value);
  if (!emailResult.valid) return emailResult;
  if (!value.endsWith(`@${domain}`)) return invalid(`Must be a ${domain} email`);
  return valid();
}

export function isPhone(value: string): ValidationResult {
  const cleaned = value.replace(/[\s\-+()\s]/g, "");
  if (!/^[6-9]\d{9}$/.test(cleaned)) return invalid("Invalid Indian phone number");
  return valid();
}

export function isURL(value: string): ValidationResult {
  try { new URL(value); return valid(); } catch { return invalid("Invalid URL"); }
}

// ─── Indian-Specific Validators ──────────────────────────────

export function isPAN(value: string): ValidationResult {
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.toUpperCase())) return invalid("Invalid PAN number (e.g., AAAPZ1234C)");
  return valid();
}

export function isAadhaar(value: string): ValidationResult {
  const cleaned = value.replace(/\s/g, "");
  if (!/^\d{12}$/.test(cleaned)) return invalid("Invalid Aadhaar number (12 digits)");
  return valid();
}

export function isIFSC(value: string): ValidationResult {
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(value.toUpperCase())) return invalid("Invalid IFSC code");
  return valid();
}

export function isGSTIN(value: string): ValidationResult {
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z0-9]$/.test(value.toUpperCase())) return invalid("Invalid GSTIN");
  return valid();
}

export function isUAN(value: string): ValidationResult {
  if (!/^\d{12}$/.test(value)) return invalid("Invalid UAN number (12 digits)");
  return valid();
}

export function isPincode(value: string): ValidationResult {
  if (!/^\d{6}$/.test(value)) return invalid("Invalid PIN code (6 digits)");
  return valid();
}

export function isBankAccount(value: string): ValidationResult {
  if (!/^\d{9,18}$/.test(value)) return invalid("Invalid bank account number (9-18 digits)");
  return valid();
}

// ─── Number Validators ───────────────────────────────────────

export function isNumber(value: string, fieldName = "Value"): ValidationResult {
  if (isNaN(Number(value)) || value.trim() === "") return invalid(`${fieldName} must be a number`);
  return valid();
}

export function inRange(min: number, max: number): Validator {
  return (value, fieldName = "Value") => {
    const num = Number(value);
    if (isNaN(num)) return invalid(`${fieldName} must be a number`);
    if (num < min || num > max) return invalid(`${fieldName} must be between ${min} and ${max}`);
    return valid();
  };
}

export function isPositive(value: string, fieldName = "Value"): ValidationResult {
  const num = Number(value);
  if (isNaN(num) || num <= 0) return invalid(`${fieldName} must be a positive number`);
  return valid();
}

export function isCurrency(value: string): ValidationResult {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return invalid("Invalid amount (max 2 decimal places)");
  return valid();
}

export function maxAmount(max: number): Validator {
  return (value, fieldName = "Amount") => {
    const num = Number(value);
    if (num > max) return invalid(`${fieldName} cannot exceed ₹${max.toLocaleString("en-IN")}`);
    return valid();
  };
}

// ─── Date Validators ─────────────────────────────────────────

export function isDate(value: string): ValidationResult {
  const d = new Date(value);
  if (isNaN(d.getTime())) return invalid("Invalid date");
  return valid();
}

export function isFutureDate(value: string, fieldName = "Date"): ValidationResult {
  const d = new Date(value);
  if (isNaN(d.getTime())) return invalid("Invalid date");
  if (d <= new Date()) return invalid(`${fieldName} must be in the future`);
  return valid();
}

export function isPastDate(value: string, fieldName = "Date"): ValidationResult {
  const d = new Date(value);
  if (isNaN(d.getTime())) return invalid("Invalid date");
  if (d >= new Date()) return invalid(`${fieldName} must be in the past`);
  return valid();
}

export function isWithinRange(minDate: Date, maxDate: Date): Validator {
  return (value, fieldName = "Date") => {
    const d = new Date(value);
    if (d < minDate || d > maxDate) return invalid(`${fieldName} must be between ${minDate.toLocaleDateString()} and ${maxDate.toLocaleDateString()}`);
    return valid();
  };
}

export function isAge(minAge: number, maxAge: number): Validator {
  return (value, fieldName = "Date of birth") => {
    const dob = new Date(value);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    if (age < minAge || age > maxAge) return invalid(`${fieldName}: Age must be between ${minAge} and ${maxAge}`);
    return valid();
  };
}

// ─── Password Validators ─────────────────────────────────────

export function isStrongPassword(value: string): ValidationResult {
  const errors: string[] = [];
  if (value.length < 8) errors.push("at least 8 characters");
  if (!/[A-Z]/.test(value)) errors.push("one uppercase letter");
  if (!/[a-z]/.test(value)) errors.push("one lowercase letter");
  if (!/[0-9]/.test(value)) errors.push("one number");
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(value)) errors.push("one special character");
  if (errors.length > 0) return invalid(`Password needs: ${errors.join(", ")}`);
  return valid();
}

export function passwordsMatch(password: string): Validator {
  return (value) => {
    if (value !== password) return invalid("Passwords do not match");
    return valid();
  };
}

// ─── File Validators ─────────────────────────────────────────

export function isAllowedFileType(allowed: string[]): Validator {
  return (value) => {
    const ext = value.split(".").pop()?.toLowerCase() ?? "";
    if (!allowed.includes(ext)) return invalid(`Allowed file types: ${allowed.join(", ")}`);
    return valid();
  };
}

export function isMaxFileSize(maxBytes: number): Validator<number> {
  return (value) => {
    if (value > maxBytes) {
      const maxMB = (maxBytes / (1024 * 1024)).toFixed(1);
      return invalid(`File size must be under ${maxMB} MB`);
    }
    return valid();
  };
}

// ─── Composite Validators ────────────────────────────────────

export function compose(...validators: Validator[]): Validator {
  return (value, fieldName) => {
    for (const validator of validators) {
      const result = validator(value, fieldName);
      if (!result.valid) return result;
    }
    return valid();
  };
}

export function optional(validator: Validator): Validator {
  return (value, fieldName) => {
    if (!value || value.trim() === "") return valid();
    return validator(value, fieldName);
  };
}

// ─── Schema Validation ──────────────────────────────────────

type SchemaField = {
  validator: Validator;
  fieldName?: string;
};

type Schema = Record<string, SchemaField>;

export function validateSchema(data: Record<string, string>, schema: Schema): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, field] of Object.entries(schema)) {
    const value = data[key] ?? "";
    const result = field.validator(value, field.fieldName ?? key);
    if (!result.valid) errors[key] = result.message;
  }
  return errors;
}

export function isSchemaValid(errors: Record<string, string>): boolean {
  return Object.keys(errors).length === 0;
}

// ─── Pre-built Schemas ──────────────────────────────────────

export const EMPLOYEE_SCHEMA: Schema = {
  firstName: { validator: compose(required, minLength(2)), fieldName: "First name" },
  lastName: { validator: compose(required, minLength(2)), fieldName: "Last name" },
  email: { validator: compose(required, isEmail), fieldName: "Email" },
  phone: { validator: compose(required, isPhone), fieldName: "Phone" },
  department: { validator: required, fieldName: "Department" },
  designation: { validator: required, fieldName: "Designation" },
  joiningDate: { validator: compose(required, isDate), fieldName: "Joining date" },
  salary: { validator: compose(required, isPositive), fieldName: "Salary" },
};

export const LEAVE_SCHEMA: Schema = {
  leaveType: { validator: required, fieldName: "Leave type" },
  fromDate: { validator: compose(required, isDate), fieldName: "From date" },
  toDate: { validator: compose(required, isDate), fieldName: "To date" },
  reason: { validator: compose(required, minLength(10)), fieldName: "Reason" },
};

export const EXPENSE_SCHEMA: Schema = {
  category: { validator: required, fieldName: "Category" },
  amount: { validator: compose(required, isPositive, maxAmount(500000)), fieldName: "Amount" },
  date: { validator: compose(required, isDate), fieldName: "Date" },
  description: { validator: compose(required, minLength(5)), fieldName: "Description" },
};

export const JOB_POSTING_SCHEMA: Schema = {
  title: { validator: compose(required, minLength(5)), fieldName: "Job title" },
  department: { validator: required, fieldName: "Department" },
  location: { validator: required, fieldName: "Location" },
  description: { validator: compose(required, minLength(50)), fieldName: "Description" },
};

export const CANDIDATE_SCHEMA: Schema = {
  firstName: { validator: compose(required, minLength(2)), fieldName: "First name" },
  lastName: { validator: compose(required, minLength(2)), fieldName: "Last name" },
  email: { validator: compose(required, isEmail), fieldName: "Email" },
  phone: { validator: compose(required, isPhone), fieldName: "Phone" },
  experience: { validator: compose(required, isPositive), fieldName: "Experience" },
  expectedCTC: { validator: compose(required, isPositive), fieldName: "Expected CTC" },
};

export const TICKET_SCHEMA: Schema = {
  title: { validator: compose(required, minLength(5)), fieldName: "Subject" },
  category: { validator: required, fieldName: "Category" },
  priority: { validator: required, fieldName: "Priority" },
  description: { validator: compose(required, minLength(20)), fieldName: "Description" },
};

export const ASSET_SCHEMA: Schema = {
  name: { validator: compose(required, minLength(3)), fieldName: "Asset name" },
  type: { validator: required, fieldName: "Type" },
  brand: { validator: required, fieldName: "Brand" },
  serialNumber: { validator: compose(required, minLength(5)), fieldName: "Serial number" },
  cost: { validator: compose(required, isPositive), fieldName: "Cost" },
  purchaseDate: { validator: compose(required, isDate), fieldName: "Purchase date" },
};

export const BANK_DETAILS_SCHEMA: Schema = {
  accountName: { validator: compose(required, minLength(3)), fieldName: "Account holder name" },
  accountNumber: { validator: compose(required, isBankAccount), fieldName: "Account number" },
  ifscCode: { validator: compose(required, isIFSC), fieldName: "IFSC code" },
  bankName: { validator: required, fieldName: "Bank name" },
  panNumber: { validator: compose(required, isPAN), fieldName: "PAN number" },
};

export const ADDRESS_SCHEMA: Schema = {
  line1: { validator: compose(required, minLength(5)), fieldName: "Address line 1" },
  city: { validator: required, fieldName: "City" },
  state: { validator: required, fieldName: "State" },
  pincode: { validator: compose(required, isPincode), fieldName: "PIN code" },
};

export const CONTRACTOR_SCHEMA: Schema = {
  name: { validator: compose(required, minLength(3)), fieldName: "Contractor name" },
  vendorCompany: { validator: required, fieldName: "Vendor company" },
  role: { validator: required, fieldName: "Role" },
  dailyRate: { validator: compose(required, isPositive), fieldName: "Daily rate" },
  contractStart: { validator: compose(required, isDate), fieldName: "Contract start" },
  contractEnd: { validator: compose(required, isDate, isFutureDate), fieldName: "Contract end" },
};

export const TRAVEL_SCHEMA: Schema = {
  purpose: { validator: compose(required, minLength(10)), fieldName: "Purpose" },
  destination: { validator: required, fieldName: "Destination" },
  departureDate: { validator: compose(required, isDate, isFutureDate), fieldName: "Departure date" },
  returnDate: { validator: compose(required, isDate, isFutureDate), fieldName: "Return date" },
  estimatedCost: { validator: compose(required, isPositive), fieldName: "Estimated cost" },
};

// ─── Indian State List ───────────────────────────────────────

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Chandigarh", "Puducherry", "Ladakh", "Jammu & Kashmir",
  "Andaman & Nicobar", "Dadra & Nagar Haveli", "Daman & Diu", "Lakshadweep",
] as const;

// ─── Department Options ──────────────────────────────────────

export const DEPARTMENTS = [
  "Engineering", "Design", "Sales", "Marketing", "HR",
  "Finance", "Support", "Operations", "Legal", "Admin",
] as const;

// ─── Designation Options ─────────────────────────────────────

export const DESIGNATIONS = [
  "Intern", "Junior Engineer", "Engineer", "Senior Engineer", "Lead Engineer",
  "Principal Engineer", "Engineering Manager", "Director", "VP", "CTO",
  "Designer", "Senior Designer", "Lead Designer", "Design Manager",
  "Analyst", "Senior Analyst", "Manager", "Senior Manager",
  "Executive", "Associate", "Coordinator", "Specialist",
] as const;

// ─── Leave Types ─────────────────────────────────────────────

export const LEAVE_TYPES = [
  { value: "casual", label: "Casual Leave", maxDays: 12 },
  { value: "sick", label: "Sick Leave", maxDays: 12 },
  { value: "earned", label: "Earned Leave", maxDays: 15 },
  { value: "maternity", label: "Maternity Leave", maxDays: 182 },
  { value: "paternity", label: "Paternity Leave", maxDays: 15 },
  { value: "comp_off", label: "Compensatory Off", maxDays: 3 },
  { value: "wfh", label: "Work From Home", maxDays: 24 },
  { value: "half_day", label: "Half Day", maxDays: 0 },
  { value: "unpaid", label: "Unpaid Leave", maxDays: 0 },
] as const;

// ─── Expense Categories ─────────────────────────────────────

export const EXPENSE_CATEGORIES = [
  { value: "travel", label: "Travel", limit: 50000 },
  { value: "equipment", label: "Equipment", limit: 25000 },
  { value: "training", label: "Training", limit: 50000 },
  { value: "software", label: "Software", limit: 15000 },
  { value: "books", label: "Books", limit: 5000 },
  { value: "events", label: "Events", limit: 100000 },
  { value: "client_meeting", label: "Client Meeting", limit: 20000 },
  { value: "marketing", label: "Marketing", limit: 100000 },
  { value: "office_supplies", label: "Office Supplies", limit: 10000 },
  { value: "other", label: "Other", limit: 10000 },
] as const;
