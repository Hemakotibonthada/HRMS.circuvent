// ═══════════════════════════════════════════════════════════════
// TENANT PROVISIONING
// ═══════════════════════════════════════════════════════════════
//
// Everything a new organisation needs to exist and work, in one transaction.
//
// This was the body of `POST /api/auth/register`. It moved here when sign-up
// grew a verification step: the organisation is now created after the address
// has answered, not when the form was submitted, so the two halves of sign-up
// need to share one definition of what "created" means. Leaving the
// transaction inline and copying it into the verify route is how the two
// would drift — one of them gaining a seed step the other never got, and a
// tenant that works or does not depending on which door it came through.
//
// The comments inside are the original ones. Each records a feature that
// shipped complete and tested and still did nothing, because the tenant it
// ran against had never been given the rows it reads.

import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, subscriptions, userRoles, users } from "@/db/schema/identity";
import { employees, holidays, leaveBalances, leavePolicies } from "@/db/schema/hrms";
import { documentTemplates, referralPolicies } from "@/db/schema/talent";
import { DEFAULT_LEAVE_POLICIES, provisionFor } from "@/lib/leave-provisioning";
import { allHolidays } from "@/lib/ap-holidays";
import { DEFAULT_REFERRAL_POLICIES } from "@/lib/referral-rules";
import { TEMPLATE_CATALOG } from "@/lib/document-templates/catalog";
import { extractTokens } from "@/lib/document-rules";
import { slugify } from "./pending-registration";
import { PLANS, trialEndsAt } from "@/lib/billing/plans";

export interface ProvisionTenantInput {
  /** The founder's display name, as typed on the form. */
  name: string;
  /** The organisation's name. */
  company: string;
  email: string;
  /** Already hashed — this function never sees a plaintext password. */
  passwordHash: string;
}

export interface ProvisionTenantResult {
  orgId: string;
  userId: string;
  employeeCode: string;
}

