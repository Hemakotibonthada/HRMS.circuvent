/**
 * Count every row each organisation owns, across every table with an org_id.
 *
 * Written before deleting demo tenants: "delete the sample data" is only safe
 * if you can see what a delete would actually take with it. Reads only.
 *
 *   PSQL_SUPERUSER=1 node scripts/census-by-org.mjs
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("select set_config('app.superuser', 'on', true)");

  const { rows: orgs } = await client.query(
    "select id, slug, name from identity.organizations order by slug"
  );
  const { rows: tables } = await client.query(`
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.column_name = 'org_id'
      and t.table_type = 'BASE TABLE'
      and c.table_schema in ('hrms', 'identity', 'public')
    order by 1, 2
  `);

  const census = new Map(orgs.map((o) => [o.id, { slug: o.slug, name: o.name, tables: {}, total: 0 }]));
  for (const t of tables) {
    const { rows } = await client.query(
      `select org_id, count(*)::int as n from "${t.table_schema}"."${t.table_name}" group by org_id`
    );
    for (const r of rows) {
      const entry = census.get(r.org_id);
      const key = `${t.table_schema}.${t.table_name}`;
      if (!entry) {
        console.log(`ORPHAN rows in ${key}: org_id ${r.org_id} has no organisation (${r.n} rows)`);
        continue;
      }
      entry.tables[key] = r.n;
      entry.total += r.n;
    }
  }

  for (const [id, entry] of census) {
    console.log(`\n${entry.slug}  (${entry.name})  ${id}  — ${entry.total} rows`);
    for (const [table, n] of Object.entries(entry.tables).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(5)}  ${table}`);
    }
    if (entry.total === 0) console.log("    (nothing)");
  }
  await client.query("commit");
} finally {
  client.release();
  await pool.end();
}
