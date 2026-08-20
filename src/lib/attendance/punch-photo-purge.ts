// ═══════════════════════════════════════════════════════════════
// PUNCH PHOTOGRAPH RETENTION
// ═══════════════════════════════════════════════════════════════
//
// Deletes punch photographs past the retention their organisation chose.
//
// This existed only as a script somebody had to remember to run, which for a
// retention rule is the same as not existing: the obligation is not "we can
// delete these" but "these are gone by day N". Photographs of employees' faces
// accumulating for ever because a cron entry was never made is exactly the
// failure the retention setting was added to prevent, and nobody would notice
// it — the app works perfectly while it happens.
//
// Extracted here so the scheduled sweep and the command line run the same code.
// A retention rule with two implementations is a retention rule that will
// eventually disagree with itself about what has been deleted.

import { and, eq, lt } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { attendancePolicies, attendancePunchPhotos } from "@/db/schema/attendance";
import { DEFAULT_RETENTION_DAYS, clampRetention } from "@/lib/attendance-selfie";
import { deleteObject, storageConfigured } from "@/lib/storage/object-store";

/**
 * Any organisation, only to open a connection. The sweep runs as superuser and
 * selects across tenants deliberately — it is the one job that must see all of
 * them.
 */
const SWEEP_ORG = "00000000-0000-0000-0000-000000000000";

export interface PurgeOutcome {
  /** True when the sweep did not run at all. */
  skipped?: "storage-not-configured" | "no-policies";
  /** Photographs found past retention. */
  expired: number;
  /** Photographs actually deleted. Equals `expired` on a clean apply run. */
  deleted: number;
  /** Object keys that could not be removed, with the reason. */
  failures: string[];
  /** Organisations examined. */
  organisations: number;
}

/**
 * Runs the sweep.
 *
 * `apply` defaults to **false**. A retention job that deletes by default is one
 * bad import away from deleting everything, and the dry run is what makes it
 * safe to point at production and read the answer first.
 *
 * The image is removed before the row. The other order leaves an object in the
 * bucket that nothing points at, which no later sweep can find because every
 * sweep walks the rows.
 */
export async function purgeExpiredPunchPhotos(
  { apply = false }: { apply?: boolean } = {}
): Promise<PurgeOutcome> {
  const empty: PurgeOutcome = { expired: 0, deleted: 0, failures: [], organisations: 0 };

  if (!storageConfigured()) {
    return { ...empty, skipped: "storage-not-configured" };
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
    return { ...empty, skipped: "no-policies" };
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
          and(eq(attendancePunchPhotos.orgId, org.orgId), lt(attendancePunchPhotos.takenAt, cutoff))
        )
    );

    expired += rows.length;
    if (!apply) continue;

    for (const row of rows) {
      try {
        await deleteObject(row.objectKey);
        await withTenant({ orgId: org.orgId, superuser: true }, async (tx) => {
          await tx.delete(attendancePunchPhotos).where(eq(attendancePunchPhotos.id, row.id));
        });
        deleted += 1;
      } catch (e) {
        // Collected rather than thrown: one unreachable object must not stop
        // the rest of an organisation's photographs being deleted on time.
        failures.push(`${row.objectKey}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { expired, deleted, failures, organisations: orgs.length };
}
