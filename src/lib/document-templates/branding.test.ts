import { afterEach, describe, expect, it } from "vitest";
import {
  applyCompanyLogo,
  defaultLogoUrl,
  extractCompanyLogoUrl,
  isAbsoluteHttpUrl,
  resolveCompanyLogoUrl,
} from "./branding";
import { COMPANY_LOGO_SLOT } from "./letter-kit.mjs";

const originalLogo = process.env.MAIL_LOGO_URL;
const originalCareers = process.env.NEXT_PUBLIC_CAREERS_URL;

afterEach(() => {
  if (originalLogo === undefined) delete process.env.MAIL_LOGO_URL;
  else process.env.MAIL_LOGO_URL = originalLogo;
  if (originalCareers === undefined) delete process.env.NEXT_PUBLIC_CAREERS_URL;
  else process.env.NEXT_PUBLIC_CAREERS_URL = originalCareers;
});

describe("isAbsoluteHttpUrl", () => {
  it("accepts a plain https URL", () => {
    expect(isAbsoluteHttpUrl("https://career.circuvent.com/logo-mark-128.png")).toBe(true);
  });

  it("accepts http too — some tenants will host their own logo unencrypted, and a document with no image beats one held to a stricter standard than the org's own site", () => {
    expect(isAbsoluteHttpUrl("http://intranet.example.com/logo.png")).toBe(true);
  });

  it("rejects the old cid: scheme — that is exactly the value this whole mechanism exists to stop reaching a rendered document", () => {
    expect(isAbsoluteHttpUrl("cid:company_logo@circuvent")).toBe(false);
  });

  it("rejects javascript: — never a value this codebase should place in a src attribute a browser renders", () => {
    expect(isAbsoluteHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects a protocol-relative URL — there is no request context here to supply the missing scheme", () => {
    expect(isAbsoluteHttpUrl("//cdn.example.com/logo.png")).toBe(false);
  });

  it("rejects a bare relative path — an upload path with no host is not something render-pdf.ts or a signing-page browser can fetch", () => {
    expect(isAbsoluteHttpUrl("/uploads/org-42/logo.png")).toBe(false);
  });

  it("rejects blank and whitespace-only values", () => {
    expect(isAbsoluteHttpUrl("")).toBe(false);
    expect(isAbsoluteHttpUrl("   ")).toBe(false);
  });

  it("rejects non-string values without throwing", () => {
    expect(isAbsoluteHttpUrl(null)).toBe(false);
    expect(isAbsoluteHttpUrl(undefined)).toBe(false);
    expect(isAbsoluteHttpUrl(42)).toBe(false);
    expect(isAbsoluteHttpUrl({})).toBe(false);
  });
});

describe("applyCompanyLogo — the one function that decides what a signed document carries", () => {
  const html = `<div class="brand">${COMPANY_LOGO_SLOT}<p>{{company_name}}</p></div>`;

  it("renders no <img> at all for a tenant that never configured a logo", () => {
    // This is the multi-tenant guarantee: an organisation with no logoUrl
    // must get a clean typographic letterhead, never a broken <img> pointing
    // nowhere.
    const result = applyCompanyLogo(html, null);
    expect(result).not.toContain("<img");
    expect(result).not.toContain(COMPANY_LOGO_SLOT);
  });

  it("renders no <img> for undefined or an empty string, the same as null", () => {
    expect(applyCompanyLogo(html, undefined)).not.toContain("<img");
    expect(applyCompanyLogo(html, "")).not.toContain("<img");
  });

  it("renders no <img> for a stray cid: value imported from the old email-only scheme", () => {
    expect(applyCompanyLogo(html, "cid:company_logo@circuvent")).not.toContain("<img");
  });

  it("renders a real <img> with the resolved absolute URL for a tenant that configured one", () => {
    const result = applyCompanyLogo(html, "https://assets.example.com/acme-logo.png");
    expect(result).toContain('<img class="company-logo" src="https://assets.example.com/acme-logo.png"');
    expect(result).not.toContain(COMPANY_LOGO_SLOT);
  });

  it("never emits both an <img> and the raw marker — the splice always fully replaces the slot", () => {
    const withLogo = applyCompanyLogo(html, "https://assets.example.com/acme-logo.png");
    const withoutLogo = applyCompanyLogo(html, null);
    for (const rendered of [withLogo, withoutLogo]) {
      expect(rendered).not.toContain(COMPANY_LOGO_SLOT);
    }
  });
});

describe("extractCompanyLogoUrl — the inverse render-pdf.ts relies on", () => {
  const html = `<div class="brand">${COMPANY_LOGO_SLOT}<p>{{company_name}}</p></div>`;

  it("round-trips a URL applyCompanyLogo just spliced in", () => {
    const rendered = applyCompanyLogo(html, "https://assets.example.com/acme-logo.png");
    expect(extractCompanyLogoUrl(rendered)).toBe("https://assets.example.com/acme-logo.png");
  });

  it("returns null when applyCompanyLogo removed the slot rather than filling it", () => {
    const rendered = applyCompanyLogo(html, null);
    expect(extractCompanyLogoUrl(rendered)).toBeNull();
  });

  it("returns null for a document with no logo markup at all", () => {
    expect(extractCompanyLogoUrl("<p>{{company_name}}</p>")).toBeNull();
  });

  it("returns null for null/undefined/empty input rather than throwing — render-pdf.ts hands this frozen renderedBody straight from the database", () => {
    expect(extractCompanyLogoUrl(null)).toBeNull();
    expect(extractCompanyLogoUrl(undefined)).toBeNull();
    expect(extractCompanyLogoUrl("")).toBeNull();
  });

  it("ignores an <img> that is not the company logo, so a photo elsewhere in a certificate cannot be mistaken for the masthead", () => {
    const html2 = `<img src="https://example.com/photo.jpg" alt="team" />`;
    expect(extractCompanyLogoUrl(html2)).toBeNull();
  });

  it("re-validates the extracted src, so a hand-edited or tampered class=\"company-logo\" tag carrying a cid: or javascript: src cannot smuggle a non-http(s) value into the PDF embedding path", () => {
    const tampered = `<img class="company-logo" src="javascript:alert(1)" />`;
    expect(extractCompanyLogoUrl(tampered)).toBeNull();
  });
});

describe("defaultLogoUrl", () => {
  it("honours MAIL_LOGO_URL when the deployment has set one", () => {
    process.env.MAIL_LOGO_URL = "https://cdn.example.com/deployment-mark.png";
    expect(defaultLogoUrl()).toBe("https://cdn.example.com/deployment-mark.png");
  });

  it("falls back to the careers site plus the known-good mark when no override is configured", () => {
    delete process.env.MAIL_LOGO_URL;
    process.env.NEXT_PUBLIC_CAREERS_URL = "https://career.circuvent.com";
    expect(defaultLogoUrl()).toBe("https://career.circuvent.com/logo-mark-128.png");
  });

  it("falls back to Circuvent's own known-good URL when neither variable is set — the founder confirmed this exact address returns 200", () => {
    delete process.env.MAIL_LOGO_URL;
    delete process.env.NEXT_PUBLIC_CAREERS_URL;
    expect(defaultLogoUrl()).toBe("https://career.circuvent.com/logo-mark-128.png");
  });
});

describe("resolveCompanyLogoUrl — per-tenant resolution with a guaranteed fallback", () => {
  it("uses the organisation's own logo when it is set and valid", () => {
    expect(resolveCompanyLogoUrl("https://acme.example.com/brand.png")).toBe(
      "https://acme.example.com/brand.png"
    );
  });

  it("falls back to the deployment default when the org has no logo configured", () => {
    delete process.env.MAIL_LOGO_URL;
    expect(resolveCompanyLogoUrl(null)).toBe(defaultLogoUrl());
    expect(resolveCompanyLogoUrl(undefined)).toBe(defaultLogoUrl());
  });

  it("falls back rather than trusting a stored value that is not an absolute http(s) URL — a relative upload path or a leftover cid: reference must not reach applyCompanyLogo unchecked", () => {
    expect(resolveCompanyLogoUrl("cid:company_logo@circuvent")).toBe(defaultLogoUrl());
    expect(resolveCompanyLogoUrl("/uploads/org-7/logo.png")).toBe(defaultLogoUrl());
    expect(resolveCompanyLogoUrl("")).toBe(defaultLogoUrl());
  });

  it("always resolves to something applyCompanyLogo will accept, for every input it can be given", () => {
    for (const input of [
      "https://acme.example.com/brand.png",
      null,
      undefined,
      "",
      "cid:x",
      "/relative/path.png",
    ]) {
      expect(isAbsoluteHttpUrl(resolveCompanyLogoUrl(input))).toBe(true);
    }
  });
});
