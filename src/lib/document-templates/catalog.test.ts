import { describe, expect, it } from "vitest";
import { extractTokens, render, validateTemplate } from "../document-rules";
import { COMPANY_TOKENS, TEMPLATE_CATALOG, templateByType } from "./catalog";
import { ENGAGEMENT_TYPES, compensationTokenFor, ruleFor } from "@/lib/offer-rules";
import { calculateSalaryStructure, formatINR } from "@/lib/payroll-engine";

/**
 * A payload that resolves every token in the catalog.
 *
 * Built by asking the catalog what it needs rather than by hand, so a template
 * that gains a token fails the "no missing tokens" test below with the token
 * named, instead of this fixture quietly drifting out of date.
 */
function payloadFor(body: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const token of extractTokens(body)) {
    values[token] = `«${token}»`;
  }
  return values;
}

describe("the catalog", () => {
  it("carries the eight templates from Office.Circuvent, plus the offer variants", () => {
    expect(TEMPLATE_CATALOG).toHaveLength(12);
    expect(TEMPLATE_CATALOG.map((t) => t.templateType).sort()).toEqual([
      "call_letter",
      "experience_certificate",
      "offer_followup",
      "offer_letter",
      "offer_letter_apprenticeship",
      "offer_letter_contract",
      "offer_letter_internship",
      "offer_letter_part_time",
      "onboarding_welcome",
      "payslip_cover",
      "payslip_notification",
      "payslip_statement",
    ]);
  });

  it("gives every template a unique key and a name", () => {
    const keys = new Set(TEMPLATE_CATALOG.map((t) => t.templateType));
    expect(keys.size).toBe(TEMPLATE_CATALOG.length);

    for (const template of TEMPLATE_CATALOG) {
      expect(template.name.trim().length).toBeGreaterThan(0);
      expect(template.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("finds a template by its key", () => {
    expect(templateByType("offer_letter")?.name).toBe("Offer Letter");
    expect(templateByType("nonsense")).toBeUndefined();
  });
});

describe("every template renders", () => {
  it.each(TEMPLATE_CATALOG.map((t) => [t.templateType, t] as const))(
    "%s resolves every token it uses",
    (_type, template) => {
      const result = render(template.body, payloadFor(template.body));
      // The renderer leaves an unresolved token in place rather than blanking
      // it, so a miss here would ship a contract reading "salary: {{salary}}".
      expect(result.missing).toEqual([]);
      expect(result.body).not.toContain("{{");
    }
  );

  it.each(TEMPLATE_CATALOG.map((t) => [t.templateType, t] as const))(
    "%s passes validation before a generation run",
    (_type, template) => {
      const result = validateTemplate(
        {
          id: template.templateType,
          name: template.name,
          category: template.category,
          body: template.body,
          requiredTokens: extractTokens(template.body),
          requiresSignature: template.requiresSignature,
          signatoryRoles: template.signatoryRoles,
          version: 1,
        },
        payloadFor(template.body)
      );
      expect(result).toEqual({ valid: true });
    }
  );

  it("reports the token by name when one is missing", () => {
    const offer = templateByType("offer_letter")!;
    const values = payloadFor(offer.body);
    delete values.annual_ctc;

    const result = render(offer.body, values);
    expect(result.missing).toContain("annual_ctc");
    // Left in the body so a preview shows exactly which field is unresolved.
    expect(result.body).toContain("{{annual_ctc}}");
  });
});

describe("the four defects found in the Office originals stay fixed", () => {
  // 1. Tenant identity was hardcoded. Importing it verbatim would have put
  // Circuvent's registered company number on every customer's offer letters.
  it.each(TEMPLATE_CATALOG.map((t) => [t.templateType, t] as const))(
    "%s hardcodes no tenant-specific detail",
    (_type, template) => {
      expect(template.body).not.toMatch(/Innovation Park/i);
      expect(template.body).not.toMatch(/circuvent\.(tech|com)/i);
      expect(template.body).not.toMatch(/\+91[\s\d]{6,}/);
      expect(template.body).not.toMatch(/CIN:\s*U\d/i);
      expect(template.body).not.toMatch(/Hyderabad|Telangana/i);
    }
  );

  it.each(TEMPLATE_CATALOG.map((t) => [t.templateType, t] as const))(
    "%s takes the company identity from tokens",
    (_type, template) => {
      const tokens = extractTokens(template.body);
      for (const required of COMPANY_TOKENS) {
        expect(tokens).toContain(required);
      }
    }
  );

  // 2. The logo was a cid: reference, which resolves only inside an assembled
  // email — a broken image on the signing page and in every PDF.
  it.each(TEMPLATE_CATALOG.map((t) => [t.templateType, t] as const))(
    "%s references no cid: attachment",
    (_type, template) => {
      expect(template.body).not.toContain("cid:");
    }
  );

  // 3. The offer letter injected eight raw HTML fragments. The renderer
  // escapes every value, so those would have rendered as visible angle
  // brackets — and widening the renderer to trust them would have reopened the
  // injection hole the escaping exists to close.
  it.each(TEMPLATE_CATALOG.map((t) => [t.templateType, t] as const))(
    "%s expects no token to carry markup",
    (_type, template) => {
      const markupTokens = extractTokens(template.body).filter((t) => t.endsWith("_html"));
      expect(markupTokens).toEqual([]);
    }
  );

  it("escapes a value that tries to inject markup", () => {
    const offer = templateByType("offer_letter")!;
    const values = payloadFor(offer.body);
    values.full_name = '<script>alert("x")</script>';

    const result = render(offer.body, values);
    expect(result.body).not.toContain("<script>");
    expect(result.body).toContain("&lt;script&gt;");
  });

  // 4. Office matched [a-zA-Z0-9_.-], this product matches [a-zA-Z0-9_.]. A
  // hyphenated token would silently never be substituted.
  it.each(TEMPLATE_CATALOG.map((t) => [t.templateType, t] as const))(
    "%s uses no hyphenated token",
    (_type, template) => {
      // Anything in double braces that the renderer's own pattern would not
      // match is a token that will never be filled.
      const braced = [...template.body.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]);
      for (const token of braced) {
        expect(token).toMatch(/^[a-zA-Z0-9_.]+$/);
      }
    }
  );
});

describe("what gets signed", () => {
  it("signs the offer letter, employee first", () => {
    const offer = templateByType("offer_letter")!;
    expect(offer.requiresSignature).toBe(true);
    // Countersigning an offer the candidate has not accepted is a company
    // signature on nothing.
    expect(offer.signatoryRoles).toEqual(["employee", "hr"]);
  });

  it("signs the experience certificate by the company alone", () => {
    const certificate = templateByType("experience_certificate")!;
    expect(certificate.requiresSignature).toBe(true);
    expect(certificate.signatoryRoles).toEqual(["hr"]);
  });

  it("does not sign a payslip", () => {
    // A signature block implies a person checked this one, and on a run of
    // nine hundred nobody did.
    for (const type of ["payslip_statement", "payslip_cover"]) {
      const template = templateByType(type)!;
      expect(template.requiresSignature).toBe(false);
      expect(template.signatoryRoles).toEqual([]);
    }
  });

  it("names a signatory whenever a signature is required", () => {
    // validateTemplate refuses a template that requires a signature but names
    // nobody; this catches it at the catalog rather than at generation time.
    for (const template of TEMPLATE_CATALOG) {
      if (template.requiresSignature) {
        expect(template.signatoryRoles.length).toBeGreaterThan(0);
      } else {
        expect(template.signatoryRoles).toEqual([]);
      }
    }
  });

  it("never signs an email", () => {
    for (const template of TEMPLATE_CATALOG.filter((t) => t.category === "mail")) {
      expect(template.requiresSignature).toBe(false);
    }
  });
});

describe("the content survived the port", () => {
  it("keeps the compensation breakdown the original injected as markup", () => {
    const tokens = extractTokens(templateByType("offer_letter")!.body);
    // These were rows inside {{compensation_breakdown_html}}. They are now
    // real table cells with plain tokens, and they line up with what
    // calculateSalaryStructure already produces.
    expect(tokens).toEqual(
      expect.arrayContaining([
        "basic_salary",
        "hra",
        "special_allowance",
        "other_allowances",
        "gross_salary",
        "annual_ctc",
      ])
    );
  });

  it("keeps the payslip's earnings, deductions and attendance", () => {
    const tokens = extractTokens(templateByType("payslip_statement")!.body);
    expect(tokens).toEqual(
      expect.arrayContaining([
        "basic_pay",
        "hra_allowance",
        "gross_pay",
        "pf_contribution",
        "professional_tax",
        "income_tax",
        "total_deductions",
        "net_pay",
        "lop_days",
      ])
    );
  });

  it("keeps the interview details on the call letter", () => {
    const tokens = extractTokens(templateByType("call_letter")!.body);
    expect(tokens).toEqual(
      expect.arrayContaining(["session_date", "session_time", "session_mode", "panel_names"])
    );
  });

  it("keeps the joining details on the welcome email", () => {
    const tokens = extractTokens(templateByType("onboarding_welcome")!.body);
    expect(tokens).toEqual(
      expect.arrayContaining([
        "start_date",
        "start_time",
        "office_location",
        "buddy_name",
        "documents_to_bring",
      ])
    );
  });

  it("puts the company registration on instruments of employment and nowhere else", () => {
    // A CIN belongs on a contract and on a certificate of service. On a
    // payslip email it is noise, and on a template that no org has filled in
    // it would render as a literal token in a legal document.
    const withRegistration = TEMPLATE_CATALOG.filter((t) =>
      extractTokens(t.body).includes("company_registration")
    ).map((t) => t.templateType);

    expect(withRegistration.sort()).toEqual([
      "experience_certificate",
      "offer_letter",
      "offer_letter_apprenticeship",
      "offer_letter_contract",
      "offer_letter_internship",
      "offer_letter_part_time",
    ]);
  });
});

// The payroll engine has no concept of a food card as a line item separate
// from "other allowances" — Annexure A's carve-out is a presentation
// decision this template makes, not one calculateSalaryStructure makes, so
// it is subtracted here rather than asked of the engine. Kept small enough
// that it stays inside otherAllowances at every CTC this suite exercises.
const FOOD_CARD_ANNUAL = 12_000;

describe.each([
  ["a salary well above the ESI wage ceiling", 2_400_000],
  ["a salary at which employer ESI genuinely applies", 240_000],
] as const)("Annexure A reconciles with the rest of the offer letter (%s)", (_label, ctc) => {
  // The compensation break-up is the one part of a signed offer letter a
  // candidate actually checks their payslip against. Annexure A lists eight
  // additive components under a "Gross salary (A)" total, then adds three
  // retirals — provident fund, gratuity and employer ESI where it applies —
  // to reach a "Total cost to company (A + B + C + D)" total: four separate
  // tokens that nothing but discipline keeps in agreement. Running this at
  // two CTCs, one comfortably above the ESI wage ceiling and one genuinely
  // below it, is what actually exercises row (D) instead of leaving it
  // permanently zero and untested by every case in the suite. This uses
  // calculateSalaryStructure, the same payroll engine every payslip in this
  // product is computed from, as a source of realistic numbers that are
  // additive by construction, then renders the real template and checks the
  // totals it prints actually agree with the rows above them.
  const structure = calculateSalaryStructure(ctc);

  const components = {
    basic_salary: structure.basic,
    hra: structure.hra,
    special_allowance: structure.specialAllowance,
    conveyance_allowance: structure.conveyanceAllowance,
    medical_allowance: structure.medicalAllowance,
    lta_allowance: structure.lta,
    food_card_allowance: FOOD_CARD_ANNUAL,
    other_allowances: structure.otherAllowances - FOOD_CARD_ANNUAL,
  };

  // Total cost to company deliberately excludes the group insurance premium.
  // The premium is already disclosed in prose under "Other benefits" in
  // Annexure B — folding it back into this total would silently inflate the
  // one figure Annexure A promises is gross salary plus provident fund,
  // gratuity and employer ESI, nothing else.
  const totalCtc =
    structure.grossSalary + structure.employerPF + structure.gratuity + structure.employerESI;

  it("the payroll engine's own components sum to the gross salary this letter quotes", () => {
    // A guard on the fixture itself: if calculateSalaryStructure ever stopped
    // being additive, or the food-card carve-out ever exceeded
    // otherAllowances, every assertion below would still pass, just against
    // a broken baseline — this is what would catch that instead.
    expect(structure.otherAllowances).toBeGreaterThanOrEqual(FOOD_CARD_ANNUAL);
    const sumOfParts = Object.values(components).reduce((total, value) => total + value, 0);
    expect(sumOfParts).toBe(structure.grossSalary);
  });

  it("never lets the total cost-to-company figure quietly absorb the insurance premium", () => {
    // structure.ctc is the number a naive integration would reach for first,
    // since it sits right there on the same object — this is what would
    // catch that temptation before it shipped a CTC a candidate's payslip
    // will never match.
    expect(structure.ctc).toBeGreaterThan(totalCtc);
    expect(structure.ctc - totalCtc).toBe(structure.insurance);
  });

  it("prints a gross salary and a total CTC in Annexure A that agree with the rows feeding them", () => {
    const offer = templateByType("offer_letter")!;
    const values = payloadFor(offer.body);

    values.basic_salary = formatINR(components.basic_salary);
    values.hra = formatINR(components.hra);
    values.special_allowance = formatINR(components.special_allowance);
    values.conveyance_allowance = formatINR(components.conveyance_allowance);
    values.medical_allowance = formatINR(components.medical_allowance);
    values.lta_allowance = formatINR(components.lta_allowance);
    values.food_card_allowance = formatINR(components.food_card_allowance);
    values.other_allowances = formatINR(components.other_allowances);
    values.gross_salary = formatINR(structure.grossSalary);
    values.employer_pf_contribution = formatINR(structure.employerPF);
    values.gratuity_provision = formatINR(structure.gratuity);
    values.employer_esi_contribution =
      structure.employerESI > 0 ? formatINR(structure.employerESI) : "Not applicable";
    values.annual_ctc = formatINR(totalCtc);

    const result = render(offer.body, values);
    expect(result.missing).toEqual([]);

    // Every line item Annexure A promises to itemise actually appears in the
    // rendered document, so a row cannot be dropped from the table without a
    // test noticing its figure went missing from the page.
    for (const amount of Object.values(components)) {
      expect(result.body).toContain(formatINR(amount));
    }
    expect(result.body).toContain(formatINR(structure.employerPF));
    expect(result.body).toContain(formatINR(structure.gratuity));

    // "Gross salary (A)" must be the sum of the rows above it — the previous
    // test established that identity for these exact numbers, so finding
    // that same figure here confirms the template renders it, not some
    // second, independently-supplied gross salary that could disagree.
    expect(result.body).toContain(formatINR(structure.grossSalary));

    // "Total cost to company (A + B + C + D)" must equal gross salary plus
    // the three retirals immediately above it in the table, not
    // structure.ctc, which additionally carries the insurance premium.
    expect(totalCtc).not.toBe(structure.ctc);
    expect(result.body).toContain(formatINR(totalCtc));
  });
});

// ─── Offer templates must match the engagement they are for ──
//
// The catalog shipped one offer letter, written for full-time employment. Used
// for an internship it promises provident fund, a probation period and an
// annual CTC, none of which an intern has — and the document is signed, so it
// is the company's own statement of an entitlement that does not exist.
//
// These tests read the token contract out of `offer-rules.ts` rather than
// restating it, so the two cannot drift: adding a forbidden token to a rule
// fails the template that uses it, and a template that starts mentioning
// gratuity to an apprentice fails here.

describe("offer letters match their engagement type", () => {
  it("ships a template for every engagement type", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const template = templateByType(ruleFor(type).templateType);
      expect(template, `no template for ${type}`).toBeDefined();
      expect(template!.category).toBe("letter");
    }
  });

  it("uses the compensation token its engagement is paid in", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const body = templateByType(ruleFor(type).templateType)!.body;
      expect(extractTokens(body)).toContain(compensationTokenFor(type));
    }
  });

  it("never carries a token the engagement forbids", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const rule = ruleFor(type);
      const tokens = extractTokens(templateByType(rule.templateType)!.body);

      for (const forbidden of rule.forbiddenTokens) {
        expect(tokens, `${rule.templateType} must not use ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("does not promise trainees benefits they have no right to", () => {
    for (const type of ["internship", "apprenticeship", "contract"] as const) {
      const body = templateByType(ruleFor(type).templateType)!.body.toLowerCase();

      // Each of these may only appear where the letter is denying it, which is
      // what the surrounding "do not apply" / "no ... arises" wording does.
      for (const claim of ["gratuity", "provident fund"]) {
        if (!body.includes(claim)) continue;
        expect(
          /do not apply|does not attract|no provident fund|no such deduction|nor gratuity|or gratuity (arises|do not)/.test(
            body
          ),
          `${type} mentions ${claim} without denying it`
        ).toBe(true);
      }
    }
  });

  it("states the term on every fixed-term engagement", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const rule = ruleFor(type);
      if (!rule.requiresEndDate) continue;
      expect(extractTokens(templateByType(rule.templateType)!.body)).toContain(
        "engagement_end_date"
      );
    }
  });

  it("keeps an end date out of open-ended employment", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const rule = ruleFor(type);
      if (rule.requiresEndDate) continue;
      expect(extractTokens(templateByType(rule.templateType)!.body)).not.toContain(
        "engagement_end_date"
      );
    }
  });

  it("tells a contractor which section their tax is deducted under", () => {
    const body = templateByType("offer_letter_contract")!.body;
    expect(body).toContain("194J");
    expect(body.toLowerCase()).toContain("not as an employee");
  });

  it("says an internship carries no promise of a job", () => {
    const body = templateByType("offer_letter_internship")!.body.toLowerCase();
    expect(body).toContain("does not create an employment relationship");
  });

  it("has every offer signed by the candidate before the company", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const template = templateByType(ruleFor(type).templateType)!;
      expect(template.requiresSignature).toBe(true);
      expect(template.signatoryRoles[0]).toBe("employee");
    }
  });

  it("resolves cleanly with every token supplied", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const template = templateByType(ruleFor(type).templateType)!;
      const { body, missing } = render(template.body, payloadFor(template.body));

      expect(missing).toEqual([]);
      expect(body).not.toContain("{{");
    }
  });

  it("carries the tenant identity tokens, never a hardcoded company", () => {
    for (const type of ENGAGEMENT_TYPES) {
      const tokens = extractTokens(templateByType(ruleFor(type).templateType)!.body);
      for (const company of COMPANY_TOKENS) {
        expect(tokens).toContain(company);
      }
    }
  });
});

// The offer letter used to carry a second, independently-numbered set of
// annexures spliced in by `offer-annexures.ts` after the candidate's own
// signature block -- a stray import, not a deliberate design, and one that
// is trivial to reintroduce by accident (a merge, a half-finished edit, a
// file silently reverted to an older revision) because nothing short of
// reading the whole rendered letter end to end would show it. These tests
// assert the structural invariants that failure mode broke, so a regression
// fails the suite instead of waiting for someone to count annexures by hand.
describe("the offer letter's annexures are lettered exactly once each, in order", () => {
  const offerBody = templateByType("offer_letter")!.body;
  const annexureLetters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

  it("has exactly one heading for each annexure A through J, and no leftover numeric annexure", () => {
    for (const letter of annexureLetters) {
      const matches = offerBody.match(new RegExp(`<h2>Annexure ${letter}\\b`, "g")) ?? [];
      expect(matches).toHaveLength(1);
    }
    // The deleted blocks in the old offer-annexures.ts numbered themselves
    // "Annexure 1" through "Annexure 7", independently of the letter scheme
    // catalog.ts actually uses. A digit straight after the word "Annexure" in
    // a rendered heading can therefore only be that duplication come back.
    expect(offerBody).not.toMatch(/<h2>Annexure \d/);
  });

  it("puts the acceptance page after every annexure, and nothing after the acceptance page", () => {
    const acceptanceIndex = offerBody.indexOf("<h2>Acceptance</h2>");
    expect(acceptanceIndex).toBeGreaterThan(-1);

    for (const letter of annexureLetters) {
      const annexureIndex = offerBody.indexOf(`<h2>Annexure ${letter}`);
      expect(annexureIndex).toBeGreaterThan(-1);
      expect(acceptanceIndex).toBeGreaterThan(annexureIndex);
    }

    // A candidate cannot meaningfully be bound by a clause that only appears
    // below the line they signed, so no further heading -- and no further
    // annexure of any kind -- may follow the acceptance page.
    expect(offerBody.indexOf("<h2>", acceptanceIndex + 1)).toBe(-1);
  });

  it("carries Annexure C as one 36-clause list, not a second terms-and-conditions annexure", () => {
    const start = offerBody.indexOf("<h2>Annexure C");
    const end = offerBody.indexOf("<h2>Annexure D");
    const section = offerBody.slice(start, end);

    expect(section.match(/<li><strong>/g) ?? []).toHaveLength(36);
    // These two clauses only existed, before this restructuring, inside the
    // deleted duplicate annexure; their presence here confirms the fact they
    // carried was folded into the real annexure rather than thrown away.
    expect(section).toContain("Deductions from salary");
    expect(section).toContain("Unauthorised absence");
  });

  it("opens Annexure C with a Definitions and interpretation section that sits before clause 1, not inside the numbered list", () => {
    const start = offerBody.indexOf("<h2>Annexure C");
    const end = offerBody.indexOf("<h2>Annexure D");
    const section = offerBody.slice(start, end);

    const definitionsIndex = section.indexOf("Definitions and interpretation");
    const probationIndex = section.indexOf("<strong>Probation.</strong>");
    expect(definitionsIndex).toBeGreaterThan(-1);
    expect(probationIndex).toBeGreaterThan(-1);
    // Clause 1 must still be Probation: the glossary is a preface, not a
    // renumbering of the clauses that clauses 19, 20, 21 and 31 are
    // cross-referenced by exact number from Annexures I and J.
    expect(definitionsIndex).toBeLessThan(probationIndex);

    for (const term of ["\"the Company\"", "\"CTC\"", "\"basic salary\"", "\"immediate family\""]) {
      expect(section).toContain(term);
    }
    // The glossary uses <em>, deliberately not <strong>, so it is never
    // miscounted by the 36-clause assertion above: a glossary entry is not a
    // clause, and a test that cannot tell the two apart would pass even if a
    // future edit quietly turned every defined term into a 37th clause.
    expect(section.match(/<li><strong>/g) ?? []).toHaveLength(36);
  });

  it("carries the labour welfare fund and the five additional conduct sections folded in from the deleted duplicate", () => {
    const bStart = offerBody.indexOf("<h2>Annexure B");
    const bEnd = offerBody.indexOf("<h2>Annexure C");
    expect(offerBody.slice(bStart, bEnd)).toContain("Labour welfare fund");

    const dStart = offerBody.indexOf("<h2>Annexure D");
    const dEnd = offerBody.indexOf("<h2>Annexure E");
    const conduct = offerBody.slice(dStart, dEnd);
    for (const title of ["Integrity", "Non-discrimination", "Insider information", "Substance misuse", "Raising a concern"]) {
      expect(conduct).toContain(title);
    }
  });

  it("carries four genuinely new boilerplate clauses in Annexure C, none of them a second Notices clause", () => {
    const start = offerBody.indexOf("<h2>Annexure C");
    const end = offerBody.indexOf("<h2>Annexure D");
    const section = offerBody.slice(start, end);

    for (const title of ["Force majeure", "Waiver", "Assignment", "Counterparts and electronic acceptance"]) {
      expect(section.match(new RegExp(`<strong>${title}\\.`, "g")) ?? []).toHaveLength(1);
    }
    // "Notices" was extended in place with a deemed-service rule rather than
    // repeated as a second clause; a second match here would mean the offer
    // now tells a candidate two different things about how notice is served.
    expect(section.match(/<strong>Notices\./g) ?? []).toHaveLength(1);
    expect(section).toContain("treated as received five working days after posting");
  });

  it("carries Annexure I with equipment, access, acceptable-use, monitoring and return-of-property sections, correctly cross-referenced", () => {
    const start = offerBody.indexOf("<h2>Annexure I");
    const end = offerBody.indexOf("<h2>Annexure J");
    expect(start).toBeGreaterThan(-1);
    const section = offerBody.slice(start, end);

    for (const title of [
      "Equipment issued to you",
      "Systems access",
      "Acceptable use",
      "Monitoring",
      "Reporting an incident",
      "Equipment for remote and hybrid working",
      "Return of company property",
    ]) {
      expect(section).toContain(title);
    }
    // Clause 19 is "Disciplinary process" and clause 31 is "Deductions from
    // salary" in the current 36-clause Annexure C; a stale number here would
    // point a candidate at the wrong clause in a signed document.
    expect(section).toContain("disciplinary matter under clause 19 of Annexure C");
    expect(section).toContain("Clause 31 of Annexure C");
    expect(section).toContain("already allows the company to deduct the value of anything you do not return");
  });

  it("carries Annexure J with a real multi-step grievance and disciplinary procedure, correctly cross-referenced", () => {
    const start = offerBody.indexOf("<h2>Annexure J");
    const end = offerBody.indexOf("<h2>Acceptance");
    expect(start).toBeGreaterThan(-1);
    const section = offerBody.slice(start, end);

    for (const title of [
      "Raising a grievance",
      "How a grievance is handled",
      "Appeal",
      "Disciplinary process",
      "What this procedure does not cover",
    ]) {
      expect(section).toContain(title);
    }
    // Clause 20 is "Grievance redressal" and clause 21 is "Termination for
    // cause"; this Annexure exists specifically to spell out what those two
    // one-sentence clauses in Annexure C point at, so the numbers must match.
    expect(section).toContain("Clause 20 of Annexure C tells you");
    expect(section).toContain("Clause 19 of Annexure C states the principle");
    expect(section).toContain("termination for cause under clause 21 of Annexure C");
    // Harassment has its own statutory route and must not be folded into the
    // general grievance procedure here. The source wraps this sentence onto
    // two lines, and HTML collapses that whitespace on render, so compare
    // against the collapsed form rather than an exact substring.
    expect(section.replace(/\s+/g, " ")).toContain("Internal Committee described in Annexure D");
  });

  it("expands Annexure B's other benefits into four named sections without dropping their tokens", () => {
    const bStart = offerBody.indexOf("<h2>Annexure B");
    const bEnd = offerBody.indexOf("<h2>Annexure C");
    const section = offerBody.slice(bStart, bEnd);

    for (const title of ["Health insurance", "Loans and advances", "Professional memberships", "Flexible benefits"]) {
      expect(section).toContain(title);
    }
    for (const token of [
      "{{health_insurance_summary}}",
      "{{loan_policy_summary}}",
      "{{professional_membership_summary}}",
      "{{flexible_benefit_pool}}",
    ]) {
      expect(section).toContain(token);
    }
  });
});
