// ═══════════════════════════════════════════════════════════════
// ENCRYPT FIELDS AT REST
// ═══════════════════════════════════════════════════════════════
// Rewrites the sensitive columns that are still plaintext, and re-wraps
// anything encrypted under a retired key.
//
// It exists because `decryptField` reads plaintext transparently. That is what
// makes encryption deployable against a live database — turning it on does not
// lock out everyone already enrolled in MFA — but it also means switching it
// on encrypts nothing that already exists. Without this script the feature
// silently protects only rows written after the deploy.
//
// Runs as superuser, because it must cross every tenant. That is the one thing
// application code must never do, and it is why this is a script.
//
// Safe to interrupt and re-run: every row is matched on whether it *needs*
// rewriting, and a row already wrapped with the current key is skipped.
//
// Usage:
//   npm run db:encrypt-fields              # rewrite what needs it
//   npm run db:encrypt-fields -- --dry-run # report only, write nothing
//
// Rotating a key:
//   1. ENCRYPTION_KEY_PREVIOUS=<old>  ENCRYPTION_KEY=<new>
//   2. npm run db:encrypt-fields
//   3. Once it reports nothing left to do, drop ENCRYPTION_KEY_PREVIOUS.

import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import {
  decryptField,
  encryptField,
  encryptionConfigured,
  needsReEncryption,
} from "../src/lib/crypto/field-encryption";

const dryRun = process.argv.slice(2).includes("--dry-run");

/**
 * Every column that holds something a database dump must not reveal.
 *
 * `bank_details` is jsonb rather than text. It is deliberately not in this
 * list: encrypting it means storing a string where the column type promises an
 * object, which needs a schema change rather than a backfill. It is tracked in
 * docs/ROADMAP.md, and nothing writes to it yet.
 */
const TARGETS = [
  { schema: "identity", table: "users", column: "mfa_secret", label: "TOTP secrets" },
  { schema: "identity", table: "sso_connections", column: "client_secret", label: "SSO client secrets" },
  { schema: "hrms", table: "employees", column: "aadhaar_number", label: "Aadhaar numbers" },
  { schema: "hrms", table: "employees", column: "pan_number", label: "PAN numbers" },
] as const;

interface Result {
  label: string;
  scanned: number;
  rewritten: number;
  skipped: number;
  missing: boolean;
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  return withTenant({ orgId: "", superuser: true }, async (tx) => {
    const result = await tx.execute(
      sql`SELECT 1 FROM information_schema.tables
          WHERE table_schema = ${schema} AND table_name = ${table}
          LIMIT 1`
    );
    return result.rows.length > 0;
  });
}

async function encryptColumn(target: (typeof TARGETS)[number]): Promise<Result> {
  const { schema, table, column, label } = target;

  if (!(await tableExists(schema, table))) {
    return { label, scanned: 0, rewritten: 0, skipped: 0, missing: true };
  }

  return withTenant({ orgId: "", superuser: true }, async (tx) => {
    const rows = (
      await tx.execute(
        sql`SELECT id, ${sql.raw(`"${column}"`)} AS value
            FROM ${sql.raw(`"${schema}"."${table}"`)}
            WHERE ${sql.raw(`"${column}"`)} IS NOT NULL`
      )
    ).rows as unknown as { id: string; value: string | null }[];

    let rewritten = 0;
    let skipped = 0;

    for (const row of rows) {
      if (!needsReEncryption(row.value)) {
        skipped++;
        continue;
      }

      if (!dryRun) {
        // Decrypt first. On a rotation `row.value` is already an envelope
        // under the retired key, and encrypting *that* would wrap it a second
        // time — the row would then need two decryptions to read, one of them
        // with a key that is about to be retired. Every MFA user would be
        // locked out, and the damage would only surface at their next sign-in.
        //
        // `decryptField` passes plaintext through unchanged, so this is also
        // correct for the first run.
        const plaintext = decryptField(row.value!);

        await tx.execute(
          sql`UPDATE ${sql.raw(`"${schema}"."${table}"`)}
              SET ${sql.raw(`"${column}"`)} = ${encryptField(plaintext)}
              WHERE id = ${row.id}`
        );
      }
      rewritten++;
    }

    return { label, scanned: rows.length, rewritten, skipped, missing: false };
  });
}

async function main() {
  if (!encryptionConfigured()) {
    console.error(
      "ENCRYPTION_KEY is not set, or is not 32 bytes of base64.\n" +
        "Generate one with: openssl rand -base64 32"
    );
    process.exit(1);
  }

  console.log(dryRun ? "Encrypting fields at rest (dry run)\n" : "Encrypting fields at rest\n");

  const results: Result[] = [];
  for (const target of TARGETS) {
    results.push(await encryptColumn(target));
  }

  let totalRewritten = 0;
  for (const r of results) {
    if (r.missing) {
      console.log(`  skip  ${r.label} — table not present`);
      continue;
    }
    totalRewritten += r.rewritten;
    const verb = dryRun ? "would rewrite" : "rewrote";
    console.log(
      `  ${r.rewritten > 0 ? "*" : " "}     ${r.label}: ${verb} ${r.rewritten}, ` +
        `already current ${r.skipped}, scanned ${r.scanned}`
    );
  }

  console.log(
    `\n${dryRun ? "Would rewrite" : "Rewrote"} ${totalRewritten} value${
      totalRewritten === 1 ? "" : "s"
    }.`
  );

  if (!dryRun && totalRewritten === 0) {
    console.log("Nothing left to encrypt — safe to drop ENCRYPTION_KEY_PREVIOUS.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Encryption backfill failed:", error);
    process.exit(1);
  });
