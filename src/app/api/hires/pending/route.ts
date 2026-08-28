// ═══════════════════════════════════════════════════════════════
// HRMS API — hires ready to be added as employees
// ═══════════════════════════════════════════════════════════════
// The Add Employee dialog now has to name the candidate a person was hired as,
// because `POST /api/employees` refuses a hire with no offer behind it. This is
// what fills that picker.
//
// It deliberately returns the same judgement the create endpoint will apply,
// rather than a list of every candidate: an HR user who can select somebody the
// server will then refuse has been set up to fail, and the refusal arrives
// after they have typed the whole form.
//
// ── Why it lists people who are not quite ready, too ──
// A candidate who accepted but has not submitted their joining form is exactly
// the case HR needs to see and chase; hiding them would leave HR wondering why
// somebody they know accepted is missing. They come back with `ready: false`
// and the reason, so the dialog can show them disabled with the fix.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { candidates, offers } from "@/db/schema";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { checkHireProvenance } from "@/lib/hire-provenance";
import { mostAdvanced } from "@/db/repositories/hire-provenance.neon";

const querySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export interface PendingHire {
  candidateId: string;
  applicationId: string | null;
  offerId: string | null;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  personalEmail: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  panNumber: string | null;
  aadhaarNumber: string | null;
  uanNumber: string | null;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactPhone: string | null;
  designation: string | null;
  departmentId: string | null;
  departmentName: string | null;
  offerStatus: string | null;
  annualCtcMinor: string | null;
  proposedStartDate: string | null;
  noticePeriodDays: number | null;
  bankName: string | null;
  accountHolderName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  accountType: string | null;
  consentBackgroundVerification: boolean | null;
  registrationSubmittedAt: string | null;
  ready: boolean;
  /** Empty when ready; otherwise what HR has to resolve first. */
  blockers: string[];
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limitCheck = checkRateLimit(clientIdentifier(request, ctx.userId), 120, 60_000);
  if (!limitCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limitCheck.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const search = parsed.data.search?.trim();
  const limit = parsed.data.limit ?? 50;

  try {
    const items = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      // Everyone with an offer that has gone somewhere, newest first.
      const rows = await tx
        .select({
          offerId: offers.id,
          candidateId: candidates.id,
          firstName: candidates.firstName,
          lastName: candidates.lastName,
          email: candidates.email,
          phone: candidates.phone,
          designation: candidates.currentDesignation,
          offerDesignation: offers.designation,
          offerStatus: offers.status,
          applicationId: offers.applicationId,
          annualCtcMinor: offers.annualCtcMinor,
          proposedStartDate: offers.proposedStartDate,
        })
        .from(offers)
        .innerJoin(candidates, eq(candidates.id, offers.candidateId))
        .where(
          and(
            eq(offers.orgId, ctx.orgId),
            isNotNull(offers.candidateId),
            search
              ? or(
                  ilike(candidates.firstName, `%${search}%`),
                  ilike(candidates.lastName, `%${search}%`),
                  ilike(candidates.email, `%${search}%`)
                )
              : undefined
          )
        )
        .orderBy(desc(offers.createdAt))
        .limit(500);

      if (rows.length === 0) return [] as PendingHire[];

      // Collapsed to one entry per candidate, keeping their most advanced offer
      const byCandidate = new Map<string, typeof rows>();
      for (const row of rows) {
        const list = byCandidate.get(row.candidateId) ?? [];
        list.push(row);
        byCandidate.set(row.candidateId, list);
      }

      const candidateIds = [...byCandidate.keys()];

      // Check if already an active employee
      const hired = await tx.execute(
        sql`SELECT candidate_id::text AS candidate_id
              FROM hrms.employees
             WHERE candidate_id = ANY(${sql.param(candidateIds)}::uuid[])
               AND deleted_at IS NULL`
      );
      const alreadyHired = new Set(
        ((hired as unknown as { rows?: Array<{ candidate_id: string }> }).rows ?? []).map((row) =>
          String(row.candidate_id)
        )
      );

      // Fetch full registration profile from candidate_registration
      const regRowsRes = await tx.execute(
        sql`SELECT 
              candidate_id::text AS candidate_id, 
              submitted_at,
              full_legal_name,
              date_of_birth::text AS date_of_birth,
              gender,
              blood_group,
              personal_email,
              mobile,
              emergency_contact_name,
              emergency_contact_relationship,
              emergency_contact_phone,
              pan_masked,
              aadhaar_masked,
              uan_masked,
              expected_ctc_minor::text AS expected_ctc_minor,
              current_ctc_minor::text AS current_ctc_minor,
              notice_period_days,
              earliest_joining_date::text AS earliest_joining_date,
              consent_background_verification
            FROM hrms.candidate_registration
           WHERE candidate_id = ANY(${sql.param(candidateIds)}::uuid[])`
      );

      interface RegData {
        candidate_id: string;
        submitted_at: string | Date | null;
        full_legal_name?: string | null;
        date_of_birth?: string | null;
        gender?: string | null;
        blood_group?: string | null;
        personal_email?: string | null;
        mobile?: string | null;
        emergency_contact_name?: string | null;
        emergency_contact_relationship?: string | null;
        emergency_contact_phone?: string | null;
        pan_masked?: string | null;
        aadhaar_masked?: string | null;
        uan_masked?: string | null;
        expected_ctc_minor?: string | null;
        current_ctc_minor?: string | null;
        notice_period_days?: number | null;
        earliest_joining_date?: string | null;
        consent_background_verification?: boolean | null;
      }

      const regMap = new Map<string, RegData>();
      for (const row of ((regRowsRes as unknown as { rows?: RegData[] }).rows ?? [])) {
        regMap.set(String(row.candidate_id), row);
      }

      // Fetch department from job_postings via applications
      const deptRes = await tx.execute(
        sql`SELECT 
              app.candidate_id::text AS candidate_id,
              jp.department_id::text AS department_id,
              dept.name AS department_name
            FROM hrms.applications app
            LEFT JOIN hrms.job_postings jp ON jp.id = app.job_id
            LEFT JOIN hrms.departments dept ON dept.id = jp.department_id
           WHERE app.candidate_id = ANY(${sql.param(candidateIds)}::uuid[])`
      );

      const deptMap = new Map<string, { departmentId: string | null; departmentName: string | null }>();
      for (const row of (
        deptRes as unknown as { rows?: Array<{ candidate_id: string; department_id: string | null; department_name: string | null }> }
      ).rows ?? []) {
        if (row.department_id) {
          deptMap.set(String(row.candidate_id), {
            departmentId: row.department_id,
            departmentName: row.department_name,
          });
        }
      }

      const results: PendingHire[] = [];
      for (const [candidateId, group] of byCandidate) {
        if (alreadyHired.has(candidateId)) continue;

        const best = mostAdvanced(group.map((row) => String(row.offerStatus)));
        const primary = group.find((row) => String(row.offerStatus) === best) ?? group[0];
        const reg = regMap.get(candidateId);
        const registrationSubmittedAt = reg?.submitted_at
          ? new Date(reg.submitted_at).toISOString()
          : null;

        const verdict = checkHireProvenance({
          candidateId,
          applicationId: primary.applicationId ?? null,
          offerStatus: best,
          registrationSubmittedAt,
        });

        const deptInfo = deptMap.get(candidateId);

        results.push({
          candidateId,
          applicationId: primary.applicationId ?? null,
          offerId: primary.offerId ?? null,
          name: `${primary.firstName ?? ""} ${primary.lastName ?? ""}`.trim(),
          firstName: primary.firstName ?? "",
          lastName: primary.lastName ?? "",
          email: primary.email ?? "",
          phone: reg?.mobile || primary.phone || null,
          personalEmail: reg?.personal_email || primary.email || null,
          gender: reg?.gender || null,
          dateOfBirth: reg?.date_of_birth || null,
          bloodGroup: reg?.blood_group || null,
          panNumber: reg?.pan_masked || null,
          aadhaarNumber: reg?.aadhaar_masked || null,
          uanNumber: reg?.uan_masked || null,
          emergencyContactName: reg?.emergency_contact_name || null,
          emergencyContactRelationship: reg?.emergency_contact_relationship || null,
          emergencyContactPhone: reg?.emergency_contact_phone || null,
          designation: primary.offerDesignation || primary.designation || null,
          departmentId: deptInfo?.departmentId || null,
          departmentName: deptInfo?.departmentName || null,
          offerStatus: best,
          annualCtcMinor: primary.annualCtcMinor?.toString() || reg?.expected_ctc_minor || reg?.current_ctc_minor || null,
          proposedStartDate: primary.proposedStartDate || reg?.earliest_joining_date || null,
          noticePeriodDays: reg?.notice_period_days || null,
          bankName: null,
          accountHolderName: `${primary.firstName ?? ""} ${primary.lastName ?? ""}`.trim(),
          accountNumber: null,
          ifsc: null,
          accountType: "savings",
          consentBackgroundVerification: reg?.consent_background_verification ?? true,
          registrationSubmittedAt,
          ready: verdict.ok,
          blockers: verdict.ok ? [] : verdict.issues.map((issue) => issue.message),
        });
      }

      // Ready first, then alphabetically.
      results.sort((a, b) =>
        a.ready === b.ready ? a.name.localeCompare(b.name) : a.ready ? -1 : 1
      );
      return results.slice(0, limit);
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Pending hires lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
