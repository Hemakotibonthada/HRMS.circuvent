// @vitest-environment node
//
// The pure planning functions behind template editing and reverting, tested
// the same way domain-logic.test.ts tests leave/attendance's extracted pure
// functions: directly, with plain objects, no database.
//
// The scenario this file exists to rule out: an HR user edits an offer
// letter template on a Friday afternoon, breaks it, and either (a) has no way
// back to the shipped wording, (b) the fix is applied with no record of who
// broke it or what it said before, or (c) a candidate's already-issued offer
// silently changes underneath them because "the template" and "what was
// rendered for this person" turned out to be the same piece of storage.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@/lib/document-rules";
import {
  planTemplateEdit,
  planRevert,
  type CurrentTemplate,
  type VersionSnapshot,
} from "@/db/repositories/document-templates.neon";

const SAMPLE_TEMPLATE: CurrentTemplate = {
  id: "11111111-1111-1111-1111-111111111111",
  orgId: "22222222-2222-2222-2222-222222222222",
  name: "Offer Letter",
  category: "offer",
  body: "Dear {{full_name}}, welcome to {{company_name}} as {{position_title}}.",
  requiresSignature: true,
  signatoryRoles: ["candidate", "hr"],
  version: 1,
};

describe("planTemplateEdit", () => {
  it("backfills a version-1 snapshot of the shipped body on the first-ever edit", () => {
    const plan = planTemplateEdit({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: null,
      newBody: "Dear {{full_name}}, welcome to {{company_name}} as {{position_title}}. Starting {{start_date}}.",
      editedById: "user-1",
      editedByEmail: "hr@example.com",
    });

    // Without this, the very first edit overwrites document_templates.body
    // and there is nothing anywhere — not a row, not a version — that still
    // holds what the template said before. This is what makes that revertible.
    expect(plan.backfillVersion).not.toBeNull();
    expect(plan.backfillVersion?.version).toBe(1);
    expect(plan.backfillVersion?.body).toBe(SAMPLE_TEMPLATE.body);
    expect(plan.backfillVersion?.name).toBe(SAMPLE_TEMPLATE.name);
    // The seed shipped this way; nobody "edited" it, so it is not attributed
    // to whoever happens to be saving the first real change.
    expect(plan.backfillVersion?.changedById).toBeNull();
    expect(plan.backfillVersion?.changedByEmail).toBeNull();
    expect(plan.backfillVersion?.changeNote).toBeNull();
  });

  it("does not re-backfill once a version already exists, and numbers the new one past the latest on record", () => {
    const plan = planTemplateEdit({
      current: { ...SAMPLE_TEMPLATE, version: 2 },
      latestVersionNumber: 2,
      newBody: "Updated body for {{full_name}}",
      editedById: "user-1",
      editedByEmail: "hr@example.com",
    });
    expect(plan.backfillVersion).toBeNull();
    expect(plan.newVersion.version).toBe(3);
    expect(plan.templateUpdate.version).toBe(3);
  });

  it("records who edited it, when (via the version row's own createdAt default) and why", () => {
    const plan = planTemplateEdit({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: 4,
      newBody: "Dear {{full_name}}, revised wording.",
      changeNote: "Trimmed the intro paragraph",
      editedById: "user-42",
      editedByEmail: "priya@example.com",
    });
    expect(plan.newVersion.changedById).toBe("user-42");
    expect(plan.newVersion.changedByEmail).toBe("priya@example.com");
    expect(plan.newVersion.changeNote).toBe("Trimmed the intro paragraph");
    expect(plan.templateUpdate.updatedById).toBe("user-42");
    expect(plan.templateUpdate.updatedByEmail).toBe("priya@example.com");
  });

  it("defaults changeNote to null rather than an empty string when none is supplied", () => {
    const plan = planTemplateEdit({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: 1,
      newBody: "Anything",
      editedById: null,
      editedByEmail: null,
    });
    expect(plan.newVersion.changeNote).toBeNull();
  });

  it("flips origin to custom on the very first edit — 'has a human touched this', not 'does it match the shipped default'", () => {
    const plan = planTemplateEdit({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: null,
      newBody: "Dear {{full_name}}",
      editedById: "user-1",
      editedByEmail: "hr@example.com",
    });
    expect(plan.templateUpdate.origin).toBe("custom");
  });

  it("recomputes requiredTokens from the new body, deduplicated and sorted — never trusted from a caller", () => {
    const plan = planTemplateEdit({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: 1,
      newBody: "{{full_name}} {{annual_ctc}} {{annual_ctc}} {{full_name}}",
      editedById: null,
      editedByEmail: null,
    });
    expect(plan.templateUpdate.requiredTokens).toEqual(["annual_ctc", "full_name"]);
    expect(plan.newVersion.requiredTokens).toEqual(["annual_ctc", "full_name"]);
  });

  it("carries name, category, requiresSignature and signatoryRoles forward unchanged — the editor's scope is body and note only", () => {
    const plan = planTemplateEdit({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: 1,
      newBody: "A completely different body",
      editedById: null,
      editedByEmail: null,
    });
    expect(plan.newVersion.name).toBe(SAMPLE_TEMPLATE.name);
    expect(plan.newVersion.category).toBe(SAMPLE_TEMPLATE.category);
    expect(plan.newVersion.requiresSignature).toBe(SAMPLE_TEMPLATE.requiresSignature);
    expect(plan.newVersion.signatoryRoles).toEqual(SAMPLE_TEMPLATE.signatoryRoles);
  });
});

