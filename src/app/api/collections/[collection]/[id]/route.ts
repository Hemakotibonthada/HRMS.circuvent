import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext, checkRateLimit, clientIdentifier } from "@/lib/api-context";
import { withTenant } from "@/db/client";
import { ALLOWED_COLLECTIONS } from "../route";

// ═══════════════════════════════════════════════════════════════
// GET/PATCH/PUT/DELETE /api/collections/[collection]/[id]
// ═══════════════════════════════════════════════════════════════
// Single-document operations for the free-form collections.

function guard(collection: string): string | null {
  return ALLOWED_COLLECTIONS.has(collection) ? collection : null;
}

interface Row {
  id: string;
  data: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function present(r: Row) {
  return { ...r.data, id: r.id, createdAt: r.created_at, updatedAt: r.updated_at };
}

async function resolve(
  request: NextRequest,
  params: Promise<{ collection: string; id: string }>
) {
  const ctx = await requireApiContext(request);
  const { collection: raw, id } = await params;
  const collection = guard(raw);
  if (!collection) throw Object.assign(new Error(`Unknown collection "${raw}"`), { status: 404 });
  // A malformed uuid would otherwise reach Postgres and fail as a 500 rather
  // than the 404 it actually is.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw Object.assign(new Error("Not found"), { status: 404 });
  }
  return { ctx, collection, id };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collection: string; id: string }> }
) {
  try {
    const { ctx, collection, id } = await resolve(request, params);
    const row = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id::text, data, created_at, updated_at
          FROM hrms.doc_store
         WHERE id = ${id}::uuid AND collection = ${collection} AND deleted_at IS NULL
      `);
      return (res.rows as unknown as Row[])[0] ?? null;
    });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(present(row));
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
}

/** Merges the supplied fields into the stored document. */
async function patch(
  request: NextRequest,
  params: Promise<{ collection: string; id: string }>,
  replace: boolean
) {
  try {
    const { ctx, collection, id } = await resolve(request, params);

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

    const row = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const res = await tx.execute(sql`
        UPDATE hrms.doc_store
           SET data = ${replace ? sql`${JSON.stringify(data)}::jsonb` : sql`data || ${JSON.stringify(data)}::jsonb`},
               updated_at = now()
         WHERE id = ${id}::uuid AND collection = ${collection} AND deleted_at IS NULL
         RETURNING id::text, data, created_at, updated_at
      `);
      return (res.rows as unknown as Row[])[0] ?? null;
    });

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(present(row));
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
}

export function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ collection: string; id: string }> }
) {
  return patch(request, ctx.params, false);
}

export function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ collection: string; id: string }> }
) {
  return patch(request, ctx.params, true);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ collection: string; id: string }> }
) {
  try {
    const { ctx, collection, id } = await resolve(request, params);
    const row = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      // Soft delete: these records are referenced from pages that may still be
      // showing them, and an accidental removal should be recoverable.
      const res = await tx.execute(sql`
        UPDATE hrms.doc_store
           SET deleted_at = now(), updated_at = now()
         WHERE id = ${id}::uuid AND collection = ${collection} AND deleted_at IS NULL
         RETURNING id::text
      `);
      return (res.rows as unknown as { id: string }[])[0] ?? null;
    });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true, id: row.id });
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
}
