import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";

// ═══════════════════════════════════════════════════════════════
// STARTING THE WORK LOG WHEN SOMEBODY SIGNS IN
// ═══════════════════════════════════════════════════════════════
// `hrms.attendance_records` was empty. Not thinly populated -- empty, in a
// product with an attendance page, an attendance hub, a clock endpoint with
// geofencing and buddy-punch protection, and a summary API. All of it worked.
// Nothing ever called it, because the only way in was a button somebody had to
// find and press, and nobody did.
//
// So signing in opens the day. It is the one moment the system already knows a
// particular person has started work, and it asks no new habit of anybody.
//
// ## What it deliberately does not do
//
// **It does not open a day that is not a working day.** Signing in at nine on a
// Sunday, or on Republic Day, is somebody checking something -- not a shift.
// Recording it would put attendance on days the pay calendar calls non-working,
// and the two would then disagree about the same month. The weekend and the
// holiday list here are the ones payroll uses.
//
// **It does not clock anybody out.** A sign-out is not the end of a working
// day: people close tabs, sessions expire, and a laptop lid comes down at
// lunch. Clocking out stays a deliberate act.
//
// **It never fails a sign-in.** Everything below is wrapped so a problem with
// attendance cannot stop somebody logging in. An authentication system that
// refuses a valid password because a bookkeeping insert failed is a far worse
// product than one with a missing attendance row.

export type WorkLogOutcome =
  | { started: true; employeeId: string; workDate: string }
  | {
      started: false;
      reason: "no-employee" | "not-a-working-day" | "already-open" | "error";
      detail?: string;
    };

/** Sunday and Saturday, matching the pay calendar's weekend. */
const WEEKEND = [0, 6];

/**
 * Opens the attendance day for the person who has just signed in.
 *
 * Resolves the employee from the account rather than assuming the two ids are
 * the same. They are the same for anybody who registered here, and they are not
 * for anybody hired through ATS -- that employee row is created by the
 * onboarding handoff with its own id, and `user_id` is filled in on first
 * sign-in. Reading `user_id` first and falling back to the work address covers
 * both, and covers the moment in between.
 */
export async function startWorkLogOnSignIn(input: {
  orgId: string;
  userId: string;
  email: string;
}): Promise<WorkLogOutcome> {
  try {
    return await withTenant({ orgId: input.orgId, superuser: true }, async (tx) => {
      const email = input.email.trim().toLowerCase();
      const found = await tx.execute(
        sql`SELECT id FROM (
              SELECT e.id::text AS id, 1 AS rank
                FROM hrms.employees e
               WHERE e.org_id = ${input.orgId}::uuid
                 AND e.user_id = ${input.userId}::uuid
                 AND e.deleted_at IS NULL AND e.status = 'active'
              UNION ALL
              SELECT e.id::text, 2
                FROM hrms.employees e
               WHERE e.org_id = ${input.orgId}::uuid
                 AND lower(e.work_email) = ${email}
                 AND e.deleted_at IS NULL AND e.status = 'active'
            ) AS candidates ORDER BY rank LIMIT 1`
      );
      const employeeId = (found.rows[0] as { id?: string } | undefined)?.id;
      if (!employeeId) return { started: false, reason: "no-employee" as const };

      /*
       * The date comes from the database, not the server's clock, so a function
       * running in Singapore and one running in Washington agree about which
       * day it is for an employee in India.
       */
      const today = await tx.execute(
        sql`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS work_date,
                   EXTRACT(dow FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int AS dow`
      );
      const workDate = (today.rows[0] as { work_date: string }).work_date;
      const dow = Number((today.rows[0] as { dow: number }).dow);

      if (WEEKEND.includes(dow)) {
        return { started: false, reason: "not-a-working-day" as const, detail: "weekend" };
      }

      const holiday = await tx.execute(
        sql`SELECT 1 FROM hrms.holidays
             WHERE org_id = ${input.orgId}::uuid
               AND holiday_date = ${workDate}::date
               AND coalesce(is_optional, false) = false
             LIMIT 1`
      );
      if (holiday.rows.length > 0) {
        return { started: false, reason: "not-a-working-day" as const, detail: "public holiday" };
      }

      /*
       * ON CONFLICT DO NOTHING against `attendance_employee_date_key`, so two
       * tabs signing in together open one day between them rather than racing.
       * An empty RETURNING is how "already open" is told from "opened".
       */
      const opened = await tx.execute(
        sql`INSERT INTO hrms.attendance_records
              (org_id, employee_id, work_date, clock_in_at, clock_in_method, status, notes)
            VALUES (${input.orgId}::uuid, ${employeeId}::uuid, ${workDate}::date, now(),
                    'web', 'present', 'Opened automatically on sign-in.')
            ON CONFLICT (employee_id, work_date) DO NOTHING
            RETURNING id`
      );

      if (opened.rows.length === 0) {
        return { started: false, reason: "already-open" as const };
      }
      return { started: true as const, employeeId, workDate };
    });
  } catch (error) {
    // Never fatal: see the header. The reason is returned so a caller can log
    // it without anybody's sign-in depending on it.
    return { started: false, reason: "error", detail: String(error) };
  }
}
