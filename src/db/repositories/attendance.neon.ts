// ═══════════════════════════════════════════════════════════════
// ATTENDANCE REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Clock-in and clock-out are the highest-frequency writes in the product and
// the easiest to get subtly wrong.
//
// Two decisions shape this module:
//
//  * Geofence checks run on the server. A mobile client reporting "I am at the
//    office" is asserting something it has every incentive to lie about, and
//    the Firestore design had no server to check it against. Coordinates are
//    compared to the employee's assigned location here.
//
//  * Late and overtime are computed against the assigned shift, not a fixed
//    9-to-5. An employee on a night shift clocking in at 22:00 is on time; a
//    naive comparison would mark them thirteen hours late.

import { and, asc, count, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { attendanceRecords, employees, locations, shifts } from "@/db/schema/hrms";
import {
  NotFoundError,
  RepositoryError,
  type AttendanceRecordDto,
  type AttendanceRepository,
  type AttendanceSummaryDto,
  type ClockInRequest,
  type ClockOutRequest,
  type ListQuery,
  type Page,
  type Unsubscribe,
} from "./types";

type Row = typeof attendanceRecords.$inferSelect;

function toRecord(row: Row): AttendanceRecordDto {
  return {
    id: row.id,
    employeeId: row.employeeId,
    workDate: row.workDate,
    clockInAt: row.clockInAt?.toISOString(),
    clockOutAt: row.clockOutAt?.toISOString(),
    status: row.status,
    workedMinutes: row.workedMinutes ?? undefined,
    overtimeMinutes: row.overtimeMinutes,
    lateByMinutes: row.lateByMinutes,
    earlyLeaveByMinutes: row.earlyLeaveByMinutes,
    clockInMethod: row.clockInMethod ?? undefined,
    isWithinGeofence: row.isWithinGeofence ?? undefined,
    isRegularized: row.isRegularized,
    organizationId: row.orgId,
  };
}

/**
 * Great-circle distance in metres.
 *
 * The haversine formula, rather than a flat-earth approximation, because a
 * geofence radius is small enough that the error from ignoring curvature is
 * comparable to the radius itself at high latitudes.
 */
export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Minutes since midnight for a `HH:MM:SS` shift time. */
function shiftMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes since midnight for a timestamp, in the given IANA zone. */
function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function localDate(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which is what the date column expects.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
}

export class NeonAttendanceRepository implements AttendanceRepository {
  constructor(private readonly ctx: TenantContext) {}

  async list(q: ListQuery = {}): Promise<Page<AttendanceRecordDto>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, q.pageSize ?? 50));

    const conditions: ReturnType<typeof eq>[] = [];
    const filters = q.filters ?? {};
    if (filters.employeeId) {
      conditions.push(eq(attendanceRecords.employeeId, filters.employeeId as string));
    }
    if (filters.status && filters.status !== "all") {
      conditions.push(eq(attendanceRecords.status, filters.status as never));
    }

    return withTenant(this.ctx, async (tx) => {
      const rangeConditions = [
        ...conditions,
        ...(filters.from ? [gte(attendanceRecords.workDate, filters.from as string)] : []),
        ...(filters.to ? [lte(attendanceRecords.workDate, filters.to as string)] : []),
      ];
      const where = rangeConditions.length ? and(...rangeConditions) : undefined;

      const rows = await tx
        .select()
        .from(attendanceRecords)
        .where(where)
        .orderBy(desc(attendanceRecords.workDate), asc(attendanceRecords.employeeId))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(attendanceRecords)
        .where(where);

      return {
        items: rows.map(toRecord),
        total,
        page,
        pageSize,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }

  async getById(id: string): Promise<AttendanceRecordDto | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(attendanceRecords)
        .where(eq(attendanceRecords.id, id))
        .limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  create(data: ClockInRequest): Promise<AttendanceRecordDto> {
    return this.clockIn(data);
  }

  async clockIn(request: ClockInRequest): Promise<AttendanceRecordDto> {
    const at = request.at ?? new Date();

    return withTenant(this.ctx, async (tx) => {
      const context = await this.employeeContext(tx, request.employeeId);
      const workDate = localDate(at, context.timezone);

      // The unique index on (employee, date) would reject a second insert, but
      // a clear message beats a constraint-violation error surfacing in the UI.
      const existing = await tx
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.employeeId, request.employeeId),
            eq(attendanceRecords.workDate, workDate)
          )
        )
        .for("update")
        .limit(1);

      if (existing[0]?.clockInAt) {
        throw new RepositoryError("You have already clocked in today", 409);
      }

      const geofence = this.checkGeofence(request, context);
      if (geofence.required && !geofence.inside) {
        throw new RepositoryError(
          `You are ${geofence.distance}m from ${context.locationName}, outside the ${context.geofenceRadius}m clock-in area`,
          403
        );
      }

      let lateByMinutes = 0;
      if (context.shiftStart) {
        const scheduled = shiftMinutes(context.shiftStart);
        const actual = localMinutes(at, context.timezone);
        // Grace period first: arriving inside it is on time, not "late by
        // zero", and the distinction matters for attendance reports.
        lateByMinutes = Math.max(0, actual - scheduled - context.graceMinutes);
      }

      const values = {
        orgId: this.ctx.orgId,
        employeeId: request.employeeId,
        workDate,
        clockInAt: at,
        status: (lateByMinutes > 0 ? "late" : "present") as "late" | "present",
        shiftId: context.shiftId,
        lateByMinutes,
        clockInMethod: request.method,
        clockInLatitude: request.latitude?.toString(),
        clockInLongitude: request.longitude?.toString(),
        clockInPhotoUrl: request.photoUrl,
        isWithinGeofence: geofence.required ? geofence.inside : null,
        ipAddress: request.ipAddress,
      };

      const [row] = existing[0]
        ? await tx
            .update(attendanceRecords)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(attendanceRecords.id, existing[0].id))
            .returning()
        : await tx.insert(attendanceRecords).values(values).returning();

      return toRecord(row);
    });
  }

  async clockOut(request: ClockOutRequest): Promise<AttendanceRecordDto> {
    const at = request.at ?? new Date();

    return withTenant(this.ctx, async (tx) => {
      const context = await this.employeeContext(tx, request.employeeId);
      const today = localDate(at, context.timezone);

      // A night shift starting on the 3rd and ending on the 4th must close the
      // 3rd's record, not open a new one for the 4th.
      const open = await tx
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.employeeId, request.employeeId),
            gte(attendanceRecords.workDate, previousDate(today)),
            lte(attendanceRecords.workDate, today),
            isNull(attendanceRecords.clockOutAt)
          )
        )
        .orderBy(desc(attendanceRecords.workDate))
        .for("update")
        .limit(1);

      const record = open[0];
      if (!record || !record.clockInAt) {
        throw new RepositoryError("You have not clocked in", 409);
      }

      const workedMinutes = Math.max(
        0,
        Math.round((at.getTime() - record.clockInAt.getTime()) / 60_000)
      );

      let earlyLeaveByMinutes = 0;
      let overtimeMinutes = 0;
      let status: string = record.status;

      if (context.shiftEnd) {
        const scheduledEnd = shiftMinutes(context.shiftEnd);
        const actualEnd = localMinutes(at, context.timezone);
        // A night shift's end is numerically smaller than its start, so a raw
        // subtraction reads as a huge early departure.
        const adjustedEnd = context.isNightShift && actualEnd < scheduledEnd
          ? actualEnd + 1440
          : actualEnd;
        const adjustedScheduled = context.isNightShift ? scheduledEnd + 1440 : scheduledEnd;

        earlyLeaveByMinutes = Math.max(0, adjustedScheduled - adjustedEnd);
        overtimeMinutes = Math.max(0, adjustedEnd - adjustedScheduled);
      }

      const netMinutes = Math.max(0, workedMinutes - context.breakMinutes);
      if (netMinutes < context.halfDayThreshold) status = "half_day";

      const [row] = await tx
        .update(attendanceRecords)
        .set({
          clockOutAt: at,
          clockOutMethod: request.method,
          workedMinutes: netMinutes,
          overtimeMinutes,
          earlyLeaveByMinutes,
          breakMinutes: context.breakMinutes,
          status: status as never,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecords.id, record.id))
        .returning();

      return toRecord(row);
    });
  }

  async today(employeeId: string): Promise<AttendanceRecordDto | null> {
    return withTenant(this.ctx, async (tx) => {
      const context = await this.employeeContext(tx, employeeId);
      const rows = await tx
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.employeeId, employeeId),
            eq(attendanceRecords.workDate, localDate(new Date(), context.timezone))
          )
        )
        .limit(1);

      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  async summary(
    employeeId: string,
    month: number,
    year: number
  ): Promise<AttendanceSummaryDto> {
    if (month < 1 || month > 12) throw new RepositoryError("Month must be 1-12", 400);

    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    // Day 0 of the next month is the last day of this one, and handles leap
    // years without a special case.
    const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

    return withTenant(this.ctx, async (tx) => {
      // Aggregated in SQL: the Firestore path pulled every record for the month
      // into the browser and counted there.
      const rows = await tx
        .select({
          status: attendanceRecords.status,
          days: count(),
          worked: sql<number>`coalesce(sum(${attendanceRecords.workedMinutes}), 0)::int`,
          overtime: sql<number>`coalesce(sum(${attendanceRecords.overtimeMinutes}), 0)::int`,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.employeeId, employeeId),
            gte(attendanceRecords.workDate, from),
            lte(attendanceRecords.workDate, to)
          )
        )
        .groupBy(attendanceRecords.status);

      const by = (status: string) => rows.find((r) => r.status === status)?.days ?? 0;

      return {
        employeeId,
        month,
        year,
        presentDays: by("present") + by("late"),
        absentDays: by("absent"),
        lateDays: by("late"),
        halfDays: by("half_day"),
        leaveDays: by("on_leave"),
        wfhDays: by("wfh"),
        totalWorkedMinutes: rows.reduce((sum, r) => sum + Number(r.worked), 0),
        totalOvertimeMinutes: rows.reduce((sum, r) => sum + Number(r.overtime), 0),
      };
    });
  }

  async regularize(
    id: string,
    reason: string,
    approverId: string
  ): Promise<AttendanceRecordDto> {
    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .update(attendanceRecords)
        .set({
          isRegularized: true,
          regularizationReason: reason,
          regularizedById: approverId,
          // Regularisation is the mechanism for correcting a missed punch, so
          // the lateness it recorded is cleared with it.
          status: "present",
          lateByMinutes: 0,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecords.id, id))
        .returning();

      if (!row) throw new NotFoundError("Attendance record", id);
      return toRecord(row);
    });
  }

  async update(id: string, data: Partial<AttendanceRecordDto>): Promise<AttendanceRecordDto> {
    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .update(attendanceRecords)
        .set({
          ...(data.status !== undefined ? { status: data.status as never } : {}),
          ...(data.overtimeMinutes !== undefined
            ? { overtimeMinutes: data.overtimeMinutes }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecords.id, id))
        .returning();

      if (!row) throw new NotFoundError("Attendance record", id);
      return toRecord(row);
    });
  }

  async remove(id: string): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .delete(attendanceRecords)
        .where(eq(attendanceRecords.id, id))
        .returning({ id: attendanceRecords.id });
      if (!row) throw new NotFoundError("Attendance record", id);
    });
  }

  subscribe(): Unsubscribe {
    throw new RepositoryError(
      "NeonAttendanceRepository does not support subscribe(); use the HTTP repository on the client",
      501
    );
  }

  // ─── Internals ─────────────────────────────────────────────

  private checkGeofence(
    request: { latitude?: number; longitude?: number; method: string },
    context: EmployeeContext
  ): { required: boolean; inside: boolean; distance: number } {
    const required =
      (request.method === "mobile" || request.method === "geo_fence") &&
      context.latitude !== null &&
      context.longitude !== null;

    if (!required) return { required: false, inside: true, distance: 0 };

    // Coordinates are mandatory once a geofence applies; treating "no
    // coordinates" as "inside" would make the check trivially bypassable by
    // omitting them.
    if (request.latitude === undefined || request.longitude === undefined) {
      throw new RepositoryError("Location is required to clock in from mobile", 400);
    }

    const distance = Math.round(
      distanceMeters(request.latitude, request.longitude, context.latitude!, context.longitude!)
    );
    return { required: true, inside: distance <= context.geofenceRadius, distance };
  }

  private async employeeContext(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    employeeId: string
  ): Promise<EmployeeContext> {
    const rows = await tx
      .select({
        employeeId: employees.id,
        status: employees.status,
        latitude: locations.latitude,
        longitude: locations.longitude,
        geofenceRadius: locations.geofenceRadiusMeters,
        locationName: locations.name,
        timezone: locations.timezone,
        shiftId: shifts.id,
        shiftStart: shifts.startTime,
        shiftEnd: shifts.endTime,
        graceMinutes: shifts.graceMinutes,
        breakMinutes: shifts.breakMinutes,
        halfDayThreshold: shifts.halfDayThresholdMinutes,
        isNightShift: shifts.isNightShift,
      })
      .from(employees)
      .leftJoin(locations, eq(locations.id, employees.locationId))
      // No per-employee shift assignment table yet, so the organization's
      // single active shift applies. Rostering is Phase 2.3.
      .leftJoin(shifts, eq(shifts.isActive, true))
      .where(eq(employees.id, employeeId))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundError("Employee", employeeId);
    if (row.status === "terminated" || row.status === "inactive") {
      throw new RepositoryError("This employee is no longer active", 403);
    }

    return {
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      geofenceRadius: row.geofenceRadius ?? 200,
      locationName: row.locationName ?? "your assigned location",
      timezone: row.timezone ?? "Asia/Kolkata",
      shiftId: row.shiftId ?? undefined,
      shiftStart: row.shiftStart ?? undefined,
      shiftEnd: row.shiftEnd ?? undefined,
      graceMinutes: row.graceMinutes ?? 15,
      breakMinutes: row.breakMinutes ?? 60,
      halfDayThreshold: row.halfDayThreshold ?? 240,
      isNightShift: row.isNightShift ?? false,
    };
  }
}

interface EmployeeContext {
  latitude: number | null;
  longitude: number | null;
  geofenceRadius: number;
  locationName: string;
  timezone: string;
  shiftId?: string;
  shiftStart?: string;
  shiftEnd?: string;
  graceMinutes: number;
  breakMinutes: number;
  halfDayThreshold: number;
  isNightShift: boolean;
}

function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
