// ═══════════════════════════════════════════════════════════════
// R2 TENANT STORAGE — Per-organisation Cloudflare R2 bucket management
// ═══════════════════════════════════════════════════════════════
//
// Each registered client organisation gets its own dedicated R2 bucket named
// after their domain/slug (e.g. "circuvent-assets-acme-corp"). This provides:
//
//   - Physical storage isolation between tenants
//   - Granular bucket-level access control and lifecycle policies
//   - Per-tenant storage metering for billing
//   - Clean deletion path: drop the bucket, all tenant data is gone
//
// Bucket naming convention:
//   circuvent-{orgSlug}
//
// Credentials required (set in Vercel environment variables — NEVER in code):
//   CLOUDFLARE_ACCOUNT_ID      — Cloudflare account ID
//   CLOUDFLARE_R2_ACCESS_KEY   — R2 API Access Key ID
//   CLOUDFLARE_R2_SECRET_KEY   — R2 API Secret Access Key
//   CLOUDFLARE_R2_TOKEN        — Cloudflare API token with R2:Edit permission
//
// S3 endpoint:  https://<accountId>.r2.cloudflarestorage.com

const R2_BUCKET_PREFIX = "circuvent";

// Maximum slug length for bucket naming (R2 bucket names: 3-63 chars,
// lowercase alphanumeric and hyphens). We cap slugs at 48 chars to leave
// room for the prefix.
const MAX_SLUG_LENGTH = 48;

// ── Configuration ─────────────────────────────────────────────

interface R2Config {
  accountId: string;
  apiToken: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function getR2Config(): R2Config {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_R2_TOKEN;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_KEY;

  if (!accountId || !apiToken || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 credentials are not configured. Set CLOUDFLARE_ACCOUNT_ID, " +
      "CLOUDFLARE_R2_TOKEN, CLOUDFLARE_R2_ACCESS_KEY, and CLOUDFLARE_R2_SECRET_KEY " +
      "in Vercel environment variables. Never hardcode these values."
    );
  }
  return { accountId, apiToken, accessKeyId, secretAccessKey };
}

// ── Bucket name ───────────────────────────────────────────────

/**
 * Returns the deterministic R2 bucket name for an organisation.
 *
 * Uses the human-readable slug so the bucket is identifiable in the
 * Cloudflare dashboard. The slug is sanitised to conform to S3 naming
 * rules: lowercase, alphanumeric and hyphens only.
 */
export function getTenantBucketName(orgSlug: string): string {
  const safe = orgSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);

  if (!safe) {
    throw new Error(`Invalid org slug "${orgSlug}" — cannot derive a valid bucket name.`);
  }
  return `${R2_BUCKET_PREFIX}-${safe}`;
}

// ── Cloudflare API helpers ────────────────────────────────────

async function cfRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<{ success: boolean; errors: { message: string }[]; result: unknown }> {
  const cfg = getR2Config();
  const res = await fetch(
    `https://api.cloudflare.com/client/v4${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${cfg.apiToken}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }
  );
  const data = await res.json() as {
    success: boolean;
    errors: { message: string }[];
    result: unknown;
  };
  return data;
}

// ── Public API ────────────────────────────────────────────────

export interface TenantBucketInfo {
  bucketName: string;
  s3Endpoint: string;
  created: boolean;
  alreadyExisted: boolean;
}

/**
 * Provisions an R2 bucket for the given organisation.
 *
 * Idempotent: if the bucket already exists (e.g. provisioning is retried
 * after a failure), the existing bucket is returned without error.
 *
 * The bucket is created in the `auto` jurisdiction so Cloudflare picks the
 * closest data centre. Switch to `eu` for GDPR-strict customers.
 */
export async function provisionTenantBucket(
  orgSlug: string,
  opts: { jurisdiction?: "default" | "eu" | "fedramp" } = {}
): Promise<TenantBucketInfo> {
  const cfg = getR2Config();
  const bucketName = getTenantBucketName(orgSlug);
  const jurisdiction = opts.jurisdiction ?? "default";

  // Check if the bucket already exists
  const listRes = await cfRequest("GET", `/accounts/${cfg.accountId}/r2/buckets/${bucketName}`);

  if (listRes.success) {
    return {
      bucketName,
      s3Endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      created: false,
      alreadyExisted: true,
    };
  }

  // Create the bucket
  const createBody: Record<string, unknown> = { name: bucketName };
  if (jurisdiction !== "default") {
    createBody.locationHint = jurisdiction === "eu" ? "WEUR" : "FRA";
  }

  const createRes = await cfRequest(
    "POST",
    `/accounts/${cfg.accountId}/r2/buckets`,
    createBody
  );

  if (!createRes.success) {
    const errors = createRes.errors.map((e) => e.message).join("; ");
    throw new Error(`Failed to create R2 bucket "${bucketName}": ${errors}`);
  }

  console.log(`[r2-tenant] Created bucket "${bucketName}" for org "${orgSlug}"`);

  return {
    bucketName,
    s3Endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    created: true,
    alreadyExisted: false,
  };
}

/**
 * Deletes (or archives) the R2 bucket for an organisation.
 *
 * This is irreversible — all stored objects are permanently deleted.
 * Should only be called after explicit admin confirmation and after
 * the organisation has been soft-deleted and its data retention period
 * has elapsed.
 *
 * For GDPR right-to-erasure compliance, this is the clean deletion path:
 * one API call removes all files without needing to enumerate them.
 */
export async function deleteTenantBucket(orgSlug: string): Promise<void> {
  const cfg = getR2Config();
  const bucketName = getTenantBucketName(orgSlug);

  const res = await cfRequest(
    "DELETE",
    `/accounts/${cfg.accountId}/r2/buckets/${bucketName}`
  );

  if (!res.success) {
    const errors = res.errors.map((e) => e.message).join("; ");
    // A 404 means the bucket was already gone — not an error.
    if (res.errors.some((e) => e.message.includes("not found") || e.message.includes("404"))) {
      console.warn(`[r2-tenant] Bucket "${bucketName}" was already deleted or never existed.`);
      return;
    }
    throw new Error(`Failed to delete R2 bucket "${bucketName}": ${errors}`);
  }

  console.log(`[r2-tenant] Deleted bucket "${bucketName}" for org "${orgSlug}"`);
}

/**
 * Returns the S3-compatible endpoint URL for a tenant's bucket.
 *
 * Use this to construct pre-signed upload/download URLs via the AWS SDK
 * configured with the R2 credentials.
 */
export function getTenantS3Endpoint(orgSlug: string): { endpoint: string; bucketName: string } {
  const cfg = getR2Config();
  return {
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    bucketName: getTenantBucketName(orgSlug),
  };
}
