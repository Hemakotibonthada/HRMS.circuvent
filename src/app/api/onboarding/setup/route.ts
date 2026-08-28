// ═══════════════════════════════════════════════════════════════
// ONBOARDING SETUP API — Orchestrates ATS Hire to HRMS Employee
// ═══════════════════════════════════════════════════════════════
// Handles:
// 1. Creating the Employee record with Manager, Department, Buddy & Location
// 2. Initializing the 90-day Onboarding Lifecycle Journey & Checklist
// 3. Generating & Dispatching formal Appointment / Joining Letter
// 4. Triggering domain Mailbox Invite / Claim Token
// 5. Allocating initial IT Hardware Asset from Asset Management

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { eq, sql, and, isNull } from "drizzle-orm";

import { withTenant } from "@/db/client";
import {
  employees,
  applications,
  offers,
  departments,
  locations,
  documentTemplates,
  salaryStructures,
} from "@/db/schema";
import { NeonDocumentsRepository } from "@/db/repositories/documents.neon";
import { NeonAssetsRepository } from "@/db/repositories/assets.neon";
import { NeonLifecycleRepository } from "@/db/repositories/lifecycle.neon";
import { loadOrgLetterDefaults } from "@/db/repositories/org-identity";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { normaliseEmploymentType } from "@/lib/employee-rules";
import { sendMailboxInvite } from "@/lib/onboarding/mailbox-invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optionalUuid = z.preprocess((v) => {
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed || trimmed === "none" || trimmed === "null" || trimmed === "undefined") return null;
  }
  return v;
}, z.string().uuid().optional().nullable());

const setupSchema = z.object({
  candidateId: optionalUuid,
  applicationId: optionalUuid,
  offerId: optionalUuid,
  employeeCode: z.string().trim().max(64).optional(),
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  workEmail: z.string().trim().email("Valid work email is required").max(320),
  personalEmail: z.string().trim().email().max(320).optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  designation: z.string().trim().min(1, "Designation is required").max(150),
  departmentId: optionalUuid,
  reportingToId: optionalUuid,
  buddyId: optionalUuid,
  locationId: optionalUuid,
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Joining date must be YYYY-MM-DD"),
  salary: z.number().nonnegative().optional().nullable(),
  employmentType: z.string().trim().default("full_time"),
  issueAppointmentLetter: z.boolean().default(true),
  triggerMailboxInvite: z.boolean().default(true),
  assetId: optionalUuid,
  notes: z.string().trim().max(2000).optional().nullable(),
});

