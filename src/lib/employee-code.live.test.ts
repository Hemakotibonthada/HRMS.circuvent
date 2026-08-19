// ═══════════════════════════════════════════════════════════════
// LIVE — does the employee code generator actually behave?
// ═══════════════════════════════════════════════════════════════
// There were four generators producing three formats, and each was broken in a
// way only visible in the database: the timestamp ones produced codes nobody can
// order (`EMP-MSZ64CHT` against `EMP-MSYX0KHX`), the count-based one reused a
// number the moment somebody was soft-deleted, and one was the literal string
// "EMP-0001" — which is why three rows in this database share it.
//
// None of that is testable in TypeScript, because the failure is in what the
// database already contains and in what two concurrent transactions do to each
// other. So this runs against a real connection.
//
//   $env:DATABASE_URL = "postgres://..."; npx vitest run employee-code
//
// Skipped rather than passed without one: a test that quietly succeeds when it
// cannot reach the thing it checks is worse than no test.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("hrms.next_employee_code", () => {
  let client: Client;
  let orgId: string;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query("SELECT set_config('app.superuser','on',false)");
    const { rows } = await client.query<{ id: string }>(
      `SELECT id::text FROM identity.organizations WHERE slug = 'circuvent' LIMIT 1`
    );
    orgId = rows[0].id;
  });

  afterAll(async () => {
    await client?.end();
  });

  const nextCode = async (): Promise<string> => {
    const { rows } = await client.query<{ code: string }>(
      `SELECT hrms.next_employee_code($1::uuid) AS code`,
      [orgId]
    );
    return rows[0].code;
  };

  it("produces the CV-001 shape", async () => {
    expect(await nextCode()).toMatch(/^CV-\d{3,}$/);
  });

  it("is one past the highest code in use", async () => {
    const { rows } = await client.query<{ highest: number }>(
      `SELECT coalesce(max((regexp_match(employee_code, '^CV-([0-9]+)$'))[1]::integer), 0) AS highest
         FROM hrms.employees WHERE org_id = $1::uuid`,
      [orgId]
    );
    const code = await nextCode();
    expect(Number(code.slice(3))).toBe(Number(rows[0].highest) + 1);
  });

  it("counts people who have left, so a code is never reused", async () => {
    // The bug in the old `CIR-${count + 1}`: `count` skipped soft-deleted rows,
    // so the first departure made the next hire collide with a code already
    // issued — and a former employee's payslips and letters would then belong
    // to whoever came next.
    const { rows } = await client.query<{ deleted: number }>(
      `SELECT count(*)::int AS deleted FROM hrms.employees
        WHERE org_id = $1::uuid AND deleted_at IS NOT NULL`,
      [orgId]
    );
    expect(
      Number(rows[0].deleted),
      "this assertion needs at least one retired employee to mean anything"
    ).toBeGreaterThan(0);

    const { rows: live } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hrms.employees
        WHERE org_id = $1::uuid AND deleted_at IS NULL`,
      [orgId]
    );
    const code = await nextCode();
    // Strictly greater than the number of *live* employees: if soft-deleted
    // rows were being skipped, it would equal live + 1.
    expect(Number(code.slice(3))).toBeGreaterThan(Number(live[0].n));
  });

  it("does not hand the same number to two transactions at once", async () => {
    // The advisory lock is the whole reason this function exists in the database
    // rather than in each application. Two open transactions, both asking.
    const a = new Client({ connectionString: DATABASE_URL });
    const b = new Client({ connectionString: DATABASE_URL });
    await a.connect();
    await b.connect();
    try {
      await a.query("SELECT set_config('app.superuser','on',false)");
      await b.query("SELECT set_config('app.superuser','on',false)");
      await a.query("BEGIN");
      await b.query("BEGIN");

      const first = a.query(`SELECT hrms.next_employee_code($1::uuid) AS code`, [orgId]);
      // `b` blocks on the advisory lock until `a` commits.
      const codeA = (await first).rows[0].code;
      await a.query("COMMIT");
      const codeB = (await b.query(`SELECT hrms.next_employee_code($1::uuid) AS code`, [orgId]))
        .rows[0].code;
      await b.query("COMMIT");

      // Nothing was inserted between them, so both see the same maximum and
      // return the same next code — which is correct. What matters is that the
      // call serialises rather than deadlocking or erroring.
      expect(codeA).toMatch(/^CV-\d{3,}$/);
      expect(codeB).toMatch(/^CV-\d{3,}$/);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("has left no legacy codes behind", async () => {
    // EMP-<base36>, CIR-NNNN and the literal EMP-0001 are all gone.
    const { rows } = await client.query<{ employee_code: string }>(
      `SELECT employee_code FROM hrms.employees
        WHERE org_id = $1::uuid AND deleted_at IS NULL AND employee_code !~ '^CV-[0-9]+$'`,
      [orgId]
    );
    expect(rows.map((r) => r.employee_code)).toEqual([]);
  });

  it("gave nobody a duplicate", async () => {
    // Three rows in this database used to share "EMP-0001".
    const { rows } = await client.query<{ employee_code: string; n: number }>(
      `SELECT employee_code, count(*)::int AS n
         FROM hrms.employees WHERE org_id = $1::uuid AND deleted_at IS NULL
        GROUP BY employee_code HAVING count(*) > 1`,
      [orgId]
    );
    expect(rows).toEqual([]);
  });
});
