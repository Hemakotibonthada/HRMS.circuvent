import { Client } from "pg";
import { hashPassword } from "@/lib/auth/password";

const EMAIL = "admin@circuvent.com";

async function main() {
  const pw = process.env.HRMS_SEED_PW!;
  // Hashed with the app's own helper so the stored format is exactly what
  // verifyPassword expects — a hand-rolled hash would fail login silently.
  const hash = await hashPassword(pw);

  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("BEGIN");

    const org = await c.query(
      `INSERT INTO identity.organizations (name, slug, plan)
       VALUES ('Circuvent Technologies', 'circuvent', 'enterprise')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const orgId = org.rows[0].id;

    const user = await c.query(
      // Email is unique across the whole identity schema, not per organisation.
      `INSERT INTO identity.users (org_id, email, display_name, password_hash, status, email_verified_at)
       VALUES ($1, $2, 'Circuvent Admin', $3, 'active', now())
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'
       RETURNING id`,
      [orgId, EMAIL, hash]
    );
    const userId = user.rows[0].id;

    await c.query(`UPDATE identity.organizations SET owner_id = $1 WHERE id = $2`, [userId, orgId]);

    // One role per app: the suite token carries a single role, and each app
    // authorises on it.
    for (const app of ["hrms", "cv365", "ats", "mail", "office"]) {
      await c.query(
        `INSERT INTO identity.user_roles (user_id, org_id, app, role)
         VALUES ($1, $2, $3::identity.app, 'owner')
         ON CONFLICT (user_id, app) DO UPDATE SET role = EXCLUDED.role`,
        [userId, orgId, app]
      );
    }

    await c.query("COMMIT");
    console.log("org  :", orgId);
    console.log("user :", userId, EMAIL);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error("SEED FAILED:", e.message); process.exit(1); });
