// ═══════════════════════════════════════════════════════════════
// INTERN DIRECTORY LOOKUPS
// ═══════════════════════════════════════════════════════════════
// Read-only queries the lifecycle-document and reminder pipelines need, kept
// out of employee.neon.ts because neither is really about the employee
// record itself. One resolves who at the company should hear that an
// intern's end date is approaching; the other assembles the values a letter
// template needs about the one employee it is being generated for. Mixing
// either into the employee repository would make every future edit to "who
// counts as HR" also touch employee CRUD, and vice versa.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTenant, type TenantContext } from "@/db/client";
import { departments, employees } from "@/db/schema/hrms";
import { users, userRoles } from "@/db/schema/identity";

export interface HrRecipient {
  email: string;
  name: string;
  role: "owner" | "admin" | "hr";
}

/**
 * Owners, admins and HR role-holders for this tenant's HRMS app — the
 * audience for anything that is the company's business rather than one
 * manager's, such as "an intern's last day is approaching" or "a relieving
 * letter needs a countersignature".
 *
 * Filtered to `app = "hrms"` explicitly rather than trusting row-level
 * security alone: `identity.users` and `identity.user_roles` are shared by
 * every app in the ecosystem, so a user can hold a CV-365 admin role and no
 * HRMS role at all, and RLS on these tables scopes by organisation, not by
 * which app a role belongs to. Matches the explicit `orgId` filter already
 * used for the same tables in workflow.neon.ts.
 */
export async function resolveHrRecipients(ctx: TenantContext): Promise<HrRecipient[]> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        email: users.email,
        name: users.displayName,
        role: userRoles.role,
      })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          eq(userRoles.orgId, ctx.orgId),
          eq(userRoles.app, "hrms"),
          inArray(userRoles.role, ["owner", "admin", "hr"]),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      )
      // HR before admin before owner: the person whose job this actually is
      // should be first author on the letter and first name in the reminder,
      // not whichever owner happens to sort first alphabetically.
      .orderBy(users.displayName);

    const rank: Record<HrRecipient["role"], number> = { hr: 0, admin: 1, owner: 2 };
    const byEmail = new Map<string, HrRecipient>();
    for (const r of rows) {
      const role = r.role as HrRecipient["role"];
      const existing = byEmail.get(r.email);
      // A person can hold at most one role per app (user_roles has a unique
      // key on (user_id, app)), so this only ever de-dupes a row appearing
      // twice from the join itself — but the join is one-to-one, so this is
      // defensive rather than load-bearing.
      if (!existing || rank[role] < rank[existing.role]) {
        byEmail.set(r.email, { email: r.email, name: r.name, role });
      }
    }
    return [...byEmail.values()].sort((a, b) => rank[a.role] - rank[b.role]);
  });
}

export interface EmployeeDocumentContext {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  workEmail: string;
  employeeCode: string;
  designation: string;
  departmentName?: string;
  employmentType: string;
  joinDate: string;
  exitDate?: string;
  exitReason?: string;
  internshipEndDate?: string;
  managerName?: string;
  managerEmail?: string;
}

/**
 * Everything a lifecycle letter or certificate needs about one employee, in a
 * single round trip: the department name and the reporting manager's name
 * both require a join the employee row alone cannot answer, and a letter
 * generated one join at a time is a letter that is sometimes missing its
 * manager's name because that lookup was forgotten at a second call site.
 */
export async function loadEmployeeForDocuments(
  ctx: TenantContext,
  employeeId: string,
): Promise<EmployeeDocumentContext | null> {
  return withTenant(ctx, async (tx) => {
    const manager = alias(employees, "manager");
    const [row] = await tx
      .select({
        e: employees,
        departmentName: departments.name,
        managerFirstName: manager.firstName,
        managerLastName: manager.lastName,
        managerEmail: manager.workEmail,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(manager, eq(manager.id, employees.reportingToId))
      .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
      .limit(1);

    if (!row) return null;

    return {
      id: row.e.id,
      firstName: row.e.firstName,
      lastName: row.e.lastName,
      fullName: `${row.e.firstName} ${row.e.lastName}`.trim(),
      workEmail: row.e.workEmail,
      employeeCode: row.e.employeeCode,
      designation: row.e.designation,
      departmentName: row.departmentName ?? undefined,
      employmentType: row.e.employmentType,
      joinDate: row.e.joinDate,
      exitDate: row.e.exitDate ?? undefined,
      exitReason: row.e.exitReason ?? undefined,
      internshipEndDate: row.e.internshipEndDate ?? undefined,
      managerName: row.managerFirstName
        ? `${row.managerFirstName} ${row.managerLastName}`.trim()
        : undefined,
      managerEmail: row.managerEmail ?? undefined,
    };
  });
}

export interface InternCandidate {
  id: string;
  fullName: string;
  workEmail: string;
  employeeCode: string;
  internshipEndDate: string;
  managerName?: string;
  managerEmail?: string;
}

/**
 * Every intern still on the books with an end date set.
 *
 * Filters down to rows the reminder sweep could plausibly still need to act
 * on — `intern`, not deleted, not already exited — and leaves the actual
 * "is a lead-time threshold due" decision to `intern-lifecycle.ts`'s pure
 * date functions rather than duplicating that arithmetic in SQL, so the one
 * rule the tests exercise is the one rule the sweep runs.
 */
export async function loadActiveInternsWithEndDate(
  ctx: TenantContext,
): Promise<InternCandidate[]> {
  return withTenant(ctx, async (tx) => {
    const manager = alias(employees, "manager");
    const rows = await tx
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        workEmail: employees.workEmail,
        employeeCode: employees.employeeCode,
        internshipEndDate: employees.internshipEndDate,
        managerFirstName: manager.firstName,
        managerLastName: manager.lastName,
        managerEmail: manager.workEmail,
      })
      .from(employees)
      .leftJoin(manager, eq(manager.id, employees.reportingToId))
      .where(
        and(
          eq(employees.employmentType, "intern"),
          isNull(employees.deletedAt),
          isNull(employees.exitDate),
        ),
      );

    const withEndDate: InternCandidate[] = [];
    for (const r of rows) {
      if (!r.internshipEndDate) continue;
      withEndDate.push({
        id: r.id,
        fullName: `${r.firstName} ${r.lastName}`.trim(),
        workEmail: r.workEmail,
        employeeCode: r.employeeCode,
        internshipEndDate: r.internshipEndDate,
        managerName: r.managerFirstName
          ? `${r.managerFirstName} ${r.managerLastName}`.trim()
          : undefined,
        managerEmail: r.managerEmail ?? undefined,
      });
    }
    return withEndDate;
  });
}
