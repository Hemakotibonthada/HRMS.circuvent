// ═══════════════════════════════════════════════════════════════
// REFERRAL RULES
// ═══════════════════════════════════════════════════════════════
// The decisions a referral scheme has to get right, separated from persistence
// so they can be tested without a database.
//
// These rules exist because money depends on them. A referral bonus is a
// promise to an employee, and the three ways schemes go wrong in practice are:
// paying twice, paying for a hire who left immediately, and paying the wrong
// person when two colleagues referred the same candidate.

export type ReferralStatus =
  | "submitted"
  | "screening"
  | "interviewing"
  | "offered"
  | "hired"
  | "rejected"
  | "withdrawn"
  | "duplicate";

export type PayoutStatus =
  | "not_eligible"
  | "pending_milestone"
  | "approved"
  | "paid"
  | "forfeited";

/**
 * Permitted stage transitions.
 *
 * Terminal states have no outgoing transitions. In particular `hired` is
 * terminal: the bonus clock has started and an employee record exists, so
 * reversing it is a correction — void and re-create — not a stage change.
 */
export const ALLOWED_TRANSITIONS: Record<ReferralStatus, readonly ReferralStatus[]> = {
  submitted: ["screening", "rejected", "withdrawn", "duplicate"],
  screening: ["interviewing", "rejected", "withdrawn"],
  interviewing: ["offered", "rejected", "withdrawn"],
  offered: ["hired", "rejected", "withdrawn"],
  hired: [],
  rejected: [],
  withdrawn: [],
  duplicate: [],
};

