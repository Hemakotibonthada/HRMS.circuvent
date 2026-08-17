/**
 * Retires the test tenants that share the production database.
 *
 * `mobile-test-co` and `mobile-test-two` were created while testing the Expo
 * app and were never removed. They are harmless while row-level security is
 * enforced — which, since the `DATABASE_URL` was repointed at `hrms_app`, it
 * is — but they are also why "the organisation, if there is exactly one" could
 * never resolve a tenant here, and why a stray query without a tenant filter
 * returns rows that belong to nobody.
 *
 * Retired, not deleted. `deleted_at` is what every query in the product already
 * filters on, so this removes them from the application completely; deleting
 * would cascade through a hundred tables and take the audit trail of what was
 * tested with it. If they are ever genuinely wanted back, clearing one column
 * restores them.
 *
 * Refuses to touch anything whose members are not obviously test addresses.
 *
 * Run with no arguments for a dry run. Pass `--commit` to apply.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require(path.join(__dirname, "..", "node_modules", "pg"));

const SLUGS = ["mobile-test-co", "mobile-test-two"];
const COMMIT = process.argv.includes("--commit");

/** Addresses that cannot belong to a real colleague. */
const TEST_ADDRESS = /@example\.(test|com|org)$/i;

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
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.superuser','on',false)");

    const orgs = await client.query(
      `SELECT id, name, slug FROM identity.organizations
        WHERE slug = ANY($1) AND deleted_at IS NULL`,
      [SLUGS]
    );

    for (const org of orgs.rows) {
      const people = await client.query(
        `SELECT email FROM identity.users WHERE org_id = $1`,
        [org.id]
      );
      const real = people.rows.map((r) => r.email).filter((e) => !TEST_ADDRESS.test(e));
      console.log(`${org.slug}: ${people.rows.length} member(s) — ${people.rows.map((r) => r.email).join(", ") || "none"}`);
      if (real.length) {
        throw new Error(
          `refusing to retire ${org.slug}: ${real.join(", ")} does not look like a test address`
        );
      }
      await client.query(
        `UPDATE identity.organizations SET deleted_at = now(), updated_at = now() WHERE id = $1`,
        [org.id]
      );
    }

    const remaining = await client.query(
      `SELECT slug FROM identity.organizations WHERE deleted_at IS NULL ORDER BY slug`
    );
    console.log(`\norganisations still active: ${remaining.rows.map((r) => r.slug).join(", ") || "(none)"}`);

    if (remaining.rows.length !== 1) {
      console.log("note: more than one organisation remains — sign-in resolves by slug, so this is fine");
    }

    if (COMMIT) {
      await client.query("COMMIT");
      console.log("COMMITTED");
    } else {
      await client.query("ROLLBACK");
      console.log("DRY RUN — rolled back. Pass --commit to apply.");
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
