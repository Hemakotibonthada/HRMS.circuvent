// ═══════════════════════════════════════════════════════════════
// COMPREHENSIVE FORM SCHEMAS & VALIDATION
// Typed validation schemas for all HRMS forms with error messages,
// conditional rules, cross-field validation, and async validators
// ═══════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────

export interface FieldRule {
  type: "required" | "minLength" | "maxLength" | "pattern" | "min" | "max" | "email" | "phone" | "custom";
  value?: unknown;
  message: string;
  validator?: (value: unknown, formValues?: Record<string, unknown>) => boolean;
}

export interface FieldSchema {
  name: string;
  label: string;
  type: "text" | "email" | "password" | "number" | "tel" | "date" | "textarea" | "select" | "multiselect" | "checkbox" | "radio" | "file";
  placeholder?: string;
  defaultValue?: unknown;
  rules: FieldRule[];
  options?: { label: string; value: string }[];
  dependsOn?: { field: string; value: unknown };
  helperText?: string;
  colSpan?: 1 | 2;
}

export interface FormSchema {
  id: string;
  title: string;
  description?: string;
  fields: FieldSchema[];
  sections?: { title: string; fields: string[] }[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

// ─── Validators ──────────────────────────────────────────────

export function validateField(value: unknown, rules: FieldRule[], formValues?: Record<string, unknown>): string | null {
  for (const rule of rules) {
    const strValue = value != null ? String(value) : "";
    
    switch (rule.type) {
      case "required":
        if (!value || strValue.trim() === "") return rule.message;
        break;
      case "minLength":
        if (strValue.length < (rule.value as number)) return rule.message;
        break;
      case "maxLength":
        if (strValue.length > (rule.value as number)) return rule.message;
        break;
      case "min":
        if (Number(value) < (rule.value as number)) return rule.message;
        break;
      case "max":
        if (Number(value) > (rule.value as number)) return rule.message;
        break;
      case "pattern":
        if (!new RegExp(rule.value as string).test(strValue)) return rule.message;
        break;
      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strValue)) return rule.message;
        break;
      case "phone":
        if (!/^[6-9]\d{9}$/.test(strValue.replace(/[\s\-+()]/g, ""))) return rule.message;
        break;
      case "custom":
        if (rule.validator && !rule.validator(value, formValues)) return rule.message;
        break;
    }
  }
  return null;
}

export function validateForm(values: Record<string, unknown>, schema: FormSchema): ValidationResult {
  const errors: Record<string, string> = {};
  
  for (const field of schema.fields) {
    // Check dependsOn condition
    if (field.dependsOn) {
      const depValue = values[field.dependsOn.field];
      if (depValue !== field.dependsOn.value) continue;
    }
    
    const error = validateField(values[field.name], field.rules, values);
    if (error) errors[field.name] = error;
  }
  
  return { isValid: Object.keys(errors).length === 0, errors };
}

// ─── Common Rules ────────────────────────────────────────────

