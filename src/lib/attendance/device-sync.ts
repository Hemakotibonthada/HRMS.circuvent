// ═══════════════════════════════════════════════════════════════
// DEVICE ATTENDANCE SYNC — reconciling the terminal's register with HRMS
// ═══════════════════════════════════════════════════════════════
// HRMS already has a complete attendance model (`attendanceRecords`,
// `attendanceRegularisations`, `leaveRequests`, `holidays`) and a UI built on
// it, but until now nothing ever populated it from the badge/RFID terminals
// the company actually runs — every record had to be typed in or clocked
// through the app itself. This module is that missing write path: it reads a
// site's daily register from the device control plane
// (`@/lib/attendance/device-client`) and turns it into `attendanceRecords`
// rows, without ever overwriting something a human already fixed by hand.
//
// The mapping from a device register to attendance rows is a pure function,
// `mapDeviceRegisterToAttendance` — no database, no HTTP, just data in and
// data out — because the decisions it makes (is this badge somebody's,
// should this status be trusted, is a missing row really an absence) are the
// part of this integration actually worth testing hard, and none of that
// reasoning needs a Postgres connection to verify.
//
// Everything below the pure function is the orchestration that gets it real
// data: `syncDeviceAttendanceForOrg` runs it for one organisation and date
// range and performs the upsert, and `syncDeviceAttendanceForAllOrgs` is what
// the daily cron calls to run it for every organisation that has the
// integration configured.

import { and, eq, gte, lte, notInArray, sql } from "drizzle-orm";

import { withTenant, type TenantContext } from "@/db/client";
import {
  attendanceRecords,
  attendanceRegularisations,
  attendanceStatusEnum,
  employees,
  holidays,
  leaveRequests,
} from "@/db/schema/hrms";
import { organizations } from "@/db/schema/identity";
import {
  deviceConfigured,
  fetchRegister as fetchRegisterFromDevice,
  type RegisterRow,
} from "@/lib/attendance/device-client";

export type AttendanceStatus = (typeof attendanceStatusEnum.enumValues)[number];

// ─── The pure mapping ─────────────────────────────────────────

/**
 * Device status → HRMS status.
 *
 * `attendance_status` has no "unknown": every value in it asserts that
 * something specific was observed (present, late, a half day, leave, a
 * holiday, a weekend). The device's "unknown" asserts the opposite — that the
 * terminal could not tell — so a row with it is never forced into one of
 * these seven values; see `mapDeviceRegisterToAttendance`, which reports it
 * instead of writing anything. This table is only consulted for a status
 * this codebase already has an honest equivalent for.
 *
 * There is deliberately no entry for "wfh": no device status maps to it, and
 * guessing that an absent-from-the-terminal day was worked from home would be
 * inventing a fact the terminal never reported.
 */
const STATUS_MAP: Partial<Record<string, AttendanceStatus>> = {
  present: "present",
  late: "late",
  absent: "absent",
  half: "half_day",
  leave: "on_leave",
  holiday: "holiday",
  weekend: "weekend",
};

/** The employee shape the pure function needs — nothing else. */
export interface DeviceSyncEmployee {
  id: string;
  employeeCode: string;
}

export interface DeviceSyncInput {
  /** `YYYY-MM-DD`. The register and every output row belong to this one day. */
  day: string;
  rows: RegisterRow[];
  /**
   * Candidate employees to match against. Callers are expected to have
   * already excluded terminated/inactive/deleted employees — see
   * `syncDeviceAttendanceForOrg` for why that filtering happens before this
   * function ever sees the list, not inside it.
   */
  employees: DeviceSyncEmployee[];
  /** Whether `day` is a non-optional organisation holiday. */
  isHoliday: boolean;
  /** Employees with an approved leave request covering `day`. */
  employeeIdsOnApprovedLeave: ReadonlySet<string>;
  /**
   * Employees whose `day` record must be left alone — already regularised by
   * HR, either through `attendanceRecords.isRegularized` or an approved
   * `attendanceRegularisations` row. See `syncDeviceAttendanceForOrg` for how
   * this set is built; this function only needs to know it must not touch
   * these employee/day pairs.
   */
  protectedEmployeeIds: ReadonlySet<string>;
}

export interface AttendanceUpsert {
  employeeId: string;
  employeeCode: string;
  workDate: string;
  status: AttendanceStatus;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  workedMinutes: number | null;
  lateByMinutes: number;
  earlyLeaveByMinutes: number;
  notes: string;
}

