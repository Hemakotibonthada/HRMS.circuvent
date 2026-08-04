// ═══════════════════════════════════════════════════════════════
// ANOMALY DETECTION — payroll, attendance and expenses
// ═══════════════════════════════════════════════════════════════
// Catches the mistakes and the fraud that a monthly eyeball of a spreadsheet
// misses: a payslip ten times its usual size, a punch from two cities at once,
// the same receipt claimed twice.
//
// Every detector here is statistical or rule-based rather than learned. Three
// reasons that is the right call for this problem:
//
//  * Anomalies are rare by definition, so there is nothing to train on until
//    long after the system needs to work.
//  * A flag has to be explainable. "Unusual" is not something an HR manager
//    can act on; "3.4x this employee's median net pay" is.
//  * These must never auto-reject. Every detector produces a flag for a human
//    to review, because the cost of wrongly withholding someone's salary is
//    far higher than the cost of a false positive.

export type AnomalySeverity = "info" | "warning" | "critical";

export interface Anomaly {
  code: string;
  severity: AnomalySeverity;
  /** Written for the person reviewing it, with the numbers that triggered it. */
  message: string;
  /** The subject: employee id, claim id, or payroll record id. */
  subjectId: string;
  /** Supporting values, for the review UI. */
  evidence?: Record<string, number | string>;
}

// ─── Statistics ──────────────────────────────────────────────

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Median absolute deviation.
 *
 * Used instead of standard deviation because the mean and SD are themselves
 * dragged by the outlier being looked for: one director's salary in a small
 * team inflates the SD enough to hide everything else. MAD has a ~50%
 * breakdown point, so half the sample would have to be anomalous before it
 * misleads.
 */
export function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * Robust z-score. 0.6745 rescales MAD to be comparable with a standard
 * deviation for normally distributed data.
 */
export function robustZScore(value: number, values: number[]): number {
  const mad = medianAbsoluteDeviation(values);
  // A zero MAD means more than half the sample is identical, so any deviation
  // is notable but not measurable as a ratio.
  if (mad === 0) return value === median(values) ? 0 : Number.POSITIVE_INFINITY;
  return (0.6745 * (value - median(values))) / mad;
}

// ─── Payroll ─────────────────────────────────────────────────

export interface PayrollObservation {
  recordId: string;
  employeeId: string;
  netPay: number;
  gross: number;
  totalDeductions: number;
  lopDays: number;
  workingDays: number;
  /** The same employee's net pay in previous periods, most recent first. */
  history: number[];
}

/** Minimum periods before a comparison against history means anything. */
const MIN_HISTORY = 3;

export function detectPayrollAnomalies(observation: PayrollObservation): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const { recordId, netPay, gross, totalDeductions, lopDays, workingDays, history } = observation;

  if (netPay === 0 && gross > 0) {
    anomalies.push({
      code: "net_pay_zero",
      severity: "critical",
      message: "Deductions consume the entire salary, leaving nothing to pay",
      subjectId: recordId,
      evidence: { gross, totalDeductions },
    });
  }

  if (totalDeductions > gross) {
    anomalies.push({
      code: "deductions_exceed_gross",
      severity: "critical",
      message: `Deductions (${totalDeductions}) exceed gross pay (${gross})`,
      subjectId: recordId,
      evidence: { gross, totalDeductions },
    });
  }

  if (workingDays > 0 && lopDays > workingDays / 2) {
    anomalies.push({
      code: "high_loss_of_pay",
      severity: "warning",
      message: `${lopDays} loss-of-pay days out of ${workingDays} working days`,
      subjectId: recordId,
      evidence: { lopDays, workingDays },
    });
  }

  if (history.length >= MIN_HISTORY) {
    const usual = median(history);
    if (usual > 0) {
      const ratio = netPay / usual;
      // Ratio rather than z-score for the headline check: "3.4 times normal"
      // is something a reviewer can immediately judge.
      if (ratio >= 2) {
        anomalies.push({
          code: "net_pay_spike",
          severity: "critical",
          message: `Net pay is ${ratio.toFixed(1)}x this employee's usual amount`,
          subjectId: recordId,
          evidence: { netPay, usual, ratio: Number(ratio.toFixed(2)) },
        });
      } else if (ratio > 0 && ratio <= 0.5 && lopDays === 0) {
        // Halved pay with no loss-of-pay days has no innocent explanation.
        anomalies.push({
          code: "net_pay_drop",
          severity: "critical",
          message: `Net pay is ${Math.round((1 - ratio) * 100)}% lower than usual with no unpaid days`,
          subjectId: recordId,
          evidence: { netPay, usual },
        });
      } else {
        const z = robustZScore(netPay, history);
        if (Number.isFinite(z) && Math.abs(z) > 3.5) {
          anomalies.push({
            code: "net_pay_outlier",
            severity: "warning",
            message: "Net pay is well outside this employee's normal range",
            subjectId: recordId,
            evidence: { netPay, usual, zScore: Number(z.toFixed(2)) },
          });
        }
      }
    }
  }

  return anomalies;
}

// ─── Attendance ──────────────────────────────────────────────

export interface AttendancePunch {
  recordId: string;
  employeeId: string;
  at: Date;
  latitude?: number;
  longitude?: number;
  method: string;
}

/**
 * Fastest plausible travel, in km/h.
 *
 * Set at commercial-flight speed rather than road speed: the check is meant to
 * catch a punch that is physically impossible, not to accuse anyone who took a
 * fast train.
 */
const MAX_TRAVEL_KMH = 900;

