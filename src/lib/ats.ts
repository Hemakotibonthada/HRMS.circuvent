// ═══════════════════════════════════════════════════════════════
// ATS RULES — pipeline, scheduling, scorecards, offers
// ═══════════════════════════════════════════════════════════════
// Pure, so it tests without a database.
//
// The rule here that earns its keep is the one about scorecards: an
// interviewer may not see anyone else's assessment until they have submitted
// their own. Panels converge hard on the first opinion voiced, and a system
// that shows the previous scores while the next interviewer is still typing
// has turned four independent assessments into one repeated four times.
//
// The rest is mostly about refusing states that make hiring data untrue —
// a candidate in two stages at once, an offer accepted after it expired, a
// panellist double-booked.

export interface PipelineStage {
  id: string;
  name: string;
  /** Position in the pipeline, ascending. */
  sequence: number;
  kind: "sourcing" | "screening" | "interview" | "assessment" | "offer" | "hired";
  /** Scorecards required before the candidate may advance. */
  requiredScorecards: number;
  /** Automatically rejects if the score falls below this. */
  autoRejectBelow?: number;
}

export type ApplicationStatus =
  | "active"
  | "hired"
  | "rejected"
  | "withdrawn"
  | "on_hold";

export interface ApplicationState {
  stageId: string;
  status: ApplicationStatus;
  scorecardCount: number;
  averageScore?: number;
}

export type AdvanceVerdict =
  | { allowed: true; toStageId: string }
  | { allowed: false; reason: string };

/**
 * Whether an application may move to the next stage.
 *
 * Stages cannot be skipped. Moving someone from "applied" straight to "offer"
 * loses the record of why they were considered suitable, and that record is
 * what an unsuccessful candidate's discrimination claim asks to see.
 */
export function canAdvance(
  application: ApplicationState,
  stages: PipelineStage[],
  toStageId?: string
): AdvanceVerdict {
  if (application.status !== "active") {
    return {
      allowed: false,
      reason: `This application is ${application.status.replace(/_/g, " ")}`,
    };
  }

  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);
  const currentIndex = ordered.findIndex((s) => s.id === application.stageId);

  if (currentIndex < 0) {
    return { allowed: false, reason: "The current stage is not part of this pipeline" };
  }

  const current = ordered[currentIndex];

  // The target is validated before readiness. A request to move backwards, or
  // to skip three stages, is malformed — telling the caller to submit
  // scorecards first would answer a question they did not ask.
  const next = toStageId
    ? ordered.find((s) => s.id === toStageId)
    : ordered[currentIndex + 1];

  if (!next) {
    return {
      allowed: false,
      reason: toStageId
        ? "That stage is not part of this pipeline"
        : "There is no further stage in this pipeline",
    };
  }

  const nextIndex = ordered.findIndex((s) => s.id === next.id);

  if (nextIndex <= currentIndex) {
    // Moving backwards is a real action, but it is not "advancing" and should
    // be recorded as the reversal it is.
    return {
      allowed: false,
      reason: `${next.name} comes before ${current.name}; use a stage reversal instead`,
    };
  }

  if (nextIndex > currentIndex + 1) {
    const skipped = ordered.slice(currentIndex + 1, nextIndex).map((s) => s.name);
    return {
      allowed: false,
      reason: `That would skip ${skipped.join(", ")}. Reject or explicitly waive each stage first.`,
    };
  }

  if (application.scorecardCount < current.requiredScorecards) {
    return {
      allowed: false,
      reason: `${current.name} needs ${current.requiredScorecards} scorecard${current.requiredScorecards === 1 ? "" : "s"}; ${application.scorecardCount} submitted`,
    };
  }

  if (
    current.autoRejectBelow !== undefined &&
    application.averageScore !== undefined &&
    application.averageScore < current.autoRejectBelow
  ) {
    return {
      allowed: false,
      reason: `The average score of ${application.averageScore.toFixed(1)} is below the ${current.autoRejectBelow} threshold for ${current.name}`,
    };
  }

  return { allowed: true, toStageId: next.id };
}

