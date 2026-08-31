// ═══════════════════════════════════════════════════════════════
// R2 TENANT STORAGE — Per-client folders in the shared bucket
// ═══════════════════════════════════════════════════════════════
//
// All Circuvent clients share one R2 bucket (display name: Circuvent
// Technologies, bucket name: circuvent-technologies). Each registered
// organisation gets a dedicated prefix:
//
//   clients/{orgSlug}/hrms/...
//   clients/{orgSlug}/cv365/...
//
// Physical isolation is by prefix and access rules, not separate buckets.

import { putObject } from "@/lib/storage/object-store";
import {
  clientStorageMarkerKey,
  clientStorageRoot,
  storageBucketName,
} from "@/lib/storage-layout";

const MAX_SLUG_LENGTH = 48;

export interface TenantBucketInfo {
  bucketName: string;
  storagePrefix: string;
  s3Endpoint: string;
  created: boolean;
  alreadyExisted: boolean;
}

function sanitizeSlug(orgSlug: string): string {
  const safe = orgSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);

  if (!safe) {
    throw new Error(`Invalid org slug "${orgSlug}" — cannot derive a storage prefix.`);
  }
  return safe;
}

/** @deprecated Use {@link getTenantStoragePrefix} — kept for API compatibility. */
export function getTenantBucketName(orgSlug: string): string {
  void orgSlug;
  return storageBucketName();
}

export function getTenantStoragePrefix(orgSlug: string): string {
  return clientStorageRoot(sanitizeSlug(orgSlug));
}

/**
 * Reserves a client folder inside the shared Circuvent Technologies bucket.
 *
 * Idempotent: writes a marker object at `clients/{slug}/.tenant`.
 */
export async function provisionTenantBucket(
  orgSlug: string,
  _opts: { jurisdiction?: "default" | "eu" | "fedramp" } = {}
): Promise<TenantBucketInfo> {
  void _opts;
  const bucketName = storageBucketName();
  const storagePrefix = getTenantStoragePrefix(orgSlug);
  const endpoint = process.env.S3_ENDPOINT?.trim() ?? "";

  const markerKey = clientStorageMarkerKey(sanitizeSlug(orgSlug));
  const body = new TextEncoder().encode(
    JSON.stringify({ orgSlug, provisionedAt: new Date().toISOString() })
  );

  try {
    await putObject(markerKey, body, "application/json");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to provision storage for "${orgSlug}": ${message}`);
  }

  console.log(`[r2-tenant] Provisioned prefix "${storagePrefix}" in bucket "${bucketName}"`);

  return {
    bucketName,
    storagePrefix,
    s3Endpoint: endpoint,
    created: true,
    alreadyExisted: false,
  };
}

/**
 * Deletes a client prefix marker. Object deletion under the prefix is a
 * separate retention/GDPR job — listing and deleting thousands of keys is
 * not done inline here.
 */
export async function deleteTenantBucket(orgSlug: string): Promise<void> {
  const { deleteObject } = await import("@/lib/storage/object-store");
  const markerKey = clientStorageMarkerKey(sanitizeSlug(orgSlug));
  await deleteObject(markerKey);
  console.log(`[r2-tenant] Removed storage marker for org "${orgSlug}"`);
}

export function getTenantS3Endpoint(orgSlug: string): { endpoint: string; bucketName: string } {
  return {
    endpoint: process.env.S3_ENDPOINT?.trim() ?? "",
    bucketName: getTenantBucketName(orgSlug),
  };
}
