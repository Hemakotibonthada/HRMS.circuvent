export const DEFAULT_S3_BUCKET = "circuvent-technologies";
export const PLATFORM_CIRCUVENT_ROOT = "platform/circuvent";

export function storageBucketName(): string {
  return process.env.S3_BUCKET?.trim() || DEFAULT_S3_BUCKET;
}

export function sanitizeTenantSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 63) || "unknown"
  );
}

export function clientStorageRoot(tenantId: string): string {
  return `clients/${sanitizeTenantSegment(tenantId)}`;
}

export function clientStorageMarkerKey(tenantId: string): string {
  return `${clientStorageRoot(tenantId)}/.tenant`;
}

export function clientAppKey(tenantId: string, app: string, ...segments: string[]): string {
  return [clientStorageRoot(tenantId), app, ...segments.filter(Boolean)].join("/");
}
