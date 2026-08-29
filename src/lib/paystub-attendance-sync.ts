import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { attendanceRecords, employees } from "@/db/schema/hrms";
import { organizations } from "@/db/schema/identity";
import { PaystubSyncConfigError, PaystubSyncRequestError, resolvePaystubTenant } from "@/lib/paystub-client";

const BATCH_SIZE = 200;

export interface PaystubAttendanceSyncRecord {
  hrmsEmployeeId: string;
  attendanceDate: string;
  status: string;
  clockIn?: string;
  clockOut?: string;
  workedMinutes?: number;
  leaveTypeCode?: string;
  notes?: string;
  hrmsRecordId: string;
}

export interface PaystubAttendanceSyncBody {
  orgId: string;
  records: PaystubAttendanceSyncRecord[];
}

export interface PaystubAttendanceSyncResult {
  written: number;
  skipped: number;
  errors: string[];
}

export interface AttendanceRangeSyncResult {
  orgId: string;
  from: string;
  to: string;
  pushed: number;
  skipped: number;
  errors: string[];
}

function attendanceSyncUrl(): string {
  const explicit = process.env.PAYSTUB_SYNC_ATTENDANCE_URL?.trim();
  if (explicit) return explicit;

  const employeeUrl = process.env.PAYSTUB_SYNC_URL?.trim();
  if (!employeeUrl) {
    throw new PaystubSyncConfigError(
      "PAYSTUB_SYNC_URL is not configured; refusing to push attendance to Paystub without explicit sync configuration."
    );
  }
  if (employeeUrl.endsWith("/employees")) {
    return employeeUrl.replace(/\/employees$/, "/attendance");
  }
  return employeeUrl.replace(/\/?$/, "/attendance");
}

function requiredToken(): string {
  const token = process.env.CROSS_APP_SYNC_TOKEN?.trim();
  if (!token) {
    throw new PaystubSyncConfigError(
      "CROSS_APP_SYNC_TOKEN is not configured; refusing to push attendance to Paystub without explicit sync configuration."
    );
  }
  return token;
}

export async function pushAttendanceBatchToPaystub(
  body: PaystubAttendanceSyncBody,
  fetchImpl: typeof fetch = fetch
): Promise<PaystubAttendanceSyncResult> {
  const response = await fetchImpl(attendanceSyncUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Token": requiredToken(),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new PaystubSyncRequestError(
      `Paystub attendance sync failed with HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
      response.status
    );
  }

  try {
    return JSON.parse(text) as PaystubAttendanceSyncResult;
  } catch {
    throw new PaystubSyncRequestError(
      `Paystub attendance sync returned non-JSON (HTTP ${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
      response.status
    );
  }
}

export async function syncAttendanceRangeToPaystub(
  ctx: TenantContext,
  range: { from: string; to: string },
  fetchImpl: typeof fetch = fetch
): Promise<AttendanceRangeSyncResult> {
  const tenant = resolvePaystubTenant(ctx.orgId);
  const result: AttendanceRangeSyncResult = {
    orgId: ctx.orgId,
    from: range.from,
    to: range.to,
    pushed: 0,
    skipped: 0,
    errors: [],
  };

  let page = 1;
  for (;;) {
    const batch = await withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({
          id: attendanceRecords.id,
          employeeId: attendanceRecords.employeeId,
          workDate: attendanceRecords.workDate,
          status: attendanceRecords.status,
          clockInAt: attendanceRecords.clockInAt,
          clockOutAt: attendanceRecords.clockOutAt,
          workedMinutes: attendanceRecords.workedMinutes,
          notes: attendanceRecords.notes,
          hrmsEmployeeId: employees.id,
        })
        .from(attendanceRecords)
        .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
        .where(
          and(
            eq(attendanceRecords.orgId, ctx.orgId),
            gte(attendanceRecords.workDate, range.from),
            lte(attendanceRecords.workDate, range.to),
            isNull(employees.deletedAt)
          )
        )
        .orderBy(asc(attendanceRecords.workDate), asc(attendanceRecords.employeeId))
        .limit(BATCH_SIZE)
        .offset((page - 1) * BATCH_SIZE);

      return rows.map(
        (row): PaystubAttendanceSyncRecord => ({
          hrmsEmployeeId: row.hrmsEmployeeId,
          attendanceDate: row.workDate,
          status: row.status,
          clockIn: row.clockInAt?.toISOString(),
          clockOut: row.clockOutAt?.toISOString(),
          workedMinutes: row.workedMinutes ?? undefined,
          notes: row.notes ?? undefined,
          hrmsRecordId: row.id,
        })
      );
    });

    if (batch.length === 0) break;

    const response = await pushAttendanceBatchToPaystub(
      { orgId: tenant.orgId, records: batch },
      fetchImpl
    );
    result.pushed += response.written;
    result.skipped += response.skipped;
    result.errors.push(...response.errors);

    if (batch.length < BATCH_SIZE) break;
    page += 1;
  }

  return result;
}

async function activeOrgsWithTimezone(): Promise<{ id: string; timezone: string }[]> {
  return withTenant({ orgId: "", superuser: true }, async (tx) =>
    tx
      .select({ id: organizations.id, timezone: organizations.timezone })
      .from(organizations)
      .where(sql`${organizations.deletedAt} is null`)
  );
}

/** First day of the calendar month containing `isoDate`, in YYYY-MM-DD form. */
export function monthStartFromIsoDate(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export interface AllOrgsAttendanceSyncResult {
  organisations: number;
  synced: number;
  results: AttendanceRangeSyncResult[];
  totals: { pushed: number; skipped: number };
  problems: string[];
}

/**
 * Pushes each organisation's attendance for the current calendar month through
 * today. Called from the daily cron after device attendance is reconciled.
 */
export async function syncAttendanceToPaystubForAllOrgs(
  deps: {
    listOrgs?: () => Promise<{ id: string; timezone: string }[]>;
    syncOrg?: (
      ctx: TenantContext,
      range: { from: string; to: string }
    ) => Promise<AttendanceRangeSyncResult>;
  } = {}
): Promise<AllOrgsAttendanceSyncResult> {
  const result: AllOrgsAttendanceSyncResult = {
    organisations: 0,
    synced: 0,
    results: [],
    totals: { pushed: 0, skipped: 0 },
    problems: [],
  };

  if (!process.env.PAYSTUB_SYNC_URL?.trim() && !process.env.PAYSTUB_SYNC_ATTENDANCE_URL?.trim()) {
    return result;
  }
  if (!process.env.CROSS_APP_SYNC_TOKEN?.trim()) {
    return result;
  }

  const listOrgs = deps.listOrgs ?? activeOrgsWithTimezone;
  const syncOrg = deps.syncOrg ?? syncAttendanceRangeToPaystub;

  let orgs: { id: string; timezone: string }[];
  try {
    orgs = await listOrgs();
  } catch (error) {
    result.problems.push(
      `Could not list organisations: ${error instanceof Error ? error.message : String(error)}`
    );
    return result;
  }

  result.organisations = orgs.length;

  for (const org of orgs) {
    try {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: org.timezone }).format(new Date());
      const from = monthStartFromIsoDate(today);
      const summary = await syncOrg({ orgId: org.id }, { from, to: today });
      result.results.push(summary);
      result.synced += 1;
      result.totals.pushed += summary.pushed;
      result.totals.skipped += summary.skipped;
      if (summary.errors.length > 0) {
        result.problems.push(`${org.id}: ${summary.errors.slice(0, 3).join(" · ")}`);
      }
    } catch (error) {
      result.problems.push(
        `${org.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return result;
}