const STANDARD_ONBOARDING_TASKS = [
  { phase: "pre", taskKey: "pre__offer_letter_signed", title: "Offer letter signed", mandatory: true, phaseOrder: 0 },
  { phase: "pre", taskKey: "pre__background_check", title: "Background check", mandatory: true, phaseOrder: 0 },
  { phase: "pre", taskKey: "pre__it_equipment_ordered", title: "IT equipment ordered", mandatory: false, phaseOrder: 0 },
  { phase: "pre", taskKey: "pre__email_account_created", title: "Email account created", mandatory: false, phaseOrder: 0 },
  { phase: "pre", taskKey: "pre__welcome_kit_prepared", title: "Welcome kit prepared", mandatory: false, phaseOrder: 0 },

  { phase: "week1", taskKey: "week1__office_tour", title: "Office tour", mandatory: false, phaseOrder: 1 },
  { phase: "week1", taskKey: "week1__team_introduction", title: "Team introduction", mandatory: false, phaseOrder: 1 },
  { phase: "week1", taskKey: "week1__system_access_setup", title: "System access setup", mandatory: true, phaseOrder: 1 },
  { phase: "week1", taskKey: "week1__policy_acknowledgement", title: "Policy acknowledgement", mandatory: true, phaseOrder: 1 },
  { phase: "week1", taskKey: "week1__first_1_on_1_with_manager", title: "First 1-on-1 with manager", mandatory: false, phaseOrder: 1 },

  { phase: "month1", taskKey: "month1__department_orientation", title: "Department orientation", mandatory: false, phaseOrder: 2 },
  { phase: "month1", taskKey: "month1__role_specific_training", title: "Role-specific training", mandatory: false, phaseOrder: 2 },
  { phase: "month1", taskKey: "month1__30_day_check_in", title: "30-day check-in", mandatory: false, phaseOrder: 2 },
  { phase: "month1", taskKey: "month1__benefits_enrollment", title: "Benefits enrollment", mandatory: false, phaseOrder: 2 },
  { phase: "month1", taskKey: "month1__company_culture_session", title: "Company culture session", mandatory: false, phaseOrder: 2 },

  { phase: "month2_3", taskKey: "month2_3__60_day_performance_review", title: "60-day performance review", mandatory: false, phaseOrder: 3 },
  { phase: "month2_3", taskKey: "month2_3__cross_team_collaboration", title: "Cross-team collaboration", mandatory: false, phaseOrder: 3 },
  { phase: "month2_3", taskKey: "month2_3__advanced_tool_training", title: "Advanced tool training", mandatory: false, phaseOrder: 3 },
  { phase: "month2_3", taskKey: "month2_3__goals_setting", title: "Goals setting", mandatory: false, phaseOrder: 3 },
  { phase: "month2_3", taskKey: "month2_3__90_day_completion_review", title: "90-day completion review", mandatory: true, phaseOrder: 3 },
];

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limitCheck = checkRateLimit(clientIdentifier(request, ctx.userId), 60, 60_000);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = setupSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid setup data" },
      { status: 400 }
    );
  }

  const data = parsed.data;

  try {
    const result = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      // 1. Determine Employee Code
      let code = data.employeeCode?.trim();
      if (!code) {
        const countRes = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(employees)
          .where(eq(employees.orgId, ctx.orgId));
        const nextNum = (countRes[0]?.count ?? 0) + 1;
        code = `CIR-${String(nextNum).padStart(3, "0")}`;
      }

      // Check if employee already exists with this email or candidateId
      let employeeId: string;
      const existing = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.orgId, ctx.orgId),
            eq(employees.workEmail, data.workEmail.toLowerCase()),
            isNull(employees.deletedAt)
          )
        )
        .limit(1);

      const empType = (normaliseEmploymentType(data.employmentType) || "full_time") as
        | "full_time"
        | "part_time"
        | "contract"
        | "intern"
        | "freelance";

      if (existing[0]) {
        employeeId = existing[0].id;
        await tx
          .update(employees)
          .set({
            firstName: data.firstName,
            lastName: data.lastName,
            personalEmail: data.personalEmail || null,
            phone: data.phone || null,
            designation: data.designation,
            departmentId: data.departmentId || null,
            reportingToId: data.reportingToId || null,
            locationId: data.locationId || null,
            joinDate: data.joiningDate,
            employmentType: empType,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(employees.id, employeeId));
      } else {
        employeeId = randomUUID();
        await tx.insert(employees).values({
          id: employeeId,
          orgId: ctx.orgId,
          employeeCode: code,
          firstName: data.firstName,
          lastName: data.lastName,
          workEmail: data.workEmail.toLowerCase(),
          personalEmail: data.personalEmail || null,
          phone: data.phone || null,
          designation: data.designation,
          departmentId: data.departmentId || null,
          reportingToId: data.reportingToId || null,
          locationId: data.locationId || null,
          joinDate: data.joiningDate,
          employmentType: empType,
          status: "active",
        });
      }

      if (data.candidateId) {
        await tx.execute(
          sql`UPDATE hrms.employees
                 SET candidate_id = ${data.candidateId}::uuid,
                     application_id = COALESCE(application_id, ${data.applicationId ?? null}::uuid),
                     updated_at = now()
               WHERE id = ${employeeId}::uuid`
        );
      } else if (data.applicationId) {
        await tx.execute(
          sql`UPDATE hrms.employees
                 SET application_id = ${data.applicationId}::uuid,
                     updated_at = now()
               WHERE id = ${employeeId}::uuid`
        );
      }

      const [departmentRow] = data.departmentId
        ? await tx
            .select({ name: departments.name })
            .from(departments)
            .where(eq(departments.id, data.departmentId))
            .limit(1)
        : [];

      // Record initial salary structure if provided
      if (data.salary && data.salary > 0) {
        const ctcMinor = BigInt(Math.round(data.salary * 100));
        const basicMinor = (ctcMinor * 50n) / 100n;
        const hraMinor = (ctcMinor * 20n) / 100n;
        const specialAllowanceMinor = ctcMinor - basicMinor - hraMinor;

        await tx.insert(salaryStructures).values({
          id: randomUUID(),
          orgId: ctx.orgId,
          employeeId,
          effectiveFrom: data.joiningDate,
          ctcMinor,
          basicMinor,
          hraMinor,
          specialAllowanceMinor,
          revisionReason: "hire",
        });
      }

      // If candidate / application provided, close application to 'hired'
      if (data.applicationId) {
        await tx
          .update(applications)
          .set({
            status: "hired",
            stage: "hired",
            updatedAt: new Date(),
          })
          .where(eq(applications.id, data.applicationId));
      }

      if (data.offerId) {
        await tx
          .update(offers)
          .set({
            status: "accepted",
            updatedAt: new Date(),
          })
          .where(eq(offers.id, data.offerId));
      }

      // 2. Initialize 90-Day Lifecycle Journey & Tasks
      const lifecycleRepo = new NeonLifecycleRepository(ctx);
      let journey = await lifecycleRepo.start({
        employeeId,
        kind: "onboarding",
        anchorDate: data.joiningDate,
        tasks: STANDARD_ONBOARDING_TASKS.map((t) => ({
          taskKey: t.taskKey,
          title: t.title,
          phase: t.phase,
          phaseOrder: t.phaseOrder,
          mandatory: t.mandatory,
        })),
      });

      // 3. Issue Appointment Letter
      let documentId: string | null = null;
      if (data.issueAppointmentLetter) {
        try {
          const templates = await tx
            .select({ id: documentTemplates.id, name: documentTemplates.name })
            .from(documentTemplates)
            .where(
              and(
                eq(documentTemplates.orgId, ctx.orgId),
                eq(documentTemplates.isActive, true)
              )
            );

          const template =
            templates.find((t) => t.name === "Appointment Letter") ||
            templates.find((t) => t.name === "Joining Letter") ||
            templates[0];

          if (template) {
            const defaults = (await loadOrgLetterDefaults(ctx)) ?? {};
            const docRepo = new NeonDocumentsRepository(ctx);

            const doc = await docRepo.generate(
              {
                templateId: template.id,
                employeeId,
                title: `Appointment Letter - ${data.firstName} ${data.lastName}`,
                recipients: {
                  employee: {
                    email: data.workEmail,
                    name: `${data.firstName} ${data.lastName}`.trim(),
                  },
                  signatory: {
                    email: defaults.hrContactEmail || "hr@circuvent.com",
                    name: defaults.signatoryName || "Authorised Signatory",
                  },
                },
                extraValues: {
                  candidate_name: `${data.firstName} ${data.lastName}`,
                  designation: data.designation,
                  join_date: data.joiningDate,
                  ctc_annual: data.salary ? `₹${data.salary.toLocaleString("en-IN")}` : "As per offer",
                },
              },
              ctx.userId
            );

            documentId = doc.id;

            // Mark task done
            const task = journey.tasks.find((t) => t.taskKey === "pre__offer_letter_signed");
            if (task) {
              journey = await lifecycleRepo.setTaskCompletion(task.id, true, ctx.userId);
            }
          }
        } catch (docErr) {
          console.error("Appointment letter generation failed:", docErr);
        }
      }

      let mailboxInvitePayload:
        | {
            employeeId: string;
            candidateId: string | null;
            employmentType: string;
            personalEmail: string | null;
            candidateName: string;
            jobTitle: string;
            startDate: string;
            employeeCode: string;
            department: string | null;
          }
        | undefined;

      // 4. Queue mailbox invite (sent after the transaction commits)
      if (data.triggerMailboxInvite) {
        mailboxInvitePayload = {
          employeeId,
          candidateId: data.candidateId ?? null,
          employmentType: empType,
          personalEmail: data.personalEmail ?? null,
          candidateName: `${data.firstName} ${data.lastName}`.trim(),
          jobTitle: data.designation,
          startDate: data.joiningDate,
          employeeCode: code,
          department: departmentRow?.name ?? null,
        };
      }

      // 5. Allocate IT Asset (if assetId provided)
      if (data.assetId) {
        try {
          const assetsRepo = new NeonAssetsRepository(ctx);
          await assetsRepo.issue(data.assetId, employeeId, ctx.userId, "good");

          const task = journey.tasks.find((t) => t.taskKey === "pre__it_equipment_ordered");
          if (task) {
            journey = await lifecycleRepo.setTaskCompletion(task.id, true, ctx.userId);
          }
        } catch (assetErr) {
          console.error("Asset allocation failed:", assetErr);
        }
      }

      return {
        employeeId,
        employeeCode: code,
        journey,
        documentId,
        mailboxInvitePayload,
      };
    });

    let mailboxInviteDetail: string | undefined;
    if (result.mailboxInvitePayload) {
      const invite = await sendMailboxInvite(result.mailboxInvitePayload);
      mailboxInviteDetail = invite.detail;
    }

    const { mailboxInvitePayload: _payload, ...rest } = result;
    return NextResponse.json({ success: true, ...rest, mailboxInviteDetail }, { status: 201 });
  } catch (error) {
    console.error("Onboarding setup failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