/** A device row that did not resolve to any employee — reported, never dropped. */
export interface UnmatchedDeviceRow {
  code: string;
  name: string;
  personId: number;
  status: string;
}

/** A matched row whose device status has no honest HRMS equivalent. */
export interface UnmappedStatusRow {
  employeeId: string;
  employeeCode: string;
  deviceStatus: string;
}

/** A matched row that was not written because HR had already regularised that day. */
export interface ProtectedSkip {
  employeeId: string;
  employeeCode: string;
}

/** An employee with no device row for `day`, and the best honest explanation available for why. */
export interface NoDeviceData {
  employeeId: string;
  employeeCode: string;
  reason: "holiday" | "approved_leave" | "no_terminal_data";
}

export interface DeviceSyncMapping {
  toWrite: AttendanceUpsert[];
  unmatched: UnmatchedDeviceRow[];
  unmappedStatus: UnmappedStatusRow[];
  skippedProtected: ProtectedSkip[];
  noData: NoDeviceData[];
}

/**
 * A badge code and an employee code refer to the same person whether or not
 * somebody typed a stray space or the wrong case into either system — a
 * terminal keypad and an HR onboarding form are not the same input method,
 * and treating "cv-001" and " CV-001 " as different badges would turn a
 * keying slip into a false "unmatched" report that sends somebody hunting for
 * a badge that was never actually lost.
 */
function normaliseCode(code: string): string {
  return code.trim().toLowerCase();
}

function parseDeviceTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function buildUpsert(day: string, employee: DeviceSyncEmployee, row: RegisterRow, status: AttendanceStatus): AttendanceUpsert {
  // `assumedOut` means the terminal itself never read an exit punch and
  // filled in a guess (a `lastOut`, a `workedMinutes`, or both) rather than
  // leave the row incomplete. Whether or not it bothered to fill in
  // `lastOut`, the honesty problem is identical: a guessed exit is not an
  // observed one, and `clockOutAt - clockInAt` against a guess would report
  // the device's assumption as a measured worked duration. So both are
  // dropped to null here regardless of what the device sent, and the
  // device's own numbers are preserved as a caveat in `notes` instead of
  // silently vanishing.
  const clockInAt = parseDeviceTimestamp(row.firstIn);
  const clockOutAt = row.assumedOut ? null : parseDeviceTimestamp(row.lastOut);
  const workedMinutes = row.assumedOut ? null : finiteOrNull(row.workedMinutes);

  const noteParts: string[] = ["Imported from the attendance device terminal."];
  if (row.manual) {
    noteParts.push("The terminal logged this as a manual entry rather than a badge read.");
  }
  if (row.note.trim()) {
    noteParts.push(`Terminal note: ${row.note.trim()}`);
  }
  if (row.assumedOut) {
    noteParts.push(
      `No checkout punch was read. The terminal assumed an exit` +
        (Number.isFinite(row.workedMinutes) ? ` and reported ${row.workedMinutes} worked minute(s) on that assumption` : "") +
        `; that figure is not carried into this record because an assumed exit is not an observed one.`
    );
  }

  return {
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    workDate: day,
    status,
    clockInAt,
    clockOutAt,
    workedMinutes,
    lateByMinutes: Math.max(0, Math.round(row.lateMinutes || 0)),
    earlyLeaveByMinutes: Math.max(0, Math.round(row.earlyMinutes || 0)),
    notes: noteParts.join(" "),
  };
}

/**
 * Turns one day's device register into the attendance rows HRMS should have,
 * with no side effects and no knowledge of Postgres. Every device row is
 * accounted for in exactly one of `toWrite`, `unmatched`, `unmappedStatus` or
 * `skippedProtected`, and every candidate employee not covered by a written
 * row is accounted for in `noData` — nothing is silently ignored.
 */
