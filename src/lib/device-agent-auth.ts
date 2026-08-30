// ═══════════════════════════════════════════════════════════════
// DEVICE AGENT AUTH — enroll tokens and per-device API keys
// ═══════════════════════════════════════════════════════════════
// Endpoint agents have no browser session. They present either a one-time
// enroll token (first run) or a device API key (heartbeat thereafter).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import {
  deviceAgentKeys,
  deviceEnrollTokens,
} from "@/db/schema/device-portal";
import { deviceSecurityPolicies } from "@/db/schema/security-incidents";
import { employees } from "@/db/schema/hrms";

export const DEVICE_KEY_PREFIX = "cv365_dev_";

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateEnrollToken(): { token: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  const token = `cv365_enroll_${secret}`;
  const prefix = secret.slice(0, 8);
  return { token, prefix, hash: hashSecret(token) };
}

export function generateDeviceAgentKey(): { key: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  const prefix = secret.slice(0, 8);
  const key = `${DEVICE_KEY_PREFIX}${prefix}_${secret}`;
  return { key, prefix, hash: hashSecret(key) };
}

export async function mintEnrollToken(input: {
  orgId: string;
  employeeEmail: string;
  employeeCode?: string | null;
  employeeId?: string | null;
  createdBy?: string | null;
  ttlMinutes?: number;
}): Promise<{ token: string; expiresAt: Date }> {
  const { token, prefix, hash } = generateEnrollToken();
  const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? 60) * 60_000);

  await db().insert(deviceEnrollTokens).values({
    orgId: input.orgId,
    employeeId: input.employeeId ?? null,
    employeeEmail: input.employeeEmail.toLowerCase(),
    employeeCode: input.employeeCode?.toUpperCase() ?? null,
    tokenHash: hash,
    tokenPrefix: prefix,
    expiresAt,
    createdBy: input.createdBy ?? null,
  });

  return { token, expiresAt };
}

export interface EnrollTokenClaims {
  orgId: string;
  employeeId: string | null;
  employeeEmail: string;
  employeeCode: string | null;
  tokenId: string;
}

export async function consumeEnrollToken(token: string): Promise<EnrollTokenClaims | null> {
  const hash = hashSecret(token.trim());
  const row = await db().query.deviceEnrollTokens.findFirst({
    where: and(
      eq(deviceEnrollTokens.tokenHash, hash),
      isNull(deviceEnrollTokens.usedAt),
      gt(deviceEnrollTokens.expiresAt, new Date())
    ),
  });
  if (!row) return null;

  await db()
    .update(deviceEnrollTokens)
    .set({ usedAt: new Date() })
    .where(eq(deviceEnrollTokens.id, row.id));

  return {
    orgId: row.orgId,
    employeeId: row.employeeId,
    employeeEmail: row.employeeEmail,
    employeeCode: row.employeeCode,
    tokenId: row.id,
  };
}

export interface DeviceAgentContext {
  orgId: string;
  deviceId: string | null;
  deviceHostname: string;
  keyId: string;
}

export async function resolveDeviceAgentKey(
  headerValue: string | null
): Promise<DeviceAgentContext | null> {
  const raw = (headerValue ?? "").trim();
  if (!raw.startsWith(DEVICE_KEY_PREFIX)) return null;

  const rest = raw.slice(DEVICE_KEY_PREFIX.length);
  const underscore = rest.indexOf("_");
  if (underscore < 1) return null;

  const prefix = rest.slice(0, underscore);
  const row = await db().query.deviceAgentKeys.findFirst({
    where: and(eq(deviceAgentKeys.keyPrefix, prefix), isNull(deviceAgentKeys.revokedAt)),
  });
  if (!row) return null;

  const expected = Buffer.from(row.keyHash, "hex");
  const actual = Buffer.from(hashSecret(raw), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  await db()
    .update(deviceAgentKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(deviceAgentKeys.id, row.id));

  return {
    orgId: row.orgId,
    deviceId: row.deviceId,
    deviceHostname: row.deviceHostname,
    keyId: row.id,
  };
}

export async function issueDeviceAgentKey(input: {
  orgId: string;
  deviceId: string;
  deviceHostname: string;
}): Promise<string> {
  const { key, prefix, hash } = generateDeviceAgentKey();
  await db().insert(deviceAgentKeys).values({
    orgId: input.orgId,
    deviceId: input.deviceId,
    deviceHostname: input.deviceHostname.toUpperCase(),
    keyHash: hash,
    keyPrefix: prefix,
  });
  return key;
}

export function enrollTokenFromRequest(req: Request): string | null {
  const header = req.headers.get("x-device-enroll-token");
  if (header?.trim()) return header.trim();
  return null;
}

export function deviceKeyFromRequest(req: Request): string | null {
  const header = req.headers.get("x-device-agent-key") ?? req.headers.get("x-api-key");
  if (header?.trim()) return header.trim();
  return null;
}

export async function employeeForPortalUser(input: {
  orgId: string;
  email: string;
}): Promise<{ id: string; employeeCode: string | null; workEmail: string } | null> {
  const row = await db().query.employees.findFirst({
    where: and(
      eq(employees.orgId, input.orgId),
      eq(employees.workEmail, input.email.toLowerCase())
    ),
    columns: { id: true, employeeCode: true, workEmail: true },
  });
  return row ?? null;
}

export async function devicePolicyByHostname(hostname: string) {
  return db().query.deviceSecurityPolicies.findFirst({
    where: eq(deviceSecurityPolicies.deviceHostname, hostname.toUpperCase().trim()),
  });
}
