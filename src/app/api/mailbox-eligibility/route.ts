// ═══════════════════════════════════════════════════════════════
// HRMS API — does this employee ID and date of birth name a real hire?
// ═══════════════════════════════════════════════════════════════
// Called by Mail.circuvent, server to server, when somebody asks for a mailbox
// without an onboarding link. Mail cannot answer the question itself: its
// database is `neondb` and this one is `hrms` — different databases on one
// cluster, so nothing there can read an employee record.
//
// ── Not a login ──
// What this authorises is placing a request in a queue that HR then approves,
// and the approver is shown the HR record it matched. That is why a pair of
// facts the employee knows is enough here and would not be enough to sign in.
//
// ── Rate limited hard, and quiet about why it said no ──
// Employee codes are sequential and there are 366 possible dates, so this is
// the obvious thing to brute-force. The response never says which half was
// wrong, and the limit is keyed on the end user's IP as forwarded by Mail, so
// one prober cannot spend everybody else's budget.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { departments, employees } from "@/db/schema";
import { activeOrganisationIds } from "@/lib/outbox-sweep";
import { selectEligible, type EmployeeRecord } from "@/lib/mailbox-eligibility";
import { checkRateLimit } from "@/lib/api-context";
import { timingSafeEqual } from "@/lib/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  employeeCode: z.string().trim().min(1).max(64),
  joiningDate: z.string().trim().min(8).max(32),
  /** The end user's IP, forwarded by Mail, so the limit tracks the prober. */
  callerIp: z.string().trim().max(64).optional(),
});

/** One answer for every refusal. See `mailbox-eligibility.ts` for why. */
const REFUSED = {
  ok: false as const,
  error:
    "That employee ID and joining date do not match a current employee record. " +
    "Check them against your offer letter, or ask HR to create your mailbox for you.",
};

export async function POST(request: NextRequest) {
  const configured = process.env.MAIL_SERVICE_TOKEN?.trim();
  if (!configured) {
    // Refused rather than waved through. An unauthenticated endpoint that
    // confirms employee IDs against dates of birth is worse than one that does
    // not answer at all.
    return NextResponse.json(
      {
        error:
          "MAIL_SERVICE_TOKEN is not configured, so this deployment cannot verify mailbox " +
          "requests. Set it to the same value here and in Mail.circuvent.",
      },
      { status: 503 }
    );
  }

  const presented = request.headers.get("x-service-token") ?? "";
  if (!timingSafeEqual(presented, configured)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { employeeCode, joiningDate, callerIp } = parsed.data;

  // Keyed on the end user, not on Mail, which would otherwise share one budget
  // across everybody registering. Ten attempts an hour is generous for
  // somebody reading their own offer letter and mean for a script.
  const limit = checkRateLimit(`mailbox-eligibility:${callerIp || "unknown"}`, 10, 60 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later, or ask HR to create your mailbox." },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  try {
    // The caller has no session, so there is no organisation on the request —
    // it is the result of this lookup. Each organisation is queried inside its
    // own tenant scope rather than with one cross-tenant read, so a record is
    // only ever read under the policy that governs it.
    const orgIds = await activeOrganisationIds();
    const candidates: EmployeeRecord[] = [];

    for (const orgId of orgIds) {
      const record = await withTenant({ orgId }, async (tx) => {
        const [row] = await tx
          .select({
            id: employees.id,
            orgId: employees.orgId,
            employeeCode: employees.employeeCode,
            firstName: employees.firstName,
            lastName: employees.lastName,
            designation: employees.designation,
            department: departments.name,
            employmentType: employees.employmentType,
            joinDate: employees.joinDate,
            status: employees.status,
            deletedAt: employees.deletedAt,
          })
          .from(employees)
          .leftJoin(departments, eq(departments.id, employees.departmentId))
          .where(and(eq(employees.orgId, orgId), eq(employees.employeeCode, employeeCode)))
          .limit(1);
        return row;
      });

      // Collected rather than decided on the spot: employee codes are unique
      // per organisation, not globally, and `CV-001` already exists in two of
      // them. Stopping at the first organisation holding the code would refuse
      // a real employee because another company shares their number.
      if (record) candidates.push(record as unknown as EmployeeRecord);
    }

    const decision = selectEligible(candidates, joiningDate);

    if (!decision.ok) {
      // Logged with the reason, answered without it.
      console.warn("[mailbox-eligibility] refused", {
        employeeCode,
        reason: decision.reason,
        candidatesConsidered: candidates.length,
      });
      return NextResponse.json(REFUSED, { status: 200 });
    }

    return NextResponse.json({ ok: true, employee: decision.employee }, { status: 200 });
  } catch (error) {
    console.error("Mailbox eligibility lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
