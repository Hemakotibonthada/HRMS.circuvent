// ═══════════════════════════════════════════════════════════════
// POST /api/organization/provision-storage
// ═══════════════════════════════════════════════════════════════
//
// Creates (or confirms) a dedicated Cloudflare R2 bucket for the
// authenticated organisation. Must be called by an org admin after
// registration to activate file storage for that tenant.
//
// The bucket is named: circuvent-{orgSlug}
//
// This endpoint is also called automatically by the billing webhook
// (POST /api/billing/webhook) when a subscription transitions to
// "active" and the org does not yet have a bucket configured.
//
// Authorization: admin or owner role only (server-side enforced).

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { organizations } from "@/db/schema/identity";
import { requireApiContext } from "@/lib/api-context";
import { provisionTenantBucket } from "@/lib/r2-tenant";
import { roleHasPermission } from "@/lib/rbac";
import { authErrorResponse } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!roleHasPermission(ctx.role, "settings.manage")) {
    return NextResponse.json(
      { error: "Forbidden — only admins may provision organisation storage." },
      { status: 403 }
    );
  }

  const { orgId } = ctx;

  try {
    // ── Fetch org slug from the database ────────────────────────
    const org = await withTenant({ orgId }, async (tx) => {
      const [row] = await tx
        .select({ slug: organizations.slug, name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      return row;
    });

    if (!org) {
      return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
    }

    // ── Provision the R2 bucket ──────────────────────────────────
    const result = await provisionTenantBucket(org.slug);

    return NextResponse.json({
      ok: true,
      bucketName: result.bucketName,
      storagePrefix: result.storagePrefix,
      s3Endpoint: result.s3Endpoint,
      created: result.created,
      alreadyExisted: result.alreadyExisted,
      message: result.alreadyExisted
        ? `Storage folder "${result.storagePrefix}" already exists for ${org.name}.`
        : `Storage folder "${result.storagePrefix}" provisioned for ${org.name}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[provision-storage] Failed to provision R2 bucket:", error);
    return NextResponse.json(
      { error: "Failed to provision storage bucket.", detail: message },
      { status: 500 }
    );
  }
}
