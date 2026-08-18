import type { employees } from "@/db/schema/hrms";

type EmployeeRow = typeof employees.$inferSelect;

export interface PaystubTenantMapping {
  orgId: string;
  entityId: string;
}

export interface PaystubEmployeeSyncBody {
  orgId: string;
  entityId: string;
  hrmsEmployeeId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  designation: string;
  joinDate: string;
  personalEmail?: string;
  phone?: string;
  avatarUrl?: string;
  gender?: "male" | "female" | "other" | "prefer_not_to_say";
  dateOfBirth?: string;
  maritalStatus?: string;
  address?: Record<string, string>;
  employmentType?: "full_time" | "part_time" | "contract" | "intern" | "consultant";
  exitDate?: string;
  exitReason?: string;
}

export interface PaystubEmployeeSyncResult {
  created: boolean;
  employee: { id: string };
}

export class PaystubSyncConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaystubSyncConfigError";
  }
}

export class PaystubSyncRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "PaystubSyncRequestError";
  }
}

function requiredEnv(name: "PAYSTUB_SYNC_URL" | "CROSS_APP_SYNC_TOKEN"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new PaystubSyncConfigError(
      `${name} is not configured; refusing to push employees to Paystub without explicit sync configuration.`
    );
  }
  return value;
}

export function paystubTenantMapFromEnv(): Record<string, PaystubTenantMapping> {
  const raw = process.env.PAYSTUB_SYNC_TENANT_MAP?.trim();
  if (!raw) {
    throw new PaystubSyncConfigError(
      "PAYSTUB_SYNC_TENANT_MAP is not configured. Map each HRMS organisation id to Paystub's orgId and entityId."
    );
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PaystubSyncConfigError("PAYSTUB_SYNC_TENANT_MAP must be a JSON object keyed by HRMS organisation id.");
  }

  const map: Record<string, PaystubTenantMapping> = {};
  for (const [hrmsOrgId, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new PaystubSyncConfigError(`PAYSTUB_SYNC_TENANT_MAP entry for ${hrmsOrgId} must contain orgId and entityId.`);
    }
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.orgId !== "string" || typeof candidate.entityId !== "string") {
      throw new PaystubSyncConfigError(`PAYSTUB_SYNC_TENANT_MAP entry for ${hrmsOrgId} must contain string orgId and entityId.`);
    }
    map[hrmsOrgId] = { orgId: candidate.orgId, entityId: candidate.entityId };
  }
  return map;
}

export function resolvePaystubTenant(
  hrmsOrgId: string,
  map: Record<string, PaystubTenantMapping> = paystubTenantMapFromEnv()
): PaystubTenantMapping {
  const mapping = map[hrmsOrgId];
  if (!mapping?.orgId) {
    throw new PaystubSyncConfigError(`No Paystub orgId mapping exists for HRMS organisation ${hrmsOrgId}.`);
  }
  if (!mapping.entityId) {
    throw new PaystubSyncConfigError(`No Paystub entityId mapping exists for HRMS organisation ${hrmsOrgId}.`);
  }
  return mapping;
}

function mapEmploymentType(value: string): PaystubEmployeeSyncBody["employmentType"] {
  switch (value) {
    case "full_time":
    case "part_time":
    case "contract":
    case "intern":
      return value;
    case "freelance":
      return "consultant";
    default:
      return undefined;
  }
}

function mapAddress(row: EmployeeRow): Record<string, string> | undefined {
  const address = {
    line1: row.addressLine1 ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    country: row.country ?? undefined,
    postalCode: row.postalCode ?? undefined,
  };

  return Object.fromEntries(Object.entries(address).filter(([, value]) => value)) as
    | Record<string, string>
    | undefined;
}

export function employeeToPaystubSyncBody(
  row: EmployeeRow,
  mapping: PaystubTenantMapping = resolvePaystubTenant(row.orgId)
): PaystubEmployeeSyncBody {
  const body: PaystubEmployeeSyncBody = {
    orgId: mapping.orgId,
    entityId: mapping.entityId,
    hrmsEmployeeId: row.id,
    employeeCode: row.employeeCode,
    firstName: row.firstName,
    lastName: row.lastName,
    workEmail: row.workEmail,
    designation: row.designation,
    joinDate: row.joinDate,
  };

  if (row.personalEmail) body.personalEmail = row.personalEmail;
  if (row.phone) body.phone = row.phone;
  if (row.avatarUrl) body.avatarUrl = row.avatarUrl;
  if (row.gender) body.gender = row.gender;
  if (row.dateOfBirth) body.dateOfBirth = row.dateOfBirth;
  if (row.maritalStatus) body.maritalStatus = row.maritalStatus;
  const address = mapAddress(row);
  if (address && Object.keys(address).length > 0) body.address = address;
  const employmentType = mapEmploymentType(row.employmentType);
  if (employmentType) body.employmentType = employmentType;
  if (row.exitDate) body.exitDate = row.exitDate;
  if (row.exitReason) body.exitReason = row.exitReason;

  return body;
}

export async function pushEmployeeToPaystub(
  row: EmployeeRow,
  fetchImpl: typeof fetch = fetch
): Promise<PaystubEmployeeSyncResult> {
  const url = requiredEnv("PAYSTUB_SYNC_URL");
  const token = requiredEnv("CROSS_APP_SYNC_TOKEN");
  const body = employeeToPaystubSyncBody(row);

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Token": token,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new PaystubSyncRequestError(
      `Paystub employee sync failed with HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
      response.status
    );
  }

  return (await response.json()) as PaystubEmployeeSyncResult;
}
