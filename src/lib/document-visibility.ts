// ═══════════════════════════════════════════════════════════════
// WHICH DOCUMENTS AN EMPLOYEE MAY SEE
// ═══════════════════════════════════════════════════════════════
// One definition, used by the list an employee is shown and by the download
// that list links to. They were briefly two copies of the same array in two
// files, which is the shape of a bug this codebase has already had once: a
// list that shows a letter and a download that refuses it, or worse, the
// reverse.
//
// ── Why a list and not "anything except draft" ──
// Because the enum has eight values and only four of them mean the document
// stands. Writing the rule as an exclusion means a status added later is
// visible by default, and the default for a document carrying somebody's
// salary should be that it is not.
//
// The excluded ones are excluded for different reasons, worth stating:
//
//   draft              HR is still working. The figure may never be agreed.
//   declined           Somebody refused to sign it, so it is not in force.
//   expired            It lapsed unsigned.
//   voided             It was withdrawn.
//
// An employee who needs to know a letter was withdrawn should hear it from
// HR, not infer it from a list that displays it as though it applied.

/** `signatureStatusEnum` values that mean the document was issued and stands. */
export const EMPLOYEE_VISIBLE_DOCUMENT_STATUSES = [
  "sent",
  "viewed",
  "partially_signed",
  "completed",
] as const;

export type EmployeeVisibleStatus = (typeof EMPLOYEE_VISIBLE_DOCUMENT_STATUSES)[number];

/** Whether an employee may see a document in this state. */
export function isEmployeeVisibleDocument(status: string | null | undefined): boolean {
  return (EMPLOYEE_VISIBLE_DOCUMENT_STATUSES as readonly string[]).includes(
    String(status ?? "")
  );
}