export async function provisionTenant(
  input: ProvisionTenantInput
): Promise<ProvisionTenantResult> {
  const { name, company, email, passwordHash } = input;

  return db().transaction(async (tx) => {
    // Superuser scope: there is no tenant yet, so RLS has nothing to scope to.
    await tx.execute(`SET LOCAL app.superuser = 'on'`);

    let slug = slugify(company);
    const clash = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (clash.length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const [org] = await tx
      .insert(organizations)
      .values({ name: company, slug })
      .returning({ id: organizations.id });

    const [user] = await tx
      .insert(users)
      .values({
        orgId: org.id,
        email,
        displayName: name,
        passwordHash,
        status: "active",
        // Truthful now in a way it was not before: this row is only written
        // once a code sent to this address has been typed back in.
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });

    await tx
      .update(organizations)
      .set({ ownerId: user.id })
      .where(eq(organizations.id, org.id));

    // The first user owns every app in the suite; they have nobody to grant
    // them access.
    for (const app of ["hrms", "cv365", "ats", "mail", "office"] as const) {
      await tx.insert(userRoles).values({
        userId: user.id,
        orgId: org.id,
        app,
        role: "owner",
      });
    }

    // Everything a tenant needs before its first working day.
    //
    // A newly registered organisation used to get nothing but a row in
    // `organizations`. It had no leave policies, so the first employee it
    // hired could not apply for leave; and no document templates, so the
    // letters screen had nothing to offer and its "New offer" button stayed
    // disabled. Both read as broken features rather than as an unrun setup
    // step, and the setup step existed only as a script somebody had to know
    // to run — `db:seed:templates` — which itself could not run, because it
    // never loaded the environment file.
    //
    // Seeding here, in the same transaction as the organisation, means a
    // tenant that exists is a tenant that works.
    await tx.insert(leavePolicies).values(
      DEFAULT_LEAVE_POLICIES.map((policy) => ({
        orgId: org.id,
        leaveType: policy.leaveType as never,
        label: policy.label,
        annualQuotaDays: String(policy.annualQuotaDays),
        carryForwardLimitDays: String(policy.carryForwardLimitDays ?? 0),
        isProRata: policy.isProRata,
      }))
    );

    await tx.insert(documentTemplates).values(
      TEMPLATE_CATALOG.map((template) => ({
        orgId: org.id,
        name: template.name,
        category: template.category,
        body: template.body,
        requiredTokens: extractTokens(template.body),
        requiresSignature: template.requiresSignature,
        signatoryRoles: template.signatoryRoles,
      }))
    );

    // Referral bonuses. Without a policy the referral module has no amount
    // to work from: referrals can be submitted and none can ever be paid,
    // which is how a complete, tested feature ships doing nothing.
    await tx.insert(referralPolicies).values(
      DEFAULT_REFERRAL_POLICIES.map((policy) => ({
        orgId: org.id,
        name: policy.name,
        seniority: policy.seniority,
        bonusAmountMinor: policy.bonusAmountMinor,
        qualifyingPeriodDays: policy.qualifyingPeriodDays,
        instalments: policy.instalments,
      }))
    );

    // The founder is also an employee.
    //
    // Registration created a user and no employee row, and every
    // employee-facing feature keys on one: clocking in, leave, payslips and
    // attendance all resolve the caller to an employee. So the person who
    // signed the company up could administer it and could not use it —
    // "Clock in" answered 404, which the mobile app rendered as an ordinary
    // "Not clocked in" card, and the web rendered as an empty state.
    //
    // `id` is set to the user's id as well as `userId`, because the routes
    // pass `ctx.userId` straight through as an employee id. Fixing that
    // properly means resolving user → employee at every call site; until
    // then the two ids agreeing for this row is what makes those routes work
    // rather than silently return nothing.
    const [firstName, ...rest] = name.trim().split(/\s+/);
    // The founder is CV-001 of a brand-new organisation. Taken from
    // `hrms.next_employee_code` rather than written as a literal — this used
    // to be the string "EMP-0001", which is why three rows in this database
    // share that code.
    const codeResult = await tx.execute(
      sql`SELECT hrms.next_employee_code(${org.id}::uuid) AS code`
    );
    const employeeCode = (codeResult.rows[0] as { code?: string } | undefined)?.code ?? "CV-001";
    const joinDate = new Date().toISOString().slice(0, 10);
    await tx.insert(employees).values({
      id: user.id,
      orgId: org.id,
      userId: user.id,
      employeeCode,
      firstName: firstName || name.trim(),
      lastName: rest.join(" ") || "-",
      workEmail: email,
      // The person registering a company is its founder. "Owner" is the app
      // *role* they hold, not a job title, and putting it in the designation
      // column is how the staff directory came to list several people as
      // holding a job called Owner.
      designation: "Founder",
      joinDate,
      status: "active",
    });

    // Leave balances, not just leave policies.
    //
    // A policy states an entitlement; a balance is what the leave screen
    // reads and what an application is checked against. Seeding only the
    // policies left a founder with nine leave types and nothing to draw on,
    // so the first leave request came back "insufficient balance" — a
    // complete, tested module reporting a correct answer to a question
    // nobody had set up. This was found by registering a tenant and looking,
    // rather than by reading the code, which had looked right for weeks.
    const balances = provisionFor({
      policies: DEFAULT_LEAVE_POLICIES,
      joinDate,
      year: new Date().getUTCFullYear(),
    });

    if (balances.length > 0) {
      await tx.insert(leaveBalances).values(
        balances.map((balance) => ({
          orgId: org.id,
          employeeId: user.id,
          year: balance.year,
          leaveType: balance.leaveType as never,
          openingDays: String(balance.openingDays),
          accruedDays: String(balance.accruedDays),
          carryForwardDays: String(balance.carryForwardDays),
        }))
      );
    }

    // The public holiday calendar.
    //
    // Attendance and leave both read it: without it every gazetted holiday
    // counts as a working day, so somebody is marked absent on a day the
    // office was shut and a leave request spends days it should not.
    //
    // Only the dates that are certain — the Andhra Pradesh fixed set. The
    // lunisolar festivals move each year and are deliberately not written;
    // see src/lib/ap-holidays.ts.
    await tx.insert(holidays).values(
      allHolidays().map((holiday) => ({
        orgId: org.id,
        name: holiday.name,
        holidayDate: holiday.date,
        year: holiday.year,
        isOptional: holiday.restricted,
        description: holiday.description,
      }))
    );

    // The trial the sign-up page promises.
    //
    // "Start your 14-day free trial" has been on the registration form since
    // it was written, and no subscription row was ever created — the table
    // stayed empty while the billing screen showed every tenant the
    // Professional plan, hardcoded. A tenant with no subscription also has no
    // seat limit to enforce, which is how the spreadsheet importer came to be
    // able to add two thousand employees to a free account.
    //
    // Starter rather than the most expensive plan: a trial that silently
    // grants Enterprise sets an expectation the first invoice takes away.
    const trialPlan = PLANS.starter;
    await tx.insert(subscriptions).values({
      orgId: org.id,
      plan: trialPlan.id,
      status: "trial",
      // `?? undefined` rather than null: the column is not nullable, and an
      // unlimited plan expresses that by leaving it to the column's own
      // default instead of writing an absence the type does not allow.
      maxEmployees: trialPlan.maxEmployees ?? undefined,
      // The founder's own employee row, created above, is the first seat.
      currentEmployees: 1,
      pricePerEmployee: trialPlan.pricePerEmployeeMinor,
      currency: trialPlan.currency,
      billingCycle: "monthly",
      trialEndsAt: trialEndsAt(),
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEndsAt(),
    });

    return { orgId: org.id, userId: user.id, employeeCode };
  });
}
