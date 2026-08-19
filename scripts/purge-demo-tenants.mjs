/**
 * Remove the demo and test tenants, leaving only the live Circuvent org.
 *
 * The database accumulated six organisations that exist only because somebody
 * ran a seed or a mobile test: three "Northwind Demo" variants, two "Mobile
 * Test" ones, and a second, empty "Circuvent Technologies" that no application
 * references. Their employees show up in cross-tenant counts, their holidays
 * outnumber the real calendar, and their `.test` addresses are one careless
 * query away from being emailed.
 *
 * The live tenant is identified by slug, and the script refuses to run if that
 * slug does not resolve to exactly one organisation — deleting "everything
 * except the one I meant" is only safe if the one you meant is unambiguous.
 *
 *   node scripts/purge-demo-tenants.mjs            # dry run, lists what would go
 *   node scripts/purge-demo-tenants.mjs --confirm  # deletes
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

const KEEP_SLUG = process.env.LIVE_ORG_SLUG ?? "circuvent";
const confirm = process.argv.includes("--confirm");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("select set_config('app.superuser', 'on', true)");

  const { rows: orgs } = await client.query(
    "select id, slug, name from identity.organizations order by slug"
  );
  const keep = orgs.filter((o) => o.slug === KEEP_SLUG);
  if (keep.length !== 1) {
    throw new Error(
      `Expected exactly one organisation with slug "${KEEP_SLUG}", found ${keep.length}. Refusing to delete anything.`
    );
  }
  const doomed = orgs.filter((o) => o.slug !== KEEP_SLUG);
  if (doomed.length === 0) {
    console.log("Nothing to purge — only the live tenant exists.");
    await client.query("commit");
    process.exit(0);
  }

  console.log(`Keeping  ${keep[0].slug}  (${keep[0].name})  ${keep[0].id}`);
  console.log(`Purging  ${doomed.length} organisation(s):`);

  const { rows: tables } = await client.query(`
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.column_name = 'org_id' and t.table_type = 'BASE TABLE'
      and c.table_schema in ('hrms', 'identity', 'public')
    order by 1, 2
  `);

  const ids = doomed.map((o) => o.id);
  let total = 0;
  for (const o of doomed) console.log(`    ${o.slug}  (${o.name})  ${o.id}`);

  for (const t of tables) {
    const qualified = `"${t.table_schema}"."${t.table_name}"`;
    const { rows } = await client.query(
      `select count(*)::int as n from ${qualified} where org_id = any($1::uuid[])`,
      [ids]
    );
    if (rows[0].n === 0) continue;
    total += rows[0].n;
    console.log(`    ${String(rows[0].n).padStart(5)}  ${t.table_schema}.${t.table_name}`);
  }

  if (!confirm) {
    console.log(`\nDry run: ${total} rows would be deleted. Re-run with --confirm.`);
    await client.query("rollback");
    process.exit(0);
  }

  // Delete the organisation rows and let the foreign keys cascade; anything
  // that does not cascade will raise here rather than leave an orphan behind.
  const { rowCount } = await client.query(
    "delete from identity.organizations where id = any($1::uuid[])",
    [ids]
  );
  console.log(`\nDeleted ${rowCount} organisation(s) and ~${total} dependent rows.`);

  const { rows: left } = await client.query("select slug from identity.organizations order by slug");
  console.log(`Remaining: ${left.map((r) => r.slug).join(", ")}`);
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
