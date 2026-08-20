/**
 * Deletes punch photographs that have passed their organisation's retention.
 *
 * Run from a scheduled job:
 *   npx tsx scripts/purge-punch-photos.ts          # report only
 *   npx tsx scripts/purge-punch-photos.ts --apply  # actually delete
 *
 * Retention is a promise made to the person photographed, and a promise kept
 * only by a column nobody acts on is not kept. The viewing route already
 * refuses an expired image, so an unrun purge does not leak one — but the bytes
 * are still there, which is not what the employee was told.
 *
 * Deletes the object first, then the row. If it stops in between, the row
 * points at an object that is gone and the viewer gets an error rather than a
 * face. The reverse order would leave the image in the bucket with nothing left
 * pointing at it, which nothing would ever find again.
 *
 * Dry by default. A tool whose whole job is deleting other people's data should
 * make you ask for it.
 */
import "./load-env";
import { and, eq, lt } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { attendancePolicies, attendancePunchPhotos } from "../src/db/schema/attendance";
import { DEFAULT_RETENTION_DAYS, clampRetention } from "../src/lib/attendance-selfie";
import { deleteObject, storageConfigured } from "../src/lib/storage/object-store";

const apply = process.argv.includes("--apply");

/**
 * `withTenant` insists on an orgId even for a superuser sweep, and rightly: the
 * guard exists so a tenant-scoped query cannot run without a tenant. The policy
 * table is itself the list of organisations, so the first read uses a nil uuid
 * with the superuser flag — the policies see through it — and every read after
 * that is scoped to a real organisation.
 */
const SWEEP_ORG = "00000000-0000-0000-0000-000000000000";

async function main() {
  if (!storageConfigured()) {
    console.error("Object storage is not configured; nothing to purge from.");
    process.exit(1);
  }

  const orgs = await withTenant({ orgId: SWEEP_ORG, superuser: true }, async (tx) =>
    tx
      .select({
        orgId: attendancePolicies.orgId,
        retention: attendancePolicies.selfieRetentionDays,
      })
      .from(attendancePolicies)
  );

  if (orgs.length === 0) {
    console.log("No organisation has an attendance policy, so no photographs exist.");
    return;
  }

  let expired = 0;
  let deleted = 0;
  const failures: string[] = [];

  for (const org of orgs) {
    const days = clampRetention(org.retention ?? DEFAULT_RETENTION_DAYS);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await withTenant({ orgId: org.orgId, superuser: true }, async (tx) =>
      tx
        .select({ id: attendancePunchPhotos.id, objectKey: attendancePunchPhotos.objectKey })
        .from(attendancePunchPhotos)
        .where(
          and(
            eq(attendancePunchPhotos.orgId, org.orgId),
            lt(attendancePunchPhotos.takenAt, cutoff)
          )
        )
    );

    expired += rows.length;

    console.log(
      `${org.orgId}  retention ${days}d  cutoff ${cutoff.toISOString().slice(0, 10)}  ` +
        `${rows.length} past retention`
    );

    if (!apply) continue;

    for (const row of rows) {
      try {
        await deleteObject(row.objectKey);
        await withTenant({ orgId: org.orgId, superuser: true }, async (tx) => {
          await tx.delete(attendancePunchPhotos).where(eq(attendancePunchPhotos.id, row.id));
        });
        deleted += 1;
      } catch (e) {
        failures.push(`${row.objectKey}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  console.log(
    apply
      ? `\n${deleted} of ${expired} expired photograph(s) deleted, ${failures.length} failed.`
      : `\n${expired} photograph(s) are past retention. Re-run with --apply to delete them.`
  );

  for (const failure of failures) console.error(`  ${failure}`);
  if (failures.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
