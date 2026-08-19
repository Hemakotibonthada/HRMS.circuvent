// ═══════════════════════════════════════════════════════════════
// GET /api/team/pulse — who is away, and whose day it is
// ═══════════════════════════════════════════════════════════════
//
// The two things people open an HR app to find out about other people: who is
// not in today, and whose birthday it is. One route because they are one
// screen, and because two round trips on a phone to render one card is two
// chances to show half of it.
//
// ─── On birthdays ───
//
// The year is never returned. Day and month are what a colleague needs to say
// happy birthday; the year is somebody's age, and an HR system publishing that
// to the whole company is a disclosure nobody consented to and several
// jurisdictions treat as a protected characteristic. Anniversaries do carry the
// year, because length of service is a fact about the job rather than the
// person, and "ten years today" is the entire point of mentioning it.
//
// Scope follows the caller. An ordinary employee sees their own team — the
// people who report to the same manager, plus that manager. A manager sees
// their reports. Nobody sees the whole organisation's leave from here: that is
// a roster question, and this is a colleague question.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employees, leaveRequests } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import {
  toIso as iso,
  upcomingAnniversaries,
  upcomingBirthdays,
  type PersonDay,
} from "@/lib/celebrations";

const querySchema = z.object({
  /** How far ahead to look for birthdays and anniversaries. */
  horizonDays: z.coerce.number().int().min(1).max(90).optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const horizonDays = parsed.data.horizonDays ?? 30;
  const today = new Date();
  const todayIso = iso(today);
  const weekAhead = new Date(today);
  weekAhead.setUTCDate(weekAhead.getUTCDate() + 7);

  try {
    const payload = await withTenant(ctx, async (tx) => {
      const [me] = await tx
        .select({ id: employees.id, reportingToId: employees.reportingToId })
        .from(employees)
        .where(eq(employees.id, ctx.userId))
        .limit(1);

      // Peers share a manager; reports report to me. A person with neither is
      // shown their own record only, which is honest — an organisation of one
      // has no team.
      const team = await tx
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          designation: employees.designation,
          dateOfBirth: employees.dateOfBirth,
          joinDate: employees.joinDate,
        })
        .from(employees)
        .where(
          and(
            eq(employees.status, "active"),
            or(
              eq(employees.reportingToId, ctx.userId),
              me?.reportingToId ? eq(employees.reportingToId, me.reportingToId) : undefined,
              me?.reportingToId ? eq(employees.id, me.reportingToId) : undefined,
              eq(employees.id, ctx.userId)
            )
          )
        )
        .limit(200);

      const teamIds = team.map((t) => t.id);

      const away = teamIds.length
        ? await tx
            .select({
              employeeId: leaveRequests.employeeId,
              leaveType: leaveRequests.leaveType,
              startDate: leaveRequests.startDate,
              endDate: leaveRequests.endDate,
            })
            .from(leaveRequests)
            .where(
              and(
                eq(leaveRequests.status, "approved"),
                lte(leaveRequests.startDate, iso(weekAhead)),
                gte(leaveRequests.endDate, todayIso),
                // `inArray`, not a raw ANY(): a bare array parameter is bound as
                // a scalar and Postgres refuses it as a malformed array literal.
                inArray(leaveRequests.employeeId, teamIds)
              )
            )
            .limit(200)
        : [];

      return { team, away };
    });

    const nameOf = new Map(
      payload.team.map((t) => [t.id, `${t.firstName} ${t.lastName}`.trim()])
    );

    const onLeave = payload.away.map((a) => ({
      employeeId: a.employeeId,
      name: nameOf.get(a.employeeId) ?? "A colleague",
      leaveType: a.leaveType,
      startDate: a.startDate,
      endDate: a.endDate,
      today: a.startDate <= todayIso && a.endDate >= todayIso,
    }));

    const people: PersonDay[] = payload.team.map((t) => ({
      employeeId: t.id,
      name: `${t.firstName} ${t.lastName}`.trim(),
      designation: t.designation ?? "",
      date: null,
    }));

    const birthdays = upcomingBirthdays(
      people.map((p, i) => ({ ...p, date: payload.team[i].dateOfBirth })),
      today,
      horizonDays
    );

    const anniversaries = upcomingAnniversaries(
      people.map((p, i) => ({ ...p, date: payload.team[i].joinDate })),
      today,
      horizonDays
    );

    return NextResponse.json({
      teamSize: payload.team.length,
      onLeave,
      birthdays,
      anniversaries,
    });
  } catch (error) {
    console.error("Team pulse failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
