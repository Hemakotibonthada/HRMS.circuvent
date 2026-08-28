// ═══════════════════════════════════════════════════════════════
// OFFER ENGAGEMENT RULES
// ═══════════════════════════════════════════════════════════════
//
// What actually differs between offering somebody a job and offering them an
// internship. The two documents look similar and are produced by the same
// screen, which is precisely why they get conflated — and the differences are
// statutory rather than cosmetic.
//
// An internship offer that promises provident fund is not a typo. PF is
// administered by the EPFO against a Universal Account Number; an intern has no
// entitlement to one, so the company either cannot deliver what the signed
// offer says or enrols someone who should not be enrolled and then has to
// unwind it. The same applies in reverse: a full-time offer with no notice
// period leaves the company with no contractual basis to hold someone for a
// handover.
//
// The rules below are therefore expressed as *what a valid offer of this kind
// must and must not contain*, and `validateOffer` enforces them. Every
// statutory position carries the provision it comes from, because these change
// and the next person needs to know what to re-check.
//
// Deliberately not encoded here: whether an intern *should* get PF as a matter
// of policy. Some employers voluntarily enrol interns. That is a decision for
// the tenant, so `statutory` describes the default position and the offer can
// override it explicitly — what it cannot do is claim a benefit silently.

/**
 * The forms of engagement this product can paper.
 *
 * These are the ones with genuinely different statutory treatment in India.
 * "Consultant" is not separate from `contract`: the distinction people draw
 * between them is about seniority, not law — both are contracts for service
 * taxed under section 194J rather than contracts of service taxed under 192.
 */
export type EngagementType =
  | "full_time"
  | "part_time"
  | "internship"
  | "apprenticeship"
  | "contract";

/** How the money in the offer is expressed. */
export type CompensationBasis =
  | "annual_ctc"
  | "monthly_salary"
  | "monthly_stipend"
  | "professional_fees";

export interface StatutoryPosition {
  /** Employees' Provident Funds and Miscellaneous Provisions Act, 1952. */
  providentFund: boolean;
  /** Employees' State Insurance Act, 1948. */
  employeeStateInsurance: boolean;
  /** Payment of Gratuity Act, 1972 — five years' continuous service. */
  gratuity: boolean;
  /** State professional tax, where the state levies one. */
  professionalTax: boolean;
  /** The Income-tax Act section the payer deducts under. */
  tdsSection: "192" | "194J" | "none";
  /** Why this position holds, for the letter and for whoever audits it. */
  basis: string;
}

export interface EngagementRule {
  type: EngagementType;
  label: string;
  /** Template key in the document catalog. */
  templateType: string;
  compensationBasis: CompensationBasis;
  /** A fixed-term engagement must say when it ends. */
  requiresEndDate: boolean;
  /** Probation only means something where the engagement is open-ended. */
  hasProbation: boolean;
  /** Notice, in days, that the letter states. Zero where none applies. */
  defaultNoticeDays: number;
  statutory: StatutoryPosition;
  /** Tokens the offer must supply beyond the common set. */
  requiredTokens: readonly string[];
  /** Tokens that must NOT appear, because they would misstate the engagement. */
  forbiddenTokens: readonly string[];
}

/** Tokens every offer carries, whatever the engagement. */
export const COMMON_OFFER_TOKENS = [
  "company_name",
  "company_address",
  "company_contact",
  "issue_date",
  "full_name",
  "candidate_email",
  "position_title",
  "start_date",
  "work_mode",
  "working_hours",
  "offer_valid_until",
] as const;

const FULL_TIME_STATUTORY: StatutoryPosition = {
  providentFund: true,
  employeeStateInsurance: true,
  gratuity: true,
  professionalTax: true,
  tdsSection: "192",
  basis:
    "Employee under a contract of service. PF applies subject to the wage ceiling, " +
    "ESI subject to the gross ceiling, and gratuity on completing five years.",
};

/**
 * Interns and apprentices are treated the same way statutorily, for different
 * reasons that arrive at the same place.
 *
 * An apprentice engaged under the Apprentices Act, 1961 is excluded by
 * section 18, which provides that an apprentice is a trainee and not a worker,
 * so the labour enactments do not apply to them. A stipendiary intern is
 * excluded on the prior question: the EPF Act applies to "employees" drawing
 * wages, and a stipend paid for training is not wages for work.
 *
 * The practical consequence is the same and it is worth stating plainly on the
 * letter, because interns frequently ask: no PF, no ESI, no gratuity, and the
 * stipend is still income in their hands.
 */