// ─── Duplicate detection ─────────────────────────────────────

export interface CandidateIdentity {
  id: string;
  email: string;
  phone?: string;
}

export interface DuplicateMatch {
  candidateId: string;
  confidence: "certain" | "likely";
  matchedOn: "email" | "phone";
}

/**
 * Finds an existing candidate matching a new applicant.
 *
 * Email is normalised, including Gmail's dot-insensitivity and plus-addressing
 * — `a.b+jobs@gmail.com` and `ab@gmail.com` are the same inbox, and treating
 * them as two people means one person's rejection is invisible when they
 * reapply.
 *
 * Phone is a likely match rather than a certain one: shared household numbers
 * are common enough that merging on one alone would combine two real people.
 */
export function findDuplicates(
  incoming: { email: string; phone?: string },
  existing: CandidateIdentity[]
): DuplicateMatch[] {
  const email = normaliseEmail(incoming.email);
  const phone = incoming.phone ? normalisePhone(incoming.phone) : undefined;

  const matches: DuplicateMatch[] = [];

  for (const candidate of existing) {
    if (normaliseEmail(candidate.email) === email) {
      matches.push({ candidateId: candidate.id, confidence: "certain", matchedOn: "email" });
      continue;
    }

    if (phone && candidate.phone && normalisePhone(candidate.phone) === phone) {
      matches.push({ candidateId: candidate.id, confidence: "likely", matchedOn: "phone" });
    }
  }

  return matches;
}

export function normaliseEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed;

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  // Plus-addressing is a routing hint, not a different address.
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);

  // Gmail ignores dots in the local part; most other providers do not, so this
  // is deliberately not applied everywhere.
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }

  return `${local}@${domain}`;
}

export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Compare the last ten digits, so a number written with a country code
  // matches the same number written without one.
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// ─── Interview scheduling ────────────────────────────────────

export interface InterviewSlot {
  interviewerId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface ScheduleConflict {
  interviewerId: string;
  conflictsWith: { startsAt: string; endsAt: string };
  reason: string;
}

/**
 * Finds panellists who are already booked.
 *
 * Reported rather than blocked, because a genuine double-booking sometimes has
 * to be made deliberately — but it has to be seen. An interview quietly
 * scheduled over another one produces an empty room and a candidate who
 * travelled for it.
 */
export function findConflicts(
  proposed: InterviewSlot,
  existing: InterviewSlot[],
  bufferMinutes = 0
): ScheduleConflict[] {
  const bufferMs = bufferMinutes * 60_000;

  return existing
    .filter((slot) => slot.interviewerId === proposed.interviewerId)
    .filter(
      (slot) =>
        proposed.startsAt.getTime() - bufferMs < slot.endsAt.getTime() &&
        proposed.endsAt.getTime() + bufferMs > slot.startsAt.getTime()
    )
    .map((slot) => ({
      interviewerId: slot.interviewerId,
      conflictsWith: {
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
      },
      reason:
        bufferMinutes > 0
          ? `Within ${bufferMinutes} minutes of another interview`
          : "Overlaps another interview",
    }));
}

// ─── Scorecards ──────────────────────────────────────────────

export interface Scorecard {
  interviewerId: string;
  submittedAt?: string;
  /** Per competency, 1-5. */
  scores: Record<string, number>;
  recommendation: "strong_hire" | "hire" | "no_hire" | "strong_no_hire";
  notes?: string;
}

export type ScorecardVisibility =
  | { canSee: true }
  | { canSee: false; reason: string };

/**
 * Whether an interviewer may see the panel's other scorecards.
 *
 * Only after submitting their own. Panels converge hard on the first opinion
 * voiced, and showing previous scores while the next interviewer is still
 * typing turns four independent assessments into one repeated four times —
 * which is worse than one assessment, because it looks like corroboration.
 */
export function canSeeOtherScorecards(
  viewerId: string,
  scorecards: Scorecard[],
  isHiringManager = false
): ScorecardVisibility {
  // The hiring manager has to be able to read the panel to make a decision,
  // and is not one of the independent assessments being protected.
  if (isHiringManager) return { canSee: true };

  const own = scorecards.find((s) => s.interviewerId === viewerId);

  if (!own) {
    return { canSee: false, reason: "You are not on this panel" };
  }
  if (!own.submittedAt) {
    return {
      canSee: false,
      reason: "Submit your own assessment before reading the panel's",
    };
  }

  return { canSee: true };
}

export interface PanelVerdict {
  submittedCount: number;
  pendingCount: number;
  averageScore: number;
  recommendation: "strong_hire" | "hire" | "no_hire" | "strong_no_hire" | "split";
  /** True when the panel disagrees enough to be worth discussing. */
  isSplit: boolean;
  /** Written for the hiring manager. */
  summary: string;
}

/**
 * Summarises a panel.
 *
 * A split decision is surfaced rather than averaged away. Two strong hires and
 * two strong no-hires average to the middle, and reporting that as "neutral"
 * hides the only interesting fact about the interview.
 */
export function summarisePanel(scorecards: Scorecard[]): PanelVerdict {
  const submitted = scorecards.filter((s) => s.submittedAt);

  if (submitted.length === 0) {
    return {
      submittedCount: 0,
      pendingCount: scorecards.length,
      averageScore: 0,
      recommendation: "split",
      isSplit: false,
      summary: "No assessments submitted yet",
    };
  }

  const allScores = submitted.flatMap((s) => Object.values(s.scores));
  const averageScore =
    allScores.length === 0
      ? 0
      : Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 100) / 100;

