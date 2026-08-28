import { withTenant } from "@/db/client";
import { sql } from "drizzle-orm";

const COLLECTION = "emailLogs";

/**
 * Writes HRMS-sent recruitment mail into the shared audit trail ATS reads.
 *
 * HRMS sends onboarding invites through SMTP directly (not the ATS outbox), so
 * without this row the ATS email screen only sees half the candidate journey.
 */
export async function recordRecruitmentEmailLog(entry: {
  orgId: string;
  to: string;
  subject: string;
  from: string;
  status: "sent" | "failed";
  source: string;
  lastError?: string | null;
}): Promise<void> {
  try {
    await withTenant({ orgId: entry.orgId, superuser: true }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO hrms.doc_store (org_id, collection, data)
            VALUES (${entry.orgId}::uuid, ${COLLECTION}, ${JSON.stringify({
              to: entry.to,
              subject: entry.subject,
              from: entry.from,
              status: entry.status,
              lastError: entry.lastError ?? null,
              sentAt: new Date().toISOString(),
              source: entry.source,
            })}::jsonb)`
      );
    });
  } catch (error) {
    console.error("[recruitment-email-log] could not persist send", error);
  }
}
