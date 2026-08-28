// ═══════════════════════════════════════════════════════════════
// GET / PATCH / DELETE /api/departments/[id]
// ═══════════════════════════════════════════════════════════════
// Direct CRUD endpoint for an individual department.
// Allows organization managers and administrators to update department
// details including allocated budgets, heads, descriptions and statuses.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { departments } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  code: z.string().trim().min(1).max(32).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  headId: z.string().uuid().optional().nullable(),
  head: z.string().trim().max(150).optional().nullable(),
  headEmail: z.string().email().optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
  budget: z.coerce.number().min(0).optional().nullable(),
  location: z.string().trim().max(100).optional().nullable(),
  costCenter: z.string().trim().max(64).optional().nullable(),
  isActive: z.boolean().optional(),
  status: z.enum(["active", "inactive", "restructuring"]).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { id } = await params;

  try {
    const row = await withTenant(ctx, async (tx) => {
      const [dept] = await tx
        .select({
          id: departments.id,
          name: departments.name,
          code: departments.code,
          description: departments.description,
          headId: departments.headId,
          parentId: departments.parentId,
          budgetMinor: departments.budgetMinor,
          costCenter: departments.costCenter,
          isActive: departments.isActive,
          headcount: sql<number>`(
            SELECT count(*) FROM hrms.employees e
            WHERE e.department_id = ${departments.id} AND e.deleted_at IS NULL
          )`,
        })
        .from(departments)
        .where(eq(departments.id, id))
        .limit(1);

      return dept || null;
    });

    if (!row) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...row,
      budget: row.budgetMinor ? Number(row.budgetMinor) / 100 : 0,
      employees: Number(row.headcount || 0),
    });
  } catch (error) {
    console.error("Department get failed:", error);
    return NextResponse.json({ error: "Could not read department" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!roleHasPermission(ctx.role, "departments.manage")) {
    return NextResponse.json(
      { error: "Insufficient permissions to update department details or budget" },
      { status: 403 }
    );
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  try {
    const updated = await withTenant(ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(departments)
        .where(eq(departments.id, id))
        .limit(1);

      if (!existing) return null;

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
      if (parsed.data.code !== undefined) updateData.code = parsed.data.code;
      if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
      if (parsed.data.headId !== undefined) updateData.headId = parsed.data.headId;
      if (parsed.data.parentId !== undefined) updateData.parentId = parsed.data.parentId;
      if (parsed.data.costCenter !== undefined) updateData.costCenter = parsed.data.costCenter;
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
      if (parsed.data.status !== undefined) updateData.isActive = parsed.data.status === "active";

      if (parsed.data.budget !== undefined) {
        updateData.budgetMinor =
          parsed.data.budget !== null
            ? Math.round(parsed.data.budget * 100)
            : null;
      }

      const [row] = await tx
        .update(departments)
        .set(updateData)
        .where(eq(departments.id, id))
        .returning();

      return row;
    });

    if (!updated) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...updated,
      budget: updated.budgetMinor ? Number(updated.budgetMinor) / 100 : 0,
    });
  } catch (error) {
    console.error("Department update failed:", error);
    return NextResponse.json({ error: "Could not update this department" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!roleHasPermission(ctx.role, "departments.manage")) {
    return NextResponse.json({ error: "You cannot delete departments" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const deleted = await withTenant(ctx, async (tx) => {
      const [row] = await tx
        .delete(departments)
        .where(eq(departments.id, id))
        .returning({ id: departments.id });

      return row || null;
    });

    if (!deleted) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id: deleted.id });
  } catch (error) {
    console.error("Department delete failed:", error);
    return NextResponse.json({ error: "Could not delete this department" }, { status: 500 });
  }
}
