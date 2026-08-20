/**
 * The scheduled sweep entry point.
 *
 * `vercel.json`'s `crons` block has Vercel call this on a schedule. The route
 * itself only authenticates that call and hands off to `sweepOutboxes`, which
 * re-drives the deliveries that did not get through the first time — employee
 * records owed to Paystub, group memberships owed to auth.circuvent.com, and
 * signed documents' archived PDFs owed to R2.
 *
 * ## Why HRMS needed one at all
 *
 * All three outboxes were written to record a retry schedule on every
 * failure, and for the first two, nothing ever read it. The only code that
 * re-drove either ran when an employee happened to be created or edited, so a
 * delivery that failed once waited for an unrelated edit to that same person.
 * This route is what turns those columns from a log of things that did not
 * happen into a queue. The PDF storage outbox was built after this route
 * already existed, precisely so it would never have that gap in the first
 * place.
 *
 * ## On the schedule
 *
 * Daily (`0 3 * * *`), which is a billing constraint rather than a design
 * decision: the Vercel Hobby plan permits one cron invocation per day per
 * path and rejects the deployment at deploy time if any expression would fire
 * more often. Paystub's own cron carries the same note for the same reason.
 *
 * Nothing here needs changing for that to be safe. Each outbox row records its
 * own next-attempt time and every drain asks for what is due, so a less
 * frequent tick changes how late a retry can be, never whether it happens.
 * The first attempt is still made inline when the employee is saved, so the
 * common case never waits for this at all — this is the recovery path.
 *
 * If sooner recovery matters, drive this same route from an external scheduler
 * with the same `Authorization: Bearer $CRON_SECRET` header. Each drain
 * selects only rows whose next attempt is due and updates them as it goes, so
 * an overlapping caller re-attempts at worst a few rows rather than corrupting
 * anything.
 *
 * Authentication follows Vercel's own convention, which is what Paystub's cron
 * does — Vercel sends `Authorization: Bearer $CRON_SECRET` when that variable
 * is configured. A missing secret refuses every request rather than waving
 * them through: treating "not configured" as "no authentication needed" would
 * mean forgetting this variable in a new environment silently publishes an
 * unauthenticated trigger that writes to three other systems.
 */

import { NextRequest, NextResponse } from "next/server";

import { syncDeviceAttendanceForAllOrgs } from "@/lib/attendance/device-sync";
import { sweepInternReminders } from "@/lib/intern-reminders";
import { processDueExits } from "@/lib/offboarding-exit";
import { sweepOutboxes } from "@/lib/outbox-sweep";
import { timingSafeEqual } from "@/lib/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET is not configured. Every request is refused until it is set — accepting " +
          "requests with no secret configured would leave this endpoint unauthenticated.",
      },
      { status: 503 }
    );
  }

  const provided = req.headers.get("authorization") ?? "";
  if (!timingSafeEqual(provided, `Bearer ${configured}`)) {
    return NextResponse.json(
      { error: 'Missing or incorrect "Authorization" header.' },
      { status: 401 }
    );
  }

  const startedAt = Date.now();
  const result = await sweepOutboxes();
  const durationMs = Date.now() - startedAt;

  if (result.problems.length > 0) {
    // The per-row failures are already recorded on the outbox rows themselves.
    // This is for the platform's request log, where somebody watching cron
    // invocations sees that a whole tenant was skipped without querying.
    console.warn("[cron] outbox sweep completed with problems", {
      problems: result.problems,
      durationMs,
    });
  }

  // Reconciles yesterday's device/RFID attendance register, the same way the
  // sweep above re-drives outbox rows — added to this route rather than a
  // second `crons` entry because the Vercel Hobby plan only permits one
  // invocation per day per path (see this file's header comment). Caught
  // independently so a device-side problem (an unreachable terminal, a bad
  // token) can never take down the paystub/group sweep's own response; the
  // two integrations share a schedule, not a failure mode. When no device
  // token is configured this resolves instantly with an empty result, so
  // deployments that do not use the device integration pay nothing for it.
  let deviceSync: Awaited<ReturnType<typeof syncDeviceAttendanceForAllOrgs>> | { failed: string };
  try {
    deviceSync = await syncDeviceAttendanceForAllOrgs();
    if (deviceSync.problems.length > 0) {
      console.warn("[cron] device attendance sync completed with problems", {
        problems: deviceSync.problems,
      });
    }
  } catch (error) {
    console.error("[cron] device attendance sync threw unexpectedly", error);
    deviceSync = { failed: error instanceof Error ? error.message : String(error) };
  }

  // Sweeps interns nearing their internship end date for last-working-day
  // reminders — added here rather than a second `crons` entry for the same
  // one-invocation-per-path-per-day reason the device sync above is: this
  // is the only tick this path gets. Caught independently so a mail-provider
  // outage cannot take down the paystub/group/device sweeps' own response.
  // Never re-sends: intern-reminders.ts claims each (employee, leadDays) pair
  // with an ON CONFLICT DO NOTHING insert before mailing anyone, so a retried
  // or overlapping run reaches the same milestone at most once, ever.
  let internReminders: Awaited<ReturnType<typeof sweepInternReminders>> | { failed: string };
  try {
    internReminders = await sweepInternReminders();
    if (internReminders.problems.length > 0) {
      console.warn("[cron] intern reminder sweep completed with problems", {
        problems: internReminders.problems,
      });
    }
  } catch (error) {
    console.error("[cron] intern reminder sweep threw unexpectedly", error);
    internReminders = { failed: error instanceof Error ? error.message : String(error) };
  }

  // Processes any leaver whose agreed last working day has arrived and who
  // is not yet fully processed — the recovery path for this feature's own
  // version of the bug described in this file's header. Settlement, access
  // removal and documents all normally happen the moment HR calls
  // `process-exit`, but nobody is guaranteed to click that on the exact
  // last working day; without this, a leaver simply not re-opened by HR
  // that day would stay a member of every mailing list indefinitely, the
  // same "nobody touches this record again" shape as the original outbox
  // defect. Caught independently for the same reason as the two sweeps
  // above: one tenant's misconfigured settlement template must not take
  // down the paystub/group/device/intern sweeps' own response.
  let exitSweep: Awaited<ReturnType<typeof processDueExits>> | { failed: string };
  try {
    exitSweep = await processDueExits();
    if (exitSweep.problems.length > 0) {
      console.warn("[cron] leaver exit sweep completed with problems", {
        problems: exitSweep.problems,
      });
    }
  } catch (error) {
    console.error("[cron] leaver exit sweep threw unexpectedly", error);
    exitSweep = { failed: error instanceof Error ? error.message : String(error) };
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    durationMs,
    organisations: result.organisations,
    ...result.totals,
    problems: result.problems,
    deviceSync,
    internReminders,
    exitSweep,
  });
}
