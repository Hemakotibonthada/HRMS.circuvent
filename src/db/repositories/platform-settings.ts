// ═══════════════════════════════════════════════════════════════
// PLATFORM SETTINGS
// ═══════════════════════════════════════════════════════════════
//
// Deployment-wide configuration, read and written through one place so the
// encryption of secret fields cannot be forgotten at a call site.
//
// The first occupant is the Razorpay merchant configuration. Those keys belong
// to Circuvent, not to a tenant — they are what charges every customer — so
// they are not on `organizations` next to per-company settings.
//
// ── Why this is configurable at all ──
//
// The keys were read from `process.env` and set nowhere, which meant billing
// could only ever be switched on by someone with access to the Vercel
// dashboard and a redeploy. Environment variables bind at build time, so
// rotating a compromised key meant editing a dashboard and waiting for a
// deployment — during which payments either use the old key or fail.
//
// The environment is still honoured as a fallback, because a deployment that
// already sets the variables must not stop working the moment this table
// exists.

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { decryptNullable, encryptField, encryptionConfigured } from "@/lib/crypto/field-encryption";

/** Where the Razorpay configuration lives. */
export const RAZORPAY_SETTING_KEY = "payments.razorpay";

export interface RazorpaySettings {
  /** Publishable. Reaches the browser, so it is stored in the clear. */
  keyId: string;
  /** Secret. Signs API calls and verifies payment signatures. */
  keySecret: string;
  /** Secret. Verifies webhook bodies. Separate from the key secret. */
  webhookSecret: string;
  /** Razorpay's own test/live distinction is carried in the key id, but an
      operator setting this up wants to say which they meant and be warned when
      the two disagree. */
  mode: "test" | "live";
  enabled: boolean;
}

export interface RazorpayConfigStatus {
  configured: boolean;
  /** "database" when set through the UI, "environment" when inherited from
      process.env, "none" when this deployment cannot take payments. */
  source: "database" | "environment" | "none";
  keyId: string | null;
  mode: "test" | "live" | null;
  enabled: boolean;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  updatedAt: string | null;
}

interface StoredRazorpay {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  mode?: string;
  enabled?: boolean;
}

