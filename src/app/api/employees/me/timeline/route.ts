// ═══════════════════════════════════════════════════════════════
// GET /api/employees/me/timeline — your record, as dated facts
// ═══════════════════════════════════════════════════════════════
//
// Keka shows a job timeline: promotions, transfers, role changes. This schema
// has no promotions table, no transfers table and no designation history —
// `employees.designation` is a single column that is overwritten, so the
// previous value is gone the moment HR types a new one.
//
// So this timeline is built only from things that were actually recorded with a
// date: the day somebody joined, the day they were confirmed, each salary
// revision and the reason given for it, their exit, and — from the day
// `hrms.job_history` was added — role, team, manager and employment changes as
// they happen. Inventing a "Promoted to Senior Engineer" entry by diffing
// something would produce a plausible history that no record supports, on the
// screen a person is most likely to quote back at HR.
//
// Nothing is backfilled. Changes made before that table existed were never
// recorded anywhere, and the note this returns keeps saying so.
//
// ─── On amounts ───
//
// A revision shows its date and its stated reason, never the figure.
// `/api/employees/me` deliberately excludes pay, and this endpoint keeps that
// boundary rather than quietly widening it: payslips are where money lives, and
// they have their own route and their own audit.

import { NextResponse, type NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employees, salaryStructures } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";
import { describeChange, readJobHistory } from "@/lib/job-history";

export interface TimelineEntry {
  /** ISO date the event happened on. */
  date: string;
  kind: "joined" | "confirmed" | "pay_revised" | "job_changed" | "left";
  title: string;
  detail: string | null;
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const payload = await withTenant(ctx, async (tx) => {
      const employeeId = await currentEmployeeId(ctx, tx);
      // An account with no employment record has no employment history, which
      // is an empty answer rather than an error.
      if (!employeeId) return { me: null, revisions: [], jobChanges: [] };

      const [me] = await tx
        .select({
          joinDate: employees.joinDate,
          confirmationDate: employees.confirmationDate,
          exitDate: employees.exitDate,
          designation: employees.designation,
        })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      const revisions = await tx
        .select({
          effectiveFrom: salaryStructures.effectiveFrom,
          revisionReason: salaryStructures.revisionReason,
        })
        .from(salaryStructures)
        .where(eq(salaryStructures.employeeId, employeeId))
        .orderBy(asc(salaryStructures.effectiveFrom))
        .limit(100);

      // Returns [] when the migration has not been applied yet, so this screen
      // keeps working rather than 500ing on a table that is not there.
      const jobChanges = await readJobHistory(tx, ctx.orgId, employeeId);

      return { me: me ?? null, revisions, jobChanges };
    });

    const entries: TimelineEntry[] = [];

    if (payload.me?.joinDate) {
      entries.push({
        date: String(payload.me.joinDate).slice(0, 10),
        kind: "joined",
        title: "Joined",
        detail: payload.me.designation ?? null,
      });
    }

    if (payload.me?.confirmationDate) {
      entries.push({
        date: String(payload.me.confirmationDate).slice(0, 10),
        kind: "confirmed",
        title: "Confirmed",
        detail: "Probation completed",
      });
    }

    for (const revision of payload.revisions) {
      entries.push({
        date: String(revision.effectiveFrom).slice(0, 10),
        kind: "pay_revised",
        title: "Pay revised",
        // The reason as HR recorded it — "annual merit", "promotion",
        // "correction" — because that word is the only account of *why* this
        // happened that exists anywhere.
        detail: revision.revisionReason ? titleCase(revision.revisionReason) : null,
      });
    }

    for (const change of payload.jobChanges) {
      const { title, detail } = describeChange(change);
      entries.push({
        date: change.effectiveOn.slice(0, 10),
        kind: "job_changed",
        title,
        detail,
      });
    }

    if (payload.me?.exitDate) {
      entries.push({
        date: String(payload.me.exitDate).slice(0, 10),
        kind: "left",
        title: "Left",
        detail: null,
      });
    }

    // Newest first: a timeline people scroll is one they read backwards from
    // now, not forwards from a hire date they already know.
    entries.sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({
      items: entries,
      // Stated so a client can say it rather than implying the list is
      // everything that ever happened.
      note:
        "Built from dated records: joining, confirmation, pay revisions, " +
        "recorded role, team and manager changes, and exit. " +
        "Changes made before this system started keeping job history are not shown.",
    });
  } catch (error) {
    console.error("Employee timeline failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
