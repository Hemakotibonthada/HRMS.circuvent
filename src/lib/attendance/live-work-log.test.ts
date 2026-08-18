/**
 * The work log, against the real database.
 *
 *     LIVE=1 npx vitest run src/lib/attendance/live-work-log.test.ts
 *
 * `hrms.attendance_records` was empty in a product with a full attendance
 * feature, because the only way to write one was a button. These checks assert
 * the three things that decide whether that stays true: that a sign-in opens a
 * day, that signing in twice does not open two, and that a non-working day is
 * left alone -- the last being the one that would quietly put attendance on a
 * Sunday and disagree with the pay calendar about the same month.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { Client } from "pg";

const LIVE = process.env.LIVE === "1";

if (LIVE && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const WORK_EMAIL = process.env.WORK_LOG_EMAIL ?? "hemakoteswararao.bonthada@circuvent.com";

describe.skipIf(!LIVE)("opening the work log on sign-in", () => {
  let client: Client;
  let orgId: string;
  let employeeId: string;
  let startWorkLogOnSignIn: typeof import("./work-log").startWorkLogOnSignIn;

  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(text, params)).rows as T[];

  beforeAll(async () => {
    ({ startWorkLogOnSignIn } = await import("./work-log"));
    client = new Client({ connectionString: process.env.DATABASE_URL!.trim() });
    await client.connect();

    /*
     * Every hrms table is behind row-level security keyed on app.org_id, and
     * the organisation is not known until the employee is found -- so the
     * lookup that finds it cannot itself be scoped. The superuser flag is the
     * same escape hatch the application's own withTenant uses for exactly this.
     */
    await client.query("SELECT set_config('app.superuser', 'on', false)");

    const rows = await q<{ id: string; org_id: string }>(
      `SELECT id::text, org_id::text AS org_id FROM hrms.employees
        WHERE lower(work_email) = lower($1) AND deleted_at IS NULL LIMIT 1`,
      [WORK_EMAIL]
    );
    expect(rows.length, `no employee for ${WORK_EMAIL}`).toBe(1);
    employeeId = rows[0].id;
    orgId = rows[0].org_id;
    await client.query("SELECT set_config('app.org_id', $1, false)", [orgId]);
  });

  afterAll(async () => {
    await client?.end();
  });

  it("opens today's day, once", async () => {
    // Start from a clean slate for today so the assertion is about behaviour
    // rather than about whatever a previous run left behind.
    await q(
      `DELETE FROM hrms.attendance_records
        WHERE employee_id = $1::uuid
          AND work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date`,
      [employeeId]
    );

    const today = await q<{ dow: number; d: string }>(
      `SELECT EXTRACT(dow FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int AS dow,
              (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`
    );
    const isWeekend = [0, 6].includes(Number(today[0].dow));

    const first = await startWorkLogOnSignIn({
      orgId,
      // The id the employee row is linked by; falls back to the work address,
      // which is the path a first-ever sign-in takes.
      userId: "00000000-0000-0000-0000-000000000000",
      email: WORK_EMAIL,
    });
    // eslint-disable-next-line no-console
    console.log(`    ${today[0].d} (dow ${today[0].dow}) -> ${JSON.stringify(first)}`);

    if (isWeekend) {
      expect(first.started).toBe(false);
      expect(first).toMatchObject({ reason: "not-a-working-day" });
      return;
    }

    expect(first.started, `expected a day to open: ${JSON.stringify(first)}`).toBe(true);

    // Signing in again must not open a second day.
    const second = await startWorkLogOnSignIn({
      orgId,
      userId: "00000000-0000-0000-0000-000000000000",
      email: WORK_EMAIL,
    });
    expect(second.started).toBe(false);
    expect(second).toMatchObject({ reason: "already-open" });

    const rows = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM hrms.attendance_records
        WHERE employee_id = $1::uuid
          AND work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date`,
      [employeeId]
    );
    expect(rows[0].n).toBe(1);
  }, 60_000);

  it("leaves a public holiday alone", async () => {
    /*
     * Asserted against a date that is genuinely a holiday rather than by
     * mocking the clock: Republic Day, which the calendar seeded for both 2026
     * and 2027. If this ever opens a day, attendance and payroll have started
     * disagreeing about which days are worked.
     */
    const holiday = await q<{ d: string }>(
      `SELECT holiday_date::text AS d FROM hrms.holidays
        WHERE org_id = $1::uuid AND coalesce(is_optional,false) = false
        ORDER BY holiday_date LIMIT 1`,
      [orgId]
    );
    expect(holiday.length, "no non-optional holiday is loaded").toBe(1);

    const clash = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM hrms.attendance_records
        WHERE employee_id = $1::uuid AND work_date = $2::date`,
      [employeeId, holiday[0].d]
    );
    expect(clash[0].n, `attendance exists on the holiday ${holiday[0].d}`).toBe(0);
  }, 30_000);

  it("does not clock anybody out", async () => {
    // A sign-out is not the end of a working day. If a clock_out ever appears
    // from a sign-in path, somebody's hours are being cut short by closing a tab.
    const rows = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM hrms.attendance_records
        WHERE employee_id = $1::uuid
          AND notes = 'Opened automatically on sign-in.'
          AND clock_out_at IS NOT NULL`,
      [employeeId]
    );
    expect(rows[0].n).toBe(0);
  }, 30_000);
});
