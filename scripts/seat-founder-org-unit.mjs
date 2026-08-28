/**
 * Give CV-001 a department and a work location.
 *
 * Both were null, which is why the payslip printed an em dash where an Indian
 * payslip is expected to name the department and the place of work.
 *
 * A Founder & CEO belongs to none of the existing functional departments —
 * putting them in Engineering because it is the largest would print something
 * untrue on a legal document — so an "Executive Office" is created if it is
 * not there. The location is the Hyderabad one already on file, matching the
 * address the employee registered with.
 *
 * Nothing is invented: the PF number stays null because EPFO issues it and
 * this script has no way to know it. A payslip showing no PF number is
 * accurate; one showing a made-up number is not.
 *
 *   node scripts/seat-founder-org-unit.mjs [--confirm]
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // absent file is fine
  }
}

const EMPLOYEE_CODE = process.env.SEAT_EMPLOYEE_CODE ?? "CV-001";
const DEPARTMENT = { code: "EXEC", name: "Executive Office" };
const LOCATION_CODE = "HHR";
const confirm = process.argv.includes("--confirm");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("select set_config('app.superuser', 'on', true)");

  const { rows: found } = await client.query(
    `select e.id, e.org_id, e.employee_code, e.department_id, e.location_id
       from hrms.employees e
      where e.employee_code = $1 and e.deleted_at is null`,
    [EMPLOYEE_CODE]
  );
  if (found.length !== 1) {
    throw new Error(`Expected exactly one live employee ${EMPLOYEE_CODE}, found ${found.length}.`);
  }
  const employee = found[0];

  const { rows: deptRows } = await client.query(
    "select id, name from hrms.departments where org_id = $1 and code = $2",
    [employee.org_id, DEPARTMENT.code]
  );
  let departmentId = deptRows[0]?.id ?? null;

  const { rows: locRows } = await client.query(
    "select id, name from hrms.locations where org_id = $1 and code = $2",
    [employee.org_id, LOCATION_CODE]
  );
  const location = locRows[0];
  if (!location) throw new Error(`No location with code ${LOCATION_CODE} in this organisation.`);

  console.log(`Employee   ${employee.employee_code}  ${employee.id}`);
  console.log(`Department ${departmentId ? `existing ${deptRows[0].name}` : `create "${DEPARTMENT.name}" (${DEPARTMENT.code})`}`);
  console.log(`Location   ${location.name} (${LOCATION_CODE})`);

  if (!confirm) {
    console.log("\nDry run. Re-run with --confirm.");
    await client.query("rollback");
    process.exit(0);
  }

  if (!departmentId) {
    const { rows } = await client.query(
      "insert into hrms.departments (org_id, code, name) values ($1, $2, $3) returning id",
      [employee.org_id, DEPARTMENT.code, DEPARTMENT.name]
    );
    departmentId = rows[0].id;
  }

  const { rows: updated } = await client.query(
    `update hrms.employees
        set department_id = $2, location_id = $3, updated_at = now()
      where id = $1
      returning employee_code, department_id, location_id`,
    [employee.id, departmentId, location.id]
  );
  console.log("\nUpdated:", updated[0]);

  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
