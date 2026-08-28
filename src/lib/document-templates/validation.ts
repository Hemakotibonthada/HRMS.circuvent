// ═══════════════════════════════════════════════════════════════
// TEMPLATE EDIT VALIDATION & PREVIEW
// ═══════════════════════════════════════════════════════════════
//
// What tokens may an HR user type into a template, and what does the letter
// look like before it is saved.
//
// There is no independent "list of legal tokens" anywhere in this codebase to
// check a new token against — `validateTemplate` in document-rules.ts only
// asks "can a value be found for every token this body uses right now", and
// the catalog's own test suite builds its check the same way, from the body
// outward. So "known token" here is assembled the same way rather than
// invented, from every source that genuinely supplies a value somewhere in
// this system today:
//
//   - COMPANY_TOKENS plus company_registration, always — `generate()` in
//     documents.neon.ts merges `identityTokens()` into every render,
//     regardless of the template's category.
//   - EMPLOYEE_TOKENS, always — the same file merges these in too, whenever a
//     generation request names an employee, again regardless of category.
//   - For the five offer/engagement letters (matched by name, the same way
//     scripts/seed-document-templates.ts matches them): COMMON_OFFER_TOKENS
//     and `requiredTokens` — offer-rules.ts's own declared vocabulary for
//     that engagement — plus every token `tokensFor()` produces for a
//     generously filled-in sample draft of that engagement.
//   - Always, for every template: whatever tokens the body already contained
//     before this edit.
//
// That last rule is the one that actually carries this file. Checking it
// against the five offer letters' *real* bodies (not just the declared
// vocabulary above) turned up `hra`, `basic_salary`, `signatory_name`,
// `application_reference` and a dozen others that no offer-engine constant or
// function anywhere produces — they exist solely as text in catalog.ts. The
// four non-offer letters and three mail templates are the same story with a
// completely different vocabulary (`bank_name`, `panel_names`,
// `key_responsibilities`, ...) that has no generation pathway at all today.
// Without the self-referential rule, opening any shipped, untouched template
// in this UI and clicking Save would fail with "unknown token", which is a
// worse outcome than the missing whitelist this file exists to build: a false
// positive on day one, on content nobody touched.
//
// "Known" is therefore computed from the body AS IT WAS BEFORE THIS EDIT, not
// the one being saved — a token already present is accepted forever (it is
// not this tool's place to relitigate wording it did not introduce), while a
// token that appears for the first time in this save has to come from one of
// the declared sources above. That is exactly enough to catch a typo (the
// correct token disappears, an unrecognised one takes its place) or an
// invented field, without this file needing to know what an unrelated
// template — including the Joining/Appointment/Confirmation/Relieving/
// Internship-Completion letters scripts/seed-letter-templates.mjs seeds,
// which this file has no oracle for — is supposed to say.
//
// Forbidden tokens are the second, independent check, and unconditional: an
// internship letter that says `{{annual_ctc}}` is the concrete harm
// offer-rules.ts exists to prevent, and it must be caught even if that text
// predates this UI — unlike an unrecognised token, there is no reading of "it
// was already there" that makes a statutorily wrong token acceptable.

import {
  extractTokens,
  render,
  validateTemplate,
  type TemplateDefinition,
  type TokenValues,
} from "@/lib/document-rules";
import { COMPANY_TOKENS, templateByType } from "@/lib/document-templates/catalog";
import {
  COMMON_OFFER_TOKENS,
  ENGAGEMENT_TYPES,
  ruleFor,
  type EngagementType,
} from "@/lib/offer-rules";
import { tokensFor, type OfferDraft } from "@/lib/letters-client";

/**
 * Mirrors the token keys the private `employeeTokens()` method produces in
 * documents.neon.ts (lines 865-900) — kept as a labelled list rather than
 * imported, because that method takes a live transaction and a real employee
 * id to build its values, neither of which a pure validation module should
 * need or be able to fabricate. `generate()` merges these into any
 * employee-linked render regardless of the template's category, so a
 * template of any kind may legitimately use them. If that method's keys ever
 * change, this list has to change with it by hand; there is no way to derive
 * one from the other without exporting a method that exists to be private.
 */
