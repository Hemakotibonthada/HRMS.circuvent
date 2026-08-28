// ═══════════════════════════════════════════════════════════════
// ASSET RULES — depreciation, assignment and lifecycle
// ═══════════════════════════════════════════════════════════════
// Pure, so it tests without a database.
//
// Two things make asset tracking harder than a list of laptops:
//
// 1. Depreciation feeds the balance sheet. The book value this produces is
//    reported to auditors, so it has to match the method the finance team
//    declared and be reproducible for any date, not just today.
//
// 2. An asset register is only worth having if it is *true*. The functions
//    below therefore refuse impossible states — issuing an asset already
//    issued, returning one nobody has — rather than accepting them and leaving
//    a register that quietly diverges from the cupboard.

/** Money is minor units as bigint, the same as payroll and compensation. */
export type Minor = bigint;

export type DepreciationMethod =
  | "straight_line"
  | "declining_balance"
  | "double_declining"
  | "none";

export interface DepreciableAsset {
  purchaseCostMinor: Minor;
  purchaseDate: string;
  /** Expected life in months. */
  usefulLifeMonths: number;
  /** Value at the end of its life. */
  salvageValueMinor: Minor;
  method: DepreciationMethod;
}

export interface DepreciationPosition {
  /** Whole months of life consumed by the valuation date. */
  monthsElapsed: number;
  accumulatedMinor: Minor;
  bookValueMinor: Minor;
  /** The charge for the month containing the valuation date. */
  monthlyChargeMinor: Minor;
  isFullyDepreciated: boolean;
}

/**
 * Book value on a given date.
 *
 * Never falls below salvage value. A straight-line schedule run past the end
 * of an asset's life would otherwise produce a negative book value, and a
 * negative asset on a balance sheet is the kind of thing an auditor asks
 * about for an hour.
 */
export function depreciate(asset: DepreciableAsset, asOf: string): DepreciationPosition {
  if (asset.usefulLifeMonths <= 0 && asset.method !== "none") {
    throw new Error("A depreciating asset needs a positive useful life");
  }
  if (asset.salvageValueMinor < 0n) {
    throw new Error("Salvage value cannot be negative");
  }
  if (asset.salvageValueMinor > asset.purchaseCostMinor) {
    throw new Error("Salvage value cannot exceed the purchase cost");
  }

  const monthsElapsed = Math.max(0, monthsBetween(asset.purchaseDate, asOf));

  if (asset.method === "none") {
    return {
      monthsElapsed,
      accumulatedMinor: 0n,
      bookValueMinor: asset.purchaseCostMinor,
      monthlyChargeMinor: 0n,
      isFullyDepreciated: false,
    };
  }

  const depreciable = asset.purchaseCostMinor - asset.salvageValueMinor;
  const capped = Math.min(monthsElapsed, asset.usefulLifeMonths);

  let accumulated: Minor;
  let monthlyCharge: Minor;

  if (asset.method === "straight_line") {
    // The final month absorbs the rounding remainder, so the schedule sums to
    // exactly the depreciable amount rather than leaving a few paise behind.
    monthlyCharge = depreciable / BigInt(asset.usefulLifeMonths);
    accumulated =
      capped >= asset.usefulLifeMonths ? depreciable : monthlyCharge * BigInt(capped);
  } else {
    const factor = asset.method === "double_declining" ? 2 : 1.5;
    const monthlyRate = factor / asset.usefulLifeMonths;

    let book = asset.purchaseCostMinor;
    let lastCharge = 0n;

    for (let month = 0; month < capped; month++) {
      // A declining-balance schedule approaches salvage asymptotically and
      // never reaches it, so the charge is clamped to whatever remains.
      const raw = BigInt(Math.round(Number(book) * monthlyRate));
      const remaining = book - asset.salvageValueMinor;
      lastCharge = raw > remaining ? remaining : raw;
      book -= lastCharge;

      if (book <= asset.salvageValueMinor) {
        book = asset.salvageValueMinor;
        break;
      }
    }

    // At the end of its useful life the asset must be AT salvage value, not
    // merely near it. Pure declining balance leaves a residue above salvage —
    // for a 36-month laptop it is about 3,300 — which would mean the asset is
    // never fully depreciated and sits on the balance sheet above its agreed
    // residual for ever. Standard practice, and what an auditor expects, is
    // that the final period absorbs the remainder.
    if (capped >= asset.usefulLifeMonths) {
      lastCharge = book - asset.salvageValueMinor;
      book = asset.salvageValueMinor;
    }

    accumulated = asset.purchaseCostMinor - book;
    monthlyCharge = lastCharge;
  }

  if (accumulated > depreciable) accumulated = depreciable;

  const bookValueMinor = asset.purchaseCostMinor - accumulated;

  return {
    monthsElapsed,
    accumulatedMinor: accumulated,
    bookValueMinor,
    monthlyChargeMinor:
      asset.method === "straight_line"
        ? capped >= asset.usefulLifeMonths
          ? 0n
          : monthlyCharge
        : monthlyCharge,
    isFullyDepreciated: bookValueMinor <= asset.salvageValueMinor,
  };
}

