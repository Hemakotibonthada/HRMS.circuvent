// ═══════════════════════════════════════════════════════════════
// BANK & STATUTORY DETAILS — validation, ownership and masking
// ═══════════════════════════════════════════════════════════════
// Pure, so it tests without a database — the same discipline as
// employee-rules.ts, and for the same reason: a rule enforced only in the
// browser is a suggestion, not a rule, because anything with a session can
// post JSON straight at the route.
//
// The gap this closes: `employees.bank_details` is a jsonb column whose own
// schema comment says nothing writes to it today; `lib/form-schemas.ts`
// defines a whole "Bank Details" section that nothing imports; and
// `isValidIFSC` in `lib/hr-utils.ts` has been sitting unused since it was
// written. Meanwhile `lib/paystub-client.ts` already sends
// `statutoryIds: { pan, uan, pf_number, esi_number }` to Paystub on every
// employee sync — the wire to payroll exists, but there was never a form for
// an employee to put a value on it.
//
// Validation is reused, not re-implemented: `isValidIFSC` and `isValidPAN`
// come from `lib/hr-utils.ts`, `isValidAccountNumber` from
// `lib/bank-advice.ts` (which has its own near-duplicate `isValidIfsc` —
// deliberately not imported here, since the task this module exists for is
// to stop there being two definitions of the same fact, not add a third).
// `FieldIssue` is `lib/validation-response.ts`'s, for the same reason —
// `lib/employee-rules.ts` already re-declared it once rather than importing
// it, which is exactly the drift this paragraph is arguing against.

import { isValidIFSC, isValidPAN } from "@/lib/hr-utils";
import { isValidAccountNumber } from "@/lib/bank-advice";
import { mask } from "@/lib/governance";
import type { FieldIssue } from "@/lib/validation-response";

export type { FieldIssue };

// ─── Account type ────────────────────────────────────────────

export const ACCOUNT_TYPE_OPTIONS: ReadonlyArray<{
  value: "savings" | "current";
  label: string;
}> = [
  { value: "savings", label: "Savings" },
  { value: "current", label: "Current" },
];

export type BankAccountType = (typeof ACCOUNT_TYPE_OPTIONS)[number]["value"];

const ACCOUNT_TYPE_VALUES = new Set<string>(ACCOUNT_TYPE_OPTIONS.map((o) => o.value));

// ─── Shapes ──────────────────────────────────────────────────

/**
 * What lands in the `bank_details` jsonb column. Plain, not encrypted — see
 * the schema comment on `employees.bankDetails` for why a jsonb column needs
 * a type-changing migration before it can hold ciphertext, and why that is
 * tracked in docs/ROADMAP.md rather than solved here.
 */
export interface BankDetails {
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  accountType: BankAccountType;
}

/**
 * The four Indian statutory identifiers `paystub-client.ts` already forwards
 * to Paystub. `panNumber` is the one of the four that is an encrypted column
 * — see `getBankDetails`/`updateBankDetails` in `employee.neon.ts`.
 */
export interface StatutoryIds {
  panNumber: string | null;
  uanNumber: string | null;
  pfNumber: string | null;
  esiNumber: string | null;
}

/** What the repository reads back: decrypted, unmasked, server-side only. */
export interface RawEmployeeBankDetails {
  bankDetails: BankDetails | null;
  statutoryIds: StatutoryIds;
}

/**
 * What a route may put in a response body.
 *
 * Structurally identical to RawEmployeeBankDetails — the guarantee
 * `toBankDetailsView` adds (the account number is masked) is a runtime fact,
 * not one TypeScript can check — but named separately so a call site that
 * hands this to `NextResponse.json` reads as a statement of which guarantee
 * it is relying on.
 */
export type EmployeeBankDetailsView = RawEmployeeBankDetails;

/**
 * The PUT body. `confirmAccountNumber` never reaches storage — it exists
 * only to catch a mistyped account number before one does.
 */
export interface BankDetailsInput {
  bankName?: string;
  accountHolderName?: string;
  accountNumber?: string;
  confirmAccountNumber?: string;
  ifsc?: string;
  accountType?: string;
  panNumber?: string;
  uanNumber?: string;
  pfNumber?: string;
  esiNumber?: string;
}

