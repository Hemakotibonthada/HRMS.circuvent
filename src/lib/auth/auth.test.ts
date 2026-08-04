// @vitest-environment node
//
// Runs in the node environment, not jsdom. jose checks `instanceof Uint8Array`,
// and jsdom's TextEncoder returns one from a different realm, so the check
// fails there even though the code is correct. These modules only ever execute
// server-side, so node is also the honest environment to test them in.
//
// Password hashing, token signing and TOTP are the parts of the system where a
// subtle mistake is silently catastrophic. These tests pin the properties that
// make them safe rather than merely working.

import { beforeEach, describe, expect, it } from "vitest";
import {
  DUMMY_HASH,
  fakeVerify,
  generateToken,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "@/lib/auth/password";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  cookieOptions,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  verifyAccessToken,
} from "@/lib/auth/tokens";
import {
  consumeBackupCode,
  createTotpEnrolment,
  generateBackupCodes,
  hashBackupCode,
  verifyTotp,
} from "@/lib/auth/mfa";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("Correct horse battery staple", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time for the same password", async () => {
    // Equal hashes would mean the salt is not random, which makes the whole
    // table attackable with one rainbow table.
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    await expect(verifyPassword("same-password", a)).resolves.toBe(true);
    await expect(verifyPassword("same-password", b)).resolves.toBe(true);
  });

  it("emits PHC format carrying its own cost parameters", async () => {
    const hash = await hashPassword("pw");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[\w+/]+\$[\w+/]+$/);
  });

  it("returns false rather than throwing on a malformed stored hash", async () => {
    // A corrupt row must not become a 500 that distinguishes itself from a
    // wrong password.
    for (const bad of ["", "not-a-hash", "$argon2id$broken", "$bcrypt$v=19$m=1,t=1,p=1$a$b"]) {
      await expect(verifyPassword("pw", bad)).resolves.toBe(false);
    }
  });

  it("refuses to hash an empty password", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });

  it("flags hashes weaker than the current cost for rehashing", () => {
    expect(needsRehash("$argon2id$v=19$m=4096,t=1,p=1$AAAA$BBBB")).toBe(true);
    expect(needsRehash("garbage")).toBe(true);
  });

  it("does not flag a freshly created hash", async () => {
    expect(needsRehash(await hashPassword("pw"))).toBe(false);
  });

  it("provides a dummy hash so unknown accounts cost the same to check", async () => {
    // Without this, an unknown email returns faster than a known one and the
    // login form enumerates accounts.
    await expect(verifyPassword("anything", DUMMY_HASH)).resolves.toBe(false);
    await expect(fakeVerify("anything")).resolves.toBeUndefined();
  });

  it("generates distinct high-entropy tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
    expect(generateToken()).toHaveLength(64);
  });
});

describe("access tokens", () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = "a".repeat(48);
  });

  const claims = {
    sub: "user-1",
    org: "org-1",
    role: "hr",
    sid: "session-1",
    email: "asha@circuvent.com",
  };

  it("round-trips its claims", async () => {
    const token = await signAccessToken(claims);
    const verified = await verifyAccessToken(token);

    expect(verified?.sub).toBe("user-1");
    expect(verified?.org).toBe("org-1");
    expect(verified?.role).toBe("hr");
    expect(verified?.sid).toBe("session-1");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAccessToken(claims);
    process.env.AUTH_JWT_SECRET = "b".repeat(48);
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it("rejects tampered, empty and malformed tokens", async () => {
    const token = await signAccessToken(claims);
    await expect(verifyAccessToken(`${token}x`)).resolves.toBeNull();
    await expect(verifyAccessToken("")).resolves.toBeNull();
    await expect(verifyAccessToken("a.b.c")).resolves.toBeNull();
  });

  it("rejects the alg=none downgrade", async () => {
    // Unsigned tokens must never be accepted; the classic JWT bypass.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ ...claims, iss: "https://circuvent.com" })).toString(
      "base64url"
    );
    await expect(verifyAccessToken(`${header}.${payload}.`)).resolves.toBeNull();
  });

  it("refuses to sign when the secret is missing or too short", async () => {
    process.env.AUTH_JWT_SECRET = "";
    await expect(signAccessToken(claims)).rejects.toThrow(/AUTH_JWT_SECRET/);

    process.env.AUTH_JWT_SECRET = "short";
    await expect(signAccessToken(claims)).rejects.toThrow(/32 characters/);
  });

  it("sets an expiry within the access-token lifetime", async () => {
    const verified = await verifyAccessToken(await signAccessToken(claims));
    const ttl = verified!.exp! - verified!.iat!;
    expect(ttl).toBe(15 * 60);
  });
});

