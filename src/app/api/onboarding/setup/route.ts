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
import { issueDocumentAndEmail } from "@/lib/issue-document";
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
  employeeId: optionalUuid,
  candidateId: optionalUuid,
  applicationId: optionalUuid,
  offerId: optionalUuid,
  employeeCode: z.string().trim().max(64).optional(),
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  workEmail: z.string().trim().email("Valid work email is required").max(320),
  personalEmail: z.string().trim().email().max(320).optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional().nullable(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD").optional().nullable(),
  bloodGroup: z.string().trim().max(16).optional().nullable(),
  panNumber: z.string().trim().max(32).optional().nullable(),
  aadhaarNumber: z.string().trim().max(32).optional().nullable(),
  designation: z.string().trim().min(1, "Designation is required").max(150),
  departmentId: optionalUuid,
  reportingToId: optionalUuid,
  buddyId: optionalUuid,
  locationId: optionalUuid,
  workstationDesk: z.string().trim().max(100).optional().nullable(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Joining date must be YYYY-MM-DD"),
  salary: z.number().nonnegative().optional().nullable(),
  employmentType: z.string().trim().default("full_time"),
  noticePeriodDays: z.number().int().nonnegative().optional().nullable(),
  probationMonths: z.number().int().nonnegative().optional().nullable(),
  bankName: z.string().trim().max(120).optional().nullable(),
  accountHolderName: z.string().trim().max(150).optional().nullable(),
  accountNumber: z.string().trim().max(64).optional().nullable(),
  ifsc: z.string().trim().max(32).optional().nullable(),
  accountType: z.enum(["savings", "current"]).default("savings").optional().nullable(),
  emergencyContactName: z.string().trim().max(150).optional().nullable(),
  emergencyContactRelation: z.string().trim().max(64).optional().nullable(),
  emergencyContactPhone: z.string().trim().max(32).optional().nullable(),
  rightToWorkCollected: z.boolean().default(true).optional(),
  backgroundCheckStatus: z.enum(["verified", "in_progress", "waived"]).default("verified").optional(),
  issueAppointmentLetter: z.boolean().default(true),
  triggerMailboxInvite: z.boolean().default(true),
  assetId: optionalUuid,
  notes: z.string().trim().max(2000).optional().nullable(),
});

