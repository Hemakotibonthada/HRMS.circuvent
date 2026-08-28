// GET/PATCH /api/employees/me — the details an employee owns about themselves.
//
// `/api/employees/[id]` already updates an employee, and is owner/admin/HR
// only. That is right for the fields it covers: an employee who could set
// their own designation, manager, salary or employment status would be able to
// promote themselves.
//
// But it also meant nobody could correct their own phone number or record
// their date of birth without asking HR to do it by hand — which is why not a
// single employee has a date of birth, and why the birthday strip on the home
// screen has never once had anything to show.
//
// So this exists, and the allowlist below is the entire security argument.
// Nothing outside it can be written here, whatever the request body contains.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { departments, employees } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";

/**
 * What somebody may change about themselves.
 *
 * Personal facts only — the things an employee is the authority on and HR is
 * merely a transcriber of. Deliberately absent, and each for a reason:
 *
 *   employeeCode, previousEmployeeCode  identity, and used as a payroll key
 *   workEmail                           identity; the login is derived from it
 *   designation, departmentId           a promotion is not self-service
 *   reportingToId                       reassigning your own manager routes
 *                                       your own approvals
 *   status, joinDate, exitDate          employment facts with statutory effect
 *   ctcMinor, currency                  pay
 *   internshipEndDate, noticePeriodDays terms of engagement
 *
 * A date of birth is included even though it drives gratuity and retirement
 * calculations, because the alternative — nobody having one — is worse, and
 * because the employee is the only person who actually knows it. It is
 * writable once and then locked; see below.
 */
