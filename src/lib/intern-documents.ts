// ═══════════════════════════════════════════════════════════════
// INTERN & EMPLOYEE LIFECYCLE DOCUMENTS
// ═══════════════════════════════════════════════════════════════
// Fires the existing document generation + signing pipeline at the four
// moments the lifecycle actually needs a letter: hire (joining letter, every
// employment type), an intern completing their internship (by converting or
// by leaving as an intern), and anyone's exit (experience certificate and
// relieving letter). This module does not render PDFs, store them in R2 or
// resolve signing tokens — documents.neon.ts and the /sign/[id] flow already
// do that. It only decides which template, which recipients and which token
// values a lifecycle event calls for, and hands the rest to that pipeline.
//
// Every dependency the pipeline needs is injectable (see DispatchDeps) so the
// one behaviour the task requires a test for — that a failed generation is
// reported, not swallowed — can be proven without a database or SMTP server.
// The shape mirrors outbox-sweep.ts's injectable-deps pattern for the same
// reason: a background/fire-and-forget caller needs to see every outcome,
// not just the first exception.

import { and, desc, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { documentTemplates } from "@/db/schema/talent";
import { NeonDocumentsRepository, type GenerateRequest } from "@/db/repositories/documents.neon";
import { loadOrgIdentity } from "@/db/repositories/org-identity";
import type { TokenValues } from "@/lib/document-rules";
import {
  loadEmployeeForDocuments,
  resolveHrRecipients,
  type EmployeeDocumentContext,
  type HrRecipient,
} from "@/lib/intern-directory";
import { documentReadyToSignEmail } from "@/lib/intern-mail";
import { mailConfigured, sendMail } from "@/lib/mailer";

export type LifecycleDocumentKind =
  | "joining_letter"
  | "internship_completion_certificate"
  | "experience_certificate"
  | "relieving_letter";

/** Template name in hrms.document_templates for each kind — must match scripts/seed-letter-templates.mjs exactly. */
const TEMPLATE_NAME: Record<LifecycleDocumentKind, string> = {
  joining_letter: "Joining Letter",
  internship_completion_certificate: "Internship Completion Certificate",
  experience_certificate: "Experience Certificate",
  relieving_letter: "Relieving Letter",
};

/** Short code for `document_reference`; not a database key, just a human-readable label on the letterhead. */
const KIND_ABBREVIATION: Record<LifecycleDocumentKind, string> = {
  joining_letter: "JOIN",
  internship_completion_certificate: "ICC",
  experience_certificate: "EXP",
  relieving_letter: "REL",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function appBaseUrl(): string {
  // Falls back to the production host rather than a request origin: unlike
  // /api/documents/[id]/send, this runs from repository methods with no
  // NextRequest to read an origin from — the same situation
  // auth/passkey-ceremony.ts is in, and it uses the same fallback.
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://hrms.circuvent.com";
}

function documentReference(employeeCode: string, kind: LifecycleDocumentKind): string {
  return `${employeeCode}/${KIND_ABBREVIATION[kind]}/${new Date().getFullYear()}`;
}

function signatoryTitle(role: HrRecipient["role"]): string {
  if (role === "hr") return "Human Resources";
  if (role === "admin") return "Administrator";
  return "Owner";
}

/** Tokens every letter in the shell() layout needs, regardless of which one it is. */
function baseTokens(
  employee: EmployeeDocumentContext,
  primaryHr: HrRecipient,
  kind: LifecycleDocumentKind,
): TokenValues {
  return {
    full_name: employee.fullName,
    candidate_email: employee.workEmail,
    issue_date: todayISO(),
    document_reference: documentReference(employee.employeeCode, kind),
    signatory_name: primaryHr.name,
    signatory_title: signatoryTitle(primaryHr.role),
    hr_contact_name: primaryHr.name,
    hr_contact_email: primaryHr.email,
  };
}

/**
 * Tokens specific to one template's body. Free-text fields that describe
 * conduct or a project fall back to an honest, non-committal default rather
 * than an invented specific — nobody has asked the manager for a summary at
 * the moment this fires automatically, and a fabricated one on a signed
 * certificate is worse than a generic one.
 */
function kindTokens(kind: LifecycleDocumentKind, employee: EmployeeDocumentContext): TokenValues {
  const department = employee.departmentName ?? "the team";
  switch (kind) {
    case "joining_letter":
      return {
        position_title: employee.designation,
        department,
        reporting_manager: employee.managerName ?? "your reporting manager",
        join_date: employee.joinDate,
        employee_code: employee.employeeCode,
        reporting_time: process.env.INTERN_DEFAULT_REPORTING_TIME?.trim() || "9:30 AM",
        work_location: process.env.INTERN_DEFAULT_WORK_LOCATION?.trim() || "the registered office",
        documents_to_bring:
          "A government photo ID and its photocopy, your latest educational certificates, and two passport-size photographs.",
        first_day_plan:
          "HR will meet you at reception, complete your onboarding paperwork, and introduce you to your team.",
      };
    case "internship_completion_certificate":
      return {
        position_title: employee.designation,
        department,
        start_date: employee.joinDate,
        // exitDate is set when remove() ends the internship outright;
        // internshipEndDate is what a conversion completes against instead,
        // since convertToPermanent() never touches exitDate. Today is the
        // last resort for a conversion run before an end date was ever set.
        engagement_end_date: employee.exitDate ?? employee.internshipEndDate ?? todayISO(),
        project_summary:
          "Contributed to the team's ongoing projects under the guidance of their reporting manager for the duration of the internship.",
        learning_outcomes:
          "Gained practical, hands-on experience applying their academic training in a live production environment.",
        conduct_remark: "No conduct concerns were recorded during the engagement.",
      };
    case "experience_certificate":
      return {
        employee_code: employee.employeeCode,
        position_title: employee.designation,
        department,
        join_date: employee.joinDate,
        last_working_day: employee.exitDate ?? todayISO(),
        conduct_remark: "No conduct concerns were recorded during the period of employment.",
      };
    case "relieving_letter":
      return {
        position_title: employee.designation,
        department,
        employee_code: employee.employeeCode,
        join_date: employee.joinDate,
        last_working_day: employee.exitDate ?? todayISO(),
        exit_reason: employee.exitReason ?? "As recorded by HR",
        settlement_status: "is being processed as per company policy",
        asset_status: "has been reviewed and cleared",
      };
  }
}

interface ResolvedTemplate {
  id: string;
  signatoryRoles: string[];
}

async function resolveTemplate(ctx: TenantContext, name: string): Promise<ResolvedTemplate | null> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({ id: documentTemplates.id, signatoryRoles: documentTemplates.signatoryRoles })
      .from(documentTemplates)
      .where(and(eq(documentTemplates.name, name), eq(documentTemplates.isActive, true)))
      .orderBy(desc(documentTemplates.updatedAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, signatoryRoles: (row.signatoryRoles as string[] | null) ?? [] };
  });
}