const TRAINEE_STATUTORY: StatutoryPosition = {
  providentFund: false,
  employeeStateInsurance: false,
  gratuity: false,
  professionalTax: false,
  tdsSection: "none",
  basis:
    "Trainee, not an employee. Apprentices are excluded by section 18 of the " +
    "Apprentices Act, 1961; a stipend paid to an intern for training is not wages " +
    "under the EPF Act. No PF, ESI or gratuity arises.",
};

const CONTRACT_STATUTORY: StatutoryPosition = {
  providentFund: false,
  employeeStateInsurance: false,
  gratuity: false,
  professionalTax: false,
  tdsSection: "194J",
  basis:
    "Contract for service, not of service. Fees are professional or technical " +
    "receipts with tax deducted under section 194J, and none of the employment " +
    "enactments apply.",
};

/**
 * Every way of expressing money in an offer.
 *
 * A letter must state exactly one of these. Two is not redundancy — an annual
 * CTC and a monthly salary that do not divide evenly is a contradiction inside
 * a signed contract, and the candidate will reasonably read whichever is
 * higher. Each rule therefore forbids all the bases except its own, and the
 * tests assert that mechanically rather than trusting the lists below to be
 * maintained by hand.
 */
export const COMPENSATION_TOKENS = [
  "annual_ctc",
  "monthly_salary",
  "stipend_amount",
  "professional_fees",
] as const;

/** The compensation tokens that are not this engagement's own. */
function otherCompensationTokens(mine: string): string[] {
  return COMPENSATION_TOKENS.filter((t) => t !== mine);
}

export const ENGAGEMENT_RULES: Readonly<Record<EngagementType, EngagementRule>> = {
  full_time: {
    type: "full_time",
    label: "Full-time employment",
    templateType: "offer_letter",
    compensationBasis: "annual_ctc",
    requiresEndDate: false,
    hasProbation: true,
    defaultNoticeDays: 60,
    statutory: FULL_TIME_STATUTORY,
    requiredTokens: ["annual_ctc", "basic_salary", "probation_period", "notice_period"],
    forbiddenTokens: [...otherCompensationTokens("annual_ctc"), "engagement_end_date"],
  },

  part_time: {
    type: "part_time",
    label: "Part-time employment",
    templateType: "offer_letter_part_time",
    compensationBasis: "monthly_salary",
    requiresEndDate: false,
    hasProbation: true,
    defaultNoticeDays: 30,
    // A part-time employee is an employee. The hours are lower, which affects
    // whether the wage ceilings are crossed, not whether the Acts apply.
    statutory: {
      ...FULL_TIME_STATUTORY,
      basis:
        "Employee under a contract of service, engaged for fewer hours. The " +
        "enactments apply; whether PF and ESI bite depends on the wage ceilings.",
    },
    requiredTokens: ["monthly_salary", "weekly_hours", "notice_period"],
    forbiddenTokens: [...otherCompensationTokens("monthly_salary"), "engagement_end_date"],
  },

  internship: {
    type: "internship",
    label: "Internship",
    templateType: "offer_letter_internship",
    compensationBasis: "monthly_stipend",
    // An internship with no end date is not an internship. Leaving it open is
    // how an unpaid-forever arrangement gets papered as training.
    requiresEndDate: true,
    hasProbation: false,
    defaultNoticeDays: 7,
    statutory: TRAINEE_STATUTORY,
    requiredTokens: ["stipend_amount", "engagement_end_date", "mentor_name"],
    forbiddenTokens: [
      ...otherCompensationTokens("stipend_amount"),
      "basic_salary",
      "probation_period",
    ],
  },

  apprenticeship: {
    type: "apprenticeship",
    label: "Apprenticeship",
    templateType: "offer_letter_apprenticeship",
    compensationBasis: "monthly_stipend",
    requiresEndDate: true,
    hasProbation: false,
    defaultNoticeDays: 7,
    statutory: TRAINEE_STATUTORY,
    requiredTokens: ["stipend_amount", "engagement_end_date", "trade_name"],
    forbiddenTokens: [
      ...otherCompensationTokens("stipend_amount"),
      "basic_salary",
      "probation_period",
    ],
  },

  contract: {
    type: "contract",
    label: "Fixed-term contract",
    templateType: "offer_letter_contract",
    compensationBasis: "professional_fees",
    requiresEndDate: true,
    hasProbation: false,
    defaultNoticeDays: 30,
    statutory: CONTRACT_STATUTORY,
    requiredTokens: ["professional_fees", "engagement_end_date", "payment_schedule"],
    forbiddenTokens: [
      ...otherCompensationTokens("professional_fees"),
      "basic_salary",
      "probation_period",
    ],
  },
};

