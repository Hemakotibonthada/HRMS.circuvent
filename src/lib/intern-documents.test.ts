// ═══════════════════════════════════════════════════════════════
// LIFECYCLE DOCUMENTS — a failed generation must be reported, not swallowed
// ═══════════════════════════════════════════════════════════════
// dispatchLifecycleDocuments never throws (a hire or a conversion already
// committed by the time it runs, and a broken template must not look like a
// failed hire) — but "never throws" is only safe if it instead always
// reports. This is the one behaviour the task explicitly asks to be tested:
// that a document which failed to generate comes back as an outcome saying
// so, not as a silently dropped entry, and not as a false "ok: true", and
// that one kind failing in a batch does not take a sibling kind down with
// it. Every collaborator dispatchOne needs is injectable for exactly this —
// it lets a test force one specific kind to fail without a database, a PDF
// renderer or SMTP.

import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/db/client";
import { dispatchLifecycleDocuments, type DispatchDeps } from "@/lib/intern-documents";
import type { EmployeeDocumentContext, HrRecipient } from "@/lib/intern-directory";

const ctx: TenantContext = { orgId: "org-1" };

const employee: EmployeeDocumentContext = {
  id: "emp-1",
  firstName: "Asha",
  lastName: "Rao",
  fullName: "Asha Rao",
  workEmail: "asha@example.com",
  employeeCode: "CVI-007",
  designation: "Intern Engineer",
  employmentType: "intern",
  joinDate: "2025-01-01",
  internshipEndDate: "2025-07-01",
};

const primaryHr: HrRecipient = { email: "hr@example.com", name: "HR Person", role: "hr" };

function baseDeps(overrides: Partial<DispatchDeps> = {}): Partial<DispatchDeps> {
  return {
    resolveTemplate: async (_ctx, name) => ({ id: `tmpl-${name}`, signatoryRoles: ["employee", "hr"] }),
    loadEmployee: async () => employee,
    resolveHrRecipients: async () => [primaryHr],
    loadCompanyName: async () => "Circuvent",
    generate: async (_ctx, request) => ({ id: `doc-${request.title}` }),
    send: async () => ({ links: [] }),
    sendMail: async () => true,
    // Off by default so no test accidentally depends on mail behaviour it
    // did not set up — the assertions below are about the outcomes array.
    mailConfigured: () => false,
    ...overrides,
  };
}

describe("dispatchLifecycleDocuments failure reporting", () => {
  it("reports a failed generation as ok:false with the real reason, instead of throwing", async () => {
    const deps = baseDeps({
      generate: async (_ctx, request) => {
        if (request.title === "Relieving Letter") {
          throw new Error("PDF render service unavailable");
        }
        return { id: `doc-${request.title}` };
      },
    });

    // Two kinds in one batch, like the exit flow fires: one whose renderer
    // is down, one that generates cleanly.
    const outcomes = await dispatchLifecycleDocuments(
      ctx,
      employee.id,
      ["relieving_letter", "experience_certificate"],
      undefined,
      deps,
    );

    const relieving = outcomes.find((o) => o.kind === "relieving_letter");
    const experience = outcomes.find((o) => o.kind === "experience_certificate");

    expect(relieving?.ok).toBe(false);
    expect(relieving?.error).toContain("PDF render service unavailable");
    expect(relieving?.documentId).toBeUndefined();

    // The failure must not have taken the batch down with it: a broken
    // relieving-letter template is not a reason to also withhold the
    // experience certificate that generated cleanly — dispatchOne catches
    // per document, not per batch.
    expect(experience?.ok).toBe(true);
    expect(experience?.documentId).toBe("doc-Experience Certificate");
  });

  it("reports a missing template as a failure rather than issuing an unsigned document", async () => {
    const deps = baseDeps({ resolveTemplate: async () => null });

    const [outcome] = await dispatchLifecycleDocuments(
      ctx,
      employee.id,
      ["joining_letter"],
      undefined,
      deps,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.documentId).toBeUndefined();
    expect(outcome.error).toMatch(/no active.*template/i);
  });

  it("reports missing an HR countersigner as a failure rather than sending without one", async () => {
    const deps = baseDeps({ resolveHrRecipients: async () => [] });

    const [outcome] = await dispatchLifecycleDocuments(
      ctx,
      employee.id,
      ["joining_letter"],
      undefined,
      deps,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/hr/i);
  });

  it("still returns ok:true with a document id when nothing fails", async () => {
    const deps = baseDeps();

    const [outcome] = await dispatchLifecycleDocuments(
      ctx,
      employee.id,
      ["joining_letter"],
      undefined,
      deps,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.error).toBeUndefined();
    expect(outcome.documentId).toBe("doc-Joining Letter");
  });
});
