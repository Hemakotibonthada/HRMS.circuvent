/*
 * Issues the joining pack for an employee, through the same repository the
 * API route uses — so what lands in `generated_documents` is what the product
 * would have produced, letterhead and all, not a one-off render.
 *
 *   npx tsx --env-file=.env.local scripts/issue-joining-pack.ts <employeeCode> [--confirm]
 */

import { NeonDocumentsRepository } from "../src/db/repositories/documents.neon";
import { withTenant } from "../src/db/client";
import { employees } from "../src/db/schema/hrms";
import { documentTemplates } from "../src/db/schema/talent";
import { and, eq, isNull } from "drizzle-orm";
import type { ApiContext } from "../src/lib/api-context";
import { loadOrgLetterDefaults } from "../src/db/repositories/org-identity";

/** The letters somebody actually needs to report for work. */
const PACK = ["Joining Letter", "Appointment Letter", "Onboarding Welcome Email"];

const code = process.argv[2];
const confirm = process.argv.includes("--confirm");
const orgArg = process.argv.find((a) => a.startsWith("--org="))?.slice(6);

async function main() {
  if (!code) {
    console.log("Usage: issue-joining-pack.ts <employeeCode> [--confirm]");
    return;
  }

  const found = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const rows = await tx
      .select({
        id: employees.id,
        orgId: employees.orgId,
        code: employees.employeeCode,
        first: employees.firstName,
        last: employees.lastName,
        email: employees.workEmail,
      })
      .from(employees)
      .where(and(eq(employees.employeeCode, code), isNull(employees.deletedAt)));

    // An employee code is unique per organisation, not globally: a second
    // tenant's first hire is also CV-001. Without --org that is a coin toss,
    // and the wrong one would be issued somebody else's joining letter.
    if (rows.length > 1 && !orgArg) {
      console.log(`${rows.length} organisations have an employee ${code}. Pass --org=<uuid>:`);
      for (const r of rows) console.log(`   --org=${r.orgId}   ${r.first} ${r.last} <${r.email}>`);
      return undefined;
    }
    return orgArg ? rows.find((r) => r.orgId === orgArg) : rows[0];
  });

  if (!found) {
    console.log(`No employee with code ${code}.`);
    return;
  }

  console.log(`${found.code}  ${found.first} ${found.last}  <${found.email}>`);
  console.log(`org ${found.orgId}\n`);

  const ctx = { orgId: found.orgId, userId: found.id, role: "owner" } as unknown as ApiContext;

  const templates = await withTenant({ orgId: found.orgId, superuser: true }, async (tx) =>
    tx
      .select({
        id: documentTemplates.id,
        name: documentTemplates.name,
        signatoryRoles: documentTemplates.signatoryRoles,
        requiresSignature: documentTemplates.requiresSignature,
      })
      .from(documentTemplates)
      // Scoped by org explicitly: `superuser` lifts row-level security, so
      // without this the other tenant's identically-named templates come back
      // too and every letter looks ambiguous.
      .where(and(eq(documentTemplates.isActive, true), eq(documentTemplates.orgId, found.orgId)))
  );

  const repo = new NeonDocumentsRepository(ctx);

  // Who signs on the company's side. Read from the organisation's own letter
  // defaults rather than hard-coded, so this script issues as whoever the
  // company says signs its letters.
  const defaults = (await loadOrgLetterDefaults(ctx)) ?? {};
  const signatoryName = defaults.signatoryName ?? "Authorised signatory";
  const signatoryEmail = defaults.hrContactEmail ?? found.email;

  for (const name of PACK) {
    const matches = templates.filter((t) => t.name === name);
    if (matches.length === 0) {
      console.log(`  MISSING  ${name} — no active template in this organisation`);
      continue;
    }
    if (matches.length > 1) {
      console.log(`  AMBIGUOUS ${name} — ${matches.length} active templates share this name`);
      continue;
    }

    if (!confirm) {
      console.log(`  would issue  ${name}  (template ${matches[0].id})`);
      continue;
    }

    try {
      // Every signatory slot the template declares needs somebody to sign it.
      // The employee signs as themselves; every other role is the company
      // side, which is whoever the organisation named as its signatory.
      const roles = (matches[0].signatoryRoles as string[] | null) ?? [];
      const recipients: Record<string, { email: string; name?: string }> = {};
      for (const role of roles) {
        recipients[role] =
          role === "employee" || role === "candidate"
            ? { email: found.email, name: `${found.first} ${found.last}`.trim() }
            : { email: signatoryEmail, name: signatoryName };
      }

      const doc = await repo.generate(
        {
          templateId: matches[0].id,
          employeeId: found.id,
          title: `${name} - ${found.first} ${found.last}`,
          ...(Object.keys(recipients).length > 0 ? { recipients } : {}),
        },
        found.id,
      );
      console.log(`  ISSUED   ${name}  -> document ${doc.id}`);
    } catch (error) {
      console.log(`  FAILED   ${name} — ${(error as Error).message.slice(0, 220)}`);
    }
  }

  if (!confirm) console.log("\nDry run. Re-run with --confirm to issue.");
}

main().then(() => process.exit(0));