async function readSetting(key: string): Promise<{ value: StoredRazorpay; updatedAt: string } | null> {
  // Superuser scope: this table has no org, so there is no tenant context to
  // derive row-level security from. Access is controlled by the caller — only
  // an owner or administrator reaches the actions that call this.
  return db().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.superuser = 'on'`);
    const result = await tx.execute(
      sql`SELECT value, updated_at::text AS updated_at FROM identity.platform_settings WHERE key = ${key}`
    );
    const row = (result.rows as { value: StoredRazorpay; updated_at: string }[])[0];
    return row ? { value: row.value ?? {}, updatedAt: row.updated_at } : null;
  });
}

/**
 * The live Razorpay configuration, secrets decrypted.
 *
 * Returns null when this deployment cannot take payments — which is the
 * ordinary state of a developer machine, and was the state of production
 * until somebody filled this in. Callers report that rather than throwing, so
 * plans, trials and seat limits keep working on a deployment that cannot yet
 * charge anybody.
 */
export async function loadRazorpaySettings(): Promise<RazorpaySettings | null> {
  const stored = await readSetting(RAZORPAY_SETTING_KEY);

  if (stored) {
    const keyId = (stored.value.keyId ?? "").trim();
    const keySecret = decryptNullable(stored.value.keySecret)?.trim() ?? "";
    const webhookSecret = decryptNullable(stored.value.webhookSecret)?.trim() ?? "";
    const enabled = stored.value.enabled !== false;
    if (keyId && keySecret) {
      return {
        keyId,
        keySecret,
        webhookSecret,
        mode: stored.value.mode === "live" ? "live" : "test",
        enabled,
      };
    }
  }

  // The environment, for a deployment configured before this table existed.
  const envKeyId = process.env.RAZORPAY_KEY_ID?.trim();
  const envKeySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (envKeyId && envKeySecret) {
    return {
      keyId: envKeyId,
      keySecret: envKeySecret,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "",
      // A live key is `rzp_live_…`; anything else is treated as test, which is
      // the safe direction to guess in.
      mode: envKeyId.startsWith("rzp_live_") ? "live" : "test",
      enabled: true,
    };
  }

  return null;
}

/**
 * What the settings screen shows.
 *
 * Reports whether each secret is present, never what it is. A settings page
 * that renders a key back to the browser turns every future XSS into a stolen
 * merchant account.
 */
export async function razorpayConfigStatus(): Promise<RazorpayConfigStatus> {
  const stored = await readSetting(RAZORPAY_SETTING_KEY);
  const settings = await loadRazorpaySettings();

  if (!settings) {
    return {
      configured: false,
      source: "none",
      keyId: null,
      mode: null,
      enabled: false,
      hasKeySecret: false,
      hasWebhookSecret: false,
      updatedAt: stored?.updatedAt ?? null,
    };
  }

  const fromDatabase = Boolean(stored?.value.keyId && stored?.value.keySecret);
  return {
    configured: true,
    source: fromDatabase ? "database" : "environment",
    keyId: settings.keyId,
    mode: settings.mode,
    enabled: settings.enabled,
    hasKeySecret: settings.keySecret.length > 0,
    hasWebhookSecret: settings.webhookSecret.length > 0,
    updatedAt: stored?.updatedAt ?? null,
  };
}

export interface SaveRazorpayInput {
  keyId: string;
  /** Omitted or blank leaves the stored secret untouched — the form never
      receives the current value, so an empty field means "unchanged", not
      "clear it". */
  keySecret?: string;
  webhookSecret?: string;
  mode: "test" | "live";
  enabled: boolean;
  updatedBy?: string | null;
}

/**
 * Writes the configuration, encrypting anything secret.
 *
 * Refuses when field encryption is unavailable rather than storing a merchant
 * key in plaintext. A deployment without `ENCRYPTION_KEY` is a deployment where
 * a database dump would hand over the ability to take payments in the company's
 * name, and silently degrading to plaintext is how that happens without anybody
 * deciding it.
 */
export async function saveRazorpaySettings(input: SaveRazorpayInput): Promise<void> {
  if (!encryptionConfigured()) {
    throw new Error(
      "ENCRYPTION_KEY is not set on this deployment, so payment credentials cannot be stored safely. Set it before configuring Razorpay."
    );
  }

  const keyId = input.keyId.trim();
  if (!keyId) throw new Error("A Razorpay Key ID is required.");

  const existing = await readSetting(RAZORPAY_SETTING_KEY);

  const keySecret = input.keySecret?.trim()
    ? encryptField(input.keySecret.trim())
    : (existing?.value.keySecret ?? null);
  const webhookSecret = input.webhookSecret?.trim()
    ? encryptField(input.webhookSecret.trim())
    : (existing?.value.webhookSecret ?? null);

  if (!keySecret) throw new Error("A Razorpay Key Secret is required the first time this is set up.");

  const value: StoredRazorpay = {
    keyId,
    keySecret,
    webhookSecret: webhookSecret ?? undefined,
    mode: input.mode,
    enabled: input.enabled,
  };

  await db().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.superuser = 'on'`);
    await tx.execute(
      sql`INSERT INTO identity.platform_settings (key, value, updated_at, updated_by)
          VALUES (${RAZORPAY_SETTING_KEY}, ${JSON.stringify(value)}::jsonb, now(), ${input.updatedBy ?? null}::uuid)
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = now(),
                updated_by = EXCLUDED.updated_by`
    );
  });
}

/**
 * Removes the stored configuration. The environment fallback, if any, applies
 * again.
 *
 * Written as an empty document rather than a DELETE. The application role is
 * granted SELECT, INSERT and UPDATE and deliberately not DELETE, so that no
 * code path — or SQL injection reaching this table — can make the payment
 * configuration vanish outright. An empty document is as good as absent to
 * every reader here, and leaves the audit columns behind to say who did it.
 */
export async function clearRazorpaySettings(updatedBy?: string | null): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.superuser = 'on'`);
    await tx.execute(
      sql`INSERT INTO identity.platform_settings (key, value, updated_at, updated_by)
          VALUES (${RAZORPAY_SETTING_KEY}, '{}'::jsonb, now(), ${updatedBy ?? null}::uuid)
          ON CONFLICT (key) DO UPDATE
            SET value = '{}'::jsonb,
                updated_at = now(),
                updated_by = EXCLUDED.updated_by`
    );
  });
}

/** A receipt id for an order. Short, unique, and readable in a Razorpay dashboard. */
export function receiptId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
