import type { employees } from "@/db/schema/hrms";

type EmployeeRow = typeof employees.$inferSelect;

/**
 * An employee plus the two things Paystub needs that do not live on the row.
 *
 * `department_id` and `location_id` are foreign keys into HRMS's own tables;
 * Paystub cannot use either, so the caller resolves them to a code and a name
 * first. Both are optional because an employee genuinely may have neither.
 */
export interface PaystubSyncSource {
  employee: EmployeeRow;
  department?: { code: string; name: string } | null;
  location?: { code: string; name: string } | null;
}

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
  /**
   * Department and work location travel as a code and a name, never as an id.
   *
   * HRMS and Paystub each keep their own `departments` and `locations` tables
   * with their own primary keys, and Paystub's employee rows carry a foreign
   * key into its own. Sending an HRMS uuid would either dangle or be rejected
   * outright — which is exactly what the previous contract did: it declared
   * `departmentId` and `locationId`, the receiving end validated them as
   * UUIDs, and no HRMS employee could ever have been given a department
   * through it. A code is the identifier the two systems can genuinely share.
   */
  departmentCode?: string;
  departmentName?: string;
  locationCode?: string;
  locationName?: string;
  /**
   * PAN, UAN, PF and ESI numbers.
   *
   * These are facts about the person, collected once at onboarding, not
   * payroll configuration — and an Indian payslip is required to carry them.
   * HRMS is where they are captured, so HRMS is what sends them; Paystub had
   * no other way to learn them and was printing an em dash in their place.
   */
  statutoryIds?: Partial<Record<"pan" | "uan" | "pf_number" | "esi_number", string>>;
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

/**
 * The statutory identifiers HRMS holds, dropping the ones it does not.
 *
 * A masked value ("XXXXXX740A") is passed through as it stands: HRMS masks on
 * capture, so the masked form is the only form it has, and a payslip showing a
 * masked PAN is right where showing nothing is wrong.
 */
function mapStatutoryIds(row: EmployeeRow): PaystubEmployeeSyncBody["statutoryIds"] | undefined {
  const ids = {
    pan: row.panNumber ?? undefined,
    uan: row.uanNumber ?? undefined,
    pf_number: row.pfNumber ?? undefined,
    esi_number: row.esiNumber ?? undefined,
  };
  const present = Object.fromEntries(Object.entries(ids).filter(([, value]) => value));
  return Object.keys(present).length > 0 ? present : undefined;
}

export function employeeToPaystubSyncBody(
  source: PaystubSyncSource,
  mapping?: PaystubTenantMapping
): PaystubEmployeeSyncBody {
  const row = source.employee;
  const tenant = mapping ?? resolvePaystubTenant(row.orgId);

  const body: PaystubEmployeeSyncBody = {
    orgId: tenant.orgId,
    entityId: tenant.entityId,
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

  if (source.department) {
    body.departmentCode = source.department.code;
    body.departmentName = source.department.name;
  }
  if (source.location) {
    body.locationCode = source.location.code;
    body.locationName = source.location.name;
  }
  const statutoryIds = mapStatutoryIds(row);
  if (statutoryIds) body.statutoryIds = statutoryIds;

  return body;
}

export async function pushEmployeeToPaystub(
  source: PaystubSyncSource,
  fetchImpl: typeof fetch = fetch
): Promise<PaystubEmployeeSyncResult> {
  const url = requiredEnv("PAYSTUB_SYNC_URL");
  const token = requiredEnv("CROSS_APP_SYNC_TOKEN");
  const body = employeeToPaystubSyncBody(source);

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