export function mapDeviceRegisterToAttendance(input: DeviceSyncInput): DeviceSyncMapping {
  const byCode = new Map<string, DeviceSyncEmployee>();
  for (const employee of input.employees) {
    byCode.set(normaliseCode(employee.employeeCode), employee);
  }

  const toWrite: AttendanceUpsert[] = [];
  const unmatched: UnmatchedDeviceRow[] = [];
  const unmappedStatus: UnmappedStatusRow[] = [];
  const skippedProtected: ProtectedSkip[] = [];
  const matchedEmployeeIds = new Set<string>();

  for (const row of input.rows) {
    const employee = byCode.get(normaliseCode(row.code));
    if (!employee) {
      // Reported, never dropped: a code nobody recognises is either a new
      // joiner nobody has entered into HRMS yet, or a badge that should have
      // been revoked when somebody left. Both need a human, and silently
      // skipping the row would hide exactly the case this integration exists
      // to surface.
      unmatched.push({ code: row.code, name: row.name, personId: row.personId, status: row.status });
      continue;
    }

    matchedEmployeeIds.add(employee.id);

    if (input.protectedEmployeeIds.has(employee.id)) {
      // Somebody at HR already corrected this employee's `day` by hand.
      // Rewriting it with what the terminal saw would silently overwrite a
      // human decision with the very machine reading that decision existed
      // to override — see `syncDeviceAttendanceForOrg` for what "already
      // corrected" means precisely.
      skippedProtected.push({ employeeId: employee.id, employeeCode: employee.employeeCode });
      continue;
    }

    const mappedStatus = STATUS_MAP[row.status];
    if (!mappedStatus) {
      // The device's own uncertainty ("unknown", or any status this mapping
      // has not been taught) is preserved by writing nothing, rather than
      // guessing "absent" or "present" and asserting a fact nobody actually
      // observed.
      unmappedStatus.push({ employeeId: employee.id, employeeCode: employee.employeeCode, deviceStatus: row.status });
      continue;
    }

    toWrite.push(buildUpsert(input.day, employee, row, mappedStatus));
  }

  const noData: NoDeviceData[] = [];
  for (const employee of input.employees) {
    if (matchedEmployeeIds.has(employee.id)) continue;

    // No row at all is not the same as the device reporting "absent" — a row
    // that says absent is the terminal's own determination, honoured above.
    // An employee missing from the register entirely might be on approved
    // leave, might be excused by a holiday the terminal has no notion of, or
    // the terminal could simply have been offline that day. Asserting absence
    // from silence would invent an observation nobody at the terminal made,
    // so this reports which of the three explanations fits instead of ever
    // writing "absent" here.
    if (input.isHoliday) {
      noData.push({ employeeId: employee.id, employeeCode: employee.employeeCode, reason: "holiday" });
    } else if (input.employeeIdsOnApprovedLeave.has(employee.id)) {
      noData.push({ employeeId: employee.id, employeeCode: employee.employeeCode, reason: "approved_leave" });
    } else {
      noData.push({ employeeId: employee.id, employeeCode: employee.employeeCode, reason: "no_terminal_data" });
    }
  }

  return { toWrite, unmatched, unmappedStatus, skippedProtected, noData };
}

// ─── Calendar helpers ─────────────────────────────────────────

/** `YYYY-MM-DD` for `at`, read in `timeZone` — the device runs on wall-clock days, not UTC ones. */
export function isoDateInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
}

/**
 * Calendar-day arithmetic on the `YYYY-MM-DD` string itself, done at noon UTC
 * rather than midnight, so a day's own DST transition (which happens at a
 * local hour, never at noon) can never shift the date the answer lands on.
 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every `YYYY-MM-DD` from `from` to `to` inclusive. Empty, not infinite, when `from` is after `to`. */
export function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** One request per day in the range, each up to the device client's own 5s timeout — bounded so a fat-fingered range cannot run out a serverless function's execution budget. */
const MAX_SYNC_DAYS = 31;

// ─── Per-organisation sync ────────────────────────────────────

export interface DaySyncResult {
  day: string;
  matched: number;
  written: number;
  skippedProtected: number;
  unmatched: UnmatchedDeviceRow[];
  unmappedStatus: UnmappedStatusRow[];
  noData: NoDeviceData[];
  error?: string;
}

export interface DeviceSyncSummary {
  siteId: number;
  from: string;
  to: string;
  days: DaySyncResult[];
  totals: {
    matched: number;
    written: number;
    skipped: number;
    unmatchedCodes: string[];
  };
  errors: string[];
}

function emptySummary(siteId: number, from: string, to: string): DeviceSyncSummary {
  return {
    siteId,
    from,
    to,
    days: [],
    totals: { matched: 0, written: 0, skipped: 0, unmatchedCodes: [] },
    errors: [],
  };
}

/**
 * Fetches, maps and writes one organisation's device attendance for every day
 * in `[from, to]`. This is the one function that touches both the device
 * client and the database; the decisions about what to write live in
 * `mapDeviceRegisterToAttendance` above, so this stays orchestration —
 * loading the candidates, calling that function, and performing the upsert.
 */