export interface LifecycleDocumentOutcome {
  kind: LifecycleDocumentKind;
  ok: boolean;
  documentId?: string;
  error?: string;
}

/** Everything dispatchLifecycleDocuments needs from the outside world, swappable for tests. */
export interface DispatchDeps {
  resolveTemplate(ctx: TenantContext, name: string): Promise<ResolvedTemplate | null>;
  loadEmployee(ctx: TenantContext, employeeId: string): Promise<EmployeeDocumentContext | null>;
  resolveHrRecipients(ctx: TenantContext): Promise<HrRecipient[]>;
  loadCompanyName(ctx: TenantContext): Promise<string>;
  generate(
    ctx: TenantContext,
    request: GenerateRequest,
    generatedById: string | undefined,
  ): Promise<{ id: string }>;
  send(
    ctx: TenantContext,
    documentId: string,
  ): Promise<{ links: { email: string; role: string; token: string }[] }>;
  sendMail(options: { to: string; subject: string; html: string; text?: string }): Promise<boolean>;
  mailConfigured(): boolean;
}

const defaultDeps: DispatchDeps = {
  resolveTemplate,
  loadEmployee: loadEmployeeForDocuments,
  resolveHrRecipients,
  loadCompanyName: async (ctx) => (await loadOrgIdentity(ctx))?.name ?? "your employer",
  // Falls back to an empty string, never to a fabricated id: every real call
  // site is an authenticated HR route where `ctx.userId` is always set, so
  // this only matters if that ever stops being true, and if it did,
  // `generate()` rejecting an empty uuid (rather than attributing the
  // document to a made-up actor) is the correct failure — dispatchOne()
  // below reports it, it does not need to be a valid document.
  generate: (ctx, request, generatedById) =>
    new NeonDocumentsRepository(ctx).generate(request, generatedById ?? ""),
  send: (ctx, documentId) => new NeonDocumentsRepository(ctx).send(documentId),
  sendMail,
  mailConfigured,
};