  const weight: Record<Scorecard["recommendation"], number> = {
    strong_hire: 2,
    hire: 1,
    no_hire: -1,
    strong_no_hire: -2,
  };

  const votes = submitted.map((s) => weight[s.recommendation]);
  const positives = votes.filter((v) => v > 0).length;
  const negatives = votes.filter((v) => v < 0).length;

  const isSplit = positives > 0 && negatives > 0;
  const total = votes.reduce((a, b) => a + b, 0);

  const recommendation: PanelVerdict["recommendation"] = isSplit
    ? "split"
    : total >= submitted.length * 2
      ? "strong_hire"
      : total > 0
        ? "hire"
        : total <= -submitted.length * 2
          ? "strong_no_hire"
          : "no_hire";

  return {
    submittedCount: submitted.length,
    pendingCount: scorecards.length - submitted.length,
    averageScore,
    recommendation,
    isSplit,
    summary: isSplit
      ? `Split panel: ${positives} for, ${negatives} against. Worth discussing before deciding.`
      : `${submitted.length} of ${scorecards.length} submitted, averaging ${averageScore.toFixed(1)}`,
  };
}

// ─── Offers ──────────────────────────────────────────────────

export type OfferStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "accepted"
  | "declined"
  | "expired"
  | "withdrawn";

export interface OfferState {
  status: OfferStatus;
  /** ISO instant. */
  expiresAt?: string;
  sentAt?: string;
  approvedById?: string;
  createdById?: string;
}

export type OfferVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * Whether an offer may be sent.
 *
 * Approval is required and must come from someone other than the author. An
 * offer commits the company to a salary; one person drafting and approving it
 * has no check on it at all — the same separation payroll and erasure use.
 */
export function canSendOffer(offer: OfferState, now = new Date()): OfferVerdict {
  if (offer.status !== "approved") {
    return {
      allowed: false,
      reason:
        offer.status === "draft" || offer.status === "pending_approval"
          ? "This offer has not been approved yet"
          : `This offer is ${offer.status}`,
    };
  }

  if (!offer.approvedById) {
    return { allowed: false, reason: "No approver is recorded on this offer" };
  }

  if (offer.createdById && offer.approvedById === offer.createdById) {
    return {
      allowed: false,
      reason: "An offer must be approved by someone other than the person who drafted it",
    };
  }

  if (offer.expiresAt && new Date(offer.expiresAt) <= now) {
    return { allowed: false, reason: "This offer has already expired" };
  }

  return { allowed: true };
}