/**
 * A full month-by-month schedule.
 *
 * Auditors ask for this, and reconstructing it from a single book value is not
 * possible. Bounded because a life of a thousand years is a data-entry error,
 * not a request for twelve thousand rows.
 */
export function depreciationSchedule(
  asset: DepreciableAsset,
  maxMonths = 600
): { month: number; date: string; chargeMinor: Minor; bookValueMinor: Minor }[] {
  if (asset.method === "none") return [];

  const months = Math.min(asset.usefulLifeMonths, maxMonths);
  const schedule = [];

  let previousBook = asset.purchaseCostMinor;

  for (let month = 1; month <= months; month++) {
    const date = addMonths(asset.purchaseDate, month);
    const position = depreciate(asset, date);

    schedule.push({
      month,
      date,
      chargeMinor: previousBook - position.bookValueMinor,
      bookValueMinor: position.bookValueMinor,
    });

    previousBook = position.bookValueMinor;
  }

  return schedule;
}

// ─── Lifecycle ───────────────────────────────────────────────

export type AssetState =
  | "in_stock"
  | "assigned"
  | "in_repair"
  | "lost"
  | "retired"
  | "disposed";

export type AssetAction =
  | "issue"
  | "return"
  | "send_for_repair"
  | "repair_complete"
  | "report_lost"
  | "recover"
  | "retire"
  | "dispose";

/**
 * Which actions each state permits.
 *
 * A table rather than a chain of conditionals, because the interesting
 * question is always "can this happen from here?" and a table answers it by
 * inspection. A disposed asset permits nothing: it no longer exists.
 */
const TRANSITIONS: Record<AssetState, Partial<Record<AssetAction, AssetState>>> = {
  in_stock: {
    issue: "assigned",
    send_for_repair: "in_repair",
    report_lost: "lost",
    retire: "retired",
  },
  assigned: {
    return: "in_stock",
    send_for_repair: "in_repair",
    report_lost: "lost",
  },
  in_repair: {
    repair_complete: "in_stock",
    retire: "retired",
    report_lost: "lost",
  },
  lost: {
    recover: "in_stock",
    // A written-off asset is retired, not deleted: it stays in the register
    // with its history, because "where did that laptop go?" is asked later.
    retire: "retired",
  },
  retired: {
    dispose: "disposed",
  },
  disposed: {},
};

export type TransitionVerdict =
  | { allowed: true; to: AssetState }
  | { allowed: false; reason: string };

export function canTransition(from: AssetState, action: AssetAction): TransitionVerdict {
  const to = TRANSITIONS[from]?.[action];

  if (!to) {
    return {
      allowed: false,
      reason: `An asset that is ${from.replace(/_/g, " ")} cannot be ${describe(action)}`,
    };
  }

  return { allowed: true, to };
}

function describe(action: AssetAction): string {
  const wording: Record<AssetAction, string> = {
    issue: "issued",
    return: "returned",
    send_for_repair: "sent for repair",
    repair_complete: "marked as repaired",
    report_lost: "reported lost",
    recover: "recovered",
    retire: "retired",
    dispose: "disposed of",
  };
  return wording[action];
}

/** Actions available from a state, for building a menu that cannot mislead. */
export function availableActions(from: AssetState): AssetAction[] {
  return Object.keys(TRANSITIONS[from] ?? {}) as AssetAction[];
}

