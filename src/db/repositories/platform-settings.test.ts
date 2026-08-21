import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Storage of the Razorpay credentials.
 *
 * The rules worth holding onto are all about what happens to a secret once it
 * has been saved: it is encrypted at rest, it is never handed back to a
 * browser, and a form submitted with the secret field left blank must not
 * erase it. That last one sounds like a nicety and is not — the settings
 * screen cannot show the stored secret, so every save that only changes the
 * mode arrives with an empty secret field.
 */

interface Row {
  value: Record<string, unknown>;
  updated_at: string;
}

let rows: Row[] = [];
const executed: string[] = [];

/**
 * A stand-in for the transaction wrapper. It records the SQL it is given and
 * answers SELECTs from `rows`, which is enough to observe what is written
 * without a database.
 */
const execute = vi.fn(async (query: { queryChunks?: unknown[] } | unknown) => {
  const text = JSON.stringify(query);
  executed.push(text);
  if (text.includes("SELECT")) return { rows };
  return { rows: [] };
});

vi.mock("@/db/client", () => ({
  db: () => ({
    transaction: async (fn: (tx: { execute: typeof execute }) => unknown) => fn({ execute }),
  }),
}));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return actual;
});

const encryptField = vi.fn((v: string) => `enc.v1.${Buffer.from(v).toString("base64")}`);
const decryptNullable = vi.fn((v: string | undefined | null) =>
  typeof v === "string" && v.startsWith("enc.v1.")
    ? Buffer.from(v.slice("enc.v1.".length), "base64").toString("utf8")
    : (v ?? null)
);
const encryptionConfigured = vi.fn(() => true);

vi.mock("@/lib/crypto/field-encryption", () => ({
  encryptField: (v: string) => encryptField(v),
  decryptNullable: (v: string | undefined | null) => decryptNullable(v),
  encryptionConfigured: () => encryptionConfigured(),
}));

const {
  loadRazorpaySettings,
  razorpayConfigStatus,
  saveRazorpaySettings,
} = await import("./platform-settings");

/** The SQL text of the last write, for asserting on what was stored. */
function lastWrite(): string {
  return [...executed].reverse().find((s) => s.includes("INSERT")) ?? "";
}

beforeEach(() => {
  rows = [];
  executed.length = 0;
  encryptionConfigured.mockReturnValue(true);
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("saveRazorpaySettings", () => {
  it("encrypts the secrets and leaves the key id readable", async () => {
    await saveRazorpaySettings({
      keyId: "rzp_test_abc",
      keySecret: "super-secret",
      webhookSecret: "hook-secret",
      mode: "test",
      enabled: true,
    });

    const written = lastWrite();
    expect(written).toContain("rzp_test_abc");
    // The plaintext of neither secret may appear in what reaches the database.
    expect(written).not.toContain("super-secret");
    expect(written).not.toContain("hook-secret");
    expect(encryptField).toHaveBeenCalledWith("super-secret");
    expect(encryptField).toHaveBeenCalledWith("hook-secret");
  });

  it("keeps the stored secret when the field is submitted blank", async () => {
    rows = [
      {
        value: {
          keyId: "rzp_test_abc",
          keySecret: "enc.v1.b2xk",
          webhookSecret: "enc.v1.aG9vaw==",
          mode: "test",
          enabled: true,
        },
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];

    // Somebody switching the mode and touching nothing else. The secret fields
    // are empty because the screen never received their values.
    await saveRazorpaySettings({ keyId: "rzp_test_abc", mode: "live", enabled: true });

    const written = lastWrite();
    expect(written).toContain("enc.v1.b2xk");
    expect(written).toContain("enc.v1.aG9vaw==");
    expect(encryptField).not.toHaveBeenCalled();
  });

  it("refuses to store credentials when encryption is unavailable", async () => {
    encryptionConfigured.mockReturnValue(false);

    await expect(
      saveRazorpaySettings({ keyId: "rzp_test_abc", keySecret: "s", mode: "test", enabled: true })
    ).rejects.toThrow(/ENCRYPTION_KEY/);

    // Nothing at all is written. Degrading to plaintext would put the ability
    // to take payments in the company's name into any database dump.
    expect(lastWrite()).toBe("");
  });

  it("refuses a first-time save with no secret", async () => {
    await expect(
      saveRazorpaySettings({ keyId: "rzp_test_abc", mode: "test", enabled: true })
    ).rejects.toThrow(/Key Secret is required/);
  });
});

describe("razorpayConfigStatus", () => {
  it("reports that the secrets exist without revealing them", async () => {
    /*
     * Distinctive values, so the assertion cannot be satisfied — or broken —
     * by a field name. An earlier version of this test looked for "hook" and
     * matched `hasWebhookSecret`, which proved nothing about leakage.
     */
    const KEY_SECRET = "zzz-key-plaintext-zzz";
    const HOOK_SECRET = "zzz-hook-plaintext-zzz";
    const enc = (v: string) => `enc.v1.${Buffer.from(v).toString("base64")}`;

    rows = [
      {
        value: {
          keyId: "rzp_test_abc",
          keySecret: enc(KEY_SECRET),
          webhookSecret: enc(HOOK_SECRET),
          mode: "test",
          enabled: true,
        },
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];

    const status = await razorpayConfigStatus();

    expect(status).toMatchObject({
      configured: true,
      source: "database",
      keyId: "rzp_test_abc",
      hasKeySecret: true,
      hasWebhookSecret: true,
    });

    // Neither the plaintext nor the stored ciphertext may reach a caller.
    const serialised = JSON.stringify(status);
    expect(serialised).not.toContain(KEY_SECRET);
    expect(serialised).not.toContain(HOOK_SECRET);
    expect(serialised).not.toContain("enc.v1.");
  });

  it("says so plainly when nothing is configured", async () => {
    const status = await razorpayConfigStatus();
    expect(status).toMatchObject({ configured: false, source: "none", keyId: null });
  });

  it("reports the environment as the source when the database is empty", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_env";
    process.env.RAZORPAY_KEY_SECRET = "env-secret";

    const status = await razorpayConfigStatus();

    // A deployment configured before this table existed keeps working, and the
    // screen says where the values are coming from rather than implying it can
    // change them.
    expect(status).toMatchObject({ configured: true, source: "environment", mode: "live" });
  });
});

describe("loadRazorpaySettings", () => {
  it("prefers the database over the environment", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_env";
    process.env.RAZORPAY_KEY_SECRET = "env-secret";
    rows = [
      {
        value: { keyId: "rzp_test_db", keySecret: "enc.v1.ZGI=", mode: "test", enabled: true },
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];

    const settings = await loadRazorpaySettings();

    expect(settings?.keyId).toBe("rzp_test_db");
    expect(settings?.keySecret).toBe("db");
  });

  it("falls back to the environment when the row was cleared", async () => {
    // `clearRazorpaySettings` writes an empty document rather than deleting the
    // row, so an empty value has to read as "not configured here".
    rows = [{ value: {}, updated_at: "2026-01-01T00:00:00Z" }];
    process.env.RAZORPAY_KEY_ID = "rzp_test_env";
    process.env.RAZORPAY_KEY_SECRET = "env-secret";

    const settings = await loadRazorpaySettings();

    expect(settings?.keyId).toBe("rzp_test_env");
  });

  it("returns nothing when neither source has credentials", async () => {
    expect(await loadRazorpaySettings()).toBeNull();
  });
});
