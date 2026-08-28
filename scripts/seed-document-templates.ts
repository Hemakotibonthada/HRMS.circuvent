// ═══════════════════════════════════════════════════════════════
// SEED DOCUMENT TEMPLATES
// ═══════════════════════════════════════════════════════════════
// Installs the eight templates in `src/lib/document-templates/catalog.ts` into
// every organization that does not already have them.
//
// Runs as superuser, because the whole point is to write across every tenant.
// That is the one thing this script does that application code must never do,
// and it is why it is a script rather than a route.
//
// Two properties matter more than anything else here:
//
//   * **It never overwrites.** A template is matched on (org_id, name) and
//     skipped if present. HR teams edit these — an offer letter is a legal
//     instrument and the wording gets negotiated with a lawyer. A seed that
//     reinstalled the stock text on every deploy would silently revert that,
//     and nobody would notice until a candidate received the wrong terms.
//
//   * **It is idempotent.** Re-running it is a no-op. An interrupted run can
//     simply be repeated, which matches how `migrate-to-neon.ts` behaves.
//
// Usage:
//   npm run db:seed:templates              # install where missing
//   npm run db:seed:templates -- --dry-run # report only, write nothing
//   npm run db:seed:templates -- --org <uuid>

import "./load-env";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { organizations } from "../src/db/schema/identity";
import { documentTemplates } from "../src/db/schema/talent";
import { extractTokens } from "../src/lib/document-rules";
import { TEMPLATE_CATALOG } from "../src/lib/document-templates/catalog";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const orgFilter = args[args.indexOf("--org") + 1];
const onlyOrg = args.includes("--org") && orgFilter && !orgFilter.startsWith("--")
  ? orgFilter
  : undefined;

interface OrgResult {
  orgId: string;
  orgName: string;
  installed: string[];
  skipped: string[];
}

async function listOrganizations(): Promise<{ id: string; name: string }[]> {
  // An empty orgId with superuser set is how the other scripts read across
  // tenants; RLS is bypassed for this connection only.
  return withTenant({ orgId: "", superuser: true }, async (tx) => {
    const rows = await tx
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(sql`${organizations.deletedAt} is null`)
      .orderBy(organizations.name);

    return onlyOrg ? rows.filter((r) => r.id === onlyOrg) : rows;
  });
}

async function seedOrganization(orgId: string, orgName: string): Promise<OrgResult> {
  const result: OrgResult = { orgId, orgName, installed: [], skipped: [] };

  for (const template of TEMPLATE_CATALOG) {
    await withTenant({ orgId, superuser: true }, async (tx) => {
      // Matched on name because the table has no template_type column. The
      // catalog's names are stable and unique, and are the same strings an HR
      // admin sees in the template list.
      const [existing] = await tx
        .select({ id: documentTemplates.id })
        .from(documentTemplates)
        .where(
          and(eq(documentTemplates.orgId, orgId), eq(documentTemplates.name, template.name))
        )
        .limit(1);

      if (existing) {
        result.skipped.push(template.name);
        return;
      }

      if (dryRun) {
        result.installed.push(template.name);
        return;
      }

      await tx.insert(documentTemplates).values({
        orgId,
        name: template.name,
        category: template.category,
        body: template.body,
        // Derived from the body rather than restated, so the stored list
        // cannot disagree with the template it describes.
        requiredTokens: extractTokens(template.body),
        requiresSignature: template.requiresSignature,
        signatoryRoles: template.signatoryRoles,
      });

      result.installed.push(template.name);
    });
  }

  return result;
}

async function main(): Promise<void> {
  console.log(
    dryRun
      ? "Dry run — reporting what would be installed, writing nothing.\n"
      : "Installing document templates.\n"
  );

  const orgs = await listOrganizations();

  if (orgs.length === 0) {
    // Not an error. A fresh database legitimately has no organizations, and
    // failing here would break a first deploy for no reason.
    console.log(
      onlyOrg
        ? `No organization found with id ${onlyOrg}.`
        : "No organizations found. Nothing to seed."
    );
    return;
  }

  let installed = 0;
  let skipped = 0;

  for (const org of orgs) {
    const result = await seedOrganization(org.id, org.name);
    installed += result.installed.length;
    skipped += result.skipped.length;

    const summary =
      result.installed.length > 0
        ? `${result.installed.length} installed`
        : "already complete";
    console.log(`  ${org.name.padEnd(34)} ${summary}`);

    for (const name of result.installed) {
      console.log(`      + ${name}`);
    }
  }

  console.log(
    `\n${orgs.length} organization${orgs.length === 1 ? "" : "s"} · ` +
      `${installed} template${installed === 1 ? "" : "s"} ${dryRun ? "would be " : ""}installed · ` +
      `${skipped} left untouched`
  );

  if (skipped > 0) {
    console.log(
      "\nExisting templates are never overwritten. To take a new version of one,\n" +
        "delete or rename the organization's copy and run this again."
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSeeding failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
