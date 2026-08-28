// ═══════════════════════════════════════════════════════════════
// The employee profile projection
// ═══════════════════════════════════════════════════════════════
// One definition of "what the rest of the ecosystem may see about a
// colleague", kept apart from any route so it cannot quietly gain a field.
//
// The employees table holds pay (`ctcMinor`, `currency`), bank details, PAN,
// Aadhaar, UAN, PF and ESI numbers, date of birth, blood group, marital
// status and home address. Every one of those is a lawful reason for HR to
// hold data and none of them belong next to somebody's name in a chat app.
//
// So this is an allowlist, not a redaction list. A field that nobody thought
// about is absent by default, which is the only version of this that stays
// correct as the employees table grows.

/** What a consumer receives. Every field here is safe to show a colleague. */
export interface EmployeeProfile {
  /** Stable identifier, so a consumer can key its own cache. */
  id: string;
  /** Work email — the join key across every app in the ecosystem. */
  email: string;
  fullName: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  department: string | null;
  employmentType: string | null;
  /** active, on_leave, probation, notice_period, terminated, inactive. */
  status: string | null;
  joinDate: string | null;
  employeeCode: string | null;
  managerName: string | null;
}

/**
 * Who is allowed to change each field, so a consumer can render the right
 * affordance instead of guessing.
 *
 * Shipped in the response rather than duplicated in each app: five apps that
 * each decide for themselves which fields are read-only will disagree within
 * a release or two, and the one that guesses wrong shows an editable box over
 * a value it cannot actually save.
 */
export type FieldOwner =
  /** HR changes it. Everyone else displays it. */
  | "hr"
  /** The employee changes it, about themselves. */
  | "self"
  /** Derived by the system; nobody types it. */
  | "system";

export const PROFILE_FIELD_OWNERS: Record<keyof EmployeeProfile, FieldOwner> = {
  id: "system",
  email: "hr",
  fullName: "hr",
  firstName: "hr",
  lastName: "hr",
  avatarUrl: "self",
  jobTitle: "hr",
  department: "hr",
  employmentType: "hr",
  status: "hr",
  joinDate: "hr",
  employeeCode: "hr",
  managerName: "hr",
};

/**
 * The shape a record must have to be projected. Deliberately structural
 * rather than importing `EmployeeRecord`: this file is copied into consuming
 * apps, and it must not drag HRMS's database types along with it.
 */
export interface ProjectableEmployee {
  id: string;
  employeeCode?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  designation?: string | null;
  departmentName?: string | null;
  employmentType?: string | null;
  status?: string | null;
  joinDate?: string | null;
  reportingToName?: string | null;
}

const clean = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Narrows a full employee record to the profile.
 *
 * Written by naming each destination field rather than by copying and
 * deleting, so a new column on `employees` cannot arrive here by accident —
 * the failure mode of the delete-what-you-don't-want approach is silent, and
 * the thing it leaks is somebody's salary.
 */
export function toEmployeeProfile(row: ProjectableEmployee): EmployeeProfile {
  const first = clean(row.firstName) ?? "";
  const last = clean(row.lastName) ?? "";
  return {
    id: row.id,
    email: (clean(row.email) ?? "").toLowerCase(),
    fullName: clean(row.fullName) ?? [first, last].filter(Boolean).join(" "),
    firstName: first,
    lastName: last,
    avatarUrl: clean(row.avatarUrl),
    jobTitle: clean(row.designation),
    department: clean(row.departmentName),
    employmentType: clean(row.employmentType),
    status: clean(row.status),
    joinDate: clean(row.joinDate),
    employeeCode: clean(row.employeeCode),
    managerName: clean(row.reportingToName),
  };
}

/** Every key the projection may ever contain, for tests and for auditing. */
export const PROFILE_FIELDS = Object.keys(PROFILE_FIELD_OWNERS) as (keyof EmployeeProfile)[];

/**
 * Fields that must never appear in a profile response.
 *
 * A test asserts none of these survive the projection. Listing them is
 * redundant with the allowlist by design: the allowlist is the mechanism and
 * this is the alarm, and an alarm that repeats the mechanism is what catches
 * the day somebody widens the mechanism without meaning to.
 */
export const FORBIDDEN_PROFILE_FIELDS = [
  "ctcMinor", "ctc", "salary", "currency",
  "bankDetails", "panNumber", "aadhaarNumber", "uanNumber", "pfNumber", "esiNumber",
  "dateOfBirth", "bloodGroup", "maritalStatus",
  "addressLine1", "city", "state", "postalCode",
  "personalEmail", "phone", "emergencyContact", "customFields",
  "exitReason", "exitDate", "noticePeriodDays",
] as const;
