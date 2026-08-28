// ═══════════════════════════════════════════════════════════════
// BACKFILL / RECONCILE — HRMS employees into Paystub
// ═══════════════════════════════════════════════════════════════
//
// Dry-run by default:
//   npx tsx scripts/sync-employees-to-paystub.ts
//
// Actually sends one active employee at a time:
//   npx tsx scripts/sync-employees-to-paystub.ts --confirm

import "./load-env";
import { and, asc, isNull, eq } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { employees } from "../src/db/schema/hrms";
import { employeeToPaystubSyncBody } from "../src/lib/paystub-client";
import {
  attemptPaystubEmployeeSync,
  queuePaystubEmployeeSync,
} from "../src/lib/paystub-sync-outbox";

const confirm = process.argv.includes("--confirm");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const rows = await withTenant({ orgId: "", superuser: true }, async (tx) =>
    tx
      .select({ id: employees.id, orgId: employees.orgId, employee: employees })
      .from(employees)
      .where(and(eq(employees.status, "active"), isNull(employees.deletedAt)))
      .orderBy(asc(employees.orgId), asc(employees.employeeCode))
  );

  console.log(`\n${rows.length} active employee(s) found.\n`);

  let ready = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    if (!confirm) {
      try {
        const body = employeeToPaystubSyncBody({ employee: row.employee });
        ready++;
        console.log(`  ready    org=${row.orgId} employee=${row.id} paystubOrg=${body.orgId} entity=${body.entityId}`);
      } catch (error) {
        failed++;
        console.log(`  missing  org=${row.orgId} employee=${row.id} — ${(error as Error).message.slice(0, 160)}`);
      }
      continue;
    }

    try {
      await withTenant({ orgId: row.orgId, superuser: true }, async (tx) => {
        await queuePaystubEmployeeSync(tx, row.orgId, row.id);
      });
      const result = await attemptPaystubEmployeeSync({ orgId: row.orgId, superuser: true }, row.id);
      if (result.ok) {
        if (result.created) created++;
        else updated++;
        console.log(`  synced   org=${row.orgId} employee=${row.id} ${result.created ? "created" : "updated"}`);
      } else {
        failed++;
        console.log(`  FAILED   org=${row.orgId} employee=${row.id} — ${result.error?.slice(0, 160)}`);
      }
    } catch (error) {
      failed++;
      console.log(`  FAILED   org=${row.orgId} employee=${row.id} — ${(error as Error).message.slice(0, 160)}`);
    }

    await sleep(250);
  }

  if (!confirm) {
    console.log(`\nDry run only. ${ready} ready, ${failed} missing configuration. Re-run with --confirm to send.\n`);
    return;
  }

  console.log(`\nSummary: created=${created} updated=${updated} failed=${failed}\n`);
}

main()
  .catch((error) => {
    console.log("ERROR:", (error as Error).message.slice(0, 400));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 250));
