import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { departments, employees } from "@/db/schema";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { sendMailboxInvite } from "@/lib/onboarding/mailbox-invite";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    candidateId: z.string().uuid().optional(),
  })
  .refine((data) => data.employeeId || data.candidateId, {
    message: "Either employeeId or candidateId is required",
  });

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limitCheck = checkRateLimit(clientIdentifier(request, ctx.userId), 30, 60_000);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Either employeeId or candidateId is required" }, { status: 400 });
  }

  if (parsed.data.candidateId) {
    const candRow = await withTenant(ctx, async (tx) => {
      const candRes = await tx.execute(
        sql`SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.current_designation,
                   o.designation as offer_designation, o.proposed_start_date,
                   r.personal_email, r.full_legal_name, r.earliest_joining_date
            FROM public.candidates c
            LEFT JOIN public.offers o ON o.candidate_id = c.id
            LEFT JOIN hrms.candidate_registration r ON r.candidate_id = c.id
            WHERE c.id = ${parsed.data.candidateId} AND c.org_id = ${ctx.orgId}
            ORDER BY o.created_at DESC
            LIMIT 1`
      );
      const row = (candRes as unknown as { rows?: Array<any> }).rows?.[0];
      return row ?? null;
    });

    if (!candRow) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const recipient = (candRow.personal_email || candRow.email || "").trim();
    const invite = await sendMailboxInvite({
      orgId: ctx.orgId,
      employeeId: "",
      candidateId: candRow.id,
      employmentType: "full_time",
      personalEmail: recipient,
      candidateName: `${candRow.first_name ?? ""} ${candRow.last_name ?? ""}`.trim() || candRow.full_legal_name || "New Team Member",
      jobTitle: candRow.offer_designation || candRow.current_designation || "New Team Member",
      startDate: candRow.proposed_start_date ? new Date(candRow.proposed_start_date).toISOString().slice(0, 10) : candRow.earliest_joining_date || null,
      employeeCode: "CV-001",
      department: "Executive Management",
    });

    if (invite.status !== "done") {
      return NextResponse.json({ error: invite.detail ?? "Could not send mailbox invitation" }, { status: 422 });
    }

    return NextResponse.json({ ok: true, detail: invite.detail });
  }

  const row = await withTenant(ctx, async (tx) => {
    const [emp] = await tx
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        personalEmail: employees.personalEmail,
        workEmail: employees.workEmail,
        designation: employees.designation,
        joinDate: employees.joinDate,
        employmentType: employees.employmentType,
        employeeCode: employees.employeeCode,
        departmentId: employees.departmentId,
      })
      .from(employees)
      .where(and(eq(employees.id, parsed.data.employeeId!), eq(employees.orgId, ctx.orgId), isNull(employees.deletedAt)))
      .limit(1);

    if (!emp) return null;

    const [dept] = emp.departmentId
      ? await tx.select({ name: departments.name }).from(departments).where(eq(departments.id, emp.departmentId)).limit(1)
      : [];

    return { emp, departmentName: dept?.name ?? null };
  });

  if (!row) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const invite = await sendMailboxInvite({
    orgId: ctx.orgId,
    employeeId: row.emp.id,
    candidateId: null,
    employmentType: row.emp.employmentType,
    personalEmail: row.emp.personalEmail ?? row.emp.workEmail,
    candidateName: `${row.emp.firstName} ${row.emp.lastName}`.trim(),
    jobTitle: row.emp.designation,
    startDate: row.emp.joinDate,
    employeeCode: row.emp.employeeCode,
    department: row.departmentName,
  });

  if (invite.status !== "done") {
    return NextResponse.json({ error: invite.detail ?? "Could not send mailbox invitation" }, { status: 422 });
  }

  return NextResponse.json({ ok: true, detail: invite.detail });
}
