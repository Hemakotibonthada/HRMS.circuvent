// ═══════════════════════════════════════════════════════════════
// Referral invite email — branding
// ═══════════════════════════════════════════════════════════════
// The invite went out as an unbranded white card: no logo, no wordmark, no
// footer. It is the first thing a referred candidate ever sees from us, and it
// asks them to click a link — an unbranded message asking that is exactly what
// a phishing filter, and a sensible human, is suspicious of.

import { describe, it, expect, afterEach } from "vitest";
import { buildInviteEmail } from "./referral-invite-email";

const base = {
  to: "candidate@example.com",
  candidateName: "Priya Raman",
  referrerName: "Sam Patel",
  organizationName: "Circuvent",
  positionTitle: "Backend Engineer",
  url: "https://hrms.circuvent.com/refer/abc123",
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

const originalLogo = process.env.MAIL_LOGO_URL;
const originalCareers = process.env.NEXT_PUBLIC_CAREERS_URL;

afterEach(() => {
  if (originalLogo === undefined) delete process.env.MAIL_LOGO_URL;
  else process.env.MAIL_LOGO_URL = originalLogo;
  if (originalCareers === undefined) delete process.env.NEXT_PUBLIC_CAREERS_URL;
  else process.env.NEXT_PUBLIC_CAREERS_URL = originalCareers;
});

describe("invite email branding", () => {
  it("carries a logo", () => {
    const { html } = buildInviteEmail(base);
    expect(html).toMatch(/<img[^>]+src="https:\/\/[^"]+"/);
  });

  it("uses an absolute https logo URL", () => {
    // A relative path resolves against nothing in an inbox, and a data: URI is
    // stripped by Gmail and Outlook.
    const src = buildInviteEmail(base).html.match(/<img[^>]+src="([^"]+)"/)?.[1];
    expect(src).toBeDefined();
    expect(src!.startsWith("https://")).toBe(true);
  });

  it("prints the org name as live text as well as showing the logo", () => {
    // Most clients block images by default. A header that is only a picture
    // arrives as an empty box, so the wordmark has to be real text.
    const { html } = buildInviteEmail(base);
    const header = html.slice(0, html.indexOf("Hello "));
    expect(header).toContain("<img");
    expect(header).toContain("Circuvent");
  });

  it("honours MAIL_LOGO_URL when it is set", () => {
    process.env.MAIL_LOGO_URL = "https://cdn.example.com/mark.png";
    expect(buildInviteEmail(base).html).toContain("https://cdn.example.com/mark.png");
  });

  it("falls back to the careers site when no logo is configured", () => {
    delete process.env.MAIL_LOGO_URL;
    process.env.NEXT_PUBLIC_CAREERS_URL = "https://career.circuvent.com";
    expect(buildInviteEmail(base).html).toContain(
      "https://career.circuvent.com/logo-mark-128.png",
    );
  });

  it("explains why the candidate received it", () => {
    // They did not sign up for this and did not ask for it.
    expect(buildInviteEmail(base).html).toMatch(/referred you/i);
  });
});

describe("invite email escaping", () => {
  it("escapes a candidate name containing markup", () => {
    const { html } = buildInviteEmail({
      ...base,
      candidateName: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes the org name in the header, not just the body", () => {
    const { html } = buildInviteEmail({ ...base, organizationName: 'A" onerror="x' });
    expect(html).not.toContain('A" onerror="x');
    expect(html).toContain("&quot;");
  });

  it("still sends a plain-text alternative", () => {
    const { text } = buildInviteEmail(base);
    expect(text).toContain("Priya Raman");
    expect(text).toContain(base.url);
    expect(text).not.toContain("<");
  });
});
