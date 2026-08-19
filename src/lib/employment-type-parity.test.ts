// ═══════════════════════════════════════════════════════════════
// LIVE — do the employment types the form offers actually exist?
// ═══════════════════════════════════════════════════════════════
// `EMPLOYMENT_TYPE_OPTIONS` is a restatement of the `hrms.employment_type`
// database enum, and a restatement drifts. When it drifted last time the
// consequence was exact and user-visible: the dropdown offered "Consultant",
// the enum had never heard of one, and choosing it produced
// `"Consultant" is not an employment type` from a control that offered it.
//
// A unit test cannot catch that — both lists are TypeScript, and they agreed
// with each other while disagreeing with Postgres. Only the database knows.
//
//   $env:DATABASE_URL = "postgres://..."; npx vitest run employment-type-parity
//
// Skipped without a connection string rather than passed, because a test that
// quietly succeeds when it cannot reach the thing it is checking is worse than
// no test at all.

import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { EMPLOYMENT_TYPE_OPTIONS, EMPLOYMENT_TYPE_VALUES } from "./employee-rules";

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

async function enumLabels(name: string): Promise<string[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query<{ enumlabel: string }>(
      `SELECT e.enumlabel
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = $1
        ORDER BY e.enumsortorder`,
      [name]
    );
    return res.rows.map((r) => r.enumlabel);
  } finally {
    await client.end();
  }
}

live("employment types", () => {
  it("are all values the database will actually store", async () => {
    const labels = await enumLabels("employment_type");
    expect(labels.length, "no employment_type enum found").toBeGreaterThan(0);

    const missing = EMPLOYMENT_TYPE_VALUES.filter((v) => !labels.includes(v));
    expect(
      missing,
      `the form offers ${missing.join(", ")}, which hrms.employment_type does not accept — ` +
        `either add the enum value or remove the option`
    ).toEqual([]);
  });

  it("cover everything the database can store", async () => {
    // The other direction. A value in the enum that the form never offers is a
    // choice nobody can make — which is how "freelance" existed in the database
    // and was absent from the dropdown for as long as "consultant" was in the
    // dropdown and absent from the database.
    const labels = await enumLabels("employment_type");
    const unoffered = labels.filter((l) => !EMPLOYMENT_TYPE_VALUES.includes(l));
    expect(
      unoffered,
      `hrms.employment_type accepts ${unoffered.join(", ")}, which the form never offers`
    ).toEqual([]);
  });

  it("specifically include consultant, the one that was reported", async () => {
    const labels = await enumLabels("employment_type");
    expect(labels).toContain("consultant");
    expect(EMPLOYMENT_TYPE_OPTIONS.map((o) => o.label)).toContain("Consultant");
  });
});
