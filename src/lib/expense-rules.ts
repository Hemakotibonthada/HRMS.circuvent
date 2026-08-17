// ═══════════════════════════════════════════════════════════════
// EXPENSE CLAIM RULES
// ═══════════════════════════════════════════════════════════════
// The decisions an expense claim needs, separated from storage so they can be
// tested without a database and stated once rather than re-derived in a route,
// a repository and a mobile screen.
//
// `/api/expenses` previously contained a copy of the category limits and a
// status map, and persisted nothing at all: `POST` validated the body, built
// an object with `id: EXP-${Date.now()}`, returned 201 "Expense submitted" and
// dropped it. The employee saw a success toast; the claim did not exist. That
// is the shape of bug this module exists to make impossible — the rules live
// here, and the repository is the only thing that decides an id.
//
// Money is minor units (paise) throughout, matching the `total_amount_minor`
// column and the payroll repository. A claim is a reimbursement, so a rounding
// error here is money somebody does not get back.

// Imported relatively rather than through the `@/` alias, because this module
// is also consumed by the mobile app, where `@/` maps to the app's own `src`.
// The alias resolves on the web and silently fails there.
import { parseMinor, sumMinor, type MinorUnits } from "./money/minor";

export type ExpenseStatus = "pending" | "approved" | "rejected" | "cancelled";

/** Terminal in the table, but tracked separately: payment happens after approval. */
export type ExpenseStage = ExpenseStatus | "reimbursed";

export interface ExpenseLineItem {
  description: string;
  amountMinor: MinorUnits;
  category?: string;
}

/**
 * Per-category ceilings, in minor units.
 *
 * These were `travel: 50000` in the old route — major units, undocumented, and
 * therefore silently a hundredth of the intended limit the moment anyone read
 * them as paise. Written as explicit rupee arithmetic so the unit is visible.
 */
const RUPEE = 100n;

export const CATEGORY_LIMITS_MINOR: Record<string, bigint> = {
  travel: 50_000n * RUPEE,
  meals: 10_000n * RUPEE,
  equipment: 40_000n * RUPEE,
  software: 50_000n * RUPEE,
  training: 25_000n * RUPEE,
  books: 5_000n * RUPEE,
  accommodation: 40_000n * RUPEE,
  other: 25_000n * RUPEE,
};

export const EXPENSE_CATEGORIES = Object.keys(CATEGORY_LIMITS_MINOR);

export function isKnownCategory(category: string): boolean {
  return Object.hasOwn(CATEGORY_LIMITS_MINOR, category);
}

/** The ceiling for a category, or null when the category is unknown. */
export function categoryLimitMinor(category: string): bigint | null {
  return CATEGORY_LIMITS_MINOR[category] ?? null;
}

/**
 * Adds line items exactly.
 *
 * The total is derived rather than accepted from the client: a submitted total
 * that disagrees with its own lines is either a bug or an attempt to claim
 * more than the lines justify, and there is no reading of it worth honouring.
 */
export function totalOfLineItems(items: readonly ExpenseLineItem[]): MinorUnits {
  return sumMinor(items.map((item) => item.amountMinor));
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface ClaimInput {
  title: string;
  category: string;
  expenseDate: string;
  lineItems: readonly ExpenseLineItem[];
  description?: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a claim may be submitted at all.
 *
 * Every failure is collected rather than thrown on the first one: a form that
 * reveals its problems one per round trip is how a person ends up submitting
 * four times.
 */
export function validateClaim(input: ClaimInput, today: string): ValidationResult {
  const errors: string[] = [];

  if (!input.title.trim()) errors.push("A title is required");
  if (input.title.length > 200) errors.push("Title must be 200 characters or fewer");

  if (!isKnownCategory(input.category)) {
    errors.push(`Unknown category "${input.category}"`);
  }

  if (!DATE_PATTERN.test(input.expenseDate)) {
    errors.push("Expense date must be YYYY-MM-DD");
  } else if (input.expenseDate > today) {
    // A claim for next Tuesday is either a typo or an advance, and an advance
    // is a different instrument with different approval.
    errors.push("An expense cannot be dated in the future");
  }

  if (input.lineItems.length === 0) {
    errors.push("A claim needs at least one line item");
  }

  let total = 0n;
  input.lineItems.forEach((item, index) => {
    if (!item.description.trim()) {
      errors.push(`Line ${index + 1} needs a description`);
    }

    let amount: bigint;
    try {
      amount = parseMinor(item.amountMinor);
    } catch {
      errors.push(`Line ${index + 1} has an invalid amount`);
      return;
    }

    if (amount <= 0n) {
      errors.push(`Line ${index + 1} must be a positive amount`);
      return;
    }
    total += amount;
  });

  const limit = categoryLimitMinor(input.category);
  if (limit !== null && total > limit) {
    errors.push(
      `Total exceeds the ${input.category} limit of ₹${(limit / RUPEE).toLocaleString("en-IN")}`
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Whether a stage change is allowed.
 *
 * A claim moves forward once. Without this a double-clicked Approve reaches
 * the reimbursement stage twice, and the second one is a duplicate payment.
 */
export function canTransition(from: ExpenseStage, to: ExpenseStage): boolean {
  const allowed: Record<ExpenseStage, ExpenseStage[]> = {
    pending: ["approved", "rejected", "cancelled"],
    approved: ["reimbursed"],
    // Terminal. A rejected claim is resubmitted as a new one, so the original
    // keeps its decision and its audit trail.
    rejected: [],
    cancelled: [],
    reimbursed: [],
  };
  return allowed[from].includes(to);
}

/** Whether a claim is still awaiting a decision. */
export function isOpen(stage: ExpenseStage): boolean {
  return stage === "pending";
}

/**
 * The approved amount, which may be less than claimed.
 *
 * An approver can allow part of a claim — the meal but not the bar tab. Null
 * means "all of it", which is the common case and avoids every caller
 * restating the total.
 */
export function resolveApprovedMinor(
  claimedMinor: MinorUnits,
  approvedMinor: MinorUnits | null | undefined
): MinorUnits {
  if (approvedMinor === null || approvedMinor === undefined) return claimedMinor;

  const claimed = parseMinor(claimedMinor);
  const approved = parseMinor(approvedMinor);

  if (approved < 0n) throw new RangeError("An approved amount cannot be negative");
  if (approved > claimed) {
    // Approving more than was claimed is not partial approval, it is an
    // unreviewed payment.
    throw new RangeError("An approved amount cannot exceed the amount claimed");
  }
  return approved.toString();
}

/**
 * A human-readable claim number, unique per organization.
 *
 * `EXP-2026-000123`. The sequence is passed in rather than generated here,
 * because uniqueness is the database's job — `expense_claims_org_number_key`
 * enforces it, and a number invented from a clock (as the old route's
 * `EXP-${Date.now()}` was) collides under concurrency and sorts by accident.
 */
export function formatClaimNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    throw new RangeError(`Unreasonable year: ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Sequence must be a positive integer, got ${sequence}`);
  }
  return `EXP-${year}-${String(sequence).padStart(6, "0")}`;
}