function haversineKm(a: AttendancePunch, b: AttendancePunch): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude! - a.latitude!);
  const dLon = toRad(b.longitude! - a.longitude!);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude!)) * Math.cos(toRad(b.latitude!)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Flags punches that could not have come from the same person.
 *
 * The classic attendance fraud is one employee punching in for a colleague, or
 * a spoofed location. A pair of punches implying supersonic travel is the
 * cheapest reliable signal.
 */
export function detectImpossibleTravel(punches: AttendancePunch[]): Anomaly[] {
  const located = punches
    .filter((p) => p.latitude !== undefined && p.longitude !== undefined)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const anomalies: Anomaly[] = [];

  for (let i = 1; i < located.length; i++) {
    const previous = located[i - 1];
    const current = located[i];

    const hours = (current.at.getTime() - previous.at.getTime()) / 3_600_000;
    const km = haversineKm(previous, current);

    // Two punches at the same instant from different places cannot both be
    // genuine, and dividing by zero hours would say nothing useful.
    if (hours <= 0) {
      if (km > 1) {
        anomalies.push({
          code: "simultaneous_punch",
          severity: "critical",
          message: `Two punches at the same moment ${km.toFixed(0)} km apart`,
          subjectId: current.recordId,
          evidence: { distanceKm: Number(km.toFixed(1)) },
        });
      }
      continue;
    }

    // Sub-kilometre differences are GPS drift, not travel.
    if (km < 1) continue;

    const speed = km / hours;
    if (speed > MAX_TRAVEL_KMH) {
      anomalies.push({
        code: "impossible_travel",
        severity: "critical",
        message: `${km.toFixed(0)} km apart in ${hours.toFixed(1)} hours, implying ${Math.round(speed)} km/h`,
        subjectId: current.recordId,
        evidence: {
          distanceKm: Number(km.toFixed(1)),
          hours: Number(hours.toFixed(2)),
          impliedSpeedKmh: Math.round(speed),
        },
      });
    }
  }

  return anomalies;
}

// ─── Expenses ────────────────────────────────────────────────

export interface ExpenseObservation {
  claimId: string;
  employeeId: string;
  amount: number;
  category: string;
  expenseDate: string;
  merchant?: string;
  hasReceipt: boolean;
  /** Other claims by the same employee, for comparison. */
  peerAmounts: number[];
}

/** Approval thresholds are a common target for splitting a claim in two. */
const SPLIT_THRESHOLDS = [5_000, 10_000, 25_000, 50_000];

export function detectExpenseAnomalies(observation: ExpenseObservation): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const { claimId, amount, hasReceipt, peerAmounts } = observation;

  if (!hasReceipt && amount > 1_000) {
    anomalies.push({
      code: "missing_receipt",
      severity: "warning",
      message: `Claim of ${amount} has no receipt attached`,
      subjectId: claimId,
      evidence: { amount },
    });
  }

  // A round number is weak evidence alone but a reliable component: genuine
  // receipts rarely land on exact thousands.
  if (amount >= 1_000 && amount % 1_000 === 0) {
    anomalies.push({
      code: "suspiciously_round",
      severity: "info",
      message: `Claim is an exact round amount (${amount})`,
      subjectId: claimId,
      evidence: { amount },
    });
  }

  // Just under a threshold is the signature of splitting a claim to stay
  // below an approval limit.
  for (const threshold of SPLIT_THRESHOLDS) {
    if (amount >= threshold * 0.95 && amount < threshold) {
      anomalies.push({
        code: "just_under_threshold",
        severity: "warning",
        message: `Claim of ${amount} sits just below the ${threshold} approval threshold`,
        subjectId: claimId,
        evidence: { amount, threshold },
      });
      break;
    }
  }

  if (peerAmounts.length >= MIN_HISTORY) {
    const usual = median(peerAmounts);
    if (usual > 0 && amount / usual >= 5) {
      anomalies.push({
        code: "unusually_large",
        severity: "warning",
        message: `Claim is ${(amount / usual).toFixed(1)}x this employee's typical amount`,
        subjectId: claimId,
        evidence: { amount, usual },
      });
    }
  }

  return anomalies;
}

/**
 * Finds claims that appear to be the same expense submitted twice.
 *
 * Duplicates are usually accidental — a resubmitted claim after a rejection,
 * or one person filing what a colleague already filed for a shared meal — but
 * they are invisible without an explicit check.
 */
export function detectDuplicateClaims(claims: ExpenseObservation[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const seen = new Map<string, ExpenseObservation>();

  for (const claim of claims) {
    // Same person, day, category and amount. Merchant is included when known,
    // since two identical taxi fares on one day are plausible but two from the
    // same merchant are not.
    const key = [
      claim.employeeId,
      claim.expenseDate,
      claim.category,
      claim.amount.toFixed(2),
      claim.merchant?.trim().toLowerCase() ?? "",
    ].join("|");

    const previous = seen.get(key);
    if (previous) {
      anomalies.push({
        code: "possible_duplicate",
        severity: "warning",
        message: `Matches claim ${previous.claimId}: same date, category and amount`,
        subjectId: claim.claimId,
        evidence: {
          amount: claim.amount,
          expenseDate: claim.expenseDate,
          matchesClaimId: previous.claimId,
        },
      });
    } else {
      seen.set(key, claim);
    }
  }

  return anomalies;
}

/** Highest severity first, so a reviewer sees what matters at the top. */
export function prioritise(anomalies: Anomaly[]): Anomaly[] {
  const rank: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 };
  return [...anomalies].sort((a, b) => rank[a.severity] - rank[b.severity]);
}