export const RULES = {
  required: (label: string): FieldRule => ({
    type: "required", message: `${label} is required`,
  }),
  email: (): FieldRule => ({
    type: "email", message: "Please enter a valid email address",
  }),
  phone: (): FieldRule => ({
    type: "phone", message: "Please enter a valid 10-digit phone number",
  }),
  minLength: (min: number, label: string): FieldRule => ({
    type: "minLength", value: min, message: `${label} must be at least ${min} characters`,
  }),
  maxLength: (max: number, label: string): FieldRule => ({
    type: "maxLength", value: max, message: `${label} cannot exceed ${max} characters`,
  }),
  min: (min: number, label: string): FieldRule => ({
    type: "min", value: min, message: `${label} must be at least ${min}`,
  }),
  max: (max: number, label: string): FieldRule => ({
    type: "max", value: max, message: `${label} cannot exceed ${max}`,
  }),
  pan: (): FieldRule => ({
    type: "pattern", value: "^[A-Z]{5}[0-9]{4}[A-Z]$", message: "Please enter a valid PAN (e.g., ABCDE1234F)",
  }),
  aadhaar: (): FieldRule => ({
    type: "pattern", value: "^\\d{12}$", message: "Please enter a valid 12-digit Aadhaar number",
  }),
  ifsc: (): FieldRule => ({
    type: "pattern", value: "^[A-Z]{4}0[A-Z0-9]{6}$", message: "Please enter a valid IFSC code",
  }),
  pincode: (): FieldRule => ({
    type: "pattern", value: "^[1-9][0-9]{5}$", message: "Please enter a valid 6-digit pincode",
  }),
  futureDate: (label: string): FieldRule => ({
    type: "custom", message: `${label} must be a future date`,
    validator: (value) => {
      if (!value) return true;
      return new Date(value as string) > new Date();
    },
  }),
  pastDate: (label: string): FieldRule => ({
    type: "custom", message: `${label} must be a past date`,
    validator: (value) => {
      if (!value) return true;
      return new Date(value as string) < new Date();
    },
  }),
  dateRange: (startField: string): FieldRule => ({
    type: "custom", message: "End date must be after start date",
    validator: (value, formValues) => {
      if (!value || !formValues) return true;
      const start = new Date(formValues[startField] as string);
      const end = new Date(value as string);
      return end >= start;
    },
  }),
  strongPassword: (): FieldRule => ({
    type: "custom", message: "Password must have 8+ chars, uppercase, lowercase, number, and special character",
    validator: (value) => {
      const str = String(value || "");
      return str.length >= 8 && /[A-Z]/.test(str) && /[a-z]/.test(str) && /[0-9]/.test(str) && /[!@#$%^&*]/.test(str);
    },
  }),
  passwordMatch: (passwordField: string): FieldRule => ({
    type: "custom", message: "Passwords do not match",
    validator: (value, formValues) => value === formValues?.[passwordField],
  }),
  maxFileSize: (maxMB: number): FieldRule => ({
    type: "custom", message: `File size must not exceed ${maxMB}MB`,
    validator: (value) => {
      if (!value || !(value instanceof File)) return true;
      return value.size <= maxMB * 1024 * 1024;
    },
  }),
  fileType: (allowedTypes: string[]): FieldRule => ({
    type: "custom", message: `Allowed file types: ${allowedTypes.join(", ")}`,
    validator: (value) => {
      if (!value || !(value instanceof File)) return true;
      const ext = value.name.split(".").pop()?.toLowerCase() ?? "";
      return allowedTypes.includes(ext);
    },
  }),
};

// ─── Form Schemas ────────────────────────────────────────────

export const EMPLOYEE_FORM: FormSchema = {
  id: "employee",
  title: "Employee Registration",
  description: "Add a new employee to the organization",
  sections: [
    { title: "Personal Information", fields: ["firstName", "lastName", "email", "phone", "dob", "gender", "bloodGroup"] },
    { title: "Employment Details", fields: ["department", "designation", "joiningDate", "employmentType", "reportingManager"] },
    { title: "Address", fields: ["addressLine1", "addressLine2", "city", "state", "pincode"] },
    { title: "Bank Details", fields: ["bankName", "accountNumber", "ifsc", "pan"] },
    { title: "Emergency Contact", fields: ["emergencyName", "emergencyRelation", "emergencyPhone"] },
  ],
  fields: [
    { name: "firstName", label: "First Name", type: "text", placeholder: "Enter first name", rules: [RULES.required("First name"), RULES.minLength(2, "First name"), RULES.maxLength(50, "First name")] },
    { name: "lastName", label: "Last Name", type: "text", placeholder: "Enter last name", rules: [RULES.required("Last name"), RULES.minLength(2, "Last name")] },
    { name: "email", label: "Email", type: "email", placeholder: "employee@company.com", rules: [RULES.required("Email"), RULES.email()] },
    { name: "phone", label: "Phone", type: "tel", placeholder: "9876543210", rules: [RULES.required("Phone"), RULES.phone()] },
    { name: "dob", label: "Date of Birth", type: "date", rules: [RULES.required("Date of birth"), RULES.pastDate("Date of birth")] },
    { name: "gender", label: "Gender", type: "select", rules: [RULES.required("Gender")], options: [{ label: "Male", value: "male" }, { label: "Female", value: "female" }, { label: "Non-Binary", value: "non_binary" }, { label: "Prefer not to say", value: "prefer_not" }] },
    { name: "bloodGroup", label: "Blood Group", type: "select", rules: [], options: [{ label: "A+", value: "A+" }, { label: "A-", value: "A-" }, { label: "B+", value: "B+" }, { label: "B-", value: "B-" }, { label: "O+", value: "O+" }, { label: "O-", value: "O-" }, { label: "AB+", value: "AB+" }, { label: "AB-", value: "AB-" }] },
    { name: "department", label: "Department", type: "select", rules: [RULES.required("Department")], options: [{ label: "Engineering", value: "engineering" }, { label: "HR", value: "hr" }, { label: "Design", value: "design" }, { label: "Sales", value: "sales" }, { label: "Marketing", value: "marketing" }, { label: "Finance", value: "finance" }, { label: "Support", value: "support" }, { label: "Operations", value: "operations" }] },
    { name: "designation", label: "Designation", type: "text", placeholder: "e.g. Software Engineer", rules: [RULES.required("Designation")] },
    { name: "joiningDate", label: "Joining Date", type: "date", rules: [RULES.required("Joining date")] },
    { name: "employmentType", label: "Employment Type", type: "select", rules: [RULES.required("Employment type")], options: [{ label: "Full-time", value: "full_time" }, { label: "Part-time", value: "part_time" }, { label: "Contract", value: "contract" }, { label: "Intern", value: "intern" }] },
    { name: "reportingManager", label: "Reporting Manager", type: "text", placeholder: "Manager name", rules: [RULES.required("Reporting manager")] },
    { name: "addressLine1", label: "Address Line 1", type: "text", placeholder: "House/Flat No., Street", rules: [RULES.required("Address")] },
    { name: "addressLine2", label: "Address Line 2", type: "text", placeholder: "Area, Landmark", rules: [] },
    { name: "city", label: "City", type: "text", placeholder: "City", rules: [RULES.required("City")] },
    { name: "state", label: "State", type: "text", placeholder: "State", rules: [RULES.required("State")] },
    { name: "pincode", label: "Pincode", type: "text", placeholder: "560001", rules: [RULES.required("Pincode"), RULES.pincode()] },
    { name: "bankName", label: "Bank Name", type: "text", placeholder: "e.g. HDFC Bank", rules: [RULES.required("Bank name")] },
    { name: "accountNumber", label: "Account Number", type: "text", placeholder: "Account number", rules: [RULES.required("Account number"), RULES.minLength(8, "Account number"), RULES.maxLength(18, "Account number")] },
    { name: "ifsc", label: "IFSC Code", type: "text", placeholder: "e.g. HDFC0001234", rules: [RULES.required("IFSC code"), RULES.ifsc()] },
    { name: "pan", label: "PAN Number", type: "text", placeholder: "e.g. ABCDE1234F", rules: [RULES.required("PAN"), RULES.pan()] },
    { name: "emergencyName", label: "Contact Name", type: "text", placeholder: "Emergency contact name", rules: [RULES.required("Emergency contact name")] },
    { name: "emergencyRelation", label: "Relation", type: "select", rules: [RULES.required("Relation")], options: [{ label: "Father", value: "father" }, { label: "Mother", value: "mother" }, { label: "Spouse", value: "spouse" }, { label: "Sibling", value: "sibling" }, { label: "Friend", value: "friend" }, { label: "Other", value: "other" }] },
    { name: "emergencyPhone", label: "Contact Phone", type: "tel", placeholder: "9876543210", rules: [RULES.required("Emergency phone"), RULES.phone()] },
  ],
};

export const LEAVE_FORM: FormSchema = {
  id: "leave",
  title: "Apply Leave",
  fields: [
    { name: "leaveType", label: "Leave Type", type: "select", rules: [RULES.required("Leave type")], options: [{ label: "Casual Leave", value: "casual" }, { label: "Sick Leave", value: "sick" }, { label: "Earned Leave", value: "earned" }, { label: "Comp Off", value: "comp_off" }, { label: "Work From Home", value: "wfh" }, { label: "Half Day", value: "half_day" }] },
    { name: "fromDate", label: "From Date", type: "date", rules: [RULES.required("From date")] },
    { name: "toDate", label: "To Date", type: "date", rules: [RULES.required("To date"), RULES.dateRange("fromDate")] },
    { name: "reason", label: "Reason", type: "textarea", placeholder: "Why do you need leave?", rules: [RULES.required("Reason"), RULES.minLength(10, "Reason")] },
    { name: "notify", label: "Notify Team Members", type: "text", placeholder: "Names to notify", rules: [], helperText: "Optional - people to inform about your absence" },
  ],
};

export const EXPENSE_FORM: FormSchema = {
  id: "expense",
  title: "Submit Expense",
  fields: [
    { name: "category", label: "Category", type: "select", rules: [RULES.required("Category")], options: [{ label: "Travel", value: "travel" }, { label: "Equipment", value: "equipment" }, { label: "Training", value: "training" }, { label: "Software", value: "software" }, { label: "Books", value: "books" }, { label: "Events", value: "events" }, { label: "Client Meeting", value: "client_meeting" }, { label: "Marketing", value: "marketing" }, { label: "Other", value: "other" }] },
    { name: "amount", label: "Amount (INR)", type: "number", placeholder: "0", rules: [RULES.required("Amount"), RULES.min(1, "Amount"), RULES.max(500000, "Amount")] },
    { name: "date", label: "Expense Date", type: "date", rules: [RULES.required("Date"), RULES.pastDate("Date")] },
    { name: "description", label: "Description", type: "textarea", placeholder: "What was this expense for?", rules: [RULES.required("Description"), RULES.minLength(5, "Description")] },
    { name: "receipt", label: "Receipt", type: "file", rules: [RULES.maxFileSize(5), RULES.fileType(["jpg", "jpeg", "png", "pdf"])], helperText: "Upload receipt (PDF, JPG, PNG, max 5MB)" },
    { name: "projectCode", label: "Project Code", type: "text", placeholder: "Optional project code", rules: [] },
  ],
};

export const HELPDESK_FORM: FormSchema = {
  id: "helpdesk",
  title: "Create Ticket",
  fields: [
    { name: "title", label: "Subject", type: "text", placeholder: "Brief description of the issue", rules: [RULES.required("Subject"), RULES.minLength(5, "Subject"), RULES.maxLength(200, "Subject")] },
    { name: "category", label: "Category", type: "select", rules: [RULES.required("Category")], options: [{ label: "IT Support", value: "it_support" }, { label: "Hardware", value: "hardware" }, { label: "Software", value: "software" }, { label: "Payroll", value: "payroll" }, { label: "HR Query", value: "hr_query" }, { label: "Access Request", value: "access" }, { label: "Facilities", value: "facilities" }, { label: "Finance", value: "finance" }, { label: "Other", value: "other" }] },
    { name: "priority", label: "Priority", type: "select", rules: [RULES.required("Priority")], options: [{ label: "Low", value: "low" }, { label: "Medium", value: "medium" }, { label: "High", value: "high" }, { label: "Urgent", value: "urgent" }] },
    { name: "description", label: "Description", type: "textarea", placeholder: "Describe your issue in detail...", rules: [RULES.required("Description"), RULES.minLength(20, "Description")] },
    { name: "attachment", label: "Attachment", type: "file", rules: [RULES.maxFileSize(10)], helperText: "Optional - attach screenshots or files (max 10MB)" },
  ],
};

export const RECRUITMENT_FORM: FormSchema = {
  id: "recruitment",
  title: "Post New Job",
  fields: [
    { name: "title", label: "Job Title", type: "text", placeholder: "e.g. Senior Full Stack Developer", rules: [RULES.required("Job title")] },
    { name: "department", label: "Department", type: "select", rules: [RULES.required("Department")], options: [{ label: "Engineering", value: "engineering" }, { label: "Design", value: "design" }, { label: "Sales", value: "sales" }, { label: "Marketing", value: "marketing" }, { label: "HR", value: "hr" }, { label: "Finance", value: "finance" }, { label: "Support", value: "support" }] },
    { name: "location", label: "Location", type: "select", rules: [RULES.required("Location")], options: [{ label: "Bangalore HQ", value: "bangalore" }, { label: "Mumbai", value: "mumbai" }, { label: "Hyderabad", value: "hyderabad" }, { label: "Remote", value: "remote" }] },
    { name: "experienceMin", label: "Min Experience (years)", type: "number", rules: [RULES.required("Min experience"), RULES.min(0, "Experience")] },
    { name: "experienceMax", label: "Max Experience (years)", type: "number", rules: [RULES.required("Max experience")] },
    { name: "salaryMin", label: "Min Salary (LPA)", type: "number", rules: [RULES.required("Min salary"), RULES.min(1, "Salary")] },
    { name: "salaryMax", label: "Max Salary (LPA)", type: "number", rules: [RULES.required("Max salary")] },
    { name: "openings", label: "Number of Openings", type: "number", rules: [RULES.required("Openings"), RULES.min(1, "Openings")] },
    { name: "description", label: "Job Description", type: "textarea", placeholder: "Describe the role and responsibilities...", rules: [RULES.required("Description"), RULES.minLength(50, "Description")] },
    { name: "requirements", label: "Requirements", type: "textarea", placeholder: "List key requirements...", rules: [RULES.required("Requirements")] },
    { name: "skills", label: "Required Skills", type: "text", placeholder: "React, Node.js, AWS (comma-separated)", rules: [RULES.required("Skills")] },
    { name: "jobType", label: "Job Type", type: "select", rules: [RULES.required("Job type")], options: [{ label: "Permanent", value: "permanent" }, { label: "Contract", value: "contract" }, { label: "Intern", value: "intern" }] },
    { name: "urgent", label: "Urgent Hiring", type: "checkbox", rules: [], helperText: "Mark if this position needs to be filled urgently" },
  ],
};

export const PERFORMANCE_GOAL_FORM: FormSchema = {
  id: "performance_goal",
  title: "Create Goal",
  fields: [
    { name: "title", label: "Goal Title", type: "text", placeholder: "e.g. Launch v3.0 platform", rules: [RULES.required("Title"), RULES.maxLength(100, "Title")] },
    { name: "description", label: "Description", type: "textarea", placeholder: "What needs to be achieved?", rules: [RULES.required("Description")] },
    { name: "category", label: "Category", type: "select", rules: [RULES.required("Category")], options: [{ label: "Business", value: "business" }, { label: "Development", value: "development" }, { label: "Operational", value: "operational" }] },
    { name: "weight", label: "Weight (%)", type: "number", placeholder: "0-100", rules: [RULES.required("Weight"), RULES.min(5, "Weight"), RULES.max(100, "Weight")] },
    { name: "dueDate", label: "Due Date", type: "date", rules: [RULES.required("Due date"), RULES.futureDate("Due date")] },
    { name: "keyResults", label: "Key Results", type: "textarea", placeholder: "List measurable key results (one per line)", rules: [RULES.required("Key results")] },
  ],
};

export const TRAINING_ENROLLMENT_FORM: FormSchema = {
  id: "training_enroll",
  title: "Course Enrollment",
  fields: [
    { name: "courseId", label: "Course", type: "select", rules: [RULES.required("Course")], options: [] },
    { name: "reason", label: "Reason for Enrollment", type: "textarea", placeholder: "Why do you want to take this course?", rules: [RULES.required("Reason")] },
    { name: "startDate", label: "Preferred Start Date", type: "date", rules: [RULES.required("Start date")] },
    { name: "managerApproval", label: "Manager has approved", type: "checkbox", rules: [{ type: "custom", message: "Manager approval is required", validator: (value) => value === true }] },
  ],
};

// ─── Utility Functions ───────────────────────────────────────

export function getFormDefaults(schema: FormSchema): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of schema.fields) {
    defaults[field.name] = field.defaultValue ?? (field.type === "checkbox" ? false : field.type === "number" ? 0 : "");
  }
  return defaults;
}

export function getFieldsBySection(schema: FormSchema): Array<{ title: string; fields: FieldSchema[] }> {
  if (!schema.sections) return [{ title: "", fields: schema.fields }];
  return schema.sections.map((section) => ({
    title: section.title,
    fields: section.fields.map((name) => schema.fields.find((f) => f.name === name)!).filter(Boolean),
  }));
}

export function isFieldRequired(field: FieldSchema): boolean {
  return field.rules.some((r) => r.type === "required");
}

export function getFieldError(fieldName: string, errors: Record<string, string>, touched: Record<string, boolean>): string | undefined {
  return touched[fieldName] ? errors[fieldName] : undefined;
}
