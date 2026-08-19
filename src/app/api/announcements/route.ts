// ═══════════════════════════════════════════════════════════════
// GET/POST /api/announcements
// ═══════════════════════════════════════════════════════════════
// `hrms.announcements` is a real table with no route. Three pages read it —
// the dashboard, the announcements page and admin — all through
// `genericService(COLLECTIONS.announcements)`, which falls back to the
// document store for anything without an entity route. The document store
// refuses it, correctly, because it has a table. So all three showed an empty
// list and no error.
//
// Found by `scripts/audit-data-paths.ts` rather than by waiting for it to be
// reported, after this same shape turned up twice in payroll and employees.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { desc, isNull, or, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { announcements } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";

const createSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(300),
  body: z.string().trim().min(1, "An announcement needs a body").max(20_000),
  category: z.string().trim().max(64).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  audienceDepartmentIds: z.array(z.string().uuid()).max(200).optional(),
  audienceLocationIds: z.array(z.string().uuid()).max(200).optional(),
  isPinned: z.boolean().optional(),
  /** Omit to publish immediately; set to schedule. */
  publishedAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const includeExpired = searchParams.get("includeExpired") === "true";
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 100), 1), 500);

  try {
    const rows = await withTenant(ctx, async (tx) => {
      // An expired announcement is not deleted — it stays for anyone looking
      // back — but it does not belong on the dashboard.
      const notExpired = or(
        isNull(announcements.expiresAt),
        sql`${announcements.expiresAt} > now()`
      );

      const query = tx.select().from(announcements);
      const scoped = includeExpired ? query : query.where(notExpired);

      // Pinned first, then newest. A pinned announcement that sorts by date is
      // not pinned to anything.
      return scoped
        .orderBy(
          desc(announcements.isPinned),
          desc(announcements.publishedAt),
          desc(announcements.createdAt)
        )
        .limit(limit);
    });

    const items = rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt?.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json({ items, data: items, count: items.length });
  } catch (error) {
    console.error("Announcements lookup failed:", error);
    return NextResponse.json({ error: "Could not read announcements" }, { status: 500 });
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

  if (!roleHasPermission(ctx.role, "announcements.create")) {
    return NextResponse.json({ error: "You cannot post announcements" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  const { publishedAt, expiresAt } = parsed.data;
  if (publishedAt && expiresAt && new Date(expiresAt) <= new Date(publishedAt)) {
    return NextResponse.json(
      { error: "An announcement cannot expire before it is published" },
      { status: 400 }
    );
  }

  try {
    const created = await withTenant(ctx, async (tx) => {
      const [row] = await tx
        .insert(announcements)
        .values({
          orgId: ctx.orgId,
          title: parsed.data.title,
          body: parsed.data.body,
          category: parsed.data.category ?? "general",
          priority: (parsed.data.priority ?? "medium") as never,
          audienceDepartmentIds: parsed.data.audienceDepartmentIds ?? [],
          audienceLocationIds: parsed.data.audienceLocationIds ?? [],
          isPinned: parsed.data.isPinned ?? false,
          // Published now unless scheduled. Left null it would never appear,
          // which reads to the author as "the post failed".
          publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          createdById: ctx.userId,
        })
        .returning();
      return row;
    });

    return NextResponse.json(
      {
        ...created,
        publishedAt: created.publishedAt?.toISOString(),
        expiresAt: created.expiresAt?.toISOString(),
        createdAt: created.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Announcement creation failed:", error);
    return NextResponse.json({ error: "Could not post this announcement" }, { status: 500 });
  }
}
