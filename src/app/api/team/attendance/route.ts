// ═══════════════════════════════════════════════════════════════
// GET /api/team/attendance — who is in, who is late, who is not here
// ═══════════════════════════════════════════════════════════════
//
// The question a manager opens an HR app at 10am to answer. Until now the app
// could not answer it at all: `/api/team/pulse` returns who booked leave, which
// is the plan, not the day.
//
// Scope is the same team `pulse` reports on, from the same helper, because a
// manager shown five people on one screen and seven on the other has no way to
// tell which is wrong.
//
// ─── What is deliberately not here ───
//
// No lateness is invented. `late_by_minutes` is NOT NULL DEFAULT 0, so a punch
// recorded against no shift carries a 0 that means "nothing measured this",
// not "on time" — and it must never become an accusation. That judgement lives
// in `presenceOf`, which is tested, rather than in a SQL CASE nobody can read.
//
// No location, no photograph, no map. This route says whether somebody started
// their day. Where they were when they did is a different question with a
// different consent position, and it is not needed to answer this one.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { attendanceRecords, employees, leaveRequests } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { teamAnchor, teamPredicate } from "@/lib/team-scope";
import { countByFilter, presenceOf, type Presence } from "@/lib/team-presence";
import { todayKey } from "@/lib/date-keys";

/**
 * The wall-clock time of an instant, in a given zone, as `HH:mm`.
 *
 * Formatted here rather than on the client. A phone slicing characters 11..16
 * out of an ISO string is reading UTC, so a punch at 00:30 IST displays as
 * 19:00 the previous evening — which is what it did.
 */
function clockAt(instant: Date | string | null, timezone: string): string | null {
  if (!instant) return null;
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

const querySchema = z.object({
  /** The day to report on, as YYYY-MM-DD. Defaults to today. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const requested = parsed.data.date ?? null;

  try {
    const payload = await withTenant(ctx, async (tx) => {
      const me = await teamAnchor(tx, ctx.userId);

      // "Today" is measured where the caller works, not in UTC. Attendance
      // rows carry the work date in the employee's location zone, so a UTC
      // date asks about yesterday for every Indian org before 05:30 — and
      // renders as the whole team having failed to turn up.
      const today = todayKey(me?.timezone);
      const date = requested ?? today;

      if (!me) return { date, today, members: [], records: [], away: [] };

      // A future day has no attendance and would render as everybody absent,
      // which reads as an alarm about a day that has not happened.
      if (date > today) return { future: true as const, date, today };

      const members = await tx
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          designation: employees.designation,
          avatarUrl: employees.avatarUrl,
        })
        .from(employees)
        .where(teamPredicate(me))
        .limit(200);

      const ids = members.map((m) => m.id);
      if (!ids.length) return { date, today, members, records: [], away: [] };

      const records = await tx
        .select({
          employeeId: attendanceRecords.employeeId,
          status: attendanceRecords.status,
          clockInAt: attendanceRecords.clockInAt,
          clockOutAt: attendanceRecords.clockOutAt,
          lateByMinutes: attendanceRecords.lateByMinutes,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.workDate, date),
            inArray(attendanceRecords.employeeId, ids)
          )
        )
        .limit(200);

      const away = await tx
        .select({
          employeeId: leaveRequests.employeeId,
          leaveType: leaveRequests.leaveType,
        })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.status, "approved"),
            lte(leaveRequests.startDate, date),
            gte(leaveRequests.endDate, date),
            inArray(leaveRequests.employeeId, ids)
          )
        )
        .limit(200);

      return { date, today, timezone: me.timezone, members, records, away };
    });

    if ("future" in payload) {
      return NextResponse.json(
        { error: "That day has not happened yet." },
        { status: 422 }
      );
    }

    const { date, today } = payload;
    const timezone = "timezone" in payload ? payload.timezone : undefined;
    const recordOf = new Map(payload.records.map((r) => [r.employeeId, r]));
    const leaveOf = new Map(payload.away.map((a) => [a.employeeId, a.leaveType]));
    const isToday = date === today;

    const members = payload.members
      .map((m) => {
        const record = recordOf.get(m.id) ?? null;
        const leaveType = leaveOf.get(m.id) ?? null;
        const presence: Presence = presenceOf({
          onLeave: leaveType !== null,
          record,
          isToday,
        });

        return {
          employeeId: m.id,
          name: `${m.firstName} ${m.lastName}`.trim(),
          designation: m.designation ?? "",
          avatarUrl: m.avatarUrl,
          presence,
          // Wall-clock, in the zone the working day is measured in. The ISO
          // instant is kept too, for anything that needs to compute rather
          // than display.
          clockInAt: record?.clockInAt ? new Date(record.clockInAt).toISOString() : null,
          clockOutAt: record?.clockOutAt ? new Date(record.clockOutAt).toISOString() : null,
          clockInLocal: clockAt(record?.clockInAt ?? null, timezone ?? "Asia/Kolkata"),
          clockOutLocal: clockAt(record?.clockOutAt ?? null, timezone ?? "Asia/Kolkata"),
          // Only reported when it is a measurement rather than a default.
          lateByMinutes: presence === "late" ? record?.lateByMinutes ?? 0 : 0,
          leaveType,
          workingFromHome: record?.status === "wfh",
        };
      })
      // Whoever needs attention first. A manager scanning this at 10am is
      // looking for the gaps, not for the people already at work.
      .sort((a, b) => {
        const rank: Record<Presence, number> = {
          not_in: 0,
          absent: 1,
          late: 2,
          in: 3,
          on_leave: 4,
          off: 5,
        };
        const byPresence = rank[a.presence] - rank[b.presence];
        return byPresence !== 0 ? byPresence : a.name.localeCompare(b.name);
      });

    return NextResponse.json({
      date,
      isToday,
      counts: countByFilter(members.map((m) => m.presence)),
      members,
    });
  } catch (error) {
    console.error("Team attendance failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
