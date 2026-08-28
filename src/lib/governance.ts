// ═══════════════════════════════════════════════════════════════
// DATA GOVERNANCE RULES — retention, erasure and legal holds
// ═══════════════════════════════════════════════════════════════
// Pure, so it tests without a database.
//
// Two things make this harder than "delete old rows":
//
// 1. Retention and legal obligation pull in opposite directions. Payroll
//    records must be kept for years by tax law; the same person has a right to
//    erasure under data-protection law. Erasure therefore has to be able to
//    say "not this, and here is the statute" rather than either refusing
//    wholesale or deleting something that must be produced at audit.
//
// 2. Erasure is irreversible. Every decision here is written to be reviewable
//    before it runs, which is why the planner returns a plan rather than
//    performing the deletion.

export type ErasureMethod =
  /** Row removed. */
  | "delete"
  /** Identifying columns nulled, the row kept for aggregate reporting. */
  | "anonymise"
  /** Replaced with a stable pseudonym so linked records stay joinable. */
  | "pseudonymise"
  /** Kept in full — a legal obligation overrides the request. */
  | "retain";

export interface RetentionPolicy {
  id: string;
  entityType: string;
  /** Months to keep after the anchor event. */
  retainForMonths: number;
  /** What starts the clock: usually the exit date or the record's creation. */
  anchor: "created_at" | "exit_date" | "closed_at" | "period_end";
  method: ErasureMethod;
  /**
   * The statute or policy requiring this period.
   *
   * Not decoration. When someone asks why a record was kept or destroyed, the
   * answer has to be a citation, and a policy with no stated basis is one
   * nobody can defend or safely change.
   */
  basis: string;
  /** Overrides an erasure request for this entity type. */
  overridesErasure: boolean;
  isActive: boolean;
}

export interface RetainedRecord {
  entityType: string;
  entityId: string;
  /** The anchor date, as YYYY-MM-DD. */
  anchorDate: string;
  /** Set when this record is under legal hold. */
  legalHoldId?: string;
  description?: string;
}

export interface RetentionDecision {
  entityType: string;
  entityId: string;
  method: ErasureMethod;
  dueOn: string;
  /** Plain language, for the person approving the run. */
  reason: string;
  /** Negative when the record is already past its retention period. */
  daysUntilDue: number;
}

/** Adds whole months, clamping to the last day of a shorter month. */
export function addMonths(date: string, months: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Dates must be YYYY-MM-DD");

  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));

  // 31 January plus one month is 28 or 29 February, not 3 March. Rolling over
  // would push a retention deadline into the wrong month.
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

/** When a record falls due under a policy. */
export function dueDate(policy: RetentionPolicy, anchorDate: string): string {
  return addMonths(anchorDate, policy.retainForMonths);
}

/**
 * What should happen to one record today.
 *
 * A legal hold always wins. Destroying evidence during litigation is a far
 * worse outcome than keeping a record longer than a retention schedule says.
 */
export function decide(
  policy: RetentionPolicy,
  record: RetainedRecord,
  today: string
): RetentionDecision {
  const due = dueDate(policy, record.anchorDate);
  const daysUntilDue = daysBetween(today, due);

  if (record.legalHoldId) {
    return {
      entityType: record.entityType,
      entityId: record.entityId,
      method: "retain",
      dueOn: due,
      daysUntilDue,
      reason: `Under legal hold ${record.legalHoldId}; retention is suspended`,
    };
  }

  if (daysUntilDue > 0) {
    return {
      entityType: record.entityType,
      entityId: record.entityId,
      method: "retain",
      dueOn: due,
      daysUntilDue,
      reason: `Retained until ${due} under ${policy.basis}`,
    };
  }

  return {
    entityType: record.entityType,
    entityId: record.entityId,
    method: policy.method,
    dueOn: due,
    daysUntilDue,
    reason: `Retention period under ${policy.basis} ended on ${due}`,
  };
}

