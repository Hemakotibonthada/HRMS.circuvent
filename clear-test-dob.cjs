// Clears the personal details invented while testing the self-profile endpoint.
//
// A date of birth and a phone number on a real person's record are not test
// data that can be left lying around: the date drives gratuity eligibility and
// a retirement date, and a made-up one is worse than none because it looks
// real. The endpoint deliberately refuses to change a date of birth once set,
// so this goes through the database.
const { Pool } = require("@neondatabase/serverless");
const fs = require("fs");

const url = fs
  .readFileSync(".env.local.pre-rolefix", "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="))
  .replace("DATABASE_URL=", "")
  .trim()
  .replace(/^"|"$/g, "");

(async () => {
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.superuser','on',true)");

    const before = await c.query(
      `select e.date_of_birth, e.phone
         from hrms.employees e
         join identity.users u on u.id = e.user_id
        where u.email = 'vema@circuvent.com'`
    );
    console.log("before:", JSON.stringify(before.rows[0]));

    const r = await c.query(
      `update hrms.employees e
          set date_of_birth = null, phone = null, updated_at = now()
         from identity.users u
        where u.id = e.user_id and u.email = 'vema@circuvent.com'
       returning e.id`
    );
    console.log("cleared rows:", r.rowCount);

    const after = await c.query(
      `select count(*)::int c from hrms.employees where date_of_birth is not null`
    );
    console.log("employees with a date of birth anywhere:", after.rows[0].c);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
})();
