// ═══════════════════════════════════════════════════════════════
// HIRE PROVENANCE — writing it into the audit trail
// ═══════════════════════════════════════════════════════════════
// Separate from the read (`hire-provenance.neon.ts`) and from the rule
// (`lib/hire-provenance.ts`) because it is the only part of the three that
// writes, and the only one that must never fail the request it accompanies.
//
// The link columns are set here too. They exist on `hrms.employees` —
// `candidate_id` and `application_id`, added by ATS's own migration 010 — but
// are absent from this app's Drizzle schema, so `NeonEmployeeRepository.create`
// cannot populate them. Setting them immediately after the insert is what makes
// an employee created through this route traceable in exactly the way one
// created by the ATS handoff already is.

import { and, eq, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees } from "@/db/schema";
import { auditLog } from "@/db/schema/identity";
import { provenanceAuditNote, type HireProvenance, type ProvenanceDecision } from "@/lib/hire-provenance";

/**
 * Records where an employee came from.
 *
 * Never throws. The employee already exists by the time this runs, and
 * failing the request afterwards would tell the caller their hire did not
 * happen when it did — leaving them to create it a second time. A missing
 * audit entry is a gap somebody can close; a duplicate employee is a person
 * paid twice.
 */
export async function recordProvenance(
  ctx: TenantContext,
  employeeId: string,
  decision: ProvenanceDecision,
  provenance: HireProvenance
): Promise<void> {
  try {
    if (provenance.candidateId || provenance.applicationId) {
      await withTenant(ctx, async (tx) => {
        // Raw, because these two columns are owned by an ATS migration and are
        // not in this app's schema — see the header. Parameterised, and the
        // ids have already been through Zod's uuid check at the route.
        await tx.execute(
          sql`UPDATE hrms.employees
                 SET candidate_id   = COALESCE(${provenance.candidateId}::uuid, candidate_id),
                     application_id = COALESCE(${provenance.applicationId}::uuid, application_id)
               WHERE id = ${employeeId}::uuid
                 AND org_id = ${ctx.orgId}::uuid`
        );
      });
    }

    await withTenant(ctx, async (tx) => {
      await tx.insert(auditLog).values({
        orgId: ctx.orgId,
        actorId: ctx.userId ?? null,
        app: "hrms",
        action: decision.overridden ? "employee.create_without_hire" : "employee.create_from_hire",
        entityType: "employee",
        entityId: employeeId,
        after: {
          candidateId: provenance.candidateId,
          applicationId: provenance.applicationId,
          offerStatus: provenance.offerStatus,
          overridden: decision.overridden,
          note: provenanceAuditNote(decision, provenance),
        },
        hash: "pending",
      });
    });
  } catch (error) {
    console.warn("[hire-provenance] Could not record where this employee came from.", {
      orgId: ctx.orgId,
      employeeId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export { and, eq };
