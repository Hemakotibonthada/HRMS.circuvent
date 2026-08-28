/**
 * Merges the duplicate "Circuvent Technologies" organisation.
 *
 * HRMS carries two organisations with the same name — `circuvent`, where
 * everyone provisioned from the directory lands, and `circuvent-technologies`,
 * which holds one person and their employee record. One colleague filed away
 * from the rest of the company is the kind of split that stays invisible until
 * somebody wonders why they cannot see their own leave balance.
 *
 * Run with no arguments for a dry run. Pass `--commit` to actually move rows.
 *
 * Every table in the database that has an `org_id` is discovered rather than
 * listed, because a hand-written list of ninety tables is a list that will be
 * wrong the first time somebody adds the ninety-first.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require(path.join(__dirname, "..", "node_modules", "pg"));

const FROM_SLUG = process.env.MERGE_FROM || "circuvent-technologies";
const TO_SLUG = process.env.MERGE_TO || "circuvent";
const COMMIT = process.argv.includes("--commit");

function databaseUrl() {
  const file = path.join(__dirname, "..", ".env.local");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^DATABASE_URL=(.*)$/.exec(line.trim());
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("no DATABASE_URL");
}

(async () => {
  const pool = new Pool({ connectionString: databaseUrl(), max: 1 });
  const client = await pool.connect();

  try {
    // Every statement runs as superuser so RLS does not hide the rows being
    // moved — the whole point is to touch two tenants at once.
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.superuser','on',false)");

    const orgs = await client.query(
      `SELECT id, name, slug FROM identity.organizations WHERE slug = ANY($1) AND deleted_at IS NULL`,
      [[FROM_SLUG, TO_SLUG]]
    );
    const from = orgs.rows.find((o) => o.slug === FROM_SLUG);
    const to = orgs.rows.find((o) => o.slug === TO_SLUG);
    if (!from || !to) throw new Error(`need both organisations; found ${orgs.rows.length}`);
    console.log(`from: ${from.name} (${from.slug}) ${from.id}`);
    console.log(`to  : ${to.name} (${to.slug}) ${to.id}\n`);

    /*
     * Every table carrying org_id, in dependency-free order — a plain UPDATE
     * per table works because the value being changed is the tenant key, not a
     * relationship between the rows.
     */
    const tables = await client.query(
      `SELECT c.table_schema, c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.column_name = 'org_id'
          AND c.table_schema IN ('identity','hrms')
          AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_schema, c.table_name`
    );

    let moved = 0;
    const touched = [];
    for (const { table_schema, table_name } of tables.rows) {
      const q = `UPDATE "${table_schema}"."${table_name}" SET org_id = $1 WHERE org_id = $2`;
      const res = await client.query(q, [to.id, from.id]);
      if (res.rowCount > 0) {
        touched.push(`${table_schema}.${table_name}: ${res.rowCount}`);
        moved += res.rowCount;
      }
    }

    console.log(`tables carrying org_id: ${tables.rows.length}`);
    console.log(`rows moved: ${moved}`);
    for (const t of touched) console.log(`   ${t}`);

    // The emptied organisation is retired rather than deleted: the rows that
    // referenced it now point elsewhere, and a deleted tenant takes its audit
    // history with it.
    await client.query(
      `UPDATE identity.organizations SET deleted_at = now(), updated_at = now() WHERE id = $1`,
      [from.id]
    );

    const remaining = await client.query(
      `SELECT slug FROM identity.organizations WHERE deleted_at IS NULL ORDER BY slug`
    );
    console.log(`\norganisations still active: ${remaining.rows.map((r) => r.slug).join(", ")}`);

    const people = await client.query(
      `SELECT u.email, o.slug FROM identity.users u
         JOIN identity.organizations o ON o.id = u.org_id ORDER BY u.email`
    );
    console.log("people:");
    for (const r of people.rows) console.log(`   ${r.email.padEnd(34)} ${r.slug}`);

    if (COMMIT) {
      await client.query("COMMIT");
      console.log("\nCOMMITTED");
    } else {
      await client.query("ROLLBACK");
      console.log("\nDRY RUN — rolled back. Pass --commit to apply.");
    }
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ERR", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
