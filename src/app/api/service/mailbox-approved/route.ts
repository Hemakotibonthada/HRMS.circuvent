// POST /api/service/mailbox-approved
// Called by Mail.circuvent when HR approves a mailbox registration tied to an employee.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { employees } from "@/db/schema";
import { NeonLifecycleRepository } from "@/db/repositories/lifecycle.neon";
import { activeOrganisationIds } from "@/lib/outbox-sweep";
import { timingSafeEqual } from "@/lib/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  employeeId: z.string().uuid(),
  workEmail: z.string().trim().email().max(320),
  orgId: z.string().uuid().optional(),
});

function authorised(request: NextRequest): boolean {
  const configured = process.env.MAIL_SERVICE_TOKEN?.trim();
  if (!configured) return false;
  const presented = request.headers.get("x-service-token") ?? "";
  return timingSafeEqual(presented, configured);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
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

  const { employeeId, workEmail } = parsed.data;
  const orgIds = parsed.data.orgId ? [parsed.data.orgId] : await activeOrganisationIds();

  for (const orgId of orgIds) {
    const updated = await withTenant({ orgId, userId: "00000000-0000-0000-0000-000000000000" }, async (tx) => {
      const [row] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId), isNull(employees.deletedAt)))
        .limit(1);
      if (!row) return false;

      await tx
        .update(employees)
        .set({
          workEmail: workEmail.toLowerCase(),
          updatedAt: new Date(),
        })
        .where(eq(employees.id, employeeId));

      const lifecycle = new NeonLifecycleRepository({ orgId, userId: "00000000-0000-0000-0000-000000000000" });
      const page = await lifecycle.list("onboarding", { filters: { employeeId } });
      const journey = page.items[0];
      if (journey) {
        const task = journey.tasks.find((t) => t.taskKey === "pre__email_account_created");
        if (task && !task.completed) {
          await lifecycle.setTaskCompletion(task.id, true, "00000000-0000-0000-0000-000000000000");
        }
      }

      return true;
    });

    if (updated) {
      return NextResponse.json({ ok: true, employeeId, workEmail: workEmail.toLowerCase() });
    }
  }

  return NextResponse.json({ error: "Employee not found" }, { status: 404 });
}