/**
 * What the repository persists once `BankDetailsInput` has passed
 * `validateBankDetailsFields`.
 *
 * Deliberately not a partial/PATCH shape like `EmployeeUpdate` — this page has
 * one form covering the whole record, so every save writes the bank fields as
 * one replacement unit (matching the `bank_details` jsonb column, which
 * cannot be merged field-by-field) and all four statutory numbers, rather
 * than leaving it ambiguous whether an absent field means "unchanged" or
 * "clear this". Blank optional fields arrive here as `null`, decided by the
 * route once validation has run, not as `undefined`.
 */
export interface BankDetailsUpdate {
  bankDetails: BankDetails;
  panNumber: string | null;
  uanNumber: string | null;
  pfNumber: string | null;
  esiNumber: string | null;
}

// ─── Validation ──────────────────────────────────────────────

/**
 * Every rule that decides whether these values are safe to store as somebody's
 * salary destination.
 *
 * Returns every problem rather than the first, matching validateEmployeeFields
 * — a form that reveals one fault per submission costs as many round trips as
 * there are mistakes.
 */
export function validateBankDetailsFields(values: BankDetailsInput): FieldIssue[] {
  const issues: FieldIssue[] = [];

  const bankName = (values.bankName ?? "").trim();
  if (!bankName) issues.push({ field: "bankName", message: "Bank name is required" });

  const accountHolderName = (values.accountHolderName ?? "").trim();
  if (!accountHolderName) {
    issues.push({ field: "accountHolderName", message: "Account holder name is required" });
  }

  const accountNumber = (values.accountNumber ?? "").trim();
  if (!accountNumber) {
    issues.push({ field: "accountNumber", message: "Account number is required" });
  } else if (!isValidAccountNumber(accountNumber)) {
    issues.push({ field: "accountNumber", message: "Account number must be 9 to 18 digits" });
  }

  // The confirm field exists for one reason: a single mistyped digit here
  // sends somebody's salary to an account that is not theirs, and the bank
  // has no way to know that and bounce it back. Comparing against the raw,
  // just-typed account number — not the masked one this module later returns
  // for display — is what makes retyping mean anything; matching against a
  // masked value would let a typo in the visible last four digits straight
  // through undetected.
  const confirmAccountNumber = (values.confirmAccountNumber ?? "").trim();
  if (accountNumber && confirmAccountNumber !== accountNumber) {
    issues.push({
      field: "confirmAccountNumber",
      message: "Account number and confirmation do not match",
    });
  }

  const ifsc = (values.ifsc ?? "").trim();
  if (!ifsc) {
    issues.push({ field: "ifsc", message: "IFSC is required" });
  } else if (!isValidIFSC(ifsc)) {
    issues.push({
      field: "ifsc",
      message:
        `"${ifsc}" is not a valid IFSC — 11 characters: 4 letters, a zero, then 6 ` +
        "letters or digits (e.g. HDFC0001234). The 5th character is always the digit 0, " +
        "reserved for future use by the RBI.",
    });
  }

  const accountType = (values.accountType ?? "").trim().toLowerCase();
  if (!accountType) {
    issues.push({ field: "accountType", message: "Account type is required" });
  } else if (!ACCOUNT_TYPE_VALUES.has(accountType)) {
    issues.push({
      field: "accountType",
      message:
        `"${values.accountType}" is not an account type. Choose ` +
        `${ACCOUNT_TYPE_OPTIONS.map((o) => o.label).join(" or ")}.`,
    });
  }

  const pan = (values.panNumber ?? "").trim();
  if (pan && !isValidPAN(pan)) {
    issues.push({
      field: "panNumber",
      message: `"${pan}" is not a valid PAN — 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)`,
    });
  }

  // UAN is fixed at 12 digits by EPFO, so it is checked as strictly as IFSC
  // and PAN. PF and ESI numbers are not: EPFO's own PF number format has
  // changed shape more than once (region/office/establishment codes, or the
  // newer UAN-linked form) and ESIC's insured-person number has too.
  // Guessing a regex for either risks rejecting a real value the same way
  // `EMPLOYMENT_TYPE_OPTIONS` used to reject "Consultant" from a dropdown that
  // offered it — so these two get a length sanity check only, not a format.
  const uan = (values.uanNumber ?? "").trim();
  if (uan && !/^\d{12}$/.test(uan)) {
    issues.push({ field: "uanNumber", message: "UAN must be exactly 12 digits" });
  }

  const pf = (values.pfNumber ?? "").trim();
  if (pf.length > 32) {
    issues.push({ field: "pfNumber", message: "PF number is too long" });
  }

  const esi = (values.esiNumber ?? "").trim();
  if (esi.length > 32) {
    issues.push({ field: "esiNumber", message: "ESI number is too long" });
  }

  return issues;
}

