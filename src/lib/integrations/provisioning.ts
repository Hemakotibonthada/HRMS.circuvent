// ═══════════════════════════════════════════════════════════════
// WHEN THE TABLE IS NOT THERE YET
// ═══════════════════════════════════════════════════════════════
// The application connects as `hrms_app`, which deliberately holds no CREATE
// privilege on the schema — DDL is an owner's job, not the running app's. So
// between deploying this code and someone applying 0036_integrations.sql there
// is a window where the endpoints exist and the table does not.
//
// Left alone that window produces a 500 and a page that says "Internal server
// error", which tells an administrator nothing about what to do. Postgres is
// specific about this case (42P01, undefined_table) and so is this: a 503 that
// names the migration.

import { NextResponse } from "next/server";

/** Postgres `undefined_table`. */
export function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "42P01") return true;
  // The Neon HTTP driver surfaces the message without always keeping the code.
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /relation .*integrations.* does not exist/i.test(message);
}

export function notProvisioned() {
  return NextResponse.json(
    {
      error:
        "Integrations are not set up on this deployment yet. Apply drizzle/0036_integrations.sql " +
        "with a role that owns the hrms schema, then reload.",
      code: "not_provisioned",
    },
    { status: 503 }
  );
}
