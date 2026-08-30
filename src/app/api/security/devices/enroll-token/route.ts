import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import { requireApiContext } from "@/lib/api-context";
import { authErrorResponse } from "@/lib/server-auth";
import { currentEmployeeId } from "@/lib/current-employee";
import { mintEnrollToken } from "@/lib/device-agent-auth";
import { deviceInstallLinks } from "@/lib/device-install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVILEGED = new Set(["owner", "admin", "hr", "manager"]);

const bodySchema = z.object({
  employeeId: z.string().uuid().optional(),
  employeeEmail: z.string().email().optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const privileged = PRIVILEGED.has(ctx.role);
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let employeeId = parsed.employeeId ?? null;
  let employeeEmail = parsed.employeeEmail?.trim().toLowerCase() ?? null;
  let employeeCode: string | null = null;

  if (!privileged) {
    const selfId = await currentEmployeeId(ctx);
    if (!selfId) {
      return NextResponse.json(
        { error: "Only employees with an HRMS record can enroll a workstation" },
        { status: 403 }
      );
    }
    employeeId = selfId;
  }

  if (employeeId) {
    const row = await db().query.employees.findFirst({
      where: and(eq(employees.id, employeeId), eq(employees.orgId, ctx.orgId)),
      columns: { id: true, workEmail: true, employeeCode: true },
    });
    if (!row) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    employeeEmail = row.workEmail.toLowerCase();
    employeeCode = row.employeeCode;
  } else if (employeeEmail) {
    if (!privileged) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const row = await db().query.employees.findFirst({
      where: and(eq(employees.workEmail, employeeEmail), eq(employees.orgId, ctx.orgId)),
      columns: { id: true, workEmail: true, employeeCode: true },
    });
    if (!row) {
      return NextResponse.json({ error: "No employee with that work email" }, { status: 404 });
    }
    employeeId = row.id;
    employeeCode = row.employeeCode;
  } else if (!privileged) {
    employeeEmail = (ctx.email ?? "").toLowerCase();
    if (!employeeEmail) {
      return NextResponse.json({ error: "Your session has no email" }, { status: 400 });
    }
    const row = await db().query.employees.findFirst({
      where: and(eq(employees.workEmail, employeeEmail), eq(employees.orgId, ctx.orgId)),
      columns: { id: true, employeeCode: true },
    });
    employeeId = row?.id ?? null;
    employeeCode = row?.employeeCode ?? null;
  } else {
    return NextResponse.json(
      { error: "employeeId or employeeEmail is required" },
      { status: 400 }
    );
  }

  if (!employeeEmail) {
    return NextResponse.json({ error: "Could not resolve employee email" }, { status: 400 });
  }

  const { token, expiresAt } = await mintEnrollToken({
    orgId: ctx.orgId,
    employeeEmail,
    employeeCode,
    employeeId,
    createdBy: ctx.userId,
    ttlMinutes: 60,
  });

  return NextResponse.json({
    token,
    expiresAt: expiresAt.toISOString(),
    employeeEmail,
    employeeCode,
    employeeId,
    install: deviceInstallLinks(token),
  });
}