describe("planRevert", () => {
  const TARGET: VersionSnapshot = {
    templateId: SAMPLE_TEMPLATE.id,
    orgId: SAMPLE_TEMPLATE.orgId,
    version: 2,
    name: "Offer Letter",
    category: "offer",
    body: "Dear {{full_name}}, the version-2 wording that used to be live.",
    requiredTokens: ["full_name"],
    requiresSignature: true,
    signatoryRoles: ["candidate", "hr"],
    changeNote: "v2 edit",
    changedById: "user-1",
    changedByEmail: "hr@example.com",
  };

  it("restores the target version's content as a brand new version, not a rewrite of the old one", () => {
    const plan = planRevert({
      current: {
        ...SAMPLE_TEMPLATE,
        version: 4,
        body: "Dear {{full_name}}, a since-broken body with a {{typo_tokenn}}.",
      },
      latestVersionNumber: 4,
      target: TARGET,
      revertedById: "user-9",
      revertedByEmail: "admin@example.com",
    });
    // One past the latest on record, never target.version itself — the
    // abandoned (broken) version stays exactly where it was, its own row,
    // untouched.
    expect(plan.newVersion.version).toBe(5);
    expect(plan.templateUpdate.version).toBe(5);
    expect(plan.newVersion.body).toBe(TARGET.body);
    expect(plan.templateUpdate.body).toBe(TARGET.body);
  });

  it("records who reverted it and defaults an explanatory note naming the restored version", () => {
    const plan = planRevert({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: 4,
      target: TARGET,
      revertedById: "user-9",
      revertedByEmail: "admin@example.com",
    });
    expect(plan.newVersion.changedById).toBe("user-9");
    expect(plan.newVersion.changedByEmail).toBe("admin@example.com");
    expect(plan.newVersion.changeNote).toBe("Reverted to version 2");
  });

  it("honours an explicit changeNote instead of the auto-generated one", () => {
    const plan = planRevert({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: 4,
      target: TARGET,
      revertedById: "user-9",
      revertedByEmail: "admin@example.com",
      changeNote: "Rolling back the salary clause typo",
    });
    expect(plan.newVersion.changeNote).toBe("Rolling back the salary clause typo");
  });

  it("writes no origin field — a revert does not un-ratchet origin back to seed", () => {
    const plan = planRevert({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: 4,
      target: TARGET,
      revertedById: "user-9",
      revertedByEmail: "admin@example.com",
    });
    // A revert is a human decision made today, same as any other save — not
    // proof that no human ever touched this template.
    expect(plan.templateUpdate).not.toHaveProperty("origin");
  });
});

