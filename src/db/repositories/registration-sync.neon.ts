// ═══════════════════════════════════════════════════════════════
// REGISTRATION SYNC — applying the joining form to employee records
// ═══════════════════════════════════════════════════════════════
// `lib/registration-sync.ts` decides what to fill; this reads the two rows,
// writes the result, and makes sure Paystub hears about it.
//
// ── Why Paystub is queued rather than told directly ──
// Paystub already receives `dateOfBirth`, `gender`, `address` and the rest in
// `PaystubEmployeeSyncBody` — it reads them from the HRMS employee row. So the
// only thing standing between a joining form and a correct payslip is the
// employee row itself; once that is filled, an ordinary sync carries it.
// Queuing through the existing outbox means a Paystub outage delays the
// update rather than losing it, and it is the same path every other employee
// change already takes.

import { and, eq, isNull, sql } from "drizzle-orm";

import { withTenant, type TenantContext } from "@/db/client";
import { employees } from "@/db/schema";
import { queuePaystubEmployeeSync } from "@/lib/paystub-sync-outbox";
import {
  planRegistrationSync,
  type RegistrationSource,
  type RegistrationSyncPlan,
} from "@/lib/registration-sync";

export interface EmployeeSyncOutcome {
  employeeId: string;
  employeeCode: string;
  filled: string[];
  reason?: RegistrationSyncPlan["reason"];
}

export interface RegistrationSyncSummary {
  considered: number;
  updated: number;
  outcomes: EmployeeSyncOutcome[];
}

/**
 * Columns on `employees` that `planRegistrationSync` may write, mapped to the
 * drizzle column. Written out rather than derived so that a field added to the
 * plan cannot silently reach the database without somebody deciding it should.
 */
const WRITABLE = {
  dateOfBirth: employees.dateOfBirth,
  gender: employees.gender,
  maritalStatus: employees.maritalStatus,
  bloodGroup: employees.bloodGroup,
  personalEmail: employees.personalEmail,
  phone: employees.phone,
  addressLine1: employees.addressLine1,
  city: employees.city,
  state: employees.state,
  postalCode: employees.postalCode,
  country: employees.country,
} as const;

/**
 * Fills in what the Careers registration can supply, for one employee or all.
 *
 * `candidate_registration` is written by ATS with raw SQL and is not in this
 * app's Drizzle schema, so it is read the same way — through the tagged
 * template, never the `{ sql, params }` object form, which `execute` does not
 * accept and which fails only at runtime.
 */
