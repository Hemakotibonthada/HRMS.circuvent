"use client";

// ═══════════════════════════════════════════════════════════════
// BANK DETAILS CLIENT
// ═══════════════════════════════════════════════════════════════
//
// Between the self-service bank details page and
// /api/employees/bank-details.
//
// The rules live in lib/bank-details-rules.ts, free of "use client", so the
// API route enforces exactly the same checks a submission already passed —
// the same discipline employee-client.ts documents for `/api/employees`: a
// rule that runs only in the browser is a suggestion, because anything with
// a session can post JSON straight at the route. Re-exported here so the
// page has one module to import from, the way EMPLOYMENT_TYPE_OPTIONS is
// re-exported from employee-client.ts rather than the page reaching past it
// into employee-rules.ts directly.

import {
  validateBankDetailsFields,
  type BankDetailsInput,
  type EmployeeBankDetailsView,
  type FieldIssue,
} from "@/lib/bank-details-rules";

export {
  ACCOUNT_TYPE_OPTIONS,
  validateBankDetailsFields,
} from "@/lib/bank-details-rules";

export type {
  BankAccountType,
  BankDetails,
  BankDetailsInput,
  EmployeeBankDetailsView,
  FieldIssue,
  StatutoryIds,
} from "@/lib/bank-details-rules";

/** What both GET and PUT /api/employees/bank-details return. */
export interface BankDetailsRecord extends EmployeeBankDetailsView {
  employeeId: string;
}

/**
 * Thrown when the API reports `{ error, issues }` rather than a single
 * message — the same shape and the same reason as employee-client.ts's
 * ValidationError. `issues` carries which field was wrong; `message` joins
 * them into one string so a call site that only does `toast.error(err.message)`
 * still shows every problem, not just the fact that there was one.
 */
export class ValidationError extends Error {
  constructor(readonly issues: FieldIssue[]) {
    super(
      issues.length > 0
        ? issues.map((i) => i.message).join("\n")
        : "The details could not be saved, but no reason was given"
    );
    this.name = "ValidationError";
  }
}

async function readError(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    issues?: FieldIssue[];
  };
  if (body.issues?.length) throw new ValidationError(body.issues);
  throw new Error(body.error || `Request failed (${response.status})`);
}

/**
 * The signed-in employee's own bank and statutory details.
 *
 * A brand-new hire has never filled this in, so a null `bankDetails` and four
 * null statutory fields is the normal first response, not a failure — the
 * page renders an empty form for it, the same way `listMyPayslips()` returning
 * an empty array means "no payslips yet", not an error. The account number
 * that comes back is already masked to its last four digits; there is no
 * request that returns it in full, so there is nothing this function could do
 * to accidentally expose more of it.
 */
export async function getMyBankDetails(): Promise<BankDetailsRecord> {
  const response = await fetch("/api/employees/bank-details", { credentials: "include" });
  if (!response.ok) await readError(response);
  return (await response.json()) as BankDetailsRecord;
}

/**
 * Replaces the signed-in employee's own bank and statutory details.
 *
 * Validated here first so a mistyped IFSC or a confirmation that does not
 * match is reported without a round trip, but the request is sent regardless
 * of what this check finds — the browser check is a convenience, and
 * `/api/employees/bank-details` runs `validateBankDetailsFields` again on
 * whatever it receives no matter what this function already looked at.
 * `employeeId` is not a parameter: the route hardcodes the update to the
 * caller's own record, so there is no field here that could name anyone else.
 */
export async function saveMyBankDetails(values: BankDetailsInput): Promise<BankDetailsRecord> {
  const issues = validateBankDetailsFields(values);
  if (issues.length > 0) throw new ValidationError(issues);

  const response = await fetch("/api/employees/bank-details", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(values),
  });

  if (!response.ok) await readError(response);
  return (await response.json()) as BankDetailsRecord;
}
