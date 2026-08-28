import { describe, expect, it } from "vitest";
import {
  INVITE_TTL_DAYS,
  hashInviteToken,
  inviteState,
  inviteUrl,
  isUsable,
  looksLikeInviteToken,
  messageForState,
  mintInvite,
  normaliseSubmission,
  validateSubmission,
  type CandidateSubmission,
  type InviteRow,
} from "./referral-invite";

const NOW = new Date("2026-05-01T09:00:00Z");

function row(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    tokenHash: "a".repeat(64),
    expiresAt: "2026-05-15T09:00:00Z",
    ...overrides,
  };
}

const validSubmission: CandidateSubmission = {
  fullName: "Priya Nair",
  email: "priya@example.com",
  consentToProcess: true,
};

describe("mintInvite", () => {
  it("produces a URL-safe token of 256 bits", () => {
    const invite = mintInvite(NOW);
    // 32 bytes in base64url with no padding is 43 characters.
    expect(invite.token).toHaveLength(43);
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never emits characters that break in a URL", () => {
    // +, / and = get percent-encoded by some mail clients and not others,
    // which is a link that works in one inbox and not another.
    for (let i = 0; i < 200; i++) {
      expect(mintInvite(NOW).token).not.toMatch(/[+/=]/);
    }
  });

  it("does not return the token in the form it stores", () => {
    const invite = mintInvite(NOW);
    expect(invite.tokenHash).not.toBe(invite.token);
    expect(invite.tokenHash).toBe(hashInviteToken(invite.token));
    expect(invite.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is different every time", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => mintInvite(NOW).token));
    expect(tokens.size).toBe(500);
  });

  it("expires after the configured window", () => {
    const invite = mintInvite(NOW);
    const expected = new Date(NOW.getTime() + INVITE_TTL_DAYS * 86_400_000);
    expect(invite.expiresAt).toBe(expected.toISOString());
  });

  it("accepts a custom lifetime", () => {
    const invite = mintInvite(NOW, 1);
    expect(invite.expiresAt).toBe("2026-05-02T09:00:00.000Z");
  });

  it("uses the injected randomness, so the source is testable", () => {
    const invite = mintInvite(NOW, 14, () => new Uint8Array(32).fill(0));
    expect(invite.token).toBe("A".repeat(43));
  });
});

describe("hashInviteToken", () => {
  it("is stable", () => {
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"));
  });

  it("differs for different tokens", () => {
    expect(hashInviteToken("abc")).not.toBe(hashInviteToken("abd"));
  });

  it("matches the known SHA-256 of a known input", () => {
    // Pinned against a published vector. If the hash function is ever swapped
    // out, every stored invite silently stops matching, and a test that only
    // checks self-consistency would not notice.
    expect(hashInviteToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("looksLikeInviteToken", () => {
  it("accepts a freshly minted token", () => {
    expect(looksLikeInviteToken(mintInvite(NOW).token)).toBe(true);
  });

  it("rejects anything the wrong shape", () => {
    expect(looksLikeInviteToken("")).toBe(false);
    expect(looksLikeInviteToken("short")).toBe(false);
    expect(looksLikeInviteToken("a".repeat(44))).toBe(false);
    expect(looksLikeInviteToken("a".repeat(42))).toBe(false);
    // A truncated link, and a path-traversal probe.
    expect(looksLikeInviteToken("../../etc/passwd")).toBe(false);
    expect(looksLikeInviteToken(`${"a".repeat(42)}+`)).toBe(false);
  });

  it("rejects non-strings without throwing", () => {
    expect(looksLikeInviteToken(undefined)).toBe(false);
    expect(looksLikeInviteToken(null)).toBe(false);
    expect(looksLikeInviteToken(42)).toBe(false);
    expect(looksLikeInviteToken({})).toBe(false);
  });
});

describe("inviteState", () => {
  it("is pending while it is in date and untouched", () => {
    expect(inviteState(row(), NOW)).toBe("pending");
    expect(isUsable(row(), NOW)).toBe(true);
  });

  it("is expired once the window passes", () => {
    expect(inviteState(row({ expiresAt: "2026-04-30T09:00:00Z" }), NOW)).toBe("expired");
    expect(isUsable(row({ expiresAt: "2026-04-30T09:00:00Z" }), NOW)).toBe(false);
  });

  it("treats the exact expiry instant as expired", () => {
    // A boundary that lets the last millisecond through is the kind of thing
    // that only shows up as an intermittent failure.
    expect(inviteState(row({ expiresAt: NOW.toISOString() }), NOW)).toBe("expired");
  });

  it("is submitted once used, and stays that way after it expires", () => {
    // Someone returning to a link they already used should be told it is done,
    // not told it timed out — which reads as "your details were lost".
    const used = row({ submittedAt: "2026-05-02T10:00:00Z", expiresAt: "2026-04-01T09:00:00Z" });
    expect(inviteState(used, NOW)).toBe("submitted");
  });

  it("reports revoked above everything else", () => {
    // An invite withdrawn because the referral was a mistake must not come
    // back to life, and must not merely look expired.
    const revoked = row({
      revokedAt: "2026-05-02T10:00:00Z",
      submittedAt: "2026-05-02T10:00:00Z",
      expiresAt: "2026-04-01T09:00:00Z",
    });
    expect(inviteState(revoked, NOW)).toBe("revoked");
    expect(isUsable(revoked, NOW)).toBe(false);
  });
});

describe("messageForState", () => {
  it("explains what to do next rather than what went wrong", () => {
    expect(messageForState("expired")).toMatch(/new one/i);
    expect(messageForState("revoked")).toMatch(/new one/i);
    expect(messageForState("submitted")).toMatch(/nothing more to do/i);
  });

  it("says nothing for a usable invite", () => {
    expect(messageForState("pending")).toBe("");
  });
});

describe("validateSubmission", () => {
  it("accepts the minimum a candidate has to give", () => {
    expect(validateSubmission(validSubmission)).toEqual({});
  });

  it("requires a name and an email", () => {
    expect(validateSubmission({ ...validSubmission, fullName: " " }).fullName).toBeDefined();
    expect(validateSubmission({ ...validSubmission, email: "nope" }).email).toBeDefined();
  });

  it("accepts the awkward but valid email addresses", () => {
    // Strict regexes reject these, and the only real test of an address is
    // whether the message arrives.
    for (const email of [
      "priya+jobs@example.com",
      "o'brien@example.co.uk",
      "a@b.io",
      "first.last@sub.domain.example",
    ]) {
      expect(validateSubmission({ ...validSubmission, email }).email, email).toBeUndefined();
    }
  });

  it("refuses to proceed without explicit consent", () => {
    // This is unsolicited processing of an outsider's personal data: they
    // never signed up, and the referrer volunteered their address for them.
    expect(validateSubmission({ ...validSubmission, consentToProcess: false }).consentToProcess)
      .toBeDefined();
    expect(validateSubmission({ ...validSubmission, consentToProcess: undefined }).consentToProcess)
      .toBeDefined();
  });

  it("does not accept a truthy value as consent", () => {
    // "on" from a raw form post, or 1 from a careless client, is not a
    // deliberate tick.
    const sneaky = { ...validSubmission, consentToProcess: "true" as unknown as boolean };
    expect(validateSubmission(sneaky).consentToProcess).toBeDefined();
  });

  it("treats optional fields as optional", () => {
    expect(validateSubmission({ ...validSubmission, phone: "" })).toEqual({});
    expect(validateSubmission({ ...validSubmission, linkedinUrl: "" })).toEqual({});
    expect(validateSubmission({ ...validSubmission, coverNote: undefined })).toEqual({});
  });

  it("accepts international phone numbers", () => {
    for (const phone of ["+91 98765 43210", "(020) 7946 0958", "+1-555-0100"]) {
      expect(validateSubmission({ ...validSubmission, phone }).phone, phone).toBeUndefined();
    }
  });

  it("rejects a phone number that is not one", () => {
    expect(validateSubmission({ ...validSubmission, phone: "call me" }).phone).toBeDefined();
  });

  it("bounds experience and notice period", () => {
    expect(validateSubmission({ ...validSubmission, totalExperienceYears: -1 })
      .totalExperienceYears).toBeDefined();
    expect(validateSubmission({ ...validSubmission, totalExperienceYears: 61 })
      .totalExperienceYears).toBeDefined();
    expect(validateSubmission({ ...validSubmission, totalExperienceYears: 7.5 })
      .totalExperienceYears).toBeUndefined();
    expect(validateSubmission({ ...validSubmission, noticePeriodDays: 90 })
      .noticePeriodDays).toBeUndefined();
    expect(validateSubmission({ ...validSubmission, noticePeriodDays: 90.5 })
      .noticePeriodDays).toBeDefined();
  });

  it("requires money as whole minor units", () => {
    // A fractional paisa is not a thing, and letting one through puts a float
    // into a bigint column.
    expect(validateSubmission({ ...validSubmission, expectedCtcMinor: 150_000_00 })
      .expectedCtcMinor).toBeUndefined();
    expect(validateSubmission({ ...validSubmission, expectedCtcMinor: 1.5 })
      .expectedCtcMinor).toBeDefined();
    expect(validateSubmission({ ...validSubmission, expectedCtcMinor: -1 })
      .expectedCtcMinor).toBeDefined();
  });

  it("requires links to be absolute", () => {
    // A relative value here would render as a link to our own site, and a
    // javascript: URL would be worse.
    expect(validateSubmission({ ...validSubmission, linkedinUrl: "linkedin.com/in/x" })
      .linkedinUrl).toBeDefined();
    expect(validateSubmission({ ...validSubmission, linkedinUrl: "javascript:alert(1)" })
      .linkedinUrl).toBeDefined();
    expect(validateSubmission({ ...validSubmission, linkedinUrl: "https://linkedin.com/in/x" })
      .linkedinUrl).toBeUndefined();
  });

  it("caps the cover note", () => {
    expect(validateSubmission({ ...validSubmission, coverNote: "x".repeat(4001) })
      .coverNote).toBeDefined();
  });

  it("reports every problem at once", () => {
    // A form that reveals one error per attempt is a form people abandon.
    const errors = validateSubmission({ fullName: "", email: "bad", consentToProcess: false });
    expect(Object.keys(errors).sort()).toEqual(["consentToProcess", "email", "fullName"]);
  });
});

describe("normaliseSubmission", () => {
  it("trims and lowercases the email so duplicates match", () => {
    const result = normaliseSubmission({
      ...validSubmission,
      email: "  Priya@Example.COM ",
      fullName: "  Priya Nair  ",
    });
    expect(result.email).toBe("priya@example.com");
    expect(result.fullName).toBe("Priya Nair");
  });

  it("drops blank optionals rather than storing empty strings", () => {
    const result = normaliseSubmission({
      ...validSubmission,
      phone: "   ",
      currentEmployer: "",
      coverNote: "  \n ",
    });
    expect(result.phone).toBeUndefined();
    expect(result.currentEmployer).toBeUndefined();
    expect(result.coverNote).toBeUndefined();
  });

  it("keeps real optional values", () => {
    const result = normaliseSubmission({ ...validSubmission, phone: " +91 98765 43210 " });
    expect(result.phone).toBe("+91 98765 43210");
  });
});

describe("inviteUrl", () => {
  it("puts the token in the path, not the query string", () => {
    // Query strings get logged by proxies and analytics far more readily than
    // paths, and have historically leaked through referrer headers.
    expect(inviteUrl("https://hrms.circuvent.com", "abc")).toBe(
      "https://hrms.circuvent.com/refer/abc"
    );
  });

  it("does not double the slash when the base has one", () => {
    expect(inviteUrl("https://hrms.circuvent.com/", "abc")).toBe(
      "https://hrms.circuvent.com/refer/abc"
    );
  });
});