const EMPLOYEE_TOKENS: readonly string[] = [
  "employee.firstName",
  "employee.lastName",
  "employee.fullName",
  "employee.code",
  "employee.email",
  "employee.designation",
  "employee.department",
  "employee.joinDate",
  "employee.employmentType",
  "employee.noticePeriodDays",
  "employee.ctc",
  "org.currency",
  "today",
];

/**
 * Resolved from the tenant's org identity but never refused when absent — see
 * `identityTokens()` in org-identity.ts and the "optional" list `generate()`
 * passes to `validateTemplate`. A company that has not recorded a
 * registration number gets a blank line on its letterhead, not a 422; the
 * same leniency belongs here so this validator never disagrees with the
 * generator it is modelled on.
 */
const OPTIONAL_UNIVERSAL_TOKENS: readonly string[] = ["company_registration"];

/**
 * The `EngagementType` a template's catalog name corresponds to, if any.
 *
 * Matched by name because `documentTemplates` rows carry no `template_type`
 * column — adding one is a migration outside this task's scope, and the
 * existing seed script (`scripts/seed-document-templates.ts`) already
 * resolves the same mapping the same way, so this is not a new convention.
 */
export function engagementTypeForName(name: string): EngagementType | undefined {
  return ENGAGEMENT_TYPES.find(
    (type) => templateByType(ruleFor(type).templateType)?.name === name
  );
}

/**
 * A generously populated sample offer draft for one engagement type — every
 * optional field `tokensFor` recognises is filled in, so the token set this
 * produces is a superset of what any real offer of this kind would use.
 * Being generous here is deliberate: the failure this file exists to prevent
 * is an unresolvable token, not a template that happens to mention a field
 * this particular engagement does not strictly require. `forbiddenTokens`,
 * checked separately below, is what actually enforces engagement-specific
 * rules (an internship must not state `annual_ctc`) — this sample only has to
 * be wide enough that a legitimate token is never mistaken for a typo.
 */
function sampleOfferDraft(type: EngagementType): OfferDraft {
  return {
    engagementType: type,
    templateId: "sample",
    candidateName: "Asha Rao",
    candidateEmail: "asha.rao@example.com",
    positionTitle: "Software Engineer",
    startDate: "2026-04-01",
    compensation: "12,00,000",
    endDate: "2026-10-01",
    managerName: "Priya Iyer",
    mentorName: "Rahul Singh",
    tradeName: "Electrician",
    paymentSchedule: "Monthly, on submission of invoice",
    weeklyHours: "24",
    workMode: "Hybrid",
    workingHours: "9:30 AM to 6:30 PM IST",
    probationPeriod: "3 months",
    noticePeriod: "60 days",
    offerValidUntil: "2026-03-15",
    hrEmail: "hr@example.com",
    hrName: "People Operations",
  };
}

export interface KnownToken {
  token: string;
  /** Human-readable label for the "available tokens" panel, e.g.
   * "annual_ctc" -> "Annual Ctc". Deliberately simple, mirroring the
   * un-exported `humanise()` in offer-rules.ts, rather than a hand-maintained
   * label per token — the set of tokens differs per template and a lookup
   * table naming each one by hand is one more place to fall out of date. */
  label: string;
}

function humanizeToken(token: string): string {
  return token
    .split(/[._]/)
    .filter(Boolean)
    .map((word) =>
      word.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())
    )
    .join(" ");
}

/**
 * Every token this specific template (identified by name) can legitimately
 * resolve, given what it already contained before this edit — see the file
 * header for why "before this edit" is load-bearing. Exported so the UI's
 * "available tokens" panel and the validator below are provably looking at
 * the same list; a panel that showed one set of tokens while the validator
 * enforced another would teach HR to distrust whichever one is showing.
 */
export function knownTokensFor(name: string, previousBody: string): KnownToken[] {
  const known = new Set<string>([
    ...COMPANY_TOKENS,
    ...OPTIONAL_UNIVERSAL_TOKENS,
    ...EMPLOYEE_TOKENS,
    ...extractTokens(previousBody),
  ]);

  const engagementType = engagementTypeForName(name);
  if (engagementType) {
    for (const token of COMMON_OFFER_TOKENS) known.add(token);
    for (const token of ruleFor(engagementType).requiredTokens) known.add(token);
    for (const token of Object.keys(tokensFor(sampleOfferDraft(engagementType)))) {
      known.add(token);
    }
  }

  return [...known].sort().map((token) => ({ token, label: humanizeToken(token) }));
}