export async function syncDeviceAttendanceForOrg(
  ctx: TenantContext,
  options: { siteId: number; from: string; to: string },
  deps: { fetchRegister?: typeof fetchRegisterFromDevice } = {}
): Promise<DeviceSyncSummary> {
  const doFetchRegister = deps.fetchRegister ?? fetchRegisterFromDevice;
  const summary = emptySummary(options.siteId, options.from, options.to);

  if (!deviceConfigured()) {
    summary.errors.push(
      "ATTENDANCE_DEVICE_TOKEN is not set, so this deployment cannot read the device register."
    );
    return summary;
  }

  const days = enumerateDays(options.from, options.to);
  if (days.length > MAX_SYNC_DAYS) {
    summary.errors.push(
      `Requested range spans ${days.length} days; a single sync accepts at most ${MAX_SYNC_DAYS} to keep one ` +
        "call from exhausting the function's own execution budget. Split the range and call it more than once."
    );
    return summary;
  }

  await withTenant(ctx, async (tx) => {
    const employeeRows = await tx
      .select({ id: employees.id, employeeCode: employees.employeeCode })
      .from(employees)
      .where(
        and(
          eq(employees.orgId, ctx.orgId),
          sql`${employees.deletedAt} is null`,
          // Terminated/inactive employees are deliberately excluded from the
          // match set. If a badge still resolves to one of them, that IS the
          // "should have been revoked" case this integration exists to
          // catch — matching it here would bury the signal inside a written
          // attendance record instead of surfacing it as an unmatched code.
          notInArray(employees.status, ["terminated", "inactive"])
        )
      );
    const employeeList: DeviceSyncEmployee[] = employeeRows.map((e) => ({ id: e.id, employeeCode: e.employeeCode }));

    const holidayRows = await tx
      .select({ holidayDate: holidays.holidayDate })
      .from(holidays)
      .where(
        and(
          eq(holidays.orgId, ctx.orgId),
          gte(holidays.holidayDate, options.from),
          lte(holidays.holidayDate, options.to),
          eq(holidays.isOptional, false)
        )
      );
    const holidaySet = new Set(holidayRows.map((h) => h.holidayDate));

    const leaveRows = await tx
      .select({
        employeeId: leaveRequests.employeeId,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.orgId, ctx.orgId),
          eq(leaveRequests.status, "approved"),
          lte(leaveRequests.startDate, options.to),
          gte(leaveRequests.endDate, options.from)
        )
      );

    // "Already corrected by HR" has two sources, checked together —
    // `regularize()` on the attendance repository (the intended path, which
    // sets `attendanceRecords.isRegularized`) and the regularisation approval
    // route, which today only ever updates `attendanceRegularisations.status`
    // and does not touch `attendanceRecords` at all. Until that route also
    // sets `isRegularized`, the approved-regularisation row is the one that
    // will actually exist for a correction made through the current UI, so
    // both are treated as authoritative here rather than trusting only the
    // column that was designed for this and is not yet wired up to fire.
    const regularizedRows = await tx
      .select({ employeeId: attendanceRecords.employeeId, workDate: attendanceRecords.workDate })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.orgId, ctx.orgId),
          eq(attendanceRecords.isRegularized, true),
          gte(attendanceRecords.workDate, options.from),
          lte(attendanceRecords.workDate, options.to)
        )
      );
    const approvedRegularisationRows = await tx
      .select({
        employeeId: attendanceRegularisations.employeeId,
        attendanceDate: attendanceRegularisations.attendanceDate,
      })
      .from(attendanceRegularisations)
      .where(
        and(
          eq(attendanceRegularisations.orgId, ctx.orgId),
          eq(attendanceRegularisations.status, "approved"),
          gte(attendanceRegularisations.attendanceDate, options.from),
          lte(attendanceRegularisations.attendanceDate, options.to)
        )
      );

    // Keyed per employee *and* day, not per employee: a regularisation for one
    // past date must not lock that employee out of every future device
    // import, only the specific day HR corrected.
    const protectedKeys = new Set<string>();
    for (const row of regularizedRows) protectedKeys.add(`${row.employeeId}|${row.workDate}`);
    for (const row of approvedRegularisationRows) protectedKeys.add(`${row.employeeId}|${row.attendanceDate}`);

    for (const day of days) {
      const registerResult = await doFetchRegister(options.siteId, day);
      if (!registerResult.ok) {
        const message =
          registerResult.reason === "rejected"
            ? `${day}: device rejected the request (${registerResult.status}) — ${registerResult.detail}`
            : `${day}: device ${registerResult.reason} — ${registerResult.detail}`;
        summary.errors.push(message);
        summary.days.push({
          day,
          matched: 0,
          written: 0,
          skippedProtected: 0,
          unmatched: [],
          unmappedStatus: [],
          noData: [],
          error: message,
        });
        continue;
      }

      const isHoliday = holidaySet.has(day);
      const onApprovedLeave = new Set(
        leaveRows.filter((l) => l.startDate <= day && l.endDate >= day).map((l) => l.employeeId)
      );
      const protectedToday = new Set(
        employeeList.filter((e) => protectedKeys.has(`${e.id}|${day}`)).map((e) => e.id)
      );

      const mapping = mapDeviceRegisterToAttendance({
        day,
        rows: registerResult.data.people,
        employees: employeeList,
        isHoliday,
        employeeIdsOnApprovedLeave: onApprovedLeave,
        protectedEmployeeIds: protectedToday,
      });

      for (const record of mapping.toWrite) {
        await tx
          .insert(attendanceRecords)
          .values({
            orgId: ctx.orgId,
            employeeId: record.employeeId,
            workDate: record.workDate,
            status: record.status,
            clockInAt: record.clockInAt,
            clockOutAt: record.clockOutAt,
            workedMinutes: record.workedMinutes,
            lateByMinutes: record.lateByMinutes,
            earlyLeaveByMinutes: record.earlyLeaveByMinutes,
            clockInMethod: record.clockInAt ? "biometric" : null,
            clockOutMethod: record.clockOutAt ? "biometric" : null,
            notes: record.notes,
          })
          .onConflictDoUpdate({
            target: [attendanceRecords.employeeId, attendanceRecords.workDate],
            set: {
              status: record.status,
              clockInAt: record.clockInAt,
              clockOutAt: record.clockOutAt,
              workedMinutes: record.workedMinutes,
              lateByMinutes: record.lateByMinutes,
              earlyLeaveByMinutes: record.earlyLeaveByMinutes,
              clockInMethod: record.clockInAt ? "biometric" : null,
              clockOutMethod: record.clockOutAt ? "biometric" : null,
              notes: record.notes,
              updatedAt: new Date(),
            },
            // Belt-and-braces, restated at the database level. `protectedToday`
            // already kept a regularised day out of `mapping.toWrite` using
            // what this transaction read a moment ago, but nothing stops a
            // regularisation from being approved in the gap between that read
            // and this write. `setWhere` makes Postgres re-check
            // `is_regularized` on the row as it stands right now, and skips
            // the update silently if it has since become true — the one
            // check a read-then-write can never fully close by itself.
            setWhere: sql`${attendanceRecords.isRegularized} = false`,
          });
      }

      summary.days.push({
        day,
        matched: mapping.toWrite.length + mapping.skippedProtected.length + mapping.unmappedStatus.length,
        written: mapping.toWrite.length,
        skippedProtected: mapping.skippedProtected.length,
        unmatched: mapping.unmatched,
        unmappedStatus: mapping.unmappedStatus,
        noData: mapping.noData,
      });

      summary.totals.matched +=
        mapping.toWrite.length + mapping.skippedProtected.length + mapping.unmappedStatus.length;
      summary.totals.written += mapping.toWrite.length;
      summary.totals.skipped += mapping.skippedProtected.length + mapping.unmappedStatus.length;
      summary.totals.unmatchedCodes.push(...mapping.unmatched.map((u) => u.code));
    }
  });

  return summary;
}