/**
 * Whether a candidate may still accept.
 *
 * Expiry is enforced rather than treated as advisory. An offer accepted three
 * weeks after it lapsed leaves genuine doubt about whether a contract exists,
 * and that doubt is resolved in a tribunal rather than in the system.
 */
export function canAcceptOffer(offer: OfferState, now = new Date()): OfferVerdict {
  if (offer.status === "accepted") {
    return { allowed: false, reason: "This offer has already been accepted" };
  }
  if (offer.status !== "sent") {
    return { allowed: false, reason: `This offer is ${offer.status}` };
  }
  if (offer.expiresAt && new Date(offer.expiresAt) <= now) {
    return { allowed: false, reason: "This offer expired" };
  }

  return { allowed: true };
}

// ─── Funnel metrics ──────────────────────────────────────────

export interface FunnelStage {
  stageId: string;
  name: string;
  sequence: number;
  entered: number;
}

export interface FunnelRow extends FunnelStage {
  /** Share of the previous stage that reached this one. */
  conversionFromPrevious: number;
  /** Share of all applicants that reached this one. */
  conversionFromStart: number;
  dropOff: number;
}

/**
 * Conversion through the pipeline.
 *
 * Both conversions are reported because they answer different questions.
 * Stage-to-stage finds the step that is failing; start-to-stage tells you how
 * many applications are needed for one hire, which is what a recruiter plans
 * against.
 */
export function funnel(stages: FunnelStage[]): FunnelRow[] {
  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);
  const start = ordered[0]?.entered ?? 0;

  return ordered.map((stage, index) => {
    const previous = index === 0 ? stage.entered : ordered[index - 1].entered;

    return {
      ...stage,
      conversionFromPrevious:
        previous === 0 ? 0 : Math.round((stage.entered / previous) * 1000) / 10,
      conversionFromStart: start === 0 ? 0 : Math.round((stage.entered / start) * 1000) / 10,
      dropOff: Math.max(0, previous - stage.entered),
    };
  });
}

export interface TimeToHire {
  medianDays: number | null;
  averageDays: number | null;
  count: number;
}

/**
 * Time to hire.
 *
 * Median as well as mean, and the median leads. One candidate who took nine
 * months because a role was frozen drags a mean far enough to make it useless
 * for planning.
 */
export function timeToHire(durationsDays: number[]): TimeToHire {
  const valid = durationsDays.filter((d) => Number.isFinite(d) && d >= 0);

  if (valid.length === 0) return { medianDays: null, averageDays: null, count: 0 };

  const sorted = [...valid].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return {
    medianDays:
      sorted.length % 2 === 1
        ? sorted[middle]
        : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10,
    averageDays: Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10,
    count: valid.length,
  };
}

export interface SourceEffectiveness {
  source: string;
  applications: number;
  hires: number;
  /** Percentage of applications from this source that became hires. */
  hireRate: number;
  costPerHireMinor?: bigint;
}

/**
 * Which channels actually produce hires.
 *
 * Sorted by hire rate rather than volume. A job board sending four hundred
 * applications and one hire is worse than a referral scheme sending ten and
 * three, and ranking by volume says the opposite.
 */
export function sourceEffectiveness(
  rows: { source: string; applications: number; hires: number; spendMinor?: bigint }[]
): SourceEffectiveness[] {
  return rows
    .map((row) => ({
      source: row.source,
      applications: row.applications,
      hires: row.hires,
      hireRate:
        row.applications === 0 ? 0 : Math.round((row.hires / row.applications) * 1000) / 10,
      costPerHireMinor:
        row.spendMinor !== undefined && row.hires > 0
          ? row.spendMinor / BigInt(row.hires)
          : undefined,
    }))
    .sort((a, b) => b.hireRate - a.hireRate || b.hires - a.hires);
}
