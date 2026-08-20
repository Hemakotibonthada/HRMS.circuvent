import { describe, expect, it } from "vitest";
import { extractTokens, render } from "@/lib/document-rules";
import { TEMPLATE_CATALOG, templateByType } from "@/lib/document-templates/catalog";
import { ENGAGEMENT_TYPES, ruleFor } from "@/lib/offer-rules";
import {
  availableTokensFor,
  knownTokensFor,
  previewTemplate,
  validateTemplateEdit,
} from "./validation";

describe("every shipped template validates clean against its own, untouched body", () => {
  // The formula this file implements has no independent whitelist to check a
  // token against — it is assembled from company/employee tokens, the offer
  // engine's declared vocabulary, and whatever the body already contains. The
  // early version of that formula omitted the last part for offer letters,
  // and the real Offer Letter body promptly failed this exact check: it uses
  // `hra`, `signatory_name`, `application_reference` and others that no
  // offer-engine constant declares. This suite is that regression, made
  // permanent — every template in the catalog must pass, unedited, or the
  // first thing this UI does to a customer is reject their own shipped
  // letter.
  it.each(TEMPLATE_CATALOG.map((t) => [t.name, t] as const))(
    "%s validates against itself with no edit applied",
    (_name, template) => {
      const result = validateTemplateEdit({
        name: template.name,
        category: template.category,
        previousBody: template.body,
        newBody: template.body,
        requiresSignature: template.requiresSignature,
        signatoryRoles: template.signatoryRoles,
      });

      expect(result, JSON.stringify(result)).toEqual({
        valid: true,
        unknownTokens: [],
        forbiddenTokens: [],
        message: undefined,
      });
    }
  );
});

describe("an unrecognised token is refused, named", () => {
  it("rejects a typo introduced in the edit and names it", () => {
    const previousBody = "<p>Dear {{full_name}}, your role is {{position_title}}.</p>";
    // "full_nmae" is a typo for a token the body already had — exactly the
    // failure this exists to catch before a candidate does.
    const newBody = "<p>Dear {{full_nmae}}, your role is {{position_title}}.</p>";

    const result = validateTemplateEdit({
      name: "Custom Notice",
      category: "mail",
      previousBody,
      newBody,
      requiresSignature: false,
      signatoryRoles: [],
    });

    expect(result.valid).toBe(false);
    expect(result.unknownTokens).toEqual(["full_nmae"]);
    expect(result.message).toContain("full_nmae");
    expect(result.message).toContain("typo");
  });

  it("does not reject a token the previous body already used", () => {
    // "full_name" is not declared anywhere for a plain mail template — it is
    // only known here because it was already present. That must still be
    // enough; this is the entire reason the self-referential term exists.
    const previousBody = "<p>Dear {{full_name}}.</p>";
    const newBody = "<p>Dear {{full_name}}, welcome aboard.</p>";

    const result = validateTemplateEdit({
      name: "Custom Notice",
      category: "mail",
      previousBody,
      newBody,
      requiresSignature: false,
      signatoryRoles: [],
    });

    expect(result.valid).toBe(true);
  });

  it("reports every unresolvable token when more than one is introduced", () => {
    const previousBody = "<p>{{full_name}}</p>";
    const newBody = "<p>{{full_name}} {{made_up_one}} {{made_up_two}}</p>";

    const result = validateTemplateEdit({
      name: "Custom Notice",
      category: "mail",
      previousBody,
      newBody,
      requiresSignature: false,
      signatoryRoles: [],
    });

    expect(result.valid).toBe(false);
    expect(result.unknownTokens.sort()).toEqual(["made_up_one", "made_up_two"]);
  });
});

describe("a token forbidden for the engagement is refused, even though it resolves", () => {
  it("rejects annual_ctc introduced into an internship offer", () => {
    const internship = templateByType(ruleFor("internship").templateType)!;
    const newBody = internship.body.replace(
      "{{stipend_amount}}",
      "{{stipend_amount}} ({{annual_ctc}} equivalent)"
    );

    const result = validateTemplateEdit({
      name: internship.name,
      category: internship.category,
      previousBody: internship.body,
      newBody,
      requiresSignature: internship.requiresSignature,
      signatoryRoles: internship.signatoryRoles,
    });

    expect(result.valid).toBe(false);
    expect(result.forbiddenTokens).toContain("annual_ctc");
    // Reported as forbidden, not unknown — "annual_ctc" resolves just fine on
    // a full-time offer, so calling it unrecognised would send an editor
    // hunting for a typo in a token they spelled correctly.
    expect(result.unknownTokens).not.toContain("annual_ctc");
    expect(result.message).toContain("annual_ctc");
    expect(result.message?.toLowerCase()).toContain("cannot appear");
  });

  it("leaves every shipped offer letter forbidden-token-clean", () => {
    // If this fails, a later formula change has started treating a forbidden
    // token as known for its own engagement — the one outcome that would
    // silently defeat offer-rules.ts's protection entirely.
    for (const type of ENGAGEMENT_TYPES) {
      const rule = ruleFor(type);
      const template = templateByType(rule.templateType)!;
      const result = validateTemplateEdit({
        name: template.name,
        category: template.category,
        previousBody: template.body,
        newBody: template.body,
        requiresSignature: template.requiresSignature,
        signatoryRoles: template.signatoryRoles,
      });
      expect(result.forbiddenTokens, `${type} unedited`).toEqual([]);
    }
  });
});

