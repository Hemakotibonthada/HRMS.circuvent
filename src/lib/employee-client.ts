"use client";

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE CREATION CLIENT
// ═══════════════════════════════════════════════════════════════
// "Validation failed" on Add Employee, with no indication of which field.
//
// The form and `POST /api/employees` disagreed about three things, and the
// toast reported none of them:
//
//   form                          API schema
//   ────────────────────────────  ──────────────────────────────────────────
//   joiningDate                   joinDate      ← required, so always failed
//   employmentType: "Full-time"   "full_time"   ← enum, so always failed
//   department: "Engineering"     departmentId  ← a uuid, so never applied
//
// The first two made every submission fail. The third is why the one employee
// who does exist shows "Unassigned": a department *name* cannot satisfy a
// foreign key to `hrms.departments`, so it was quietly dropped.
//
// The API had been reporting all of this precisely — it returns
// `{ error, issues: [{ field, message }] }` — and the page threw the array
// away and said "Failed to add employee". Surfacing it is most of the fix.

export interface DepartmentOption {
  id: string;
  name: string;
  code: string;
  headcount: number;
  isActive: boolean;
}

export interface EmployeeFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** A department *name* from the picker. Resolved to an id before sending. */
  department: string;
  designation: string;
  joiningDate: string;
  employmentType: string;
  location: string;
  status: string;
  salary: string;
}

/** Field-level problems, in the shape the API reports them. */
export interface FieldIssue {
  field: string;
  message: string;
}

export class ValidationError extends Error {
  constructor(readonly issues: FieldIssue[]) {
    // Named fields rather than "Validation failed". Someone who cannot see
    // which field is wrong cannot fix it.
    super(
      issues.length > 0
        ? issues.map((i) => (i.field ? `${i.field}: ${i.message}` : i.message)).join("; ")
        : "Validation failed"
    );
    this.name = "ValidationError";
  }
}

/**
 * The employment types the API accepts.
 *
 * The form offered "Full-time", "Part-time", "Contract", "Intern" — display
 * labels, sent verbatim into a snake_case enum. Kept as a mapping rather than
 * a lowercase-and-replace so the two lists cannot drift silently: an option
 * added to the form with no entry here fails loudly at the boundary.
 */
const EMPLOYMENT_TYPES: Record<string, string> = {
  "full-time": "full_time",
  "full time": "full_time",
  full_time: "full_time",
  "part-time": "part_time",
  "part time": "part_time",
  part_time: "part_time",
  contract: "contract",
  contractor: "contract",
  intern: "intern",
  internship: "intern",
  freelance: "freelance",
  freelancer: "freelance",
};

export function normaliseEmploymentType(value: string): string | null {
  return EMPLOYMENT_TYPES[value.trim().toLowerCase()] ?? null;
}

const STATUSES = new Set([
  "active",
  "on_leave",
  "probation",
  "notice_period",
  "terminated",
  "inactive",
]);

export function normaliseStatus(value: string): string | null {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return STATUSES.has(key) ? key : null;
}

/**
 * Checks what the form can check, before a round trip.
 *
 * The page only required first name, last name, email and department, so a
 * blank designation reached the server and came back as an unexplained
 * "Validation failed". Designation is required by the schema and is checked
 * here too.
 */
export function validateEmployeeForm(form: EmployeeFormValues): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (!form.firstName.trim()) issues.push({ field: "firstName", message: "First name is required" });
  if (!form.lastName.trim()) issues.push({ field: "lastName", message: "Last name is required" });

  if (!form.email.trim()) issues.push({ field: "email", message: "Email is required" });
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    issues.push({ field: "email", message: "Enter a valid email address" });
  }

  if (!form.designation.trim()) {
    issues.push({ field: "designation", message: "Designation is required" });
  }

  if (!form.joiningDate.trim()) {
    issues.push({ field: "joiningDate", message: "Joining date is required" });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(form.joiningDate.trim())) {
    issues.push({ field: "joiningDate", message: "Joining date must be YYYY-MM-DD" });
  }

  if (form.employmentType && normaliseEmploymentType(form.employmentType) === null) {
    issues.push({
      field: "employmentType",
      message: `"${form.employmentType}" is not an employment type`,
    });
  }

  if (form.salary.trim()) {
    const salary = Number(form.salary);
    if (!Number.isFinite(salary) || salary < 0) {
      issues.push({ field: "salary", message: "Salary must be a positive number" });
    }
  }

  return issues;
}

async function readError(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    issues?: FieldIssue[];
  };

  if (body.issues?.length) throw new ValidationError(body.issues);
  throw new Error(body.error || `Request failed (${response.status})`);
}

export async function listDepartments(): Promise<DepartmentOption[]> {
  const response = await fetch("/api/departments", { credentials: "include" });
  if (!response.ok) await readError(response);
  const body = (await response.json()) as { items: DepartmentOption[] };
  return body.items ?? [];
}

/**
 * Finds a department by name, creating it if it is new.
 *
 * The picker offers a mix of departments that exist and a hardcoded starter
 * list that does not. Rather than refusing the latter — which is what
 * effectively happened before, silently — the first use of a name creates it.
 * `POST /api/departments` returns the existing row when the code matches, so
 * two people adding the first Engineering hire at once get the same
 * department rather than a duplicate.
 */
export async function resolveDepartmentId(
  name: string,
  known: DepartmentOption[]
): Promise<string | undefined> {
  const wanted = name.trim();
  if (!wanted || wanted.toLowerCase() === "all") return undefined;

  const existing = known.find((d) => d.name.toLowerCase() === wanted.toLowerCase());
  if (existing) return existing.id;

  const response = await fetch("/api/departments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name: wanted }),
  });

  if (!response.ok) {
    // Not fatal. Someone without `departments.manage` can still add an
    // employee; they simply cannot invent a department while doing it, and
    // saying so beats failing the whole submission.
    return undefined;
  }

  const created = (await response.json()) as DepartmentOption;
  return created.id;
}

/** Maps the form onto the API contract and creates the employee. */
export async function createEmployee(
  form: EmployeeFormValues,
  departments: DepartmentOption[]
): Promise<{ id: string }> {
  const issues = validateEmployeeForm(form);
  if (issues.length > 0) throw new ValidationError(issues);

  const departmentId = await resolveDepartmentId(form.department, departments);

  const payload: Record<string, unknown> = {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    email: form.email.trim(),
    designation: form.designation.trim(),
    // The field the schema actually names.
    joinDate: form.joiningDate.trim(),
  };

  if (form.phone.trim()) payload.phone = form.phone.trim();
  if (form.location.trim()) payload.location = form.location.trim();
  if (departmentId) payload.departmentId = departmentId;

  const employmentType = normaliseEmploymentType(form.employmentType);
  if (employmentType) payload.employmentType = employmentType;

  const status = normaliseStatus(form.status);
  if (status) payload.status = status;

  // Omitted entirely when blank. Sending `0` would record everyone as earning
  // nothing, which payroll would then faithfully act on.
  if (form.salary.trim()) payload.salary = Number(form.salary);

  const response = await fetch("/api/employees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!response.ok) await readError(response);
  return (await response.json()) as { id: string };
}
