// @vitest-environment node
//
// A signature is only defensible if you can show who signed, when, and that
// the document has not changed since. These tests pin the parts that make
// that true: refusing to render a document with a blank in it, hashing that
// survives a line-ending change, and signing order that cannot be jumped.

import { describe, expect, it } from "vitest";
import {
  buildSlots,
  canSign,
  createAccessToken,
  envelopeStatus,
  escapeHtml,
  extractTokens,
  hashContent,
  hashToken,
  pendingSignatories,
  render,
  timingSafeEqualHex,
  validateTemplate,
  verifyIntegrity,
  type SignatureSlot,
  type TemplateDefinition,
} from "@/lib/document-rules";

const template: TemplateDefinition = {
  id: "offer",
  name: "Offer letter",
  category: "offer",
  body: "Dear {{employee.firstName}}, your salary is {{offer.salary}}.",
  requiredTokens: ["employee.firstName", "offer.salary"],
  requiresSignature: true,
  signatoryRoles: ["candidate", "hr"],
  version: 1,
};

describe("extractTokens", () => {
  it("finds every distinct token", () => {
    expect(extractTokens(template.body)).toEqual(["employee.firstName", "offer.salary"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(extractTokens("{{ a.b }} and {{c}}")).toEqual(["a.b", "c"]);
  });

  it("does not report a repeated token twice", () => {
    expect(extractTokens("{{x}} {{x}}")).toEqual(["x"]);
  });

  it("returns nothing for a body with no tokens", () => {
    expect(extractTokens("Plain text.")).toEqual([]);
  });
});

describe("render", () => {
  it("substitutes values", () => {
    const result = render(template.body, {
      "employee.firstName": "Asha",
      "offer.salary": "1,200,000",
    });
    expect(result.body).toBe("Dear Asha, your salary is 1,200,000.");
    expect(result.missing).toEqual([]);
  });

  it("accepts numeric values", () => {
    expect(render("{{n}}", { n: 42 }).body).toBe("42");
  });

  it("reports a missing token rather than blanking it", () => {
    // "Your salary will be " is worse than no contract, and it will be signed
    // before anyone notices.
    const result = render(template.body, { "employee.firstName": "Asha" });
    expect(result.missing).toEqual(["offer.salary"]);
    expect(result.body).toContain("{{offer.salary}}");
  });

  it("treats an empty string as missing", () => {
    expect(render("{{x}}", { x: "" }).missing).toEqual(["x"]);
  });

  it("treats null and undefined as missing", () => {
    expect(render("{{x}}", { x: null }).missing).toEqual(["x"]);
    expect(render("{{x}}", {}).missing).toEqual(["x"]);
  });

  it("escapes HTML in substituted values", () => {
    // A name or a free-text reason must not be able to inject markup into a
    // document that is rendered as HTML and then signed.
    const result = render("Hello {{name}}", { name: "<script>alert(1)</script>" });
    expect(result.body).toBe("Hello &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes quotes as well as angle brackets", () => {
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });

  it("escapes the ampersand first so entities are not double-encoded wrongly", () => {
    expect(escapeHtml("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });

  it("does not treat a value containing braces as a further token", () => {
    // Otherwise a value could inject a token that reads another field.
    const result = render("{{a}}", { a: "{{b}}" });
    expect(result.body).toBe("{{b}}");
    expect(result.missing).toEqual([]);
  });
});

describe("validateTemplate", () => {
  it("passes when every token resolves", () => {
    expect(
      validateTemplate(template, { "employee.firstName": "Asha", "offer.salary": "10" })
    ).toEqual({ valid: true });
  });

  it("fails and names the unresolved tokens", () => {
    // Discovering on document 400 that a token is unresolvable leaves 399
    // half-correct letters already sent.
    const result = validateTemplate(template, {});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.missing).toEqual(["employee.firstName", "offer.salary"]);
    }
  });

  it("fails a signature template that names no signatories", () => {
    const broken = { ...template, signatoryRoles: [] };
    const result = validateTemplate(broken, {
      "employee.firstName": "A",
      "offer.salary": "1",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/names no signatories/);
  });

  it("allows an unsigned template with no signatories", () => {
    const memo = { ...template, requiresSignature: false, signatoryRoles: [] };
    expect(
      validateTemplate(memo, { "employee.firstName": "A", "offer.salary": "1" })
    ).toEqual({ valid: true });
  });
});

describe("hashContent", () => {
  it("is stable for the same content", async () => {
    expect(await hashContent("contract")).toBe(await hashContent("contract"));
  });

  it("changes when a single character changes", async () => {
    expect(await hashContent("salary 100")).not.toBe(await hashContent("salary 101"));
  });

  it("is a 64-character hex digest", async () => {
    expect(await hashContent("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores line-ending differences", async () => {
    // Otherwise a document stored on Windows and re-read on Linux hashes
    // differently and every signature on it appears tampered with.
    expect(await hashContent("a\r\nb")).toBe(await hashContent("a\nb"));
  });
});

describe("verifyIntegrity", () => {
  it("confirms an unchanged document", async () => {
    const hash = await hashContent("terms");
    expect((await verifyIntegrity("terms", hash)).intact).toBe(true);
  });

  it("detects a document altered after signing", async () => {
    const hash = await hashContent("salary 100");
    const result = await verifyIntegrity("salary 900", hash);
    expect(result.intact).toBe(false);
    expect(result.currentHash).not.toBe(hash);
  });
});

describe("envelopeStatus", () => {
  const now = "2026-04-10T00:00:00.000Z";

  function slot(over: Partial<SignatureSlot> = {}): SignatureSlot {
    return { signatoryEmail: "a@b.com", signatoryRole: "candidate", sequence: 1, ...over };
  }

  it("is draft before it is sent", () => {
    expect(envelopeStatus([slot()], { now })).toBe("draft");
  });

  it("is sent once dispatched but unopened", () => {
    expect(envelopeStatus([slot()], { now, sentAt: "2026-04-01T00:00:00.000Z" })).toBe("sent");
  });

  it("is viewed once opened", () => {
    expect(
      envelopeStatus([slot({ viewedAt: "2026-04-02T00:00:00.000Z" })], {
        now,
        sentAt: "2026-04-01T00:00:00.000Z",
      })
    ).toBe("viewed");
  });

  it("is partially signed with one of two signatures", () => {
    const slots = [
      slot({ signedAt: "2026-04-03T00:00:00.000Z" }),
      slot({ signatoryEmail: "hr@b.com", signatoryRole: "hr", sequence: 2 }),
    ];
    expect(envelopeStatus(slots, { now, sentAt: "2026-04-01T00:00:00.000Z" })).toBe(
      "partially_signed"
    );
  });

  it("is completed when everyone has signed", () => {
    const slots = [
      slot({ signedAt: "2026-04-03T00:00:00.000Z" }),
      slot({
        signatoryEmail: "hr@b.com",
        signatoryRole: "hr",
        sequence: 2,
        signedAt: "2026-04-04T00:00:00.000Z",
      }),
    ];
    expect(envelopeStatus(slots, { now, sentAt: "2026-04-01T00:00:00.000Z" })).toBe("completed");
  });

  it("counts a completed envelope as complete even past its deadline", () => {
    // A document everybody signed before the deadline is complete, not expired.
    const slots = [slot({ signedAt: "2026-04-03T00:00:00.000Z" })];
    expect(
      envelopeStatus(slots, {
        now,
        sentAt: "2026-04-01T00:00:00.000Z",
        expiresAt: "2026-04-05T00:00:00.000Z",
      })
    ).toBe("completed");
  });

  it("expires an unsigned envelope past its deadline", () => {
    expect(
      envelopeStatus([slot()], {
        now,
        sentAt: "2026-04-01T00:00:00.000Z",
        expiresAt: "2026-04-05T00:00:00.000Z",
      })
    ).toBe("expired");
  });

  it("is declined when any signatory declines", () => {
    const slots = [
      slot({ signedAt: "2026-04-03T00:00:00.000Z" }),
      slot({
        signatoryEmail: "hr@b.com",
        sequence: 2,
        declinedAt: "2026-04-04T00:00:00.000Z",
      }),
    ];
    expect(envelopeStatus(slots, { now, sentAt: "2026-04-01T00:00:00.000Z" })).toBe("declined");
  });

  it("voiding overrides everything, including a completed envelope", () => {
    const slots = [slot({ signedAt: "2026-04-03T00:00:00.000Z" })];
    expect(
      envelopeStatus(slots, {
        now,
        sentAt: "2026-04-01T00:00:00.000Z",
        voidedReason: "Superseded",
      })
    ).toBe("voided");
  });

  it("does not report an envelope with no slots as completed", () => {
    expect(envelopeStatus([], { now, sentAt: "2026-04-01T00:00:00.000Z" })).toBe("sent");
  });
});

describe("canSign", () => {
  const now = "2026-04-10T00:00:00.000Z";
  const sentAt = "2026-04-01T00:00:00.000Z";

  const slots: SignatureSlot[] = [
    { signatoryEmail: "candidate@b.com", signatoryRole: "candidate", sequence: 1 },
    { signatoryEmail: "hr@b.com", signatoryRole: "hr", sequence: 2 },
  ];

  it("allows the first signatory", () => {
    const verdict = canSign(slots, "candidate@b.com", { now, sentAt });
    expect(verdict.allowed).toBe(true);
  });

  it("refuses a countersignature before the first party signs", () => {
    // A countersignature collected first attests to a document the other side
    // had not yet agreed to.
    const verdict = canSign(slots, "hr@b.com", { now, sentAt });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/candidate to sign first/);
  });

  it("allows the countersignature once the first party has signed", () => {
    const signed = [{ ...slots[0], signedAt: "2026-04-02T00:00:00.000Z" }, slots[1]];
    expect(canSign(signed, "hr@b.com", { now, sentAt }).allowed).toBe(true);
  });

  it("matches the signatory case-insensitively and ignores stray whitespace", () => {
    // Email is being used as an identity here; a capital letter must not lock
    // someone out of their own contract.
    expect(canSign(slots, " Candidate@B.com ", { now, sentAt }).allowed).toBe(true);
  });

  it("refuses someone who is not a signatory", () => {
    const verdict = canSign(slots, "stranger@b.com", { now, sentAt });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/not a signatory/);
  });

  it("refuses a second signature from the same person", () => {
    const signed = [{ ...slots[0], signedAt: "2026-04-02T00:00:00.000Z" }, slots[1]];
    const verdict = canSign(signed, "candidate@b.com", { now, sentAt });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/already signed/);
  });

  it("refuses a draft that has not been sent", () => {
    const verdict = canSign(slots, "candidate@b.com", { now });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/not been sent/);
  });

  it("refuses an expired envelope", () => {
    const verdict = canSign(slots, "candidate@b.com", {
      now,
      sentAt,
      expiresAt: "2026-04-05T00:00:00.000Z",
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/expired/);
  });

  it("refuses a voided envelope", () => {
    const verdict = canSign(slots, "candidate@b.com", { now, sentAt, voidedReason: "Withdrawn" });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/voided/);
  });

  it("refuses once someone has declined", () => {
    const declined = [{ ...slots[0], declinedAt: "2026-04-02T00:00:00.000Z" }, slots[1]];
    const verdict = canSign(declined, "hr@b.com", { now, sentAt });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/declined/);
  });
});

describe("pendingSignatories", () => {
  const slots: SignatureSlot[] = [
    { signatoryEmail: "a@b.com", signatoryRole: "candidate", sequence: 1 },
    { signatoryEmail: "c@b.com", signatoryRole: "hr", sequence: 2 },
  ];

  it("returns only the earliest outstanding sequence", () => {
    expect(pendingSignatories(slots).map((s) => s.signatoryRole)).toEqual(["candidate"]);
  });

  it("advances once the earlier party signs", () => {
    const signed = [{ ...slots[0], signedAt: "2026-04-02T00:00:00.000Z" }, slots[1]];
    expect(pendingSignatories(signed).map((s) => s.signatoryRole)).toEqual(["hr"]);
  });

  it("returns everyone at the same sequence", () => {
    const parallel: SignatureSlot[] = [
      { signatoryEmail: "a@b.com", signatoryRole: "one", sequence: 1 },
      { signatoryEmail: "b@b.com", signatoryRole: "two", sequence: 1 },
    ];
    expect(pendingSignatories(parallel)).toHaveLength(2);
  });

  it("returns nothing when fully signed", () => {
    const done = slots.map((s) => ({ ...s, signedAt: "2026-04-02T00:00:00.000Z" }));
    expect(pendingSignatories(done)).toEqual([]);
  });
});

describe("buildSlots", () => {
  it("assigns sequence from the order roles are listed", () => {
    const slots = buildSlots(["candidate", "hr"], {
      candidate: { email: "c@b.com" },
      hr: { email: "hr@b.com", name: "HR Team" },
    });

    expect(slots).toEqual([
      { signatoryRole: "candidate", signatoryEmail: "c@b.com", signatoryName: undefined, sequence: 1 },
      { signatoryRole: "hr", signatoryEmail: "hr@b.com", signatoryName: "HR Team", sequence: 2 },
    ]);
  });

  it("normalises the email so ordering checks match later", () => {
    const slots = buildSlots(["hr"], { hr: { email: " HR@B.com " } });
    expect(slots[0].signatoryEmail).toBe("hr@b.com");
  });

  it("refuses a missing recipient rather than creating an unsendable envelope", () => {
    expect(() => buildSlots(["candidate", "hr"], { candidate: { email: "c@b.com" } })).toThrow(
      /No recipient given for the "hr" signatory/
    );
  });
});

describe("access tokens", () => {
  it("produces a token and a matching hash", async () => {
    const { token, hash } = await createAccessToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(token)).toBe(hash);
  });

  it("produces a different token each time", async () => {
    const a = await createAccessToken();
    const b = await createAccessToken();
    expect(a.token).not.toBe(b.token);
  });

  it("does not let the hash reveal the token", async () => {
    const { token, hash } = await createAccessToken();
    expect(hash).not.toBe(token);
  });
});

describe("timingSafeEqualHex", () => {
  it("accepts identical values", () => {
    expect(timingSafeEqualHex("abc123", "abc123")).toBe(true);
  });

  it("rejects different values of the same length", () => {
    expect(timingSafeEqualHex("abc123", "abc124")).toBe(false);
  });

  it("rejects different lengths", () => {
    expect(timingSafeEqualHex("abc", "abcd")).toBe(false);
  });

  it("rejects a difference in the first character", () => {
    // A short-circuiting comparison leaks how much of a token was correct
    // through timing, which is enough to recover it a byte at a time.
    expect(timingSafeEqualHex("zbc123", "abc123")).toBe(false);
  });
});