export interface TemplateEditValidation {
  valid: boolean;
  /** Tokens the new body uses that nothing in this template's vocabulary can resolve. */
  unknownTokens: string[];
  /** Tokens the new body uses that this engagement's rules forbid outright — only checked for the five offer/engagement letters. */
  forbiddenTokens: string[];
  /** One combined, human-facing message naming the offending token(s). Undefined when valid. */
  message?: string;
}

/**
 * Checks a proposed template body before it is saved.
 *
 * Reuses `validateTemplate` from document-rules.ts rather than re-deriving
 * "does every token resolve" — that is the exact function `generate()`
 * already calls before rendering a real letter, so a body accepted here is a
 * body `generate()` would also accept. Every "known" token is handed in with
 * a placeholder value so `validateTemplate` can tell known from unknown the
 * same way it tells resolvable from missing; whatever it reports missing is,
 * by construction, not in the known set — i.e. unknown.
 */
export function validateTemplateEdit(params: {
  name: string;
  category: string;
  previousBody: string;
  newBody: string;
  requiresSignature: boolean;
  signatoryRoles: string[];
}): TemplateEditValidation {
  const { name, category, previousBody, newBody, requiresSignature, signatoryRoles } = params;

  const known = knownTokensFor(name, previousBody);
  const sampleValues: TokenValues = Object.fromEntries(
    known.map((k) => [k.token, `known:${k.token}`])
  );

  const definition: TemplateDefinition = {
    id: "draft",
    name,
    category,
    body: newBody,
    requiredTokens: extractTokens(newBody),
    requiresSignature,
    signatoryRoles,
    version: 0,
  };

  const result = validateTemplate(definition, sampleValues, {
    optional: OPTIONAL_UNIVERSAL_TOKENS,
  });
  const rawUnknown = result.valid ? [] : result.missing;

  const engagementType = engagementTypeForName(name);
  const forbidden = engagementType ? ruleFor(engagementType).forbiddenTokens : [];
  const forbiddenTokens = extractTokens(newBody).filter((t) => forbidden.includes(t));

  // A forbidden token is, by construction, also unresolvable — `tokensFor()`
  // deletes every forbidden key from its own output before this function ever
  // sees it, so an internship template's `annual_ctc` shows up in both lists.
  // Reported as forbidden only: "annual_ctc doesn't belong on an internship
  // offer" is the actionable reason, and "annual_ctc is unrecognised" would
  // send someone hunting for a typo in a token they spelled correctly.
  const unknownTokens = rawUnknown.filter((t) => !forbiddenTokens.includes(t));

  const valid = unknownTokens.length === 0 && forbiddenTokens.length === 0;

  const parts: string[] = [];
  if (unknownTokens.length > 0) {
    const plural = unknownTokens.length > 1;
    parts.push(
      `Unknown token${plural ? "s" : ""} ${unknownTokens.map((t) => `{{${t}}}`).join(", ")} — ` +
        `this system has no value it can resolve ${plural ? "them" : "it"} against, so ` +
        `${plural ? "one of them" : "it"} would go out blank on a real document. Remove ` +
        `${plural ? "them" : "it"} or check for a typo against the available tokens list.`
    );
  }
  if (forbiddenTokens.length > 0 && engagementType) {
    const rule = ruleFor(engagementType);
    parts.push(
      `${forbiddenTokens.map((t) => `{{${t}}}`).join(", ")} cannot appear in a ` +
        `${rule.label.toLowerCase()} letter — the engagement rules in offer-rules.ts forbid ` +
        `it because it would misstate this engagement (see ${rule.statutory.basis}).`
    );
  }
  const message = parts.length > 0 ? parts.join(" ") : undefined;

  return { valid, unknownTokens, forbiddenTokens, message };
}

/** `availableTokensFor` is `knownTokensFor` under the name the UI calls it by —
 * kept as a distinct export so a template detail route can present "what can
 * I use" without importing something named for what is, from the API's
 * perspective, an implementation detail of validation. */
