// ═══════════════════════════════════════════════════════════════
// TEMPLATE BACKFILL — getting a new catalog template into old tenants
// ═══════════════════════════════════════════════════════════════
// `provision-tenant.ts` seeds `TEMPLATE_CATALOG` into a tenant when it is
// created, and only then. So adding a template to the catalog gives it to
// every tenant created afterwards and to none created before — which, for a
// product with existing customers, is every tenant that matters.
//
// The compensation revision letter found this: it was added to the catalog,
// shipped, and existed in no organisation's database at all. The endpoint that
// issues it would have answered "no such template" forever, and the only clue
// would have been that message.
//
// ── Idempotent, and additive only ──
// A template an organisation already has is left completely alone. That is not
// laziness about conflict resolution: `document_templates.origin` records
// whether a human has edited the wording, and offer letters are contracts.
// Overwriting a tenant's edited offer letter with the shipped default because
// a *different* template was added would be a silent, serious regression.
//
// Matched by name, because `document_templates` carries no `template_type`
// column — the same way `document-templates/validation.ts` matches them.

import { and, eq, inArray } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { documentTemplates } from "@/db/schema";
import { TEMPLATE_CATALOG } from "@/lib/document-templates/catalog";
import { extractTokens } from "@/lib/document-rules";

export interface BackfillResult {
  orgId: string;
  /** Names of templates that were added. */
  added: string[];
  /** How many the organisation already had. */
  existing: number;
}

/**
 * Adds any catalog template this organisation does not already have.
 *
 * Returns what it did rather than logging it, so a caller can report "nothing
 * to do" distinctly from "added three" — the difference matters when somebody
 * is checking whether a deployment took effect.
 */
export async function backfillTemplatesForOrg(orgId: string): Promise<BackfillResult> {
  return withTenant({ orgId }, async (tx) => {
    const catalogNames = TEMPLATE_CATALOG.map((t) => t.name);

    const present = await tx
      .select({ name: documentTemplates.name })
      .from(documentTemplates)
      .where(
        and(
          eq(documentTemplates.orgId, orgId),
          inArray(documentTemplates.name, catalogNames)
        )
      );

    const have = new Set(present.map((row) => row.name));
    const missing = TEMPLATE_CATALOG.filter((template) => !have.has(template.name));

    if (missing.length === 0) {
      return { orgId, added: [], existing: have.size };
    }

    await tx.insert(documentTemplates).values(
      missing.map((template) => ({
        orgId,
        name: template.name,
        category: template.category,
        body: template.body,
        requiredTokens: extractTokens(template.body),
        requiresSignature: template.requiresSignature,
        signatoryRoles: template.signatoryRoles,
        // "seed" is the default and is left as it is: nobody has edited these,
        // and marking them otherwise would misreport a fresh insert as a
        // human decision.
      }))
    );

    return { orgId, added: missing.map((t) => t.name), existing: have.size };
  });
}
