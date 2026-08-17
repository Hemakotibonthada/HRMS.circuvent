import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptField,
  decryptNullable,
  encryptField,
  encryptNullable,
  encryptionConfigured,
  isEncrypted,
  needsReEncryption,
} from "./field-encryption";

// Fixed keys so fingerprints are stable across runs. 32 bytes each.
const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

const original = { ...process.env };

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY_A;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
});

afterEach(() => {
  process.env = { ...original };
});

describe("round trip", () => {
  it("recovers what it encrypted", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(decryptField(encryptField(secret))).toBe(secret);
  });

  it("handles an empty string", () => {
    expect(decryptField(encryptField(""))).toBe("");
  });

  it("handles JSON, which is how bank details are stored", () => {
    const details = JSON.stringify({ accountNumber: "12345678901", ifsc: "HDFC0001234" });
    expect(decryptField(encryptField(details))).toBe(details);
  });

  it("handles non-ASCII", () => {
    const value = "आधार — ✓ 日本語";
    expect(decryptField(encryptField(value))).toBe(value);
  });

  it("handles a long value", () => {
    const value = "x".repeat(10_000);
    expect(decryptField(encryptField(value))).toBe(value);
  });
});

describe("ciphertext shape", () => {
  it("does not contain the plaintext", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(encryptField(secret)).not.toContain(secret);
  });

  it("is recognisable as an envelope", () => {
    expect(isEncrypted(encryptField("x"))).toBe(true);
    expect(isEncrypted("JBSWY3DPEHPK3PXP")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
  });

  it("produces a different ciphertext every time for the same input", () => {
    // A fresh IV per encryption. Identical output would mean a reused IV,
    // which in GCM leaks the XOR of the two plaintexts and the auth subkey.
    const a = encryptField("same");
    const b = encryptField("same");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe(decryptField(b));
  });

  it("records which key encrypted it", () => {
    const withA = encryptField("x");

    process.env.ENCRYPTION_KEY = KEY_B;
    const withB = encryptField("x");

    const idOf = (envelope: string) => envelope.split(".")[2];
    expect(idOf(withA)).not.toBe(idOf(withB));
  });
});

describe("tamper resistance", () => {
  it("refuses a modified ciphertext instead of returning garbage", () => {
    const envelope = encryptField("JBSWY3DPEHPK3PXP");
    const parts = envelope.split(".");

    // Flip a character in the payload.
    const payload = parts[4];
    parts[4] = (payload[0] === "A" ? "B" : "A") + payload.slice(1);

    expect(() => decryptField(parts.join("."))).toThrow();
  });

  it("refuses a ciphertext whose IV was swapped", () => {
    const a = encryptField("first").split(".");
    const b = encryptField("second").split(".");

    a[3] = b[3];
    expect(() => decryptField(a.join("."))).toThrow();
  });

  it("rejects a truncated envelope", () => {
    expect(() => decryptField("enc.v1.deadbeef.AAAA")).toThrow();
    expect(() => decryptField("enc.v1.deadbeef.AAAA.AA")).toThrow();
  });

  it("refuses to decrypt with the wrong key", () => {
    const envelope = encryptField("secret");

    // A different key, and the old one is not offered as a previous key.
    process.env.ENCRYPTION_KEY = KEY_B;
    expect(() => decryptField(envelope)).toThrow(/No key matching fingerprint/);
  });
});

describe("key rotation", () => {
  it("reads rows written with a retired key", () => {
    const envelope = encryptField("written-under-old-key");

    process.env.ENCRYPTION_KEY = KEY_B;
    process.env.ENCRYPTION_KEY_PREVIOUS = KEY_A;

    expect(decryptField(envelope)).toBe("written-under-old-key");
  });

  it("writes new values with the current key only", () => {
    process.env.ENCRYPTION_KEY = KEY_B;
    process.env.ENCRYPTION_KEY_PREVIOUS = KEY_A;

    const fresh = encryptField("new");
    process.env.ENCRYPTION_KEY_PREVIOUS = "";

    // Still readable with only the current key, so the retired one is not
    // load-bearing for new writes.
    expect(decryptField(fresh)).toBe("new");
  });

  it("accepts several retired keys", () => {
    const underA = encryptField("a");
    process.env.ENCRYPTION_KEY = KEY_B;
    const underB = encryptField("b");

    const KEY_C = Buffer.alloc(32, 3).toString("base64");
    process.env.ENCRYPTION_KEY = KEY_C;
    process.env.ENCRYPTION_KEY_PREVIOUS = `${KEY_A},${KEY_B}`;

    expect(decryptField(underA)).toBe("a");
    expect(decryptField(underB)).toBe("b");
  });

  it("flags values that need rewriting", () => {
    const underA = encryptField("x");
    expect(needsReEncryption(underA)).toBe(false);

    process.env.ENCRYPTION_KEY = KEY_B;
    process.env.ENCRYPTION_KEY_PREVIOUS = KEY_A;
    expect(needsReEncryption(underA)).toBe(true);
  });

  it("flags plaintext as needing encryption, and empty values as not", () => {
    expect(needsReEncryption("JBSWY3DPEHPK3PXP")).toBe(true);
    expect(needsReEncryption(null)).toBe(false);
    expect(needsReEncryption(undefined)).toBe(false);
    expect(needsReEncryption("")).toBe(false);
  });
});

describe("migration from plaintext", () => {
  it("returns an un-enveloped value unchanged", () => {
    // Rows written before encryption existed must keep working, or turning
    // this on locks every existing user out of their own MFA.
    expect(decryptField("JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("does the same through the nullable wrapper", () => {
    expect(decryptNullable("JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
  });
});

describe("nullable wrappers", () => {
  it("maps null, undefined and empty to null rather than encrypting them", () => {
    expect(encryptNullable(null)).toBeNull();
    expect(encryptNullable(undefined)).toBeNull();
    expect(encryptNullable("")).toBeNull();

    expect(decryptNullable(null)).toBeNull();
    expect(decryptNullable(undefined)).toBeNull();
    expect(decryptNullable("")).toBeNull();
  });

  it("round-trips a real value", () => {
    const stored = encryptNullable("ABCDE1234F");
    expect(stored).not.toBeNull();
    expect(decryptNullable(stored)).toBe("ABCDE1234F");
  });
});

describe("key configuration", () => {
  it("refuses to encrypt with no key rather than storing plaintext", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encryptField("x")).toThrow(/ENCRYPTION_KEY must be set/);
  });

  it("rejects a key of the wrong length", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptField("x")).toThrow(/must be exactly 32 bytes/);
  });

  it("reports whether a usable key is configured", () => {
    expect(encryptionConfigured()).toBe(true);

    delete process.env.ENCRYPTION_KEY;
    expect(encryptionConfigured()).toBe(false);

    process.env.ENCRYPTION_KEY = "too-short";
    expect(encryptionConfigured()).toBe(false);
  });

  it("does not need a key to read plaintext, so a misconfigured deploy degrades predictably", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(decryptField("plain")).toBe("plain");
  });
});