const selfEditable = z.object({
  phone: z.string().trim().max(20).nullish(),
  personalEmail: z.string().trim().email().max(255).nullish(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  bloodGroup: z.string().trim().max(10).nullish(),
  maritalStatus: z.enum(["single", "married", "divorced", "widowed"]).nullish(),
  addressLine1: z.string().trim().max(255).nullish(),
  city: z.string().trim().max(120).nullish(),
  state: z.string().trim().max(120).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  country: z.string().trim().max(120).nullish(),
  /**
   * Your own face, which is yours to change.
   *
   * `https` only, and parsed rather than pattern-matched: a `javascript:` or
   * `data:` value here would be rendered by whatever shows the picture, and
   * the staff directory shows it to the whole company. Length-capped because
   * a data URL smuggled through would otherwise be a megabyte in a text
   * column read on every screen that greets somebody by name.
   */
  avatarUrl: z
    .string()
    .trim()
    .max(2048)
    .refine(
      (value) => {
        try {
          return new URL(value).protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "A picture has to be an https address" }
    )
    .nullish(),
});

const RETURNED = {
  id: employees.id,
  firstName: employees.firstName,
  lastName: employees.lastName,
  employeeCode: employees.employeeCode,
  workEmail: employees.workEmail,
  personalEmail: employees.personalEmail,
  phone: employees.phone,
  avatarUrl: employees.avatarUrl,
  dateOfBirth: employees.dateOfBirth,
  bloodGroup: employees.bloodGroup,
  maritalStatus: employees.maritalStatus,
  addressLine1: employees.addressLine1,
  city: employees.city,
  state: employees.state,
  postalCode: employees.postalCode,
  country: employees.country,
  designation: employees.designation,
  joinDate: employees.joinDate,
  // Facts about your own job. Not editable here — HR owns all of them — but a
  // person is entitled to see the terms they are employed on without asking,
  // and a "Job" tab that could not name your department or your manager would
  // be a heading over nothing.
  confirmationDate: employees.confirmationDate,
  employmentType: employees.employmentType,
  departmentId: employees.departmentId,
  reportingToId: employees.reportingToId,
} as const;

async function loadSelf(ctx: Awaited<ReturnType<typeof requireApiContext>>) {
  return withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
    const rows = await tx
      .select(RETURNED)
      .from(employees)
      .where(
        and(
          eq(employees.userId, ctx.userId),
          eq(employees.orgId, ctx.orgId),
          isNull(employees.deletedAt)
        )
      )
      .limit(1);

    const self = rows[0] ?? null;
    if (!self) return null;

    // Resolved to names here rather than shipping uuids a client cannot read.
    // Two small lookups on a screen somebody opens occasionally, against one
    // join that would complicate every other use of RETURNED.
    const [department] = self.departmentId
      ? await tx
          .select({ name: departments.name })
          .from(departments)
          .where(eq(departments.id, self.departmentId))
          .limit(1)
      : [];

    const [manager] = self.reportingToId
      ? await tx
          .select({ firstName: employees.firstName, lastName: employees.lastName })
          .from(employees)
          .where(eq(employees.id, self.reportingToId))
          .limit(1)
      : [];

    const { departmentId: _d, reportingToId: _r, ...rest } = self;

    return {
      ...rest,
      departmentName: department?.name ?? null,
      managerName: manager ? `${manager.firstName} ${manager.lastName}`.trim() : null,
    };
  });
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(clientIdentifier(request, ctx.userId), 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const me = await loadSelf(ctx);
    if (!me) {
      return NextResponse.json(
        { error: "You do not have an employee record yet. Ask HR to create one." },
        { status: 404 }
      );
    }
    // `dateOfBirthLocked` rather than making the client infer it from the value
    // being non-null: the rule lives on the server, and a client that guessed
    // it would eventually guess differently.
    return NextResponse.json({ ...me, dateOfBirthLocked: me.dateOfBirth != null });
  } catch (error) {
    console.error("Self profile lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`self:${ctx.userId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: z.infer<typeof selfEditable>;
  try {
    // `strict` is the point. An unknown key is a request to write something
    // outside the allowlist, and answering it with a quiet success would be
    // the worst of both worlds — the caller believes it worked.
    body = selfEditable.strict().parse(await request.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid request";
    return NextResponse.json({ error: message ?? "Invalid request" }, { status: 400 });
  }

  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  if (body.dateOfBirth) {
    const dob = new Date(`${body.dateOfBirth}T00:00:00Z`);
    if (Number.isNaN(dob.getTime())) {
      return NextResponse.json({ error: "That is not a real date" }, { status: 400 });
    }

    const years = (Date.now() - dob.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
    // 14 is the floor for employment in India under the Child Labour
    // (Prohibition and Regulation) Act. A date failing this is a typo, and
    // storing it would put an impossible age into gratuity and retirement
    // calculations that nobody would look at again.
    if (years < 14) {
      return NextResponse.json(
        { error: "That date of birth would make you under 14. Please check it." },
        { status: 400 }
      );
    }
    if (years > 100) {
      return NextResponse.json({ error: "Please check that date of birth." }, { status: 400 });
    }
  }

  try {
    const result = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const existing = await tx
        .select({ id: employees.id, dateOfBirth: employees.dateOfBirth })
        .from(employees)
        .where(
          and(
            eq(employees.userId, ctx.userId),
            eq(employees.orgId, ctx.orgId),
            isNull(employees.deletedAt)
          )
        )
        .limit(1);

      const me = existing[0];
      if (!me) return { kind: "noRecord" as const };

      // Writable once, then HR's job. A date of birth drives gratuity
      // eligibility and retirement date; letting somebody edit it freely turns
      // a statutory calculation into something they can move. Setting it the
      // first time is self-service because otherwise it never gets set at all.
      if (body.dateOfBirth != null && me.dateOfBirth != null && body.dateOfBirth !== me.dateOfBirth) {
        return { kind: "dobLocked" as const };
      }

      const patch = Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== undefined)
      );

      const rows = await tx
        .update(employees)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(employees.id, me.id), eq(employees.orgId, ctx.orgId)))
        .returning(RETURNED);

      return { kind: "ok" as const, employee: rows[0] };
    });

    switch (result.kind) {
      case "noRecord":
        return NextResponse.json(
          { error: "You do not have an employee record yet. Ask HR to create one." },
          { status: 404 }
        );
      case "dobLocked":
        return NextResponse.json(
          {
            error:
              "Your date of birth is already recorded. Ask HR to change it — it affects " +
              "gratuity and your retirement date.",
          },
          { status: 409 }
        );
      default:
        return NextResponse.json({
          ...result.employee,
          dateOfBirthLocked: result.employee.dateOfBirth != null,
        });
    }
  } catch (error) {
    console.error("Self profile update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