/**
 * Turns a validated `BankDetailsInput` into the shape the repository writes.
 *
 * Call only after `validateBankDetailsFields(values)` returns no issues —
 * this function does not re-check anything, it normalises. IFSC and PAN are
 * upper-cased to match what `isValidIFSC`/`isValidPAN` already checked
 * against (both compare an upper-cased copy internally but return no
 * canonical form), so two submissions differing only by case do not become
 * two different-looking values sitting in the same column. Blank optional
 * fields become `null`, not `""` — `decryptNullable`/`encryptNullable` in
 * `lib/crypto/field-encryption.ts` already treat `""` as "absent", so storing
 * `null` rather than `""` is the form that every reader downstream expects.
 */
export function toBankDetailsUpdate(values: BankDetailsInput): BankDetailsUpdate {
  const blankToNull = (value: string | undefined): string | null => {
    const trimmed = (value ?? "").trim();
    return trimmed ? trimmed : null;
  };

  return {
    bankDetails: {
      bankName: (values.bankName ?? "").trim(),
      accountHolderName: (values.accountHolderName ?? "").trim(),
      accountNumber: (values.accountNumber ?? "").trim(),
      ifsc: (values.ifsc ?? "").trim().toUpperCase(),
      accountType: (values.accountType ?? "").trim().toLowerCase() as BankAccountType,
    },
    panNumber: blankToNull(values.panNumber?.toUpperCase()),
    uanNumber: blankToNull(values.uanNumber),
    pfNumber: blankToNull(values.pfNumber),
    esiNumber: blankToNull(values.esiNumber),
  };
}

// ─── Ownership ───────────────────────────────────────────────

/**
 * Whether the caller may write to this employee's bank details.
 *
 * No privileged exception, unlike `canViewOthersBankDetails` in `rbac.ts`.
 * Reading bank details is something payroll legitimately needs to do — to
 * generate a bank advice file, say — but changing where someone's salary is
 * deposited on their behalf is not a thing this product does at all. If HR
 * needs a detail corrected, that is the employee re-entering their own
 * details, not HR entering them for a colleague.
 */
export function canWriteBankDetails(callerId: string, targetEmployeeId: string): boolean {
  return callerId === targetEmployeeId;
}

// ─── Display ─────────────────────────────────────────────────

/**
 * Masks the account number for display. Everything else — PAN, UAN, PF, ESI
 * — is returned in full: a signed-in employee reading their own statutory
 * numbers back is not the risk this exists for. A screen-shared or
 * shoulder-surfed account number that could be retyped into a transfer
 * elsewhere is, which is why it alone is masked to its last four digits, per
 * `mask()` in `lib/governance.ts`.
 */
export function toBankDetailsView(raw: RawEmployeeBankDetails): EmployeeBankDetailsView {
  if (!raw.bankDetails) return raw;
  return {
    ...raw,
    bankDetails: {
      ...raw.bankDetails,
      accountNumber: mask(raw.bankDetails.accountNumber),
    },
  };
}

/**
 * What is safe to write into `identity.audit_log`'s `before`/`after` jsonb
 * columns.
 *
 * The audit trail exists to prove what changed and who changed it, not to
 * become a second place a stolen credential — or a curious colleague with
 * `audit.view` — could read someone's account number or PAN from. Both are
 * masked here the same way `toBankDetailsView` masks the account number for
 * an ordinary read, so an investigation can still see "this is the same
 * account as before, only the IFSC changed" without the full numbers sitting
 * in a table that, unlike `employees.pan_number`, was never built to hold
 * ciphertext and cannot be rotated or re-encrypted the way that column can.
 */
export function toAuditSnapshot(raw: RawEmployeeBankDetails): Record<string, unknown> {
  return {
    bankDetails: raw.bankDetails
      ? { ...raw.bankDetails, accountNumber: mask(raw.bankDetails.accountNumber) }
      : null,
    statutoryIds: {
      ...raw.statutoryIds,
      panNumber: raw.statutoryIds.panNumber ? mask(raw.statutoryIds.panNumber) : null,
    },
  };
}
