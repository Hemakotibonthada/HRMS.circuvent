import { describe, expect, it } from "vitest";
import { extractTokens, render, validateTemplate } from "../document-rules";
import { COMPANY_TOKENS, TEMPLATE_CATALOG, templateByType } from "./catalog";

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
  it("carries all eight templates from Office.Circuvent", () => {
    expect(TEMPLATE_CATALOG).toHaveLength(8);
    expect(TEMPLATE_CATALOG.map((t) => t.templateType).sort()).toEqual([
      "call_letter",
      "experience_certificate",
      "offer_followup",
      "offer_letter",
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

    expect(withRegistration.sort()).toEqual(["experience_certificate", "offer_letter"]);
  });
});