describe("an offer letter may introduce a token the offer engine declares, unused or not", () => {
  it("accepts offer_valid_until on a full-time offer that never mentioned it before", () => {
    const fullTime = templateByType(ruleFor("full_time").templateType)!;
    // Strip every existing use of the token so this actually exercises the
    // offer-engine vocabulary layer rather than the self-referential one.
    const strippedBody = fullTime.body.replace(/\{\{\s*offer_valid_until\s*\}\}/g, "March 2026");
    expect(extractTokens(strippedBody)).not.toContain("offer_valid_until");

    const newBody = strippedBody + "<p>This offer is valid until {{offer_valid_until}}.</p>";

    const result = validateTemplateEdit({
      name: fullTime.name,
      category: fullTime.category,
      previousBody: strippedBody,
      newBody,
      requiresSignature: fullTime.requiresSignature,
      signatoryRoles: fullTime.signatoryRoles,
    });

    expect(result.valid).toBe(true);
  });

  it("does not extend that same allowance to a non-offer template", () => {
    // offer_valid_until is meaningful for an offer; a payslip template has no
    // engagement type and so gets no benefit of the doubt for it.
    const payslip = templateByType("payslip_statement")!;
    const newBody = payslip.body + "<p>{{offer_valid_until}}</p>";

    const result = validateTemplateEdit({
      name: payslip.name,
      category: payslip.category,
      previousBody: payslip.body,
      newBody,
      requiresSignature: payslip.requiresSignature,
      signatoryRoles: payslip.signatoryRoles,
    });

    expect(result.valid).toBe(false);
    expect(result.unknownTokens).toContain("offer_valid_until");
  });
});

describe("available tokens shown to an editor", () => {
  it("is the exact list the validator itself accepts", () => {
    // A panel showing tokens the validator would then refuse teaches HR to
    // distrust whichever one is wrong. They must be the same function.
    expect(availableTokensFor).toBe(knownTokensFor);
  });

  it("includes every token the offer letter already uses, and a human label", () => {
    const offer = templateByType("offer_letter")!;
    const available = knownTokensFor(offer.name, offer.body);
    const tokens = available.map((t) => t.token);

    for (const used of extractTokens(offer.body)) {
      expect(tokens, `${used} missing from available tokens`).toContain(used);
    }

    const annualCtc = available.find((t) => t.token === "annual_ctc");
    expect(annualCtc?.label).toBe("Annual Ctc");
  });

  it("gives a dotted employee token a readable, spaced label", () => {
    const available = knownTokensFor("Anything", "<p></p>");
    const firstName = available.find((t) => t.token === "employee.firstName");
    expect(firstName?.label).toBe("Employee First Name");
  });
});

describe("preview always renders, even with a token nothing recognises", () => {
  it("leaves no raw {{token}} syntax in a known-only body", () => {
    const offer = templateByType("offer_letter")!;
    const preview = previewTemplate(offer.name, offer.body, offer.body);

    expect(preview.renderedBody).not.toContain("{{");
    expect(preview.genericTokens).toEqual([]);
  });

  it("substitutes a visibly generic placeholder for an unrecognised token, never a blank", () => {
    const previousBody = "<p>Dear {{full_name}}.</p>";
    const draftBody = "<p>Dear {{full_name}}, your reference is {{never_declared_anywhere}}.</p>";
    const preview = previewTemplate("Custom Notice", previousBody, draftBody);

    expect(preview.renderedBody).not.toContain("{{");
    expect(preview.renderedBody).toContain("«never_declared_anywhere»");
    expect(preview.genericTokens).toEqual(["never_declared_anywhere"]);
  });

  it("flags a token introduced in this draft as generic, not as already-known", () => {
    // This is the exact bug once caught writing this file: previewing a
    // draft against ITSELF as the "previous" body let every token in it
    // satisfy knownTokensFor's self-referential "already present" rule
    // trivially, so a token typed a moment ago was never flagged. previousBody
    // must be the last genuinely SAVED body, distinct from the draft, or this
    // check is vacuous.
    const previousBody = "<p>Dear {{full_name}}.</p>";
    const draftBody = "<p>Dear {{full_name}}, see {{new_field_in_progress}}.</p>";
    const preview = previewTemplate("Custom Notice", previousBody, draftBody);

    expect(preview.genericTokens).toEqual(["new_field_in_progress"]);
  });

  it("never lets render()'s own missing-token result leak into a preview", () => {
    // render() leaves {{token}} in place for anything it was not given a
    // value for. previewTemplate must supply a value for literally every
    // token the body uses, known or not, so that never happens here.
    const body = "<p>{{a}} {{b}} {{c.d}}</p>";
    const preview = previewTemplate("Anything", body, body);
    const { missing } = render(body, Object.fromEntries(extractTokens(body).map((t) => [t, "x"])));
    expect(missing).toEqual([]); // sanity: these tokens are trivially resolvable
    expect(preview.renderedBody).not.toContain("{{");
  });
});
