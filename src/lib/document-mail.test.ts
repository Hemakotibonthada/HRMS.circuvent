// These messages carry candidate-controlled text into HTML that internal staff
// read, and they carry a single-use credential in a link. The escaping tests
// and the "no link in internal mail" test are the two that matter.

import { describe, expect, it } from "vitest";
import {
  documentSignedNotice,
  formatDateForEmail,
  offerAcceptedEmail,
  offerIssuedEmail,
  offerReminderEmail,
  offerRevokedEmail,
  type OfferMailContext,
} from "@/lib/document-mail";

const BASE: OfferMailContext = {
  recipientName: "Asha Nair",
  companyName: "Northwind Textiles",
  positionTitle: "Backend Engineer",
  engagementLabel: "Full-time employment",
  signUrl: "https://hr.example.com/sign/abc?token=xyz",
  validUntil: "2026-09-30",
  contactName: "People Ops",
  contactEmail: "people@example.com",
};

const ALL = [
  offerIssuedEmail(BASE),
  offerReminderEmail(BASE),
  offerAcceptedEmail(BASE),
  offerRevokedEmail(BASE),
];

describe("every message", () => {
  it("has a subject, an html body and a text body", () => {
    for (const mail of ALL) {
      expect(mail.subject.trim().length).toBeGreaterThan(0);
      expect(mail.html.trim().length).toBeGreaterThan(0);
      expect(mail.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("names the tenant, never this product", () => {
    for (const mail of ALL) {
      expect(mail.subject + mail.html + mail.text).toContain("Northwind Textiles");
      expect(mail.html).not.toContain("Circuvent");
    }
  });

  it("leaves no unresolved token behind", () => {
    for (const mail of ALL) {
      expect(mail.html).not.toContain("{{");
      expect(mail.text).not.toContain("{{");
      expect(mail.subject).not.toContain("undefined");
      expect(mail.text).not.toContain("undefined");
    }
  });

  it("closes every tag it opens", () => {
    for (const mail of ALL) {
      const open = (mail.html.match(/<div/g) ?? []).length;
      const close = (mail.html.match(/<\/div>/g) ?? []).length;
      expect(close).toBe(open);
    }
  });
});

describe("candidate-controlled text cannot inject markup", () => {
  const hostile = "<script>alert(1)</script>";

  it("escapes the recipient name", () => {
    const mail = offerIssuedEmail({ ...BASE, recipientName: hostile });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("escapes the position title", () => {
    const mail = offerIssuedEmail({ ...BASE, positionTitle: hostile });
    expect(mail.html).not.toContain("<script>");
  });

  it("escapes the company name", () => {
    const mail = offerIssuedEmail({ ...BASE, companyName: hostile });
    expect(mail.html).not.toContain("<script>");
  });

  it("escapes a withdrawal reason", () => {
    const mail = offerRevokedEmail({ ...BASE, reason: hostile });
    expect(mail.html).not.toContain("<script>");
  });

  it("escapes a signatory name in the internal notice", () => {
    const mail = documentSignedNotice({
      companyName: "Northwind Textiles",
      documentTitle: "Offer Letter",
      signatoryName: hostile,
      signatoryRole: "employee",
      remaining: 1,
    });
    expect(mail.html).not.toContain("<script>");
  });

  it("escapes a hostile document title", () => {
    const mail = documentSignedNotice({
      companyName: "Northwind Textiles",
      documentTitle: hostile,
      signatoryRole: "hr",
      remaining: 0,
    });
    expect(mail.html).not.toContain("<script>");
  });

  it("does not let a quote in a name break out of an attribute", () => {
    const mail = offerIssuedEmail({ ...BASE, recipientName: `" onmouseover="alert(1)` });
    expect(mail.html).not.toContain(`onmouseover="alert(1)"`);
  });
});

describe("the signing link", () => {
  it("appears in the candidate's message as a button and as a bare URL", () => {
    const mail = offerIssuedEmail(BASE);
    expect(mail.html).toContain(BASE.signUrl!.replace(/&/g, "&amp;"));
    expect(mail.text).toContain(BASE.signUrl!);
  });

  it("is omitted cleanly when there is nothing to sign", () => {
    const mail = offerIssuedEmail({ ...BASE, signUrl: undefined });
    expect(mail.html).not.toContain("href=\"undefined\"");
    expect(mail.text).not.toContain("undefined");
    expect(mail.html).not.toContain("Read and sign");
  });

  it("says the link is single-use, so a deleted mail is not a silent dead end", () => {
    expect(offerIssuedEmail(BASE).text).toContain("used once");
  });

  // An internal "signed" notice gets forwarded around a company as a matter of
  // routine. A signing link in it is a working credential for a contract that
  // belongs to somebody else.
  it("never appears in an internal notification", () => {
    const mail = documentSignedNotice({
      companyName: "Northwind Textiles",
      documentTitle: "Offer Letter",
      signatoryName: "Asha Nair",
      signatoryRole: "employee",
      remaining: 1,
    });
    expect(mail.html).not.toContain("token=");
    expect(mail.text).not.toContain("token=");
    expect(mail.html).not.toContain("/sign/");
  });

  it("is not present in the acceptance or withdrawal messages", () => {
    for (const mail of [offerAcceptedEmail(BASE), offerRevokedEmail(BASE)]) {
      expect(mail.text).not.toContain("token=");
    }
  });
});

describe("dates", () => {
  it("formats an ISO date in IST, not the server's timezone", () => {
    expect(formatDateForEmail("2026-09-30")).toBe("30 September 2026");
  });

  // A UTC server parsing "2026-03-01" gets midnight UTC, which is still
  // 28 February in IST. Pinning the zone is what stops an offer appearing to
  // expire a day early.
  it("does not shift a date backwards across midnight", () => {
    expect(formatDateForEmail("2026-03-01")).toBe("1 March 2026");
    expect(formatDateForEmail("2026-01-01")).toBe("1 January 2026");
  });

  it("returns nothing for a missing or unparseable date", () => {
    expect(formatDateForEmail(undefined)).toBeUndefined();
    expect(formatDateForEmail("not a date")).toBeUndefined();
  });

  it("omits the deadline sentence when there is no deadline", () => {
    const mail = offerIssuedEmail({ ...BASE, validUntil: undefined });
    expect(mail.text).not.toContain("open until");
  });
});

describe("addressing", () => {
  it("greets by name when there is one", () => {
    expect(offerIssuedEmail(BASE).text).toContain("Hi Asha Nair");
  });

  it("falls back to a greeting that still reads correctly", () => {
    for (const name of [undefined, "", "   "]) {
      const mail = offerIssuedEmail({ ...BASE, recipientName: name });
      expect(mail.text).toContain("Hi there,");
    }
  });

  it("includes the contact when given", () => {
    expect(offerIssuedEmail(BASE).text).toContain("people@example.com");
  });

  it("omits the contact line entirely when there is no address", () => {
    const mail = offerIssuedEmail({ ...BASE, contactEmail: undefined, contactName: undefined });
    expect(mail.text).not.toContain("Questions?");
    expect(mail.html).not.toContain("Questions?");
  });
});

describe("the internal signed notice", () => {
  it("counts what is still outstanding", () => {
    const mail = documentSignedNotice({
      companyName: "Northwind Textiles",
      documentTitle: "Offer Letter",
      signatoryRole: "employee",
      remaining: 2,
    });
    expect(mail.text).toContain("2 signatures still outstanding");
  });

  it("uses the singular for one", () => {
    const mail = documentSignedNotice({
      companyName: "Northwind Textiles",
      documentTitle: "Offer Letter",
      signatoryRole: "employee",
      remaining: 1,
    });
    expect(mail.text).toContain("1 signature still outstanding");
  });

  it("says so plainly when nothing is outstanding", () => {
    const mail = documentSignedNotice({
      companyName: "Northwind Textiles",
      documentTitle: "Offer Letter",
      signatoryRole: "hr",
      remaining: 0,
    });
    expect(mail.text).toContain("Every signature is now in");
  });

  it("falls back to the role when the signatory has no name", () => {
    const mail = documentSignedNotice({
      companyName: "Northwind Textiles",
      documentTitle: "Offer Letter",
      signatoryRole: "hr",
      remaining: 0,
    });
    expect(mail.text).toContain("hr signed");
  });
});

describe("withdrawal", () => {
  it("states the reason when one is given", () => {
    const mail = offerRevokedEmail({ ...BASE, reason: "Role placed on hold" });
    expect(mail.text).toContain("Reason given: Role placed on hold");
  });

  it("omits the reason line rather than leaving it empty", () => {
    for (const reason of [undefined, "", "  "]) {
      const mail = offerRevokedEmail({ ...BASE, reason });
      expect(mail.text).not.toContain("Reason given:");
    }
  });

  it("tells the candidate the link has stopped working", () => {
    expect(offerRevokedEmail(BASE).text).toContain("no longer works");
  });
});

describe("the engagement basis", () => {
  it("states it when the sender knows it", () => {
    const mail = offerIssuedEmail({ ...BASE, engagementLabel: "Internship" });
    expect(mail.text).toContain("on a internship basis");
  });

  // A document row records the template it came from, not the engagement that
  // was offered. Guessing produced "on a letter basis", which is worse than
  // saying nothing.
  it("omits the phrase rather than guessing, when it does not", () => {
    for (const label of [undefined, "", "  "]) {
      const mail = offerIssuedEmail({ ...BASE, engagementLabel: label });
      expect(mail.text).toContain("at Northwind Textiles.");
      expect(mail.text).not.toContain("basis");
      expect(mail.html).not.toContain("basis");
    }
  });
});
