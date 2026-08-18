// Each test here names an attack. A passkey implementation that passes its
// happy path and skips one of these is not weaker in a subtle way — it loses
// the specific property that made passkeys worth adopting.

import { describe, expect, it } from "vitest";
import {
  authenticationOptions,
  challengeIsFresh,
  constantTimeEquals,
  fromBase64Url,
  parseFlags,
  registrationOptions,
  toBase64Url,
  verifyAuthenticatorData,
  verifyClientData,
  type RelyingParty,
} from "@/lib/auth/webauthn";

const rp: RelyingParty = {
  id: "hrms.circuvent.com",
  name: "Circuvent HRMS",
  origins: ["https://hrms.circuvent.com", "android:apk-key-hash:abc123"],
};

const flags = {
  userPresent: true,
  userVerified: true,
  backupEligible: true,
  backedUp: true,
  attestedCredentialData: false,
};

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
  });

  it("emits no padding and no URL-unsafe characters", () => {
    const encoded = toBase64Url(new Uint8Array([251, 255, 190]));
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
  });

  it("decodes a value that needs padding restored", () => {
    expect(Array.from(fromBase64Url(toBase64Url(new Uint8Array([1]))))).toEqual([1]);
    expect(Array.from(fromBase64Url(toBase64Url(new Uint8Array([1, 2]))))).toEqual([1, 2]);
  });
});

describe("comparison", () => {
  it("matches equal strings and rejects different ones", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });

  // A comparison that exits at the first differing byte turns guessing a
  // challenge from an exhaustive search into a linear one.
  it("looks at every character even when the first differs", () => {
    const long = "a".repeat(4096);
    const differsFirst = "b" + long.slice(1);
    const differsLast = long.slice(0, -1) + "b";

    const time = (b: string) => {
      const started = performance.now();
      for (let i = 0; i < 200; i++) constantTimeEquals(long, b);
      return performance.now() - started;
    };

    const first = time(differsFirst);
    const last = time(differsLast);
    const slower = Math.max(first, last);
    const faster = Math.min(first, last);

    // Generous, because a shared CI runner is noisy. An early-exit compare is
    // orders of magnitude apart on a 4096-character string, not 5x.
    expect(slower).toBeLessThan(faster * 5 + 5);
  });
});

describe("client data — this is what stops phishing", () => {
  const clientData = {
    type: "webauthn.get" as const,
    challenge: "Q0hBTExFTkdF",
    origin: "https://hrms.circuvent.com",
  };

  const expected = { ceremony: "webauthn.get" as const, challenge: "Q0hBTExFTkdF", rp };

  it("accepts a well-formed assertion", () => {
    expect(verifyClientData(clientData, expected).ok).toBe(true);
  });

  // A site at hrms.circuvent.com.evil.test cannot produce an assertion naming
  // our origin, however convincing its page looks. Dropping this check gives
  // up the one property that makes passkeys unphishable.
  it("refuses an assertion produced for a look-alike domain", () => {
    for (const origin of [
      "https://hrms.circuvent.com.evil.test",
      "https://hrms-circuvent.com",
      "http://hrms.circuvent.com",
      "https://evil.test",
    ]) {
      const verdict = verifyClientData({ ...clientData, origin }, expected);
      expect(verdict.ok, `accepted ${origin}`).toBe(false);
      expect(verdict.reason).toContain("Origin");
    }
  });

  it("accepts a registered native app origin", () => {
    const verdict = verifyClientData(
      { ...clientData, origin: "android:apk-key-hash:abc123" },
      expected
    );
    expect(verdict.ok).toBe(true);
  });

  // Both ceremonies produce a signed blob; only this field says which.
  it("refuses a registration response replayed into login", () => {
    const verdict = verifyClientData({ ...clientData, type: "webauthn.create" }, expected);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("ceremony");
  });

  it("refuses a stale or forged challenge", () => {
    const verdict = verifyClientData({ ...clientData, challenge: "T0xEQ0hBTA" }, expected);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("Challenge");
  });

  it("refuses a ceremony completed inside somebody else's iframe", () => {
    const verdict = verifyClientData({ ...clientData, crossOrigin: true }, expected);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("Cross-origin");
  });
});