const STANDARD_ONBOARDING_TASKS = [
  { phase: "pre", taskKey: "pre__offer_letter_signed", title: "Offer letter signed", mandatory: true, phaseOrder: 0 },
  { phase: "pre", taskKey: "pre__background_check", title: "Background check", mandatory: true, phaseOrder: 0 },
  { phase: "pre", taskKey: "pre__it_equipment_ordered", title: "IT equipment ordered", mandatory: false, phaseOrder: 0 },
  { phase: "pre", taskKey: "pre__email_account_created", title: "Email account created", mandatory: true, phaseOrder: 0 },
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
      // 1. Determine Employee Code (Strict CV-001 standard)
      let code = data.employeeCode?.trim();
      if (!code) {
        const existingCodes = await tx
          .select({ code: employees.employeeCode })
          .from(employees)
          .where(eq(employees.orgId, ctx.orgId));
        
        let maxNum = 0;
        for (const row of existingCodes) {
          const match = row.code?.match(/^CV-(\d+)$/i);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
          }
        }
        code = `CV-${String(maxNum + 1).padStart(3, "0")}`;
      }

      // Check if employee already exists with this ID or email or candidateId
      let employeeId: string;
      let existingEmp: { id: string; employeeCode: string } | null = null;

      if (data.employeeId) {
        const [byId] = await tx
          .select({ id: employees.id, employeeCode: employees.employeeCode })
          .from(employees)
          .where(
            and(
              eq(employees.id, data.employeeId),
              eq(employees.orgId, ctx.orgId),
              isNull(employees.deletedAt)
            )
          )
          .limit(1);
        if (byId) {
          existingEmp = byId;
        }
      }

      if (!existingEmp) {
        const [byEmail] = await tx
          .select({ id: employees.id, employeeCode: employees.employeeCode })
          .from(employees)
          .where(
            and(
              eq(employees.orgId, ctx.orgId),
              eq(employees.workEmail, data.workEmail.toLowerCase()),
              isNull(employees.deletedAt)
            )
          )
          .limit(1);
        if (byEmail) {
          existingEmp = byEmail;
        }
      }

      const empType = (normaliseEmploymentType(data.employmentType) || "full_time") as
        | "full_time"
        | "part_time"
        | "contract"
        | "intern"
        | "freelance";

      const validGender =
        data.gender && ["male", "female", "other"].includes(data.gender)
          ? (data.gender as "male" | "female" | "other")
          : null;

      const bankDetailsPayload =
        data.bankName || data.accountNumber || data.ifsc
          ? {
              bankName: data.bankName || "",
              accountHolderName: data.accountHolderName || `${data.firstName} ${data.lastName}`.trim(),
              accountNumber: data.accountNumber || "",
              ifsc: data.ifsc || "",
              accountType: data.accountType || "savings",
            }
          : null;

      const emergencyContactPayload =
        data.emergencyContactName || data.emergencyContactPhone
          ? {
              name: data.emergencyContactName || "",
              relationship: data.emergencyContactRelation || "",
              phone: data.emergencyContactPhone || "",
            }
          : null;

      let confirmationDate: string | null = null;
      if (data.probationMonths && data.probationMonths > 0) {
        const jd = new Date(data.joiningDate);
        jd.setMonth(jd.getMonth() + data.probationMonths);
        confirmationDate = jd.toISOString().slice(0, 10);
      }

      const ctcMinorVal = data.salary && data.salary > 0 ? BigInt(Math.round(data.salary * 100)) : null;

      if (existingEmp) {
        employeeId = existingEmp.id;
        const codeToUse = data.employeeCode?.trim() || existingEmp.employeeCode;
        await tx
          .update(employees)
          .set({
            employeeCode: codeToUse,
            firstName: data.firstName,
            lastName: data.lastName,
            workEmail: data.workEmail.toLowerCase(),
            personalEmail: data.personalEmail || null,
            phone: data.phone || null,
            gender: validGender,
            dateOfBirth: data.dateOfBirth || null,
            bloodGroup: data.bloodGroup || null,
            panNumber: data.panNumber || null,
            aadhaarNumber: data.aadhaarNumber || null,
            designation: data.designation,
            departmentId: data.departmentId || null,
            reportingToId: data.reportingToId || null,
            locationId: data.locationId || null,
            joinDate: data.joiningDate,
            confirmationDate,
            noticePeriodDays: data.noticePeriodDays ?? 60,
            employmentType: empType,
            ctcMinor: ctcMinorVal,
            bankDetails: bankDetailsPayload,
            emergencyContact: emergencyContactPayload,
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
          gender: validGender,
          dateOfBirth: data.dateOfBirth || null,
          bloodGroup: data.bloodGroup || null,
          panNumber: data.panNumber || null,
          aadhaarNumber: data.aadhaarNumber || null,
          designation: data.designation,
          departmentId: data.departmentId || null,
          reportingToId: data.reportingToId || null,
          locationId: data.locationId || null,
          joinDate: data.joiningDate,
          confirmationDate,
          noticePeriodDays: data.noticePeriodDays ?? 60,
          employmentType: empType,
          ctcMinor: ctcMinorVal,
          bankDetails: bankDetailsPayload,
          emergencyContact: emergencyContactPayload,
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

      // Record / Update salary structure if provided
      if (data.salary && data.salary > 0) {
        const ctcMinor = BigInt(Math.round(data.salary * 100));
        const basicMinor = (ctcMinor * 50n) / 100n;
        const hraMinor = (ctcMinor * 20n) / 100n;
        const specialAllowanceMinor = ctcMinor - basicMinor - hraMinor;

        const [existingStructure] = await tx
          .select({ id: salaryStructures.id })
          .from(salaryStructures)
          .where(and(eq(salaryStructures.employeeId, employeeId), eq(salaryStructures.orgId, ctx.orgId)))
          .limit(1);

        if (existingStructure) {
          await tx
            .update(salaryStructures)
            .set({
              effectiveFrom: data.joiningDate,
              ctcMinor,
              basicMinor,
              hraMinor,
              specialAllowanceMinor,
              revisionReason: "update",
            })
            .where(eq(salaryStructures.id, existingStructure.id));
        } else {
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

      return {
        employeeId,
        employeeCode: code,
        empType,
        departmentName: departmentRow?.name ?? null,
      };
    });

    const { employeeId, employeeCode, empType, departmentName } = result;

    // 2. Initialize 90-Day Lifecycle Journey & Tasks (Post-commit)
    const lifecycleRepo = new NeonLifecycleRepository(ctx);
    let journey: any = null;
    try {
      journey = await lifecycleRepo.start({
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
    } catch (lifecycleErr) {
      console.error("Lifecycle journey initialization failed:", lifecycleErr);
    }

    // 3. Issue Appointment Letter
    let documentId: string | null = null;
    if (data.issueAppointmentLetter) {
      try {
        const defaults = (await loadOrgLetterDefaults(ctx)) ?? {};
        const docRepo = new NeonDocumentsRepository(ctx);
        const templates = await docRepo.listTemplates();
        const template =
          templates.find((t) => t.name === "Appointment Letter") ||
          templates.find((t) => t.name === "Joining Letter") ||
          templates[0];

        if (template) {
          const recipientEmail = data.personalEmail || data.workEmail;
          const doc = await docRepo.generate(
            {
              templateId: template.id,
              employeeId,
              title: `Appointment Letter - ${data.firstName} ${data.lastName}`,
              recipients: {
                employee: {
                  email: recipientEmail,
                  name: `${data.firstName} ${data.lastName}`.trim(),
                },
                candidate: {
                  email: recipientEmail,
                  name: `${data.firstName} ${data.lastName}`.trim(),
                },
                signatory: {
                  email: defaults.hrContactEmail || "hr@circuvent.com",
                  name: defaults.signatoryName || "Authorised Signatory",
                },
              },
              extraValues: {
                candidate_name: `${data.firstName} ${data.lastName}`,
                candidate_email: recipientEmail,
                personal_email: recipientEmail,
                designation: data.designation,
                join_date: data.joiningDate,
                ctc_annual: data.salary ? `₹${data.salary.toLocaleString("en-IN")}` : "As per offer",
              },
            },
            ctx.userId
          );

          documentId = doc.id;

          try {
            await issueDocumentAndEmail(ctx, doc.id, new URL(request.url).origin);
          } catch (sendErr) {
            console.error("Appointment letter dispatch failed:", sendErr);
          }

          // Mark task done for offer/appointment letter
          if (journey) {
            const task = journey.tasks.find((t: any) => t.taskKey === "pre__offer_letter_signed");
            if (task) {
              journey = await lifecycleRepo.setTaskCompletion(task.id, true, ctx.userId);
            }
          }
        }
      } catch (docErr) {
        console.error("Appointment letter generation failed:", docErr);
      }
    }

    // Update completed checklist tasks
    if (journey) {
      // Mark right-to-work documents collected if provided
      if (data.rightToWorkCollected || data.panNumber || data.aadhaarNumber) {
        const rtwTask = journey.tasks.find((t: any) => t.taskKey === "pre__right_to_work");
        if (rtwTask) {
          try {
            journey = await lifecycleRepo.setTaskCompletion(rtwTask.id, true, ctx.userId);
          } catch (e) {
            console.error("RTW task update failed:", e);
          }
        }
      }

      // Mark background check done if verified
      if (data.backgroundCheckStatus === "verified") {
        const bgTask = journey.tasks.find((t: any) => t.taskKey === "pre__background_check");
        if (bgTask) {
          try {
            journey = await lifecycleRepo.setTaskCompletion(bgTask.id, true, ctx.userId);
          } catch (e) {
            console.error("BG task update failed:", e);
          }
        }
      }

      // Mark payroll and bank setup done if bank details given
      if (data.bankName || data.accountNumber) {
        const bankTask = journey.tasks.find((t: any) => t.taskKey === "pre__payroll_bank_setup");
        if (bankTask) {
          try {
            journey = await lifecycleRepo.setTaskCompletion(bankTask.id, true, ctx.userId);
          } catch (e) {
            console.error("Bank task update failed:", e);
          }
        }
      }

      // Mark desk assigned if specified
      if (data.workstationDesk) {
        const deskTask = journey.tasks.find((t: any) => t.taskKey === "pre__desk_assigned");
        if (deskTask) {
          try {
            journey = await lifecycleRepo.setTaskCompletion(deskTask.id, true, ctx.userId);
          } catch (e) {
            console.error("Desk task update failed:", e);
          }
        }
      }

      // Mark buddy assigned if chosen
      if (data.buddyId && data.buddyId !== "none") {
        const buddyTask = journey.tasks.find((t: any) => t.taskKey === "pre__buddy_assigned");
        if (buddyTask) {
          try {
            journey = await lifecycleRepo.setTaskCompletion(buddyTask.id, true, ctx.userId);
          } catch (e) {
            console.error("Buddy task update failed:", e);
          }
        }
      }

      // Mark email created if invite triggered
      if (data.triggerMailboxInvite) {
        const mailTask = journey.tasks.find((t: any) => t.taskKey === "pre__email_account_created");
        if (mailTask) {
          try {
            journey = await lifecycleRepo.setTaskCompletion(mailTask.id, true, ctx.userId);
          } catch (e) {
            console.error("Email task update failed:", e);
          }
        }
      }
    }

    // 4. Allocate IT Asset (if assetId provided)
    if (data.assetId) {
      try {
        const assetsRepo = new NeonAssetsRepository(ctx);
        await assetsRepo.issue(data.assetId, employeeId, ctx.userId, "good");

        if (journey) {
          const task = journey.tasks.find((t: any) => t.taskKey === "pre__it_equipment_ordered");
          if (task) {
            journey = await lifecycleRepo.setTaskCompletion(task.id, true, ctx.userId);
          }
        }
      } catch (assetErr) {
        console.error("Asset allocation failed:", assetErr);
      }
    }

    // 5. Send Mailbox invite
    let mailboxInviteDetail: string | undefined;
    if (data.triggerMailboxInvite) {
      try {
        const invite = await sendMailboxInvite({
          orgId: ctx.orgId,
          employeeId,
          candidateId: data.candidateId ?? null,
          employmentType: empType,
          personalEmail: data.personalEmail ?? null,
          candidateName: `${data.firstName} ${data.lastName}`.trim(),
          jobTitle: data.designation,
          startDate: data.joiningDate,
          employeeCode,
          department: departmentName,
        });
        mailboxInviteDetail = invite.detail;
      } catch (mailErr) {
        console.error("Mailbox invite dispatch failed:", mailErr);
      }
    }

    return NextResponse.json(
      {
        success: true,
        employeeId,
        employeeCode,
        journey,
        documentId,
        mailboxInviteDetail,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Onboarding setup failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