describe("refresh tokens", () => {
  it("hashes deterministically so a stored hash can be matched", () => {
    expect(hashRefreshToken("token-abc")).toBe(hashRefreshToken("token-abc"));
    expect(hashRefreshToken("token-abc")).not.toBe(hashRefreshToken("token-abd"));
    expect(hashRefreshToken("x")).toHaveLength(64);
  });

  it("never stores the token itself", () => {
    const token = generateToken();
    expect(hashRefreshToken(token)).not.toContain(token);
  });

  it("expires 30 days out", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(refreshTokenExpiry(from).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});

describe("session cookies", () => {
  it("are httpOnly and lax so XSS cannot read them and links keep the session", () => {
    const opts = cookieOptions(900);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("omits the domain outside production, where localhost would reject it", () => {
    const previous = process.env.AUTH_COOKIE_DOMAIN;
    delete process.env.AUTH_COOKIE_DOMAIN;

    const opts = cookieOptions(900);
    expect(opts.domain).toBeUndefined();
    expect(opts.secure).toBe(false);

    if (previous !== undefined) process.env.AUTH_COOKIE_DOMAIN = previous;
  });

  it("uses the configured apex domain so every subdomain shares the session", () => {
    process.env.AUTH_COOKIE_DOMAIN = ".circuvent.com";
    expect(cookieOptions(900).domain).toBe(".circuvent.com");
    delete process.env.AUTH_COOKIE_DOMAIN;
  });

  it("names the cookies distinctly", () => {
    expect(ACCESS_COOKIE).not.toBe(REFRESH_COOKIE);
  });
});

describe("TOTP", () => {
  it("issues a scannable enrolment", () => {
    const enrolment = createTotpEnrolment("asha@circuvent.com");
    expect(enrolment.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrolment.uri).toContain("asha%40circuvent.com");
    expect(enrolment.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrolment.manualEntryKey).toContain(" ");
  });

  it("rejects malformed codes without throwing", () => {
    const { secret } = createTotpEnrolment("a@b.com");
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5"]) {
      expect(verifyTotp(secret, bad)).toBe(false);
    }
  });

  it("rejects a code against a malformed secret", () => {
    expect(verifyTotp("not-base32!", "123456")).toBe(false);
    expect(verifyTotp("", "123456")).toBe(false);
  });
});

describe("backup codes", () => {
  it("generates ten distinct formatted codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });

  it("matches a code regardless of spacing, dashes or case", () => {
    const code = "ABCDE-12345";
    expect(hashBackupCode(code)).toBe(hashBackupCode("abcde12345"));
    expect(hashBackupCode(code)).toBe(hashBackupCode("ABCDE 12345"));
  });

  it("consumes a code exactly once", () => {
    const codes = generateBackupCodes(3);
    const stored = codes.map(hashBackupCode);

    const remaining = consumeBackupCode(codes[1], stored);
    expect(remaining).toHaveLength(2);
    expect(remaining).not.toContain(hashBackupCode(codes[1]));

    // Replaying the same code must fail, or it is not single-use.
    expect(consumeBackupCode(codes[1], remaining!)).toBeNull();
  });

  it("returns null for a code that was never issued", () => {
    const stored = generateBackupCodes(3).map(hashBackupCode);
    expect(consumeBackupCode("00000-00000", stored)).toBeNull();
  });
});
