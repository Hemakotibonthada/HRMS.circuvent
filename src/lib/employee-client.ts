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
  /**
   * The candidate this person was hired as, and the application it came from.
   *
   * Required by `POST /api/employees` unless an override reason is given: an
   * employee with nobody behind them is how a mailbox gets created for someone
   * who was never hired. Optional in this type because the same form is used
   * for editing, where the link already exists.
   */
  candidateId?: string;
  applicationId?: string;
  /** A written justification for a founder, an acquisition or a corrected record. */
  provenanceOverrideReason?: string;
}

/** Field-level problems, in the shape the API reports them. */
export interface FieldIssue {
  field: string;
  message: string;
}

export class ValidationError extends Error {
  constructor(readonly issues: FieldIssue[]) {
    // The messages alone, one per line. They already name their field in
    // ordinary words — "Joining date cannot be in the past" — so prefixing
    // `joiningDate:` only added jargon to something a person has to read and
    // act on. What matters is that the reason appears at all: this used to be
    // the single word "Validation failed".
    super(
      issues.length > 0
        ? issues.map((i) => i.message).join("\n")
        : "The details could not be saved, but no reason was given"
    );
    this.name = "ValidationError";
  }
}

// -- The rules, which live in one place -----------------------
//
// `lib/employee-rules.ts` owns them, free of "use client", so the API route
// enforces exactly the same checks. A rule that runs only in the browser is a
// suggestion: anything with a session can post JSON straight at the route.
// Re-exported here so the page keeps importing from one module.

import {
  normaliseEmploymentType,
  normaliseStatus,
  validateEmployeeFields,
} from "@/lib/employee-rules";

export {
  EMPLOYMENT_TYPE_OPTIONS,
  isCompanyAddress,
  isRoleAddress,
  normaliseEmploymentType,
  normaliseStatus,
  todayLocalIso,
} from "@/lib/employee-rules";

/** Checks what the form can check, before a round trip. */
export function validateEmployeeForm(
  form: EmployeeFormValues,
  now: Date = new Date()
): FieldIssue[] {
  return validateEmployeeFields(
    {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      designation: form.designation,
      joiningDate: form.joiningDate,
      employmentType: form.employmentType,
      salary: form.salary,
    },
    { now }
  );
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

/**
 * Candidates with an offer behind them who are not yet employees.
 *
 * Fills the Add Employee dialog's candidate picker. The server applies the same
 * provenance rule the create endpoint will, so a name that appears selectable
 * here is one the create will accept — anything else is a form somebody fills
 * in completely before being told they cannot submit it.
 */
export interface PendingHire {
  candidateId: string;
  applicationId: string | null;
  name: string;
  email: string;
  designation: string | null;
  offerStatus: string | null;
  registrationSubmittedAt: string | null;
  ready: boolean;
  blockers: string[];
}

export async function listPendingHires(search?: string): Promise<PendingHire[]> {
  const query = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
  const response = await fetch(`/api/hires/pending${query}`, { credentials: "include" });
  if (!response.ok) await readError(response);
  const body = (await response.json()) as { items?: PendingHire[] };
  return body.items ?? [];
}

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

  // The hire this record stands for. The server refuses a create without one
  // unless an override reason is supplied, and records both against the
  // employee either way.
  if (form.candidateId?.trim()) payload.candidateId = form.candidateId.trim();
  if (form.applicationId?.trim()) payload.applicationId = form.applicationId.trim();
  if (form.provenanceOverrideReason?.trim()) {
    payload.provenanceOverrideReason = form.provenanceOverrideReason.trim();
  }

  const response = await fetch("/api/employees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!response.ok) await readError(response);
  return (await response.json()) as { id: string };
}
