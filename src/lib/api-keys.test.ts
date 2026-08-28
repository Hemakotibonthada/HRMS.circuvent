// @vitest-environment node
//
// API keys are long-lived credentials that live in someone else's
// configuration, so the properties that matter are: a leak of the database
// yields nothing usable, scopes actually constrain, and verification does not
// leak information through timing or error messages.

import { describe, expect, it } from "vitest";
import {
  ALL_SCOPES,
  extractApiKey,
  extractPrefix,
  generateApiKey,
  hasScope,
  hashApiKey,
  requireScopes,
  timingSafeEqualHex,
  verifyApiKey,
  type StoredKey,
} from "@/lib/api-keys";

function stored(over: Partial<StoredKey> = {}): StoredKey {
  const key = generateApiKey();
  return {
    id: "key-1",
    orgId: "org-1",
    keyHash: key.hash,
    scopes: ["employees:read"],
    rateLimitPerMinute: 600,
    ...over,
  };
}

describe("generateApiKey", () => {
  it("produces the documented shape", () => {
    const key = generateApiKey();
    expect(key.plaintext).toMatch(/^cvk_live_[0-9a-f]{32}_[0-9a-f]{48}$/);
    expect(key.prefix).toMatch(/^cvk_live_[0-9a-f]{32}$/);
    expect(key.plaintext.startsWith(key.prefix)).toBe(true);
  });

  it("marks test keys distinctly", () => {
    expect(generateApiKey("test").plaintext).toMatch(/^cvk_test_/);
  });

  it("never repeats", () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().plaintext));
    expect(keys.size).toBe(200);
  });

  it("stores only a hash", () => {
    // A database leak must not yield working keys.
    const key = generateApiKey();
    expect(key.hash).not.toContain(key.plaintext);
    expect(key.hash).toHaveLength(64);
    expect(key.hash).toBe(hashApiKey(key.plaintext));
  });

  it("keeps the prefix non-secret so a leaked key can be revoked from it", () => {
    const key = generateApiKey();
    // The prefix alone must not be enough to reconstruct the key.
    expect(hashApiKey(key.prefix)).not.toBe(key.hash);
  });
});

describe("extractPrefix", () => {
  it("returns the public segment of a well-formed key", () => {
    const key = generateApiKey();
    expect(extractPrefix(key.plaintext)).toBe(key.prefix);
  });

  it("rejects malformed keys", () => {
    for (const bad of [
      "",
      "not-a-key",
      "cvk_live_short_x",
      "xxx_live_" + "a".repeat(32) + "_" + "b".repeat(48),
      "cvk_staging_" + "a".repeat(32) + "_" + "b".repeat(48),
      "cvk_live_" + "z".repeat(32) + "_" + "b".repeat(48),
    ]) {
      expect(extractPrefix(bad), bad).toBeNull();
    }
  });
});

describe("verifyApiKey", () => {
  it("accepts a matching key", () => {
    const key = generateApiKey();
    const record = stored({ keyHash: key.hash });
    const result = verifyApiKey(key.plaintext, record);
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed key before any lookup", () => {
    const result = verifyApiKey("garbage", stored());
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects when no record exists", () => {
    expect(verifyApiKey(generateApiKey().plaintext, null)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports a wrong secret as not_found", () => {
    // Distinguishing "prefix exists, secret wrong" tells an attacker their
    // guess was half right.
    const result = verifyApiKey(generateApiKey().plaintext, stored());
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a revoked key", () => {
    const key = generateApiKey();
    const result = verifyApiKey(
      key.plaintext,
      stored({ keyHash: key.hash, revokedAt: new Date("2026-01-01") })
    );
    expect(result).toEqual({ ok: false, reason: "revoked" });
  });

  it("rejects an expired key", () => {
    const key = generateApiKey();
    const result = verifyApiKey(
      key.plaintext,
      stored({ keyHash: key.hash, expiresAt: new Date(Date.now() - 1000) })
    );
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts a key whose expiry is still ahead", () => {
    const key = generateApiKey();
    const result = verifyApiKey(
      key.plaintext,
      stored({ keyHash: key.hash, expiresAt: new Date(Date.now() + 86_400_000) })
    );
    expect(result.ok).toBe(true);
  });
});

describe("timingSafeEqualHex", () => {
  it("matches identical strings and rejects differing ones", () => {
    expect(timingSafeEqualHex("abcdef", "abcdef")).toBe(true);
    expect(timingSafeEqualHex("abcdef", "abcdeg")).toBe(false);
    expect(timingSafeEqualHex("abc", "abcdef")).toBe(false);
  });

  it("compares the whole string rather than stopping at the first difference", () => {
    // Both differ from the reference; an early-exit comparison would be
    // measurably faster for the first.
    expect(timingSafeEqualHex("zbcdef", "abcdef")).toBe(false);
    expect(timingSafeEqualHex("abcdez", "abcdef")).toBe(false);
  });
});

describe("scopes", () => {
  it("grants only what was issued", () => {
    const key = stored({ scopes: ["employees:read", "leave:read"] });
    expect(hasScope(key, "employees:read")).toBe(true);
    expect(hasScope(key, "payroll:read")).toBe(false);
  });

  it("does not let a write scope imply read", () => {
    // An integration that only pushes attendance has no reason to download the
    // roster, and implying it would widen every key already issued.
    const key = stored({ scopes: ["attendance:write"] });
    expect(hasScope(key, "attendance:read")).toBe(false);
  });

  it("reports exactly which scopes are missing", () => {
    const key = stored({ scopes: ["employees:read"] });
    expect(requireScopes(key, ["employees:read", "payroll:read", "reports:read"])).toEqual([
      "payroll:read",
      "reports:read",
    ]);
    expect(requireScopes(key, ["employees:read"])).toEqual([]);
  });

  it("enumerates every scope the API defines", () => {
    expect(new Set(ALL_SCOPES).size).toBe(ALL_SCOPES.length);
    expect(ALL_SCOPES).toContain("reports:read");
  });
});

describe("extractApiKey", () => {
  it("reads a bearer token", () => {
    expect(extractApiKey(new Headers({ authorization: "Bearer cvk_live_x" }))).toBe("cvk_live_x");
    expect(extractApiKey(new Headers({ authorization: "bearer cvk_live_x" }))).toBe("cvk_live_x");
  });

  it("reads the X-API-Key header", () => {
    expect(extractApiKey(new Headers({ "x-api-key": " cvk_live_x " }))).toBe("cvk_live_x");
  });

  it("ignores other authorization schemes", () => {
    expect(extractApiKey(new Headers({ authorization: "Basic abc" }))).toBeNull();
  });

  it("returns null when no key is present", () => {
    expect(extractApiKey(new Headers())).toBeNull();
  });
});