export const availableTokensFor = knownTokensFor;

export interface TemplatePreview {
  renderedBody: string;
  /** Tokens that received a generic placeholder because this module does not
   * specifically recognise them — not necessarily wrong (a letter seeded by
   * another script may use tokens this file has no oracle for), but worth a
   * visual flag distinct from the hard validation error above. */
  genericTokens: string[];
}

/**
 * Renders a draft template body against best-effort sample data.
 *
 * Takes the same two-body shape as `validateTemplateEdit` — the last-saved
 * body plus the draft being worked on — and for the same reason: passing the
 * draft as its own "previous" body would make `knownTokensFor`'s
 * self-referential term grandfather every token in it by definition (it is
 * trivially "already present"), so a brand-new, unrecognised token typed a
 * moment ago would never be flagged generic. Marking it generic here and
 * refusing it in `validateTemplateEdit` must agree, since a UI showing "1
 * generic token" next to a save button that then succeeds anyway teaches HR
 * to ignore the flag.
 *
 * Preview must never fail to render, or the one feature that lets someone see
 * a broken template before a candidate does becomes unusable exactly when it
 * is needed most. Every token the draft references gets *some* value, known
 * or not, so `render()`'s own `missing` list — and the raw, alarming
 * `{{token}}` syntax it leaves behind for a genuinely missing value — never
 * surfaces here. An unrecognised token instead gets the obviously-a-
 * placeholder `«token»` filler, the same convention catalog.test.ts's own
 * `payloadFor` uses for tokens it does not specifically know either.
 */
export function previewTemplate(
  name: string,
  previousBody: string,
  draftBody: string
): TemplatePreview {
  const known = new Set(knownTokensFor(name, previousBody).map((k) => k.token));
  const used = extractTokens(draftBody);

  const values: TokenValues = {};
  const genericTokens: string[] = [];

  for (const token of used) {
    if (known.has(token)) {
      values[token] = sampleDisplayValue(token);
    } else {
      genericTokens.push(token);
      values[token] = `«${token}»`;
    }
  }

  const { body: renderedBody } = render(draftBody, values);
  return { renderedBody, genericTokens };
}

/**
 * Realistic-looking sample text for a recognised token, so a preview reads
 * like a real letter rather than a wall of token names — the closest
 * approximation available of what a candidate will actually see.
 */
function sampleDisplayValue(token: string): string {
  const overrides: Record<string, string> = {
    company_name: "Acme Technologies Private Limited",
    company_address: "4th Floor, Prestige Towers, MG Road, Bengaluru, India",
    company_contact: "hr@acme.example · +91 80 4567 8900",
    company_registration: "U72900KA2015PTC080123",
    full_name: "Asha Rao",
    candidate_email: "asha.rao@example.com",
    position_title: "Software Engineer",
    start_date: "1 April 2026",
    issue_date: "15 March 2026",
    work_mode: "Hybrid",
    working_hours: "9:30 AM to 6:30 PM IST",
    offer_valid_until: "31 March 2026",
    notice_period: "60 days",
    probation_period: "3 months",
    engagement_end_date: "30 September 2026",
    manager_name: "Priya Iyer",
    mentor_name: "Rahul Singh",
    trade_name: "Electrician",
    payment_schedule: "Monthly, on submission of invoice",
    weekly_hours: "24 hours",
    annual_ctc: "₹12,00,000",
    monthly_salary: "₹45,000",
    stipend_amount: "₹15,000",
    professional_fees: "₹60,000",
    hr_contact_name: "People Operations",
    hr_contact_email: "hr@acme.example",
    today: new Date().toISOString().slice(0, 10),
    "employee.firstName": "Asha",
    "employee.lastName": "Rao",
    "employee.fullName": "Asha Rao",
    "employee.code": "EMP1042",
    "employee.email": "asha.rao@acme.example",
    "employee.designation": "Software Engineer",
    "employee.department": "Engineering",
    "employee.joinDate": "1 April 2024",
    "employee.employmentType": "full_time",
    "employee.noticePeriodDays": "60",
    "employee.ctc": "₹12,00,000",
    "org.currency": "INR",
  };

  return overrides[token] ?? `Sample ${humanizeToken(token)}`;
}
