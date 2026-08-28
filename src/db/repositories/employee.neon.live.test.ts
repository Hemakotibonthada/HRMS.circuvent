// ═══════════════════════════════════════════════════════════════
// LIVE — does converting an intern to permanent actually behave?
// ═══════════════════════════════════════════════════════════════
// convertToPermanent (src/db/repositories/employee.neon.ts) makes two
// claims that only mean something against a real transaction, not a mocked
// one: idempotency is "a retried call, inside the same FOR UPDATE lock,
// observes employmentType already changed to full_time and stops instead of
// drawing again", and history preservation is "the UPDATE statement only
// ever sets employeeCode / previousEmployeeCode / codeChangedAt /
// employmentType / updatedAt, so nothing else on the row — or in any other
// table — moves". Neither survives being restated as a pure-function test;
// both are about what Postgres actually does with a row lock and an UPDATE.
// So, like employee-code.live.test.ts, this runs against a real connection.
//
//   $env:DATABASE_URL = "postgres://..."; npx vitest run employee.neon
//
// Skipped rather than passed without one, for the same reason as the code
// generator's live tests: a test that quietly succeeds when it cannot reach
// the thing it checks is worse than no test.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("NeonEmployeeRepository.convertToPermanent", () => {
  let admin: Client;
  let orgId: string;
  let managerId: string;
  let internId: string;
  let originalCode: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    // Bypasses RLS for fixture setup only. The conversions under test, below,
    // always run through a normal (non-superuser) tenant context via
    // NeonEmployeeRepository, so the code actually being exercised still goes
    // through the same row-level security every real request does.
    await admin.query("SELECT set_config('app.superuser','on',false)");

    const { rows: orgRows } = await admin.query<{ id: string }>(
      `SELECT id::text FROM identity.organizations WHERE slug = 'circuvent' LIMIT 1`
    );
    orgId = orgRows[0].id;

    // Any existing employee stands in for "the manager" — the fixture only
    // needs reportingToId to point at a row that exists, not at someone with
    // a specific role.
    const { rows: managerRows } = await admin.query<{ id: string }>(
      `SELECT id::text FROM hrms.employees WHERE org_id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
      [orgId]
    );
    managerId = managerRows[0].id;

    const { rows: codeRows } = await admin.query<{ code: string }>(
      `SELECT hrms.next_employee_code($1::uuid, 'CVI-') AS code`,
      [orgId]
    );
    originalCode = codeRows[0].code;

    const { rows: internRows } = await admin.query<{ id: string }>(
      `INSERT INTO hrms.employees
         (org_id, employee_code, first_name, last_name, work_email, designation,
          employment_type, join_date, reporting_to_id)
       VALUES ($1::uuid, $2, 'Conversion', 'Fixture', $3, 'Intern Engineer',
               'intern', current_date, $4::uuid)
       RETURNING id::text`,
      [orgId, originalCode, `conversion-fixture-${Date.now()}@example.invalid`, managerId]
    );
    internId = internRows[0].id;

    // Present before conversion so "leave balances survive" is a real claim
    // about this row, not an assumption: convertToPermanent's UPDATE never
    // names hrms.leave_balances at all, so if this is later missing or its
    // value has changed, that claim was false.
    await admin.query(
      `INSERT INTO hrms.leave_balances (org_id, employee_id, year, leave_type, opening_days)
       VALUES ($1::uuid, $2::uuid, extract(year from current_date)::int, 'casual', '12.50')`,
      [orgId, internId]
    );
  });

  afterAll(async () => {
    if (internId) {
      await admin.query(`DELETE FROM hrms.leave_balances WHERE employee_id = $1::uuid`, [internId]);
      await admin.query(`DELETE FROM hrms.employees WHERE id = $1::uuid`, [internId]);
    }
    await admin?.end();
  });

  it("draws a new CV- code and keeps the CVI- one as history", async () => {
    const repo = new NeonEmployeeRepository({ orgId, superuser: false });
    const converted = await repo.convertToPermanent(internId);

    expect(converted.employeeCode).toMatch(/^CV-\d{3,}$/);
    expect(converted.employeeCode).not.toBe(originalCode);
    expect(converted.previousEmployeeCode).toBe(originalCode);
    expect(converted.employmentType).toBe("full_time");
    // Recorded, not just non-null — a future payslip lookup needs to know
    // *when* the code changed, not only that it did.
    expect(converted.codeChangedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(converted.codeChangedAt as string))).toBe(false);
  });

  it("does not draw a second code when the conversion is retried", async () => {
    const repo = new NeonEmployeeRepository({ orgId, superuser: false });
    // Simulates a double-click on "Convert to permanent", or a client retry
    // after a timed-out response whose result never reached the caller. The
    // row-lock check inside convertToPermanent sees employmentType is
    // already "full_time" from the previous test and returns the record
    // as-is instead of drawing a second CV- code.
    const first = await repo.convertToPermanent(internId);
    const second = await repo.convertToPermanent(internId);

    expect(second.employeeCode).toBe(first.employeeCode);
    // The thing a double-issue bug would actually break: a second call must
    // not overwrite previousEmployeeCode with the now-current CV- code and
    // erase the CVI- one payslips already reference.
    expect(second.previousEmployeeCode).toBe(originalCode);
  });

  it("leaves the reporting line and an existing leave balance untouched", async () => {
    const repo = new NeonEmployeeRepository({ orgId, superuser: false });
    const record = await repo.convertToPermanent(internId);
    expect(record.reportingToId).toBe(managerId);

    const { rows } = await admin.query<{ opening_days: string }>(
      `SELECT opening_days::text FROM hrms.leave_balances WHERE employee_id = $1::uuid`,
      [internId]
    );
    // Neither deleted nor rewritten — group membership is left equally
    // untouched, for the identical reason: the UPDATE this method issues
    // names five columns on hrms.employees and nothing else.
    expect(rows).toHaveLength(1);
    expect(rows[0].opening_days).toBe("12.50");
  });
});
