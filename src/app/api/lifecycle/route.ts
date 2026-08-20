// ═══════════════════════════════════════════════════════════════
// GET/POST /api/lifecycle
// ═══════════════════════════════════════════════════════════════
// Onboarding and offboarding checklists.
//
// Before this, neither had any storage: the dashboard pages held tick state in
// React `useState`, so an HR admin working through an exit checklist lost
// every tick on refresh — and offboarding showed a "Clearance updated" toast
// that said the opposite.
//
// Gated on `employees.edit` rather than a role list. Running someone's exit
// clearance is an HR function; a manager holding `employees.view` can see the
// directory without being able to certify that a laptop came back.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLifecycleRepository } from "@/db/repositories/lifecycle.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";
import { roleHasPermission } from "@/lib/rbac";

const kindSchema = z.enum(["onboarding", "offboarding"]);

const listSchema = z.object({
  kind: kindSchema.default("onboarding"),
  status: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const taskSchema = z.object({
  taskKey: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(300),
  phase: z.string().trim().min(1).max(80),
  phaseOrder: z.number().int().min(0).max(1000).optional(),
  assignee: z.string().trim().max(40).optional(),
  mandatory: z.boolean().optional(),
  dueOffsetDays: z.number().int().min(-365).max(365).optional(),
});

const startSchema = z.object({
  employeeId: z.string().uuid(),
  kind: kindSchema,
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Anchor date must be YYYY-MM-DD"),
  exitReason: z.string().trim().max(2000).optional(),
  tasks: z.array(taskSchema).min(1, "A checklist needs at least one task").max(200),
});

function fail(error: unknown) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Lifecycle API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const parsed = listSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  // Someone without `employees.view_all` sees only their own checklist — a new
  // joiner should be able to follow their own onboarding without being handed
  // the whole company's exits.
  const seesAll = roleHasPermission(ctx.role, "employees.edit");

  try {
    // ctx.userId is the signing-in account, not the employment record a
    // checklist is keyed by — see lib/current-employee.ts.
    const self = seesAll ? null : await currentEmployeeId(ctx);
    const employeeId = seesAll ? parsed.data.employeeId : (self ?? undefined);

    if (!seesAll && !self) {
      return NextResponse.json({
        data: [],
        items: [],
        pagination: {
          page: parsed.data.page ?? 1,
          pageSize: parsed.data.pageSize ?? parsed.data.limit ?? 50,
          total: 0,
          hasMore: false,
        },
      });
    }

    const repo = new NeonLifecycleRepository(ctx);
    const page = await repo.list(parsed.data.kind, {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize ?? parsed.data.limit,
      filters: { status: parsed.data.status, employeeId },
    });

    const summary = seesAll ? await repo.summary(parsed.data.kind) : undefined;

    return NextResponse.json({
      data: page.items,
      items: page.items,
      summary,
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        hasMore: page.hasMore,
      },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!roleHasPermission(ctx.role, "employees.edit")) {
    return NextResponse.json({ error: "You cannot start a checklist" }, { status: 403 });
  }

  const limit = checkRateLimit(`lifecycle-start:${clientIdentifier(request, ctx.userId)}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = startSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }

  try {
    const journey = await new NeonLifecycleRepository(ctx).start({
      employeeId: parsed.data.employeeId,
      kind: parsed.data.kind,
      anchorDate: parsed.data.anchorDate,
      exitReason: parsed.data.exitReason,
      tasks: parsed.data.tasks,
    });

    return NextResponse.json({ data: journey }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
