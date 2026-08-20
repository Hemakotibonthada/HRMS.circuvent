// ═══════════════════════════════════════════════════════════════
// DOCUMENT TEMPLATES REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Lets HR/admin edit the letter and mail templates documents.neon.ts renders,
// without ever losing the shipped wording or disturbing a document already
// issued from an earlier version.
//
// `planTemplateEdit` and `planRevert` are pure — same split as
// src/lib/governance.ts's `planErasure`, and tested the same way, directly,
// with no database (see document-templates.test.ts). Both return a plan: the
// version-history row(s) to insert and the fields to write onto the live
// row, as plain data. Neither function's return type has anywhere to put a
// `generatedDocuments` write, and neither is handed a database connection
// that could make one anyway — a rendered, possibly signed document staying
// exactly as issued isn't a rule this file has to remember to obey each time,
// it is a shape this file cannot violate even by mistake.
//
// The class below is the thin, untested-by-design part: it fetches the
// current row and its version history, calls the pure planner, and writes
// the result inside one locked transaction. If it ever starts computing
// version numbers or deciding what counts as "the first edit" itself instead
// of asking the planner, the safety property above stops being something you
// can see just by reading a type signature.

import { desc, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { documentTemplates, documentTemplateVersions } from "@/db/schema/talent";
import { extractTokens } from "@/lib/document-rules";
import { validateTemplateEdit } from "@/lib/document-templates/validation";
import { NotFoundError, RepositoryError } from "./types";

export type TemplateOrigin = "seed" | "custom";

export interface TemplateListItem {
  id: string;
  name: string;
  category: string;
  origin: TemplateOrigin;
  version: number;
  isActive: boolean;
  requiresSignature: boolean;
  updatedAt: string;
  /** Denormalized onto the row at edit time — see the `updatedByEmail` comment
   * in talent.ts. Null means nobody ever has: this is still the shipped
   * default. */
  updatedByEmail: string | null;
}

export interface TemplateDetail extends TemplateListItem {
  body: string;
  requiredTokens: string[];
  signatoryRoles: string[];
  createdAt: string;
}

export interface TemplateVersionRecord {
  version: number;
  name: string;
  category: string;
  body: string;
  requiredTokens: string[];
  requiresSignature: boolean;
  signatoryRoles: string[];
  changeNote: string | null;
  changedByEmail: string | null;
  /** Null only for a backfilled version-1 row: it records what shipped, not
   * an edit anyone made — see `planTemplateEdit`. */
  changedById: string | null;
  createdAt: string;
}

function toListItem(row: typeof documentTemplates.$inferSelect): TemplateListItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    origin: row.origin as TemplateOrigin,
    version: row.version,
    isActive: row.isActive,
    requiresSignature: row.requiresSignature,
    updatedAt: row.updatedAt.toISOString(),
    updatedByEmail: row.updatedByEmail ?? null,
  };
}