/** Yesterday, `YYYY-MM-DD`, in the given organisation's own timezone rather than the server's. */
export async function defaultSyncRange(ctx: TenantContext): Promise<{ from: string; to: string }> {
  const timezone = await withTenant(ctx, async (tx) => {
    const [org] = await tx
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1);
    return org?.timezone ?? "Asia/Kolkata";
  });
  const day = addDays(isoDateInZone(new Date(), timezone), -1);
  return { from: day, to: day };
}

// ─── Every organisation, for the daily cron ───────────────────

/**
 * `HRMS org id → device site id`, e.g. `{"3f2b1c4e-...": 12}`.
 *
 * Kept in an environment variable rather than a column on `organizations`,
 * mirroring `PAYSTUB_SYNC_TENANT_MAP`'s job of mapping an HRMS org to the id
 * it is known by on the other side of an integration — the same shape of
 * problem gets the same shape of answer, and it means the cron path needs no
 * write access to the shared identity schema for what is, from HRMS's side, a
 * single per-org integer that changes only when a site is added or renamed.
 */
function siteMapFromEnv(): Record<string, number> {
  const raw = process.env.ATTENDANCE_DEVICE_SITE_MAP?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [orgId, value] of Object.entries(parsed)) {
      const siteId = Number(value);
      if (Number.isFinite(siteId)) out[orgId] = siteId;
    }
    return out;
  } catch {
    // A typo in the map must not crash the cron for every tenant over one
    // bad character — it disables the device sync (nothing resolves to a
    // site) and the malformed variable is visible in the cron's own response
    // instead of in a stack trace nobody is watching for.
    return {};
  }
}

