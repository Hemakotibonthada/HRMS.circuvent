// ═══════════════════════════════════════════════════════════════
// EMPLOYEE ONBOARDING
// ═══════════════════════════════════════════════════════════════
// Creating an employee used to fan the record out into three Firestore
// databases — HRMS's, CV-365's and Mail's — plus a Firebase Auth user, and
// reported which of those four writes had succeeded.
//
// None of that is needed now. Identity is one shared schema
// (identity.users / identity.user_roles) that every Circuvent app reads
// directly, and the employee record itself lives in hrms.employees. There is
// nothing left to copy, and a copy could only drift from the original.
//
// The exported shapes are unchanged so the employees screen did not have to be
// rewritten; the per-app flags now describe a single write, which is all that
// actually happens.

export interface CrossAppEmployee {
  uid: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  phone?: string;
  department: string;
  designation: string;
  joiningDate: string;
  status: string;
  employmentType: string;
  location?: string;
  [key: string]: unknown;
}

export interface SyncResult {
  success: boolean;
  firebaseAuthCreated: boolean;
  hrmsUserCreated: boolean;
  cv365UserCreated: boolean;
  mailUserCreated: boolean;
  errors: string[];
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const parsed = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: parsed.error || `Request failed (${res.status})` };
  } catch {
    return { ok: false, error: "Could not reach the server" };
  }
}

/**
 * Creates the employee.
 *
 * The result still reports each app as "created" on success, because the record
 * is visible to all of them the moment it exists — that is the point of a
 * shared schema.
 */
export async function createEmployeeAcrossApps(
  employee: CrossAppEmployee,
  /**
   * Accepted for source compatibility and ignored.
   *
   * It used to create a Firebase Auth user. Sign-in accounts are now issued
   * from the identity schema, so an employee record no longer carries a
   * password — and quietly creating a credential from this screen would be the
   * wrong place to do it anyway.
   */
  _password?: string
): Promise<SyncResult> {
  void _password;
  const { ok, error } = await post("/api/employees", {
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    phone: employee.phone,
    designation: employee.designation,
    departmentName: employee.department,
    joinDate: employee.joiningDate,
    status: employee.status,
    employmentType: employee.employmentType,
    location: employee.location,
  });

  return {
    success: ok,
    firebaseAuthCreated: false,
    hrmsUserCreated: ok,
    cv365UserCreated: ok,
    mailUserCreated: ok,
    errors: ok ? [] : [error ?? "Could not create the employee"],
  };
}

/**
 * Kept so the update path on the employees screen keeps compiling.
 *
 * Updating the employee record is the whole operation now; there are no other
 * copies to push it to.
 */
export async function syncEmployeeToOtherApps(
  employee: Partial<CrossAppEmployee> & { uid?: string; email: string }
): Promise<SyncResult> {
  void employee;
  return {
    success: true,
    firebaseAuthCreated: false,
    hrmsUserCreated: true,
    cv365UserCreated: true,
    mailUserCreated: true,
    errors: [],
  };
}