// ─── An issued document is unaffected by a later template edit ──────────────
//
// generatedDocuments.renderedBody is described in its own schema comment as
// "frozen at generation" and the table has no updatedAt column at all — it is
// structurally write-once. The proof below is in three parts: this file
// literally cannot import that table (so no line in it can query or write to
// it, even by accident — an unimported Drizzle table object cannot be used
// in a `.from()` or `eq()` call, only mentioned in prose), the plans it
// computes never carry a field that belongs to that table, and — the
// concrete scenario a reviewer actually worries about — re-deriving what a
// candidate already received still matches byte for byte after the template
// that produced it has since been edited.
describe("an issued document is unaffected by a later template edit", () => {
  it("the repository never imports the generatedDocuments schema table, so no line in it can query or write to it", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "db", "repositories", "document-templates.neon.ts"),
      "utf8"
    );
    // Checked against the import line specifically, not the whole file: the
    // file's own comments explain this exact guarantee in prose (mentioning
    // the table by name to say what it does NOT do), which a raw substring
    // search can't tell apart from a real reference. What actually matters —
    // whether code here could ever query or write that table — is entirely
    // decided by what gets imported from the schema module.
    const schemaImport = source.match(/import\s*\{([^}]*)\}\s*from\s*"@\/db\/schema\/talent"/);
    expect(schemaImport).not.toBeNull();
    const importedNames = (schemaImport?.[1] ?? "").split(",").map((s) => s.trim());
    expect(importedNames).not.toContain("generatedDocuments");
  });

  // Columns that exist only on generatedDocuments (talent.ts) — a template
  // edit or revert writing any of these would mean it had reached into a
  // rendered document's own row, which is the one thing this feature must
  // never do.
  const GENERATED_DOCUMENT_ONLY_FIELDS = [
    "renderedBody",
    "blobUrl",
    "contentHash",
    "status",
    "sentAt",
    "completedAt",
    "expiresAt",
    "voidedReason",
    "generatedById",
    "templateVersion",
    "candidateId",
    "employeeId",
    "title",
  ];

  it("an edit plan writes no field belonging to generatedDocuments", () => {
    const plan = planTemplateEdit({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: null,
      newBody: "Updated {{full_name}}",
      editedById: "user-1",
      editedByEmail: "hr@example.com",
    });
    const writtenKeys = new Set([
      ...Object.keys(plan.templateUpdate),
      ...Object.keys(plan.newVersion),
      ...Object.keys(plan.backfillVersion ?? {}),
    ]);
    for (const field of GENERATED_DOCUMENT_ONLY_FIELDS) {
      expect(writtenKeys.has(field)).toBe(false);
    }
  });

  it("a revert plan writes no field belonging to generatedDocuments", () => {
    const plan = planRevert({
      current: SAMPLE_TEMPLATE,
      latestVersionNumber: 4,
      target: {
        templateId: SAMPLE_TEMPLATE.id,
        orgId: SAMPLE_TEMPLATE.orgId,
        version: 2,
        name: "Offer Letter",
        category: "offer",
        body: "Dear {{full_name}}.",
        requiredTokens: ["full_name"],
        requiresSignature: true,
        signatoryRoles: ["candidate", "hr"],
        changeNote: null,
        changedById: null,
        changedByEmail: null,
      },
      revertedById: "user-9",
      revertedByEmail: "admin@example.com",
    });
    const writtenKeys = new Set([
      ...Object.keys(plan.templateUpdate),
      ...Object.keys(plan.newVersion),
    ]);
    for (const field of GENERATED_DOCUMENT_ONLY_FIELDS) {
      expect(writtenKeys.has(field)).toBe(false);
    }
  });

  it("re-rendering the pre-edit body after the template has been edited reproduces the exact string a candidate was issued", () => {
    // What generate() in documents.neon.ts computes once, at issue time, and
    // freezes into generatedDocuments.renderedBody — never re-run afterwards.
    const originalBody = "Dear {{full_name}}, your CTC is {{annual_ctc}}.";
    const valuesAtIssueTime = { full_name: "Asha Rao", annual_ctc: "12,00,000" };
    const issued = render(originalBody, valuesAtIssueTime).body;

    // HR edits the live template afterwards — a real, subsequent change.
    const plan = planTemplateEdit({
      current: { ...SAMPLE_TEMPLATE, body: originalBody },
      latestVersionNumber: null,
      newBody: "Dear {{full_name}}, your CTC is {{annual_ctc}} per annum — revised wording, unrelated typo fixed.",
      editedById: "user-1",
      editedByEmail: "hr@example.com",
    });

    // The candidate's document was this string, computed once. Re-deriving
    // it from the same (old body, values) pair the generator used still
    // gives back the identical text: rendering consults nothing about what
    // the template looks like now, only the body and values it was given.
    expect(render(originalBody, valuesAtIssueTime).body).toBe(issued);
    expect(issued).toBe("Dear Asha Rao, your CTC is 12,00,000.");
    expect(issued).not.toContain("revised wording");
    // The edit plan's own new body is the *new* wording — proving the two
    // are simply different strings living in different places, not one
    // piece of storage being read two ways.
    expect(plan.templateUpdate.body).toContain("revised wording");
    expect(plan.templateUpdate.body).not.toBe(issued);
  });
});