function toDetail(row: typeof documentTemplates.$inferSelect): TemplateDetail {
  return {
    ...toListItem(row),
    body: row.body,
    // Derived from the body, never trusted from storage — the same reason
    // documents.neon.ts's listTemplates() does this: a stored list goes stale
    // the moment someone edits the body, which for this file is every save.
    requiredTokens: extractTokens(row.body),
    signatoryRoles: (row.signatoryRoles as string[]) ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

function toVersionRecord(
  row: typeof documentTemplateVersions.$inferSelect
): TemplateVersionRecord {
  return {
    version: row.version,
    name: row.name,
    category: row.category,
    body: row.body,
    requiredTokens: extractTokens(row.body),
    requiresSignature: row.requiresSignature,
    signatoryRoles: (row.signatoryRoles as string[]) ?? [],
    changeNote: row.changeNote ?? null,
    changedByEmail: row.changedByEmail ?? null,
    changedById: row.changedById ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── Pure planning ───────────────────────────────────────────

/** The fields of a live template row a plan needs to read — not the full
 * Drizzle row type, so the pure functions below can be unit-tested with a
 * plain object and no schema import. */
export interface CurrentTemplate {
  id: string;
  orgId: string;
  name: string;
  category: string;
  body: string;
  requiresSignature: boolean;
  signatoryRoles: string[];
  version: number;
}

/** What a version-history insert needs — matches `documentTemplateVersions`'s
 * columns, again as a plain object rather than a Drizzle row. */
export interface VersionSnapshot {
  templateId: string;
  orgId: string;
  version: number;
  name: string;
  category: string;
  body: string;
  requiredTokens: string[];
  requiresSignature: boolean;
  signatoryRoles: string[];
  changeNote: string | null;
  changedById: string | null;
  changedByEmail: string | null;
}

export interface TemplateEditPlan {
  /**
   * A snapshot of the row exactly as it was a moment ago, present only when
   * this template has no version history yet.
   *
   * Without this, the very first edit to a shipped template would overwrite
   * document_templates.body and there would be nothing left anywhere — not a
   * row, not a version — to prove what it used to say. A template with even
   * one prior edit already has that proof in its last version row, which is
   * why this is null after the first edit, not written every time.
   */
  backfillVersion: VersionSnapshot | null;
  newVersion: VersionSnapshot;
  templateUpdate: {
    body: string;
    requiredTokens: string[];
    version: number;
    origin: "custom";
    updatedById: string | null;
    updatedByEmail: string | null;
  };
}

/**
 * Plans the writes for one template edit. Pure: given the same inputs it
 * always returns the same plan, and it touches nothing — the caller decides
 * whether and how to persist it.
 *
 * `latestVersionNumber` is the highest version number already in
 * `documentTemplateVersions` for this template, or null when there are none.
 * Passed in rather than looked up here so this function can be tested without
 * a database — the repository class below is the only thing that queries.
 */
export function planTemplateEdit(params: {
  current: CurrentTemplate;
  latestVersionNumber: number | null;
  newBody: string;
  changeNote?: string | null;
  editedById: string | null;
  editedByEmail: string | null;
}): TemplateEditPlan {
  const { current, latestVersionNumber, newBody, changeNote, editedById, editedByEmail } =
    params;

  const isFirstEdit = latestVersionNumber === null;

  const backfillVersion: VersionSnapshot | null = isFirstEdit
    ? {
        templateId: current.id,
        orgId: current.orgId,
        // The version number the row carried before this edit — for a
        // template nobody has touched, that is the `1` it was seeded with.
        version: current.version,
        name: current.name,
        category: current.category,
        body: current.body,
        requiredTokens: extractTokens(current.body),
        requiresSignature: current.requiresSignature,
        signatoryRoles: current.signatoryRoles,
        changeNote: null,
        // Nobody edited the seed content; this row exists to preserve it, not
        // to attribute it to whoever happens to be saving the first real
        // edit.
        changedById: null,
        changedByEmail: null,
      }
    : null;

  const nextVersion = (isFirstEdit ? current.version : (latestVersionNumber as number)) + 1;

  const newVersion: VersionSnapshot = {
    templateId: current.id,
    orgId: current.orgId,
    version: nextVersion,
    name: current.name,
    category: current.category,
    body: newBody,
    requiredTokens: extractTokens(newBody),
    requiresSignature: current.requiresSignature,
    signatoryRoles: current.signatoryRoles,
    changeNote: changeNote ?? null,
    changedById: editedById,
    changedByEmail: editedByEmail,
  };

  return {
    backfillVersion,
    newVersion,
    templateUpdate: {
      body: newBody,
      requiredTokens: newVersion.requiredTokens,
      version: nextVersion,
      // Ratchets forward only. See the `origin` column comment in talent.ts:
      // this is "has a human ever touched this", and a later revert to the
      // exact shipped words is still a human decision made today, not proof
      // that none was ever made.
      origin: "custom",
      updatedById: editedById,
      updatedByEmail: editedByEmail,
    },
  };
}

export interface TemplateRevertPlan {
  newVersion: VersionSnapshot;
  templateUpdate: {
    name: string;
    category: string;
    body: string;
    requiredTokens: string[];
    requiresSignature: boolean;
    signatoryRoles: string[];
    version: number;
    updatedById: string | null;
    updatedByEmail: string | null;
  };
}

/**
 * Plans a revert to an earlier version. Also pure, for the same reason as
 * `planTemplateEdit`.
 *
 * A revert is a save whose new content happens to come from an old snapshot,
 * not a special case with its own data shape — it still gets a new version
 * row, still records who did it and when, and the row it restores loses
 * nothing: the version being abandoned (whatever was live a moment before the
 * revert) is already preserved as its own row, exactly like any other edit.
 *
 * Deliberately not re-validated against today's token rules (see
 * validateTemplateEdit in lib/document-templates/validation.ts) — this text
 * was live once already. Refusing to restore it would leave a broken
 * template with no way back to the last known-good state, which is the one
 * outcome a revert feature exists to prevent.
 */
export function planRevert(params: {
  current: CurrentTemplate;
  /** The highest version number on record — always present, because a
   * revert target found by the caller implies at least one version row
   * exists. */
  latestVersionNumber: number;
  target: VersionSnapshot;
  revertedById: string | null;
  revertedByEmail: string | null;
  changeNote?: string | null;
}): TemplateRevertPlan {
  const { current, latestVersionNumber, target, revertedById, revertedByEmail, changeNote } =
    params;

  const nextVersion = latestVersionNumber + 1;

  const newVersion: VersionSnapshot = {
    templateId: current.id,
    orgId: current.orgId,
    version: nextVersion,
    name: target.name,
    category: target.category,
    body: target.body,
    requiredTokens: extractTokens(target.body),
    requiresSignature: target.requiresSignature,
    signatoryRoles: target.signatoryRoles,
    changeNote: changeNote ?? `Reverted to version ${target.version}`,
    changedById: revertedById,
    changedByEmail: revertedByEmail,
  };

  return {
    newVersion,
    templateUpdate: {
      name: newVersion.name,
      category: newVersion.category,
      body: newVersion.body,
      requiredTokens: newVersion.requiredTokens,
      requiresSignature: newVersion.requiresSignature,
      signatoryRoles: newVersion.signatoryRoles,
      version: nextVersion,
      updatedById: revertedById,
      updatedByEmail: revertedByEmail,
    },
  };
}

// ─── Neon-backed repository ──────────────────────────────────

export class NeonDocumentTemplatesRepository {
  constructor(private readonly ctx: TenantContext) {}

  /**
   * Every template this org can edit — active only, matching
   * documents.neon.ts's listTemplates(). A retired template is not offered
   * for editing any more than it is offered for generating a new document
   * from.
   */
  async list(): Promise<TemplateListItem[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.isActive, true))
        .orderBy(documentTemplates.category, documentTemplates.name);
      return rows.map(toListItem);
    });
  }

  async getById(id: string): Promise<TemplateDetail | null> {
    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.id, id))
        .limit(1);
      return row ? toDetail(row) : null;
    });
  }

  /** Oldest to newest is the DB order; newest-first is what a "history" panel
   * wants to show, so this reverses it at the boundary rather than asking
   * every caller to remember to. */
  async listVersions(templateId: string): Promise<TemplateVersionRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(documentTemplateVersions)
        .where(eq(documentTemplateVersions.templateId, templateId))
        .orderBy(desc(documentTemplateVersions.version));
      return rows.map(toVersionRecord);
    });
  }

  /**
   * Saves an edited body.
   *
   * Locks the row before reading it so two concurrent saves cannot both read
   * version 4 and both write version 5 — the second commit would silently
   * overwrite the first's history entry, which is exactly the "no record of
   * what it said before" liability this table exists to prevent. Everything
   * this method writes comes from `planTemplateEdit`; this method's own job
   * is only to gather what the planner needs and persist what it decides.
   *
   * Re-validates with `validateTemplateEdit` here, not only at the API route:
   * `generate()` in documents.neon.ts checks `validateTemplate` inside the
   * repository too, rather than trusting the route to have done it, and an
   * unknown token reaching a saved template is the exact failure this whole
   * feature exists to prevent — it must not depend on every future caller of
   * this method remembering to check first.
   */
  async update(input: {
    id: string;
    newBody: string;
    changeNote?: string;
    editedById: string | null;
    editedByEmail: string | null;
  }): Promise<TemplateDetail> {
    return withTenant(this.ctx, async (tx) => {
      const [current] = await tx
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.id, input.id))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundError("Template", input.id);
      if (!current.isActive) {
        throw new RepositoryError("This template has been retired", 409);
      }

      // Checked against the body this transaction just locked and read, not
      // a caller-supplied "previous body" — the same TOCTOU concern
      // `.for("update")` above closes for concurrent writers applies here to
      // spoofed input: only the database's own last-saved text can be
      // trusted as the self-referential "already known" set.
      const check = validateTemplateEdit({
        name: current.name,
        category: current.category,
        previousBody: current.body,
        newBody: input.newBody,
        requiresSignature: current.requiresSignature,
        signatoryRoles: (current.signatoryRoles as string[]) ?? [],
      });
      if (!check.valid) {
        throw new RepositoryError(check.message ?? "This draft could not be validated", 422);
      }

      const [latest] = await tx
        .select({ version: documentTemplateVersions.version })
        .from(documentTemplateVersions)
        .where(eq(documentTemplateVersions.templateId, input.id))
        .orderBy(desc(documentTemplateVersions.version))
        .limit(1);

      const plan = planTemplateEdit({
        current: {
          id: current.id,
          orgId: current.orgId,
          name: current.name,
          category: current.category,
          body: current.body,
          requiresSignature: current.requiresSignature,
          signatoryRoles: (current.signatoryRoles as string[]) ?? [],
          version: current.version,
        },
        latestVersionNumber: latest?.version ?? null,
        newBody: input.newBody,
        changeNote: input.changeNote ?? null,
        editedById: input.editedById,
        editedByEmail: input.editedByEmail,
      });

      if (plan.backfillVersion) {
        await tx.insert(documentTemplateVersions).values({
          orgId: this.ctx.orgId,
          templateId: input.id,
          version: plan.backfillVersion.version,
          name: plan.backfillVersion.name,
          category: plan.backfillVersion.category,
          body: plan.backfillVersion.body,
          requiredTokens: plan.backfillVersion.requiredTokens,
          requiresSignature: plan.backfillVersion.requiresSignature,
          signatoryRoles: plan.backfillVersion.signatoryRoles,
          changeNote: plan.backfillVersion.changeNote,
          changedById: plan.backfillVersion.changedById,
          changedByEmail: plan.backfillVersion.changedByEmail,
        });
      }

      await tx.insert(documentTemplateVersions).values({
        orgId: this.ctx.orgId,
        templateId: input.id,
        version: plan.newVersion.version,
        name: plan.newVersion.name,
        category: plan.newVersion.category,
        body: plan.newVersion.body,
        requiredTokens: plan.newVersion.requiredTokens,
        requiresSignature: plan.newVersion.requiresSignature,
        signatoryRoles: plan.newVersion.signatoryRoles,
        changeNote: plan.newVersion.changeNote,
        changedById: plan.newVersion.changedById,
        changedByEmail: plan.newVersion.changedByEmail,
      });

      const [updated] = await tx
        .update(documentTemplates)
        .set({
          body: plan.templateUpdate.body,
          requiredTokens: plan.templateUpdate.requiredTokens,
          version: plan.templateUpdate.version,
          origin: plan.templateUpdate.origin,
          updatedById: plan.templateUpdate.updatedById,
          updatedByEmail: plan.templateUpdate.updatedByEmail,
          updatedAt: new Date(),
        })
        .where(eq(documentTemplates.id, input.id))
        .returning();

      return toDetail(updated);
    });
  }

  /**
   * Restores an earlier version as the live body.
   *
   * `generatedDocuments.renderedBody` is never read, written, or referenced
   * anywhere in this file — this method's `.set()` call lists every column
   * it touches, and none of them belong to that table. A document already
   * issued or signed was rendered once, in `documents.neon.ts`'s `generate()`,
   * into its own row; reverting the template it came from has no path back
   * to that row and cannot reach it by construction, not merely by care.
   */
  async revert(input: {
    id: string;
    toVersion: number;
    changeNote?: string;
    revertedById: string | null;
    revertedByEmail: string | null;
  }): Promise<TemplateDetail> {
    return withTenant(this.ctx, async (tx) => {
      const [current] = await tx
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.id, input.id))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundError("Template", input.id);

      const versions = await tx
        .select()
        .from(documentTemplateVersions)
        .where(eq(documentTemplateVersions.templateId, input.id))
        .orderBy(desc(documentTemplateVersions.version));

      const latest = versions[0];
      if (!latest) {
        throw new RepositoryError(
          "This template has never been edited, so there is no earlier version to revert to",
          409
        );
      }

      const target = versions.find((v) => v.version === input.toVersion);
      if (!target) throw new NotFoundError("Template version", String(input.toVersion));

      const plan = planRevert({
        current: {
          id: current.id,
          orgId: current.orgId,
          name: current.name,
          category: current.category,
          body: current.body,
          requiresSignature: current.requiresSignature,
          signatoryRoles: (current.signatoryRoles as string[]) ?? [],
          version: current.version,
        },
        latestVersionNumber: latest.version,
        target: toVersionSnapshot(target),
        revertedById: input.revertedById,
        revertedByEmail: input.revertedByEmail,
        changeNote: input.changeNote ?? null,
      });

      await tx.insert(documentTemplateVersions).values({
        orgId: this.ctx.orgId,
        templateId: input.id,
        version: plan.newVersion.version,
        name: plan.newVersion.name,
        category: plan.newVersion.category,
        body: plan.newVersion.body,
        requiredTokens: plan.newVersion.requiredTokens,
        requiresSignature: plan.newVersion.requiresSignature,
        signatoryRoles: plan.newVersion.signatoryRoles,
        changeNote: plan.newVersion.changeNote,
        changedById: plan.newVersion.changedById,
        changedByEmail: plan.newVersion.changedByEmail,
      });

      const [updated] = await tx
        .update(documentTemplates)
        .set({
          name: plan.templateUpdate.name,
          category: plan.templateUpdate.category,
          body: plan.templateUpdate.body,
          requiredTokens: plan.templateUpdate.requiredTokens,
          requiresSignature: plan.templateUpdate.requiresSignature,
          signatoryRoles: plan.templateUpdate.signatoryRoles,
          version: plan.templateUpdate.version,
          updatedById: plan.templateUpdate.updatedById,
          updatedByEmail: plan.templateUpdate.updatedByEmail,
          updatedAt: new Date(),
        })
        .where(eq(documentTemplates.id, input.id))
        .returning();

      return toDetail(updated);
    });
  }
}

function toVersionSnapshot(row: typeof documentTemplateVersions.$inferSelect): VersionSnapshot {
  return {
    templateId: row.templateId,
    orgId: row.orgId,
    version: row.version,
    name: row.name,
    category: row.category,
    body: row.body,
    requiredTokens: extractTokens(row.body),
    requiresSignature: row.requiresSignature,
    signatoryRoles: (row.signatoryRoles as string[]) ?? [],
    changeNote: row.changeNote ?? null,
    changedById: row.changedById ?? null,
    changedByEmail: row.changedByEmail ?? null,
  };
}