async function dispatchOne(
  ctx: TenantContext,
  employeeId: string,
  kind: LifecycleDocumentKind,
  generatedById: string | undefined,
  deps: DispatchDeps,
): Promise<LifecycleDocumentOutcome> {
  try {
    const template = await deps.resolveTemplate(ctx, TEMPLATE_NAME[kind]);
    if (!template) {
      throw new Error(
        `No active "${TEMPLATE_NAME[kind]}" template is configured for this organisation`,
      );
    }

    const employee = await deps.loadEmployee(ctx, employeeId);
    if (!employee) {
      throw new Error(`Employee ${employeeId} could not be loaded for ${TEMPLATE_NAME[kind]}`);
    }

    const hrRecipients = await deps.resolveHrRecipients(ctx);
    const primaryHr = hrRecipients[0];
    if (!primaryHr) {
      throw new Error("No owner, admin or HR user is configured to countersign this document");
    }

    // Built from the template's actual signatoryRoles rather than a second
    // hardcoded assumption of what they are — if HR ever edits the template
    // in the product to drop the employee's signature, this must not still
    // try to seat one, and buildSlots() enforces the reverse (a role with no
    // recipient here fails loudly rather than silently issuing unsigned).
    const recipients: Record<string, { email: string; name?: string }> = {};
    for (const role of template.signatoryRoles) {
      recipients[role] =
        role === "employee"
          ? { email: employee.workEmail, name: employee.fullName }
          : { email: primaryHr.email, name: primaryHr.name };
    }

    const extraValues: TokenValues = {
      ...baseTokens(employee, primaryHr, kind),
      ...kindTokens(kind, employee),
    };

    const document = await deps.generate(
      ctx,
      {
        templateId: template.id,
        employeeId,
        title: TEMPLATE_NAME[kind],
        extraValues,
        recipients,
        expiresInDays: 30,
      },
      generatedById,
    );

    const { links } = await deps.send(ctx, document.id);

    if (deps.mailConfigured() && links.length > 0) {
      const companyName = await deps.loadCompanyName(ctx);
      for (const link of links) {
        const url = `${appBaseUrl()}/sign/${document.id}?token=${link.token}`;
        const recipientName = link.role === "employee" ? employee.fullName : primaryHr.name;
        const body = documentReadyToSignEmail({
          companyName,
          recipientName,
          documentTitle: TEMPLATE_NAME[kind],
          employeeName: employee.fullName,
          signUrl: url,
        });
        await deps.sendMail({ to: link.email, subject: body.subject, html: body.html, text: body.text });
      }
    }

    return { kind, ok: true, documentId: document.id };
  } catch (error) {
    // Caught here, per document, rather than letting one exception unwind
    // the whole batch: a broken relieving-letter template must not also
    // block the experience certificate that would otherwise have gone out
    // cleanly. Every kind still gets an explicit entry in the returned
    // array — ok:false with the real reason — which is what makes this
    // "reported" rather than "swallowed": a caller that never inspects the
    // array will still see it logged by whoever called this, but nothing
    // here discards the failure itself.
    return {
      kind,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fires however many lifecycle documents one event calls for, and reports
 * what happened to each. Never throws: a hire, a conversion or an exit must
 * still succeed even if a template is missing or SMTP is down, so the
 * transaction that changed the employee record is already committed by the
 * time this runs. What must not happen is claiming success — every outcome
 * says explicitly whether its document was actually generated.
 */
export async function dispatchLifecycleDocuments(
  ctx: TenantContext,
  employeeId: string,
  kinds: LifecycleDocumentKind[],
  generatedById: string | undefined,
  deps: Partial<DispatchDeps> = {},
): Promise<LifecycleDocumentOutcome[]> {
  const merged: DispatchDeps = { ...defaultDeps, ...deps };
  const outcomes: LifecycleDocumentOutcome[] = [];
  for (const kind of kinds) {
    outcomes.push(await dispatchOne(ctx, employeeId, kind, generatedById, merged));
  }
  return outcomes;
}
