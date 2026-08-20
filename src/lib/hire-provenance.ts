// ═══════════════════════════════════════════════════════════════
// HIRE PROVENANCE — an employee has to have come from somewhere
// ═══════════════════════════════════════════════════════════════
// `employee-rules.ts` answers "is this person an employee at all" — not a role
// mailbox, not a personal address. This answers the different question the
// same form raises: where did this hire come from?
//
// ── The hole this closes ──
// The company's hiring pattern is Careers → ATS → employee, and the ATS
// handoff enforces it: `validateHandoff` refuses unless an offer is
// `accepted`, and `commitHandoff` stamps `employees.candidate_id` and
// `application_id` so the employee record points back at the application they
// were hired against.
//
// `POST /api/employees` — the "Add New Employee" dialog HR uses daily —
// bypasses all of that. It creates a row with both link columns NULL, no
// offer, and no candidate, from nothing but a typed name and address. So the
// pipeline is enforced on the path nobody uses by hand and unenforced on the
// one everybody does.
//
// ── Why this is not simply "must have a Careers account" ──
// Because that would block most real hires. Candidates reach ATS through the
// public apply form and recruiter bulk import, with no portal password
// (`candidate_credentials`) and no joining form (`candidate_registration`) —
// the registration is described in ATS's own code as something a candidate
// completes "once they are close to an offer", not to apply. Requiring a
// portal login would refuse people the company has genuinely hired.
//
// What IS true of every real hire is that somebody made them an offer and
// they accepted it. That is the chain worth enforcing, and it is the one the
// ATS handoff already proves.
//
// ── The override is deliberate ──
// A founder predates the ATS. An acquisition arrives as a spreadsheet. A
// record deleted by mistake has to be recreated. Refusing those outright
// would mean the first person to hit one edits the database directly, which
// is worse than a documented, audited exception. So the exception exists, has
// to be justified in writing, and is recorded — a door with a name on it,
// rather than a wall with a hole knocked through it.

import type { FieldIssue } from "@/lib/employee-rules";

/** What the system knows about where a proposed hire came from. */
export interface HireProvenance {
  /** `hrms.candidates.id`, when the caller supplied one. */
  candidateId: string | null;
  /** `hrms.applications.id`, when the caller supplied one. */
  applicationId: string | null;
  /**
   * The status of the candidate's most advanced offer, or null when they have
   * none. Only `accepted` proves a hire.
   */
  offerStatus: string | null;
  /**
   * When the candidate submitted their joining form, or null.
   *
   * `submitted_at` rather than the computed completeness percentage: the
   * percentage is derived at read time and moves whenever the required-field
   * list changes, so an employee who was valid on Tuesday would be invalid on
   * Wednesday. The timestamp records a thing the candidate actually did.
   */
  registrationSubmittedAt: Date | string | null;
}

export interface ProvenanceOptions {
  /**
   * A written justification for creating this employee without a hire behind
   * them. Its presence is what turns a refusal into a recorded exception.
   */
  overrideReason?: string | null;
  /**
   * Whether the joining form must have been submitted.
   *
   * Separable from the offer check because it is the softer of the two: an
   * offer nobody accepted means this is not a hire, whereas an unsubmitted
   * joining form means the paperwork is behind. Deployments that collect that
   * paperwork after joining can turn it off without also losing the check
   * that matters.
   */
  requireSubmittedRegistration?: boolean;
}

/** The shortest override a person can write and still have said something. */
const MIN_OVERRIDE_REASON = 20;

export interface ProvenanceDecision {
  ok: boolean;
  issues: FieldIssue[];
  /** True when this was allowed only because somebody justified it. */
  overridden: boolean;
  /** The justification, trimmed, for the audit entry. */
  overrideReason: string | null;
}

/**
 * Decides whether a proposed employee may be created.
 *
 * Returns a decision rather than throwing, so the caller can report every
 * problem with a submission at once — the same reason `validateEmployeeFields`
 * collects issues instead of failing on the first.
 */
export function checkHireProvenance(
  provenance: HireProvenance,
  options: ProvenanceOptions = {}
): ProvenanceDecision {
  const reason = String(options.overrideReason ?? "").trim();
  const requireRegistration = options.requireSubmittedRegistration ?? true;

  if (reason.length > 0) {
    if (reason.length < MIN_OVERRIDE_REASON) {
      return {
        ok: false,
        overridden: false,
        overrideReason: null,
        issues: [
          {
            field: "overrideReason",
            message: `Say why this person has no hire record behind them, in at least ${MIN_OVERRIDE_REASON} characters — this is recorded against the employee.`,
          },
        ],
      };
    }
    // A justified exception is not checked further. The point of writing it
    // down is that a person has taken responsibility for the gap.
    return { ok: true, overridden: true, overrideReason: reason, issues: [] };
  }

  const issues: FieldIssue[] = [];

  if (!provenance.candidateId) {
    issues.push({
      field: "candidateId",
      message:
        "Pick the candidate this person was hired as. Everybody hired through Careers and the ATS already has one; if this person genuinely predates that, give a reason instead.",
    });
  }

  if (provenance.offerStatus !== "accepted") {
    issues.push({
      field: "offerStatus",
      message:
        provenance.offerStatus === null
          ? "This candidate has no offer. An employee record is created from an offer somebody accepted."
          : `This candidate's offer is "${provenance.offerStatus}", not accepted. Record the acceptance in the ATS first.`,
    });
  }

  if (requireRegistration && !provenance.registrationSubmittedAt) {
    issues.push({
      field: "registrationSubmittedAt",
      message:
        "This candidate has not submitted their joining form yet. Ask them to complete it in the careers portal before creating their employee record.",
    });
  }

  return {
    ok: issues.length === 0,
    overridden: false,
    overrideReason: null,
    issues,
  };
}

/**
 * A one-line summary for the audit entry.
 *
 * Written here so the audit wording and the rule cannot drift: whoever reads
 * the trail later should see the same reason the form gave at the time.
 */
export function provenanceAuditNote(decision: ProvenanceDecision, provenance: HireProvenance): string {
  if (decision.overridden) {
    return `Created without a hire record. Reason given: ${decision.overrideReason}`;
  }
  return `Created from candidate ${provenance.candidateId ?? "unknown"}${
    provenance.applicationId ? ` (application ${provenance.applicationId})` : ""
  } with an accepted offer.`;
}
