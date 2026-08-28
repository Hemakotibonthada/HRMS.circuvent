// Proves the encryption backfill against a real Postgres engine (PGlite),
// rather than trusting that the SQL is right.
//
// The backfill is the part that cannot be checked by unit tests: it builds
// identifiers with sql.raw, walks tables that may not exist in every
// deployment, and has to be safe to run twice. All three are the kind of thing
// that looks correct and fails on contact with a database.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  decryptField,
  encryptField,
  isEncrypted,
  needsReEncryption,
} from "../src/lib/crypto/field-encryption";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");
const KEY_A = Buffer.alloc(32, 11).toString("base64");
const KEY_B = Buffer.alloc(32, 22).toString("base64");

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

async function applyMigrations(db: PGlite) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
}

/**
 * The backfill's core loop, against a live connection.
 *
 * Mirrors scripts/encrypt-fields.ts rather than importing it, because that
 * module connects to Neon on import and exits the process when it finishes.
 */
async function encryptColumn(
  db: PGlite,
  schema: string,
  table: string,
  column: string
): Promise<number> {
  const rows = (
    await db.query<{ id: string; value: string | null }>(
      `SELECT id, "${column}" AS value FROM "${schema}"."${table}" WHERE "${column}" IS NOT NULL`
    )
  ).rows;

  let rewritten = 0;
  for (const row of rows) {
    if (!needsReEncryption(row.value)) continue;
    // Decrypt before re-encrypting, or a rotation double-wraps the value.
    // Mirrors scripts/encrypt-fields.ts.
    const plaintext = decryptField(row.value!);
    await db.query(`UPDATE "${schema}"."${table}" SET "${column}" = $1 WHERE id = $2`, [
      encryptField(plaintext),
      row.id,
    ]);
    rewritten++;
  }
  return rewritten;
}

async function readSecret(db: PGlite, userId: string): Promise<string | null> {
  const rows = (
    await db.query<{ mfa_secret: string | null }>(
      `SELECT mfa_secret FROM identity.users WHERE id = $1`,
      [userId]
    )
  ).rows;
  return rows[0]?.mfa_secret ?? null;
}

async function main() {
  process.env.ENCRYPTION_KEY = KEY_A;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;

  console.log("Encryption backfill against a real Postgres\n");

  const db = new PGlite();
  await applyMigrations(db);

  // A tenant and two users: one enrolled in MFA before encryption existed,
  // one with no secret at all.
  const org = (
    await db.query<{ id: string }>(
      `INSERT INTO identity.organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id`
    )
  ).rows[0].id;

  const enrolled = (
    await db.query<{ id: string }>(
      `INSERT INTO identity.users (org_id, email, display_name, mfa_secret, mfa_enabled_at)
       VALUES ($1, 'asha@acme.test', 'Asha', 'JBSWY3DPEHPK3PXP', now()) RETURNING id`,
      [org]
    )
  ).rows[0].id;

  const plain = (
    await db.query<{ id: string }>(
      `INSERT INTO identity.users (org_id, email, display_name)
       VALUES ($1, 'ravi@acme.test', 'Ravi') RETURNING id`,
      [org]
    )
  ).rows[0].id;

  check("a pre-existing secret starts as plaintext", (await readSecret(db, enrolled)) === "JBSWY3DPEHPK3PXP");

  // ── First run ──────────────────────────────────────────────
  const first = await encryptColumn(db, "identity", "users", "mfa_secret");
  check("rewrites exactly the one plaintext secret", first === 1, `rewrote ${first}`);

  const stored = await readSecret(db, enrolled);
  check("the stored value is now an envelope", isEncrypted(stored));
  check("the plaintext is gone from the column", !stored?.includes("JBSWY3DPEHPK3PXP"));
  check("a user with no secret is left alone", (await readSecret(db, plain)) === null);

  // ── Idempotence ────────────────────────────────────────────
  const second = await encryptColumn(db, "identity", "users", "mfa_secret");
  check("a second run rewrites nothing", second === 0, `rewrote ${second}`);
  check("and does not disturb the stored value", (await readSecret(db, enrolled)) === stored);

  // ── Rotation ───────────────────────────────────────────────
  process.env.ENCRYPTION_KEY = KEY_B;
  process.env.ENCRYPTION_KEY_PREVIOUS = KEY_A;

  const rotated = await encryptColumn(db, "identity", "users", "mfa_secret");
  check("rotation rewrites the row under the new key", rotated === 1, `rewrote ${rotated}`);

  const afterRotation = await readSecret(db, enrolled);
  check("the envelope changed", afterRotation !== stored);

  // Readable with the new key alone — the retired key is not load-bearing.
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  check(
    "and decrypts to the original secret without the retired key",
    decryptField(afterRotation!) === "JBSWY3DPEHPK3PXP",
    `got ${decryptField(afterRotation!).slice(0, 40)}`
  );

  const afterRotationRun = await encryptColumn(db, "identity", "users", "mfa_secret");
  check("a run after rotation completes is a no-op", afterRotationRun === 0);

  // ── The login view still works ─────────────────────────────
  const view = (
    await db.query<{ mfa_secret: string | null; mfa_enabled_at: Date | null }>(
      `SELECT mfa_secret, mfa_enabled_at FROM identity.login_lookup WHERE email = 'asha@acme.test'`
    )
  ).rows[0];

  check("login_lookup exposes mfa_enabled_at", view?.mfa_enabled_at != null);
  check("login_lookup returns the encrypted secret", isEncrypted(view?.mfa_secret));

  await db.close();

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Backfill verification failed:", error);
  process.exit(1);
});
