import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext, checkRateLimit, clientIdentifier } from "@/lib/api-context";
import { withTenant } from "@/db/client";

// ═══════════════════════════════════════════════════════════════
// GET/POST /api/collections/[collection]
// ═══════════════════════════════════════════════════════════════
// Backs the dashboard's document collections, which previously read and wrote
// Firestore directly from the browser.
//
// Only the free-form collections live here. Employees, leave, payroll and the
// rest have their own tables and their own routes; routing them through a
// schemaless store as well would give the same records two homes and let them
// drift apart.
//
// Tenant scoping is not done in this file. Every statement runs inside
// withTenant, so row-level security decides what is visible — a filter this
// code cannot forget to apply.

/**
 * Collections that may be stored as documents.
 *
 * An allowlist rather than a free-for-all: without it any caller could invent a
 * collection name and use the table as unbounded storage.
 *
 * `socialPosts` was missing until it was noticed that the company wall had
 * never worked. The page called this route, got a 404 for an unknown
 * collection, and rendered an empty feed; posting failed just as silently. It
 * belongs here rather than in its own table for the same reason as the rest --
 * a wall post is free-form text with no relationships anything else depends on.
 */
export const ALLOWED_COLLECTIONS = new Set([
  "goals", "training", "enrollments", "documents", "notifications", "teams",
  "surveys", "feedback", "kudos", "events", "policies", "loans", "travel",
  "wfh", "overtime", "timesheets", "meetingBookings", "visitors", "incidents",
  "celebrations", "settings", "awards", "knowledgebase", "grievances",
  "wellness", "badges", "performanceReviews", "auditLog", "socialPosts",
]);

function guard(collection: string): string | null {
  return ALLOWED_COLLECTIONS.has(collection) ? collection : null;
}

export async function GET(
  request: NextRequest,
  ctxParam: { params: Promise<{ collection: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { collection: raw } = await ctxParam.params;
  const collection = guard(raw);
  if (!collection) {
    return NextResponse.json({ error: `Unknown collection "${raw}"` }, { status: 404 });
  }

  const limit = checkRateLimit(clientIdentifier(request, ctx.userId), 240, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const take = Math.min(Math.max(Number(searchParams.get("limit") ?? 200), 1), 500);

  try {
    const rows = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id::text, data, created_at, updated_at
          FROM hrms.doc_store
         WHERE collection = ${collection} AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ${take}
      `);
      return res.rows as unknown as {
        id: string;
        data: Record<string, unknown>;
        created_at: Date;
        updated_at: Date;
      }[];
    });

    // The id is merged into the document because these pages were written
    // against Firestore, where the document id is part of the record.
    return NextResponse.json({
      items: rows.map((r) => ({
        ...r.data,
        id: r.id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      count: rows.length,
    });
  } catch (e) {
    console.error(`Failed to read collection ${collection}:`, e);
    return NextResponse.json({ error: "Could not read this collection" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  ctxParam: { params: Promise<{ collection: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { collection: raw } = await ctxParam.params;
  const collection = guard(raw);
  if (!collection) {
    return NextResponse.json({ error: `Unknown collection "${raw}"` }, { status: 404 });
  }

  const limit = checkRateLimit(`write:${clientIdentifier(request, ctx.userId)}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let data: Record<string, unknown>;
  try {
    data = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }

  try {
    const created = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO hrms.doc_store (org_id, collection, data, created_by)
        VALUES (${ctx.orgId}::uuid, ${collection}, ${JSON.stringify(data)}::jsonb, ${ctx.userId}::uuid)
        RETURNING id::text, data, created_at, updated_at
      `);
      return res.rows[0] as unknown as {
        id: string;
        data: Record<string, unknown>;
        created_at: Date;
        updated_at: Date;
      };
    });

    return NextResponse.json(
      {
        ...created.data,
        id: created.id,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error(`Failed to write to collection ${collection}:`, e);
    return NextResponse.json({ error: "Could not save this record" }, { status: 500 });
  }
}