// ─── Assignment ──────────────────────────────────────────────

export interface AssignmentCheck {
  assetState: AssetState;
  /** Assets already held by the person, for a per-category limit. */
  employeeHoldings: { categoryId: string; count: number }[];
  categoryId: string;
  /** Zero or absent means no limit. */
  maxPerEmployee?: number;
  employeeIsActive: boolean;
}

export type IssueVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * Whether an asset may be issued.
 *
 * The leaver check is the one that matters. Issuing equipment to someone whose
 * last day has passed is how a laptop leaves the building permanently, and it
 * happens because the register and the employment record are checked by
 * different people at different times.
 */
export function canIssue(check: AssignmentCheck): IssueVerdict {
  const transition = canTransition(check.assetState, "issue");
  if (!transition.allowed) return { allowed: false, reason: transition.reason };

  if (!check.employeeIsActive) {
    return {
      allowed: false,
      reason: "This person is no longer active, so equipment cannot be issued to them",
    };
  }

  if (check.maxPerEmployee && check.maxPerEmployee > 0) {
    const held =
      check.employeeHoldings.find((h) => h.categoryId === check.categoryId)?.count ?? 0;

    if (held >= check.maxPerEmployee) {
      return {
        allowed: false,
        reason: `They already hold ${held} of these, and the limit is ${check.maxPerEmployee}`,
      };
    }
  }

  return { allowed: true };
}

export interface ClearanceItem {
  assetId: string;
  assetTag: string;
  name: string;
  categoryName: string;
  bookValueMinor: Minor;
  issuedOn: string;
}

export interface ClearanceResult {
  outstanding: ClearanceItem[];
  totalValueMinor: Minor;
  isClear: boolean;
}

/**
 * What a leaver still holds.
 *
 * Book value rather than purchase cost. Charging someone the full price of a
 * four-year-old laptop is neither defensible nor, in most jurisdictions,
 * lawful — and a clearance figure that cannot be defended is one that gets
 * waived entirely.
 */
export function exitClearance(held: ClearanceItem[]): ClearanceResult {
  const totalValueMinor = held.reduce((sum, item) => sum + item.bookValueMinor, 0n);

  return {
    outstanding: [...held].sort((a, b) =>
      b.bookValueMinor > a.bookValueMinor ? 1 : b.bookValueMinor < a.bookValueMinor ? -1 : 0
    ),
    totalValueMinor,
    isClear: held.length === 0,
  };
}

// ─── Warranty and maintenance ────────────────────────────────

export interface WarrantyPosition {
  isUnderWarranty: boolean;
  daysRemaining: number | null;
  expiringSoon: boolean;
}

/**
 * Warranty state on a date.
 *
 * `expiringSoon` exists so a renewal decision can be made before the cover
 * lapses. Finding out an asset is out of warranty at the moment it breaks is
 * finding out too late.
 */
export function warrantyPosition(
  warrantyUntil: string | null | undefined,
  asOf: string,
  soonDays = 60
): WarrantyPosition {
  if (!warrantyUntil) {
    return { isUnderWarranty: false, daysRemaining: null, expiringSoon: false };
  }

  const days = daysBetween(asOf, warrantyUntil);

  return {
    isUnderWarranty: days >= 0,
    daysRemaining: days,
    expiringSoon: days >= 0 && days <= soonDays,
  };
}

/** The next service date from the last one and an interval. */
export function nextServiceDue(
  lastServicedOn: string | null | undefined,
  intervalMonths: number,
  purchaseDate: string
): string | null {
  if (intervalMonths <= 0) return null;
  // An asset never serviced is due from purchase, not from never — otherwise
  // the one thing most likely to need attention is the one thing the report
  // never shows.
  return addMonths(lastServicedOn ?? purchaseDate, intervalMonths);
}

// ─── Dates ───────────────────────────────────────────────────

export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);

  if ([fy, fm, fd, ty, tm, td].some(Number.isNaN)) {
    throw new Error("Dates must be YYYY-MM-DD");
  }

  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if ([y, m, d].some(Number.isNaN)) throw new Error("Dates must be YYYY-MM-DD");

  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();

  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error("Dates must be YYYY-MM-DD");
  return Math.round((b - a) / 86_400_000);
}