export function canTransition(from: ReferralStatus, to: ReferralStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ReferralStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * Explains a refused transition in terms the user can act on.
 *
 * "Invalid transition" tells someone nothing; "a hired referral cannot change
 * further" tells them to stop trying.
 */
export function explainRefusal(from: ReferralStatus, to: ReferralStatus): string {
  if (canTransition(from, to)) return "";
  if (isTerminal(from)) return `This referral is ${from} and cannot change further`;
  return `A ${from} referral cannot move to ${to}`;
}

// ─── Bonus eligibility ───────────────────────────────────────

export interface BonusInstalment {
  /** Days after the hire date this instalment falls due. */
  afterDays: number;
  /** Share of the total bonus, 0-100. */
  percent: number;
}

export interface BonusPolicy {
  bonusAmountMinor: bigint;
  qualifyingPeriodDays: number;
  instalments?: BonusInstalment[];
}

/**
 * The date a bonus becomes payable.
 *
 * Bonuses are conditional on the hire staying, because the scheme exists to
 * find people who will succeed, not to reward introductions.
 */
export function payoutEligibleOn(hiredOn: string, qualifyingPeriodDays: number): string {
  const date = new Date(`${hiredOn}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("hiredOn must be a valid YYYY-MM-DD date");
  }
  date.setUTCDate(date.getUTCDate() + Math.max(0, qualifyingPeriodDays));
  return date.toISOString().slice(0, 10);
}

export interface ScheduledInstalment {
  dueOn: string;
  amountMinor: bigint;
}

/**
 * Splits a bonus into instalments.
 *
 * Rounding is handled by giving the remainder to the final instalment, so the
 * parts always sum to exactly the promised total. Distributing it evenly would
 * leave the employee a rupee short or the company a rupee over, and neither
 * reconciles.
 */
export function scheduleInstalments(
  policy: BonusPolicy,
  hiredOn: string
): ScheduledInstalment[] {
  const total = policy.bonusAmountMinor;
  if (total <= 0n) return [];

  const instalments = policy.instalments?.length
    ? policy.instalments
    : [{ afterDays: policy.qualifyingPeriodDays, percent: 100 }];

  const totalPercent = instalments.reduce((sum, i) => sum + i.percent, 0);
  if (totalPercent !== 100) {
    throw new Error(`Instalments must total 100%, got ${totalPercent}%`);
  }

  const scheduled: ScheduledInstalment[] = [];
  let allocated = 0n;

  instalments.forEach((instalment, index) => {
    const isLast = index === instalments.length - 1;
    const amount = isLast
      ? total - allocated
      : (total * BigInt(instalment.percent)) / 100n;

    allocated += amount;
    scheduled.push({
      dueOn: payoutEligibleOn(hiredOn, instalment.afterDays),
      amountMinor: amount,
    });
  });

  return scheduled;
}

// ─── Duplicate detection ─────────────────────────────────────

export interface ExistingReferral {
  id: string;
  referrerId: string;
  candidateEmail: string;
  jobId: string | null;
  status: ReferralStatus;
  submittedAt: string;
}

export type DuplicateVerdict =
  | { kind: "none" }
  | { kind: "self_referral" }
  | { kind: "own_duplicate"; existingId: string }
  | { kind: "colleague_duplicate"; existingId: string; referrerId: string };

/**
 * Decides whether a new referral collides with an existing one.
 *
 * Deliberately distinguishes "you already referred them" from "a colleague
 * did". The first is a mistake the user can correct; the second involves
 * someone else's bonus claim and needs a different message, because telling
 * the second referrer nothing is how disputes start.
 *
 * A referral that was rejected or withdrawn does not block a later one — the
 * candidate may have become suitable, or applied for a different role.
 */
export function detectDuplicate(
  candidateEmail: string,
  jobId: string | null,
  referrerId: string,
  referrerEmail: string,
  existing: ExistingReferral[]
): DuplicateVerdict {
  const email = candidateEmail.trim().toLowerCase();

  if (email === referrerEmail.trim().toLowerCase()) {
    return { kind: "self_referral" };
  }

  const blocking = existing.filter(
    (r) =>
      r.candidateEmail.trim().toLowerCase() === email &&
      r.jobId === jobId &&
      !["rejected", "withdrawn", "duplicate"].includes(r.status)
  );

  if (blocking.length === 0) return { kind: "none" };

  // Earliest wins, which is the only defensible rule when money is attached.
  const first = [...blocking].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0];

  return first.referrerId === referrerId
    ? { kind: "own_duplicate", existingId: first.id }
    : { kind: "colleague_duplicate", existingId: first.id, referrerId: first.referrerId };
}

/**
 * Whether a hire still qualifies for the bonus.
 *
 * Checked at approval time rather than trusting the milestone date, because
 * approval may happen days or weeks after the milestone and the hire may have
 * resigned in between.
 */
export function stillQualifies(employeeStatus: string, isDeleted: boolean): boolean {
  if (isDeleted) return false;
  // Notice period counts as leaving: paying a retention bonus to someone whose
  // resignation is already in defeats the purpose.
  return ["active", "probation", "on_leave"].includes(employeeStatus);
}

// ─── Default policy set ──────────────────────────────────────

/**
 * What a newly registered organisation starts with.
 *
 * The referral module shipped complete — a tested state machine, instalment
 * scheduling, duplicate detection, payout eligibility — and no organisation
 * had a single policy row, so there was no bonus amount for any of it to work
 * from. The screens rendered, referrals could be submitted, and nothing could
 * ever be paid. Same shape as the leave module before its policies were
 * seeded: the logic was never the missing part.
 *
 * These are a starting point the tenant is expected to edit, not a claim about
 * what anyone owes. The two-instalment split is the common Indian pattern:
 * part on joining, the rest once the hire has stayed long enough to show the
 * referral was a good one.
 */
export interface DefaultReferralPolicy {
  name: string;
  seniority: string | null;
  bonusAmountMinor: bigint;
  qualifyingPeriodDays: number;
  instalments: { label: string; percentage: number; afterDays: number }[];
}

export const DEFAULT_REFERRAL_POLICIES: readonly DefaultReferralPolicy[] = [
  {
    name: "Standard referral",
    seniority: null,
    // ₹25,000, in paise, because money is held in minor units everywhere in
    // this product and a float here would be the one place it is not.
    bonusAmountMinor: 2_500_000n,
    qualifyingPeriodDays: 90,
    instalments: [
      { label: "On joining", percentage: 50, afterDays: 0 },
      { label: "After probation", percentage: 50, afterDays: 90 },
    ],
  },
  {
    name: "Senior referral",
    seniority: "senior",
    bonusAmountMinor: 5_000_000n,
    qualifyingPeriodDays: 180,
    instalments: [
      { label: "On joining", percentage: 40, afterDays: 0 },
      { label: "After six months", percentage: 60, afterDays: 180 },
    ],
  },
  {
    name: "Leadership referral",
    seniority: "lead",
    bonusAmountMinor: 10_000_000n,
    qualifyingPeriodDays: 180,
    instalments: [
      { label: "On joining", percentage: 30, afterDays: 0 },
      { label: "After six months", percentage: 70, afterDays: 180 },
    ],
  },
] as const;