/** Records due for action today, worst-overdue first. */
export function planRetention(
  policies: RetentionPolicy[],
  records: RetainedRecord[],
  today: string
): RetentionDecision[] {
  const active = policies.filter((p) => p.isActive);

  return records
    .map((record) => {
      const policy = active.find((p) => p.entityType === record.entityType);
      if (!policy) return null;
      return decide(policy, record, today);
    })
    .filter((d): d is RetentionDecision => d !== null)
    .filter((d) => d.method !== "retain")
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

// ─── Erasure requests ────────────────────────────────────────

export interface ErasureScope {
  entityType: string;
  entityId: string;
  /** Tables or areas the request would touch. */
  areas: string[];
}

export interface ErasureItem {
  area: string;
  method: ErasureMethod;
  reason: string;
}

export interface ErasurePlan {
  subjectId: string;
  items: ErasureItem[];
  /** True when at least one area can actually be erased. */
  actionable: boolean;
  /** Areas kept, with the obligation that requires it. */
  retained: ErasureItem[];
}

/**
 * Builds an erasure plan without performing it.
 *
 * Returned for review rather than executed, because erasure is irreversible
 * and a plan is the only chance anyone gets to notice that it is about to
 * remove something it should not.
 *
 * Areas with an overriding retention obligation come back as `retain` with the
 * statute named. A request that silently skipped them would leave the
 * requester believing their data was gone.
 */
export function planErasure(
  subjectId: string,
  scope: ErasureScope[],
  policies: RetentionPolicy[],
  legalHolds: { entityType: string; entityId: string; reference: string }[] = []
): ErasurePlan {
  const items: ErasureItem[] = [];

  for (const target of scope) {
    const hold = legalHolds.find(
      (h) => h.entityType === target.entityType && h.entityId === target.entityId
    );

    const policy = policies.find(
      (p) => p.isActive && p.entityType === target.entityType && p.overridesErasure
    );

    for (const area of target.areas) {
      if (hold) {
        items.push({
          area,
          method: "retain",
          reason: `Under legal hold ${hold.reference}`,
        });
        continue;
      }

      if (policy) {
        items.push({
          area,
          method: "retain",
          reason: `Required by ${policy.basis} for ${policy.retainForMonths} months`,
        });
        continue;
      }

      items.push({
        area,
        // Anonymise rather than delete by default: removing a row from payroll
        // history changes totals that were already reported and filed.
        method: "anonymise",
        reason: "Identifying data removed; the record is kept for aggregate reporting",
      });
    }
  }

  const retained = items.filter((i) => i.method === "retain");

  return {
    subjectId,
    items,
    actionable: items.some((i) => i.method !== "retain"),
    retained,
  };
}

// ─── Redaction ───────────────────────────────────────────────

/**
 * A stable pseudonym for a subject.
 *
 * Deterministic so linked records across tables still join after erasure —
 * an anonymised payslip and an anonymised attendance record must still be
 * recognisable as the same (now unidentified) person, or the aggregate
 * reporting the anonymisation was meant to preserve stops working.
 */
export async function pseudonym(subjectId: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}:${subjectId}`)
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `anon-${hex.slice(0, 16)}`;
}

/** Masks a value for display, keeping just enough to recognise it. */
export function mask(value: string | null | undefined, keep = 4): string {
  if (!value) return "";
  if (value.length <= keep) return "•".repeat(value.length);
  return "•".repeat(value.length - keep) + value.slice(-keep);
}

/** Masks an email, keeping the domain so the account is still recognisable. */
export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes("@")) return mask(email);
  const [local, domain] = email.split("@");
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

// ─── Subject access ──────────────────────────────────────────

export interface SubjectAccessSection {
  area: string;
  /** Rows as plain objects, ready to serialise. */
  records: Record<string, unknown>[];
}

export interface SubjectAccessExport {
  subjectId: string;
  generatedAt: string;
  sections: SubjectAccessSection[];
  /** Areas deliberately excluded, and why. */
  omitted: { area: string; reason: string }[];
}

/**
 * Assembles a subject-access response.
 *
 * Empty sections are kept rather than dropped. "We hold no disciplinary
 * record for you" is itself an answer the requester is entitled to, and a
 * response that simply omits the section is indistinguishable from one that
 * forgot to look.
 */
export function buildSubjectAccess(
  subjectId: string,
  sections: SubjectAccessSection[],
  omitted: { area: string; reason: string }[] = [],
  now: string = new Date().toISOString()
): SubjectAccessExport {
  return { subjectId, generatedAt: now, sections, omitted };
}

/**
 * Fields excluded from a subject-access response.
 *
 * A subject is entitled to their own data, not to a third party's. An
 * appraisal comment naming a colleague, or a grievance filed against them,
 * contains someone else's personal data too — disclosing it in full would
 * breach that person's rights while satisfying the requester's.
 */
export const THIRD_PARTY_SENSITIVE_AREAS = [
  "grievances_about_others",
  "investigation_witness_statements",
  "peer_review_comments",
  "referee_notes",
] as const;

export function isThirdPartySensitive(area: string): boolean {
  return (THIRD_PARTY_SENSITIVE_AREAS as readonly string[]).includes(area);
}

// ─── Consent ─────────────────────────────────────────────────

export interface ConsentRecord {
  purpose: string;
  grantedAt?: string;
  withdrawnAt?: string;
  /** Consent obtained under an older wording needs re-asking. */
  policyVersion: number;
}

/**
 * Whether consent currently covers a purpose.
 *
 * Withdrawal wins regardless of order, and a consent given against an older
 * policy version does not carry forward — if the wording changed, the person
 * agreed to something else.
 */
export function hasConsent(
  consents: ConsentRecord[],
  purpose: string,
  currentPolicyVersion: number
): boolean {
  const relevant = consents.filter((c) => c.purpose === purpose);
  if (relevant.length === 0) return false;

  const latest = relevant.sort((a, b) =>
    (a.grantedAt ?? "").localeCompare(b.grantedAt ?? "")
  ).at(-1)!;

  if (latest.withdrawnAt) return false;
  if (!latest.grantedAt) return false;
  return latest.policyVersion >= currentPolicyVersion;
}
