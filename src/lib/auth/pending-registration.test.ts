import { describe, expect, it } from "vitest";
import {
  MAX_VERIFICATION_ATTEMPTS,
  REGISTRATION_CODE_TTL_MINUTES,
  checkVerification,
  generateVerificationCode,
  hashVerificationCode,
  readPendingMetadata,
  slugify,
  toPendingMetadata,
} from "./pending-registration";

/**
 * Sign-up used to create an organisation, its owner and every row a tenant
 * needs straight from the submitted form, with no proof that anybody could
 * read mail at the address typed into it. These are the parts of the fix that
 * can be checked without a database.
 */

const future = () => new Date(Date.now() + 10 * 60_000);
const past = () => new Date(Date.now() - 60_000);

describe("generateVerificationCode", () => {
  it("is always six digits", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it("keeps leading zeros rather than shortening the code", () => {
    // Padding, not a 100000..999999 range: generating in that range to avoid
    // padding would silently discard a tenth of the space.
    const codes = Array.from({ length: 4000 }, generateVerificationCode);
    expect(codes.every((c) => c.length === 6)).toBe(true);
  });
});

describe("hashVerificationCode", () => {
  it("does not store the code itself", () => {
    const hash = hashVerificationCode("someone@example.com", "123456");
    expect(hash).not.toContain("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds the code to one address", () => {
    /*
     * Six digits observed anywhere would otherwise be six digits usable
     * everywhere. The address is folded in so a code only completes the
     * registration it was issued for.
     */
    const a = hashVerificationCode("a@example.com", "123456");
    const b = hashVerificationCode("b@example.com", "123456");
    expect(a).not.toBe(b);
  });

  it("is not defeated by case or padding in the address", () => {
    const plain = hashVerificationCode("someone@example.com", "123456");
    expect(hashVerificationCode("  SomeOne@Example.COM  ", " 123456 ")).toBe(plain);
  });
});

describe("checkVerification", () => {
  const base = {
    storedHash: "abc",
    submittedHash: "abc",
    expiresAt: future(),
    consumedAt: null as Date | null,
    attempts: 0,
  };

  it("accepts a correct, live, unused code", () => {
    expect(checkVerification(base)).toEqual({ ok: true });
  });

  it("refuses a wrong code", () => {
    expect(checkVerification({ ...base, submittedHash: "zzz" })).toEqual({
      ok: false,
      reason: "wrong_code",
    });
  });

  it("refuses an expired code even when it is correct", () => {
    expect(checkVerification({ ...base, expiresAt: past() })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a code that has already been used", () => {
    // The reason a second request carrying the same correct code cannot
    // provision a second organisation.
    expect(checkVerification({ ...base, consumedAt: new Date() })).toEqual({
      ok: false,
      reason: "consumed",
    });
  });

  it("stops accepting guesses once the attempt limit is reached", () => {
    expect(
      checkVerification({ ...base, submittedHash: "zzz", attempts: MAX_VERIFICATION_ATTEMPTS })
    ).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  it("checks expiry and reuse before the code, so a late correct code burns no attempt", () => {
    /*
     * Order matters. If the comparison ran first, somebody submitting the
     * right code just after it expired would be recorded as having guessed
     * wrongly, and a genuine user could exhaust their own attempts.
     */
    expect(checkVerification({ ...base, expiresAt: past(), submittedHash: "zzz" })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(checkVerification({ ...base, consumedAt: new Date(), submittedHash: "zzz" })).toEqual({
      ok: false,
      reason: "consumed",
    });
  });

  it("treats the expiry instant itself as expired", () => {
    const now = new Date();
    expect(checkVerification({ ...base, expiresAt: now, now })).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("pending metadata", () => {
  it("carries the sign-up across the two steps and starts at zero attempts", () => {
    const meta = toPendingMetadata({
      name: "Ada Lovelace",
      company: "Analytical Engines",
      passwordHash: "$argon2id$v=19$...",
    });
    expect(meta.attempts).toBe(0);
    expect(readPendingMetadata(meta)).toEqual(meta);
  });

  it("refuses a half-populated row rather than provisioning from it", () => {
    /*
     * A partial row would otherwise create an organisation with an empty name,
     * or an owner with no password hash — an account nobody can sign into.
     */
    expect(readPendingMetadata(null)).toBeNull();
    expect(readPendingMetadata({})).toBeNull();
    expect(readPendingMetadata({ name: "A", company: "B" })).toBeNull();
    expect(readPendingMetadata({ name: "", company: "B", passwordHash: "h" })).toBeNull();
    expect(readPendingMetadata({ name: "A", company: "  ", passwordHash: "h" })).toBeNull();
    expect(readPendingMetadata({ name: "A", company: "B", passwordHash: "" })).toBeNull();
  });

  it("does not trust an attempt count it cannot use", () => {
    const read = readPendingMetadata({
      name: "A",
      company: "B",
      passwordHash: "h",
      attempts: -5,
    });
    expect(read?.attempts).toBe(0);
  });
});

describe("slugify", () => {
  it("makes a URL-safe slug", () => {
    expect(slugify("HT Research & Development Pvt Ltd")).toBe("ht-research-development-pvt-ltd");
  });

  it("never returns an empty slug", () => {
    // A company name of nothing but punctuation would otherwise produce "",
    // and every such tenant would collide on the same empty slug.
    expect(slugify("!!!")).toBe("org");
    expect(slugify("")).toBe("org");
  });
});

describe("code lifetime", () => {
  it("is short enough to matter and long enough to type", () => {
    expect(REGISTRATION_CODE_TTL_MINUTES).toBeGreaterThanOrEqual(5);
    expect(REGISTRATION_CODE_TTL_MINUTES).toBeLessThanOrEqual(30);
  });
});