describe("authenticator data", () => {
  const expected = { rpIdHash: "RPHASH", requireUserVerification: true };

  it("accepts a verified assertion for this domain", () => {
    const verdict = verifyAuthenticatorData(
      { rpIdHash: "RPHASH", flags, signCount: 1 },
      expected
    );
    expect(verdict.ok).toBe(true);
  });

  it("refuses a credential bound to another domain", () => {
    const verdict = verifyAuthenticatorData(
      { rpIdHash: "OTHERHASH", flags, signCount: 1 },
      expected
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("different domain");
  });

  it("refuses an assertion with nobody present", () => {
    const verdict = verifyAuthenticatorData(
      { rpIdHash: "RPHASH", flags: { ...flags, userPresent: false }, signCount: 1 },
      expected
    );
    expect(verdict.ok).toBe(false);
  });

  // Presence only means a finger touched the key. On a stolen unlocked phone
  // that is one tap from somebody's payroll record.
  it("refuses presence alone when verification is required", () => {
    const verdict = verifyAuthenticatorData(
      { rpIdHash: "RPHASH", flags: { ...flags, userVerified: false }, signCount: 1 },
      expected
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("biometric");
  });

  it("allows presence alone where verification is not demanded", () => {
    const verdict = verifyAuthenticatorData(
      { rpIdHash: "RPHASH", flags: { ...flags, userVerified: false }, signCount: 1 },
      { ...expected, requireUserVerification: false }
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("cloning detection", () => {
  const base = { rpIdHash: "RPHASH", flags };

  it("accepts a counter that moved forward", () => {
    const verdict = verifyAuthenticatorData(
      { ...base, signCount: 6 },
      { rpIdHash: "RPHASH", previousSignCount: 5 }
    );
    expect(verdict.ok).toBe(true);
  });

  it("refuses a counter that went backwards or repeated", () => {
    for (const count of [5, 4, 0]) {
      const verdict = verifyAuthenticatorData(
        { ...base, signCount: count },
        { rpIdHash: "RPHASH", previousSignCount: 5 }
      );
      expect(verdict.ok, `accepted ${count} after 5`).toBe(false);
      expect(verdict.reason).toContain("cloned");
    }
  });

  // iCloud Keychain and Google Password Manager always report zero, because
  // the credential is meant to exist on several devices. Treating that as
  // cloning rejects every modern passkey.
  it("does not treat a synced authenticator's constant zero as cloning", () => {
    const verdict = verifyAuthenticatorData(
      { ...base, signCount: 0 },
      { rpIdHash: "RPHASH", previousSignCount: 0 }
    );
    expect(verdict.ok).toBe(true);
  });

  it("skips the check entirely on first use", () => {
    const verdict = verifyAuthenticatorData({ ...base, signCount: 0 }, { rpIdHash: "RPHASH" });
    expect(verdict.ok).toBe(true);
  });
});

describe("flags", () => {
  it("reads each bit independently", () => {
    expect(parseFlags(0x01).userPresent).toBe(true);
    expect(parseFlags(0x04).userVerified).toBe(true);
    expect(parseFlags(0x40).attestedCredentialData).toBe(true);
    expect(parseFlags(0x00)).toEqual({
      userPresent: false,
      userVerified: false,
      backupEligible: false,
      backedUp: false,
      attestedCredentialData: false,
    });
  });

  it("reads a realistic combined byte", () => {
    // Present + verified + backup eligible + backed up + attested.
    const parsed = parseFlags(0x5d);
    expect(parsed.userPresent).toBe(true);
    expect(parsed.userVerified).toBe(true);
    expect(parsed.backedUp).toBe(true);
  });
});

describe("registration options", () => {
  const options = registrationOptions({
    challenge: "Q0hBTA",
    rp,
    user: { id: "u1", email: "asha@example.test", displayName: "Asha Rao" },
    existing: [
      { credentialId: "cred1", publicKey: "k", signCount: 0, userId: "u1", transports: ["internal"] },
    ],
  });

  it("asks for a discoverable, verified credential", () => {
    expect(options.authenticatorSelection.residentKey).toBe("required");
    expect(options.authenticatorSelection.userVerification).toBe("required");
  });

  it("offers ES256 before RS256", () => {
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
  });

  // Attestation identifies the authenticator's make and model, which this
  // product has no policy about — asking collects hardware identifiers we do
  // not use and adds a consent prompt on Apple platforms.
  it("does not ask for attestation", () => {
    expect(options.attestation).toBe("none");
  });

  // An authenticator that already holds a key for this account should decline
  // rather than create a second one the user has to guess between.
  it("excludes credentials the user already has", () => {
    expect(options.excludeCredentials).toHaveLength(1);
    expect(options.excludeCredentials[0].id).toBe("cred1");
  });

  it("falls back to the email when there is no display name", () => {
    const bare = registrationOptions({
      challenge: "c",
      rp,
      user: { id: "u1", email: "asha@example.test" },
      existing: [],
    });
    expect(bare.user.displayName).toBe("asha@example.test");
  });

  it("never puts the raw user id where a display name goes", () => {
    expect(options.user.displayName).not.toBe("u1");
    expect(options.user.name).toBe("asha@example.test");
  });
});

describe("authentication options", () => {
  const options = authenticationOptions({ challenge: "Q0hBTA", rp });

  it("requires verification", () => {
    expect(options.userVerification).toBe("required");
  });

  // Naming the credentials an account holds answers "does this email exist
  // here" to anyone who asks. A discoverable credential means the
  // authenticator already knows.
  it("names no credentials, so it cannot enumerate accounts", () => {
    expect(options.allowCredentials).toEqual([]);
  });

  it("binds to the relying party id", () => {
    expect(options.rpId).toBe("hrms.circuvent.com");
  });
});

describe("challenge freshness", () => {
  const pending = {
    challenge: "c",
    ceremony: "webauthn.get" as const,
    issuedAt: 1_000_000,
  };

  it("accepts one used promptly", () => {
    expect(challengeIsFresh(pending, 1_000_000)).toBe(true);
    expect(challengeIsFresh(pending, 1_030_000)).toBe(true);
  });

  it("refuses one older than the window", () => {
    expect(challengeIsFresh(pending, 1_000_000 + 90_001)).toBe(false);
  });

  // A challenge from the future means the clock moved or the value was forged.
  it("refuses one issued in the future", () => {
    expect(challengeIsFresh(pending, 999_000)).toBe(false);
  });

  it("allows the window to be shortened", () => {
    expect(challengeIsFresh(pending, 1_030_000, 10_000)).toBe(false);
  });
});
