/**
 * Deletes punch photographs that have passed their organisation's retention.
 *
 *   npx tsx scripts/purge-punch-photos.ts          # report only
 *   npx tsx scripts/purge-punch-photos.ts --apply  # actually delete
 *
 * Retention is a promise made to the person photographed, and a promise kept
 * only by a column nobody acts on is not kept. The viewing route already
 * refuses an expired image, so an unrun purge does not leak one — but the bytes
 * are still there, which is not what the employee was told.
 *
 * The sweep itself lives in `src/lib/attendance/punch-photo-purge.ts` and also
 * runs from the scheduled cron route, so it happens whether or not anybody
 * remembers this command. This file is the manual door: report first, delete
 * when asked.
 *
 * Dry by default. A tool whose whole job is deleting other people's data should
 * make you ask for it.
 */
import "./load-env";
import { purgeExpiredPunchPhotos } from "../src/lib/attendance/punch-photo-purge";

const apply = process.argv.includes("--apply");

async function main() {
  const result = await purgeExpiredPunchPhotos({ apply });

  if (result.skipped === "storage-not-configured") {
    console.error("Object storage is not configured; nothing to purge from.");
    process.exit(1);
  }
  if (result.skipped === "no-policies") {
    console.log("No organisation has an attendance policy, so no photographs exist.");
    return;
  }

  console.log(`${result.organisations} organisation(s) examined.`);
  console.log(
    apply
      ? `${result.deleted} of ${result.expired} expired photograph(s) deleted, ` +
          `${result.failures.length} failed.`
      : `${result.expired} photograph(s) are past retention. ` +
          `Re-run with --apply to delete them.`
  );

  for (const failure of result.failures) console.error(`  ${failure}`);
  if (result.failures.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error("PURGE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
