// ═══════════════════════════════════════════════════════════════
// BACKFILL — HRMS attendance into Paystub
// ═══════════════════════════════════════════════════════════════
//
// Dry-run by default (lists how many rows would be sent per org):
//   npx tsx scripts/sync-attendance-to-paystub.ts
//
// Push attendance for the current calendar month through today:
//   npx tsx scripts/sync-attendance-to-paystub.ts --confirm
//
// Custom range:
//   npx tsx scripts/sync-attendance-to-paystub.ts --confirm --from=2026-08-01 --to=2026-08-29

import "./load-env";
import { activeOrganisationIds } from "../src/lib/outbox-sweep";
import {
  monthStartFromIsoDate,
  syncAttendanceRangeToPaystub,
} from "../src/lib/paystub-attendance-sync";

const confirm = process.argv.includes("--confirm");

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const orgIds = await activeOrganisationIds();
  console.log(`\n${orgIds.length} organisation(s).\n`);

  for (const orgId of orgIds) {
    const timezone = "Asia/Kolkata";
    const today =
      readArg("to") ?? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    const from = readArg("from") ?? monthStartFromIsoDate(today);

    if (!confirm) {
      console.log(`  ready    org=${orgId} range=${from}..${today}`);
      continue;
    }

    try {
      const result = await syncAttendanceRangeToPaystub({ orgId, superuser: true }, { from, to: today });
      console.log(
        `  synced   org=${orgId} pushed=${result.pushed} skipped=${result.skipped} errors=${result.errors.length}`
      );
      if (result.errors.length > 0) {
        for (const line of result.errors.slice(0, 5)) {
          console.log(`           ${line}`);
        }
      }
    } catch (error) {
      console.log(`  FAILED   org=${orgId} — ${(error as Error).message.slice(0, 200)}`);
    }
  }

  if (!confirm) {
    console.log("\nDry run only. Re-run with --confirm to push attendance to Paystub.\n");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