export const ENGAGEMENT_TYPES = Object.keys(ENGAGEMENT_RULES) as EngagementType[];

export function isEngagementType(value: string): value is EngagementType {
  return Object.prototype.hasOwnProperty.call(ENGAGEMENT_RULES, value);
}

export function ruleFor(type: EngagementType): EngagementRule {
  return ENGAGEMENT_RULES[type];
}

export interface OfferInput {
  engagementType: EngagementType;
  /** Token values supplied for the letter. */
  values: Record<string, string | number | undefined>;
  startDate?: string;
  endDate?: string;
  /** Set when the tenant deliberately extends a benefit the default withholds. */
  voluntaryBenefits?: { providentFund?: boolean; insurance?: boolean };
}

export interface OfferProblem {
  field: string;
  message: string;
}

export interface OfferValidation {
  valid: boolean;
  problems: OfferProblem[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks an offer against the rules for its engagement type.
 *
 * Returns every problem rather than the first, because these are corrected in
 * a form: reporting one at a time turns a single fix into five round trips,
 * and the person filling it in stops reading the message and starts guessing.
 */
export function validateOffer(input: OfferInput): OfferValidation {
  const problems: OfferProblem[] = [];

  if (!isEngagementType(input.engagementType)) {
    return {
      valid: false,
      problems: [{ field: "engagementType", message: "Unknown engagement type" }],
    };
  }

  const rule = ruleFor(input.engagementType);
  const has = (token: string) => {
    const value = input.values[token];
    return value !== undefined && value !== null && String(value).trim() !== "";
  };

  for (const token of rule.requiredTokens) {
    if (!has(token)) {
      problems.push({
        field: token,
        message: `${rule.label} needs ${humanise(token)}`,
      });
    }
  }

  // The forbidden set is the half that matters. A missing field produces a
  // visibly incomplete letter; a field that should not be there produces a
  // complete, plausible letter promising something the engagement cannot
  // deliver, and nobody notices until the person asks for it.
  for (const token of rule.forbiddenTokens) {
    if (has(token)) {
      problems.push({
        field: token,
        message: `${rule.label} cannot state ${humanise(token)}`,
      });
    }
  }

  if (rule.requiresEndDate && !has("engagement_end_date") && !input.endDate) {
    problems.push({
      field: "engagement_end_date",
      message: `${rule.label} is fixed-term and must say when it ends`,
    });
  }

  const start = input.startDate ?? String(input.values.start_date ?? "");
  const end = input.endDate ?? String(input.values.engagement_end_date ?? "");

  if (start && !ISO_DATE.test(start)) {
    problems.push({ field: "start_date", message: "Start date must be YYYY-MM-DD" });
  }
  if (end && !ISO_DATE.test(end)) {
    problems.push({ field: "engagement_end_date", message: "End date must be YYYY-MM-DD" });
  }

  // Compared as strings, which is safe for ISO dates and avoids the timezone
  // trap that `new Date("2026-03-01")` walks into: it parses as UTC midnight,
  // so in IST it is still the previous day.
  if (start && end && ISO_DATE.test(start) && ISO_DATE.test(end) && end <= start) {
    problems.push({
      field: "engagement_end_date",
      message: "The engagement must end after it starts",
    });
  }

  if (!rule.hasProbation && has("probation_period")) {
    problems.push({
      field: "probation_period",
      message: `${rule.label} has no probation`,
    });
  }

  return { valid: problems.length === 0, problems };
}

/**
 * The statutory position to print, after any deliberate override.
 *
 * A tenant that voluntarily enrols interns in PF may say so; what it may not do
 * is have the letter claim PF by accident. So an override has to be passed
 * explicitly and is reflected in the stated basis, which is what an auditor
 * reads.
 */
export function statutoryFor(input: OfferInput): StatutoryPosition {
  const base = ruleFor(input.engagementType).statutory;
  const voluntaryPf = input.voluntaryBenefits?.providentFund === true;

  if (!voluntaryPf || base.providentFund) return base;

  return {
    ...base,
    providentFund: true,
    basis:
      base.basis +
      " Provident fund is extended voluntarily by the employer and is not a " +
      "statutory entitlement of this engagement.",
  };
}

/** The compensation token this engagement expresses its money in. */
export function compensationTokenFor(type: EngagementType): string {
  switch (ruleFor(type).compensationBasis) {
    case "annual_ctc":
      return "annual_ctc";
    case "monthly_salary":
      return "monthly_salary";
    case "monthly_stipend":
      return "stipend_amount";
    case "professional_fees":
      return "professional_fees";
  }
}

function humanise(token: string): string {
  return token.replace(/_/g, " ");
}