/** The device site id configured for `orgId` — an explicit override first, then `ATTENDANCE_DEVICE_SITE_MAP`. */
export function resolveSiteId(orgId: string, explicit?: number | null): number | null {
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  return siteMapFromEnv()[orgId] ?? null;
}

async function activeOrgsWithTimezone(): Promise<{ id: string; timezone: string }[]> {
  // Superuser, exactly like `outbox-sweep.ts`'s `activeOrganisationIds`: a
  // scheduled job has no signed-in caller and therefore no tenant of its own
  // — the organisation is what this lookup produces, not what scopes it. Not
  // imported from `outbox-sweep.ts` because that helper is private to it and
  // selects different columns (just `id`, not `id` and `timezone`); the
  // pattern is duplicated on purpose rather than exporting a second caller
  // out of a module other agents are also working in this week.
  const rows = await withTenant({ orgId: "", superuser: true }, async (tx) =>
    tx
      .select({ id: organizations.id, timezone: organizations.timezone })
      .from(organizations)
      .where(sql`${organizations.deletedAt} is null`)
  );
  return rows;
}

export interface OrgDeviceSyncResult {
  orgId: string;
  siteId: number;
  summary: DeviceSyncSummary;
}

export interface AllOrgsDeviceSyncResult {
  organisations: number;
  configured: number;
  results: OrgDeviceSyncResult[];
  totals: { matched: number; written: number; skipped: number };
  /** One entry per organisation that could not be synced at all, naming which. */
  problems: string[];
}

/**
 * Runs the device sync for "yesterday" (in each organisation's own timezone)
 * for every organisation that both has a site id configured and the
 * integration turned on. This is what the daily cron calls.
 *
 * It is reached by extending the existing `/api/cron` route rather than
 * adding a second scheduled path, because the Vercel Hobby plan this project
 * runs on permits only one cron invocation per day per path — see that
 * route's own header comment, which already carries this constraint for the
 * outbox sweep.
 *
 * `listOrgs` and `syncOrg` are injectable for the same reason
 * `sweepOutboxes` takes `listOrgs`/`drainPaystub`/`drainGroups`: the
 * behaviour worth proving here — that one organisation's failure does not
 * cost the others their sync — is not provable against a real database and a
 * live device API.
 */
export async function syncDeviceAttendanceForAllOrgs(
  deps: {
    listOrgs?: () => Promise<{ id: string; timezone: string }[]>;
    syncOrg?: (ctx: TenantContext, options: { siteId: number; from: string; to: string }) => Promise<DeviceSyncSummary>;
  } = {}
): Promise<AllOrgsDeviceSyncResult> {
  const result: AllOrgsDeviceSyncResult = {
    organisations: 0,
    configured: 0,
    results: [],
    totals: { matched: 0, written: 0, skipped: 0 },
    problems: [],
  };

  if (!deviceConfigured()) return result;

  const listOrgs = deps.listOrgs ?? activeOrgsWithTimezone;
  const syncOrg = deps.syncOrg ?? syncDeviceAttendanceForOrg;

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
    const siteId = resolveSiteId(org.id);
    if (siteId === null) continue;
    result.configured += 1;

    try {
      const yesterday = addDays(isoDateInZone(new Date(), org.timezone), -1);
      const summary = await syncOrg({ orgId: org.id }, { siteId, from: yesterday, to: yesterday });
      result.results.push({ orgId: org.id, siteId, summary });
      result.totals.matched += summary.totals.matched;
      result.totals.written += summary.totals.written;
      result.totals.skipped += summary.totals.skipped;
      if (summary.errors.length > 0) {
        result.problems.push(`${org.id}: ${summary.errors.join("; ")}`);
      }
    } catch (error) {
      // One organisation's device or database problem must not cost the
      // others their sync, mirroring `sweepOutboxes`'s per-organisation
      // isolation.
      result.problems.push(`${org.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