export async function syncEmployeesFromRegistration(
  ctx: TenantContext,
  options: { employeeId?: string; limit?: number } = {}
): Promise<RegistrationSyncSummary> {
  const limit = options.limit ?? 500;

  const rows = await withTenant(ctx, async (tx) => {
    const result = await tx.execute(
      options.employeeId
        ? sql`SELECT e.id::text AS employee_id, e.employee_code,
                     e.date_of_birth::text AS emp_dob, e.gender::text AS emp_gender,
                     e.marital_status AS emp_marital, e.blood_group AS emp_blood,
                     e.personal_email AS emp_personal_email, e.phone AS emp_phone,
                     e.address_line1 AS emp_address, e.city AS emp_city,
                     e.state AS emp_state, e.postal_code AS emp_pin, e.country AS emp_country,
                     r.submitted_at, r.date_of_birth::text AS reg_dob, r.gender AS reg_gender,
                     r.marital_status AS reg_marital, r.blood_group AS reg_blood,
                     r.personal_email AS reg_personal_email, r.mobile, r.mobile_country_code,
                     r.present_line1, r.present_line2, r.present_city, r.present_state,
                     r.present_pin, r.present_country
                FROM hrms.employees e
                LEFT JOIN hrms.candidate_registration r ON r.candidate_id = e.candidate_id
               WHERE e.org_id = ${ctx.orgId}::uuid
                 AND e.deleted_at IS NULL
                 AND e.id = ${options.employeeId}::uuid
               LIMIT 1`
        : sql`SELECT e.id::text AS employee_id, e.employee_code,
                     e.date_of_birth::text AS emp_dob, e.gender::text AS emp_gender,
                     e.marital_status AS emp_marital, e.blood_group AS emp_blood,
                     e.personal_email AS emp_personal_email, e.phone AS emp_phone,
                     e.address_line1 AS emp_address, e.city AS emp_city,
                     e.state AS emp_state, e.postal_code AS emp_pin, e.country AS emp_country,
                     r.submitted_at, r.date_of_birth::text AS reg_dob, r.gender AS reg_gender,
                     r.marital_status AS reg_marital, r.blood_group AS reg_blood,
                     r.personal_email AS reg_personal_email, r.mobile, r.mobile_country_code,
                     r.present_line1, r.present_line2, r.present_city, r.present_state,
                     r.present_pin, r.present_country
                FROM hrms.employees e
                JOIN hrms.candidate_registration r ON r.candidate_id = e.candidate_id
               WHERE e.org_id = ${ctx.orgId}::uuid
                 AND e.deleted_at IS NULL
                 AND r.submitted_at IS NOT NULL
               LIMIT ${limit}`
    );
    return (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
  });

  const summary: RegistrationSyncSummary = { considered: rows.length, updated: 0, outcomes: [] };

  for (const row of rows) {
    const registration: RegistrationSource | null = row.submitted_at
      ? {
          submittedAt: row.submitted_at as string,
          dateOfBirth: (row.reg_dob as string) ?? null,
          gender: (row.reg_gender as string) ?? null,
          maritalStatus: (row.reg_marital as string) ?? null,
          bloodGroup: (row.reg_blood as string) ?? null,
          personalEmail: (row.reg_personal_email as string) ?? null,
          mobile: (row.mobile as string) ?? null,
          mobileCountryCode: (row.mobile_country_code as string) ?? null,
          presentLine1: (row.present_line1 as string) ?? null,
          presentLine2: (row.present_line2 as string) ?? null,
          presentCity: (row.present_city as string) ?? null,
          presentState: (row.present_state as string) ?? null,
          presentPin: (row.present_pin as string) ?? null,
          presentCountry: (row.present_country as string) ?? null,
        }
      : null;

    const plan = planRegistrationSync(
      {
        dateOfBirth: (row.emp_dob as string) ?? null,
        gender: (row.emp_gender as string) ?? null,
        maritalStatus: (row.emp_marital as string) ?? null,
        bloodGroup: (row.emp_blood as string) ?? null,
        personalEmail: (row.emp_personal_email as string) ?? null,
        phone: (row.emp_phone as string) ?? null,
        addressLine1: (row.emp_address as string) ?? null,
        city: (row.emp_city as string) ?? null,
        state: (row.emp_state as string) ?? null,
        postalCode: (row.emp_pin as string) ?? null,
        country: (row.emp_country as string) ?? null,
      },
      registration
    );

    const employeeId = String(row.employee_id);
    const employeeCode = String(row.employee_code ?? "");

    if (plan.filled.length === 0) {
      summary.outcomes.push({ employeeId, employeeCode, filled: [], reason: plan.reason });
      continue;
    }

    await withTenant(ctx, async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      for (const [field, value] of Object.entries(plan.updates)) {
        const column = WRITABLE[field as keyof typeof WRITABLE];
        if (column) set[field] = value;
      }

      await tx
        .update(employees)
        .set(set)
        .where(
          and(
            eq(employees.id, employeeId),
            eq(employees.orgId, ctx.orgId),
            isNull(employees.deletedAt)
          )
        );

      // Paystub reads date of birth, gender and address from the employee row
      // to print a payslip and to decide PF and ESI eligibility. Filling the
      // row and not telling Paystub would leave the payslip exactly as wrong
      // as it was.
      await queuePaystubEmployeeSync(tx, ctx.orgId, employeeId);
    });

    summary.updated++;
    summary.outcomes.push({ employeeId, employeeCode, filled: plan.filled });
  }

  return summary;
}
