// ═══════════════════════════════════════════════════════════════
// PATCH/DELETE /api/integrations/[id]
// ═══════════════════════════════════════════════════════════════
// Enable, disable, rename, or remove. Same permission as creating one, and the
// same reason: this decides where the server sends company data.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { integrations } from "@/db/schema/integrations";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { canManageIntegrations } from "@/lib/integrations/permissions";
import { checkEndpoint } from "@/lib/integrations/endpoint";
import { encryptNullable } from "@/lib/crypto/field-encryption";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";
import { present } from "../route";

const patchSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  endpointUrl: z.string().trim().url().max(2048).optional(),
  secret: z.string().trim().min(8).max(200).nullable().optional(),
  isEnabled: z.boolean().optional(),
  events: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
});

function forbidden() {
  return NextResponse.json(
    { error: "Only an administrator can manage integrations." },
    { status: 403 }
  );
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!canManageIntegrations(ctx.role)) return forbidden();

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Unknown integration" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  // A change of endpoint is a new destination and gets the same scrutiny as
  // the first one. Checking only on create would make edit the way around it.
  if (parsed.data.endpointUrl) {
    const decision = await checkEndpoint(parsed.data.endpointUrl);
    if (!decision.ok) {
      const reason = decision.reason ?? "That endpoint is not allowed.";
      return NextResponse.json(
        { error: reason, issues: [{ path: "endpointUrl", message: reason }] },
        { status: 400 }
      );
    }
  }

  const changes: Partial<typeof integrations.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.displayName !== undefined) changes.displayName = parsed.data.displayName;
  if (parsed.data.endpointUrl !== undefined) changes.endpointUrl = parsed.data.endpointUrl;
  if (parsed.data.isEnabled !== undefined) changes.isEnabled = parsed.data.isEnabled;
  if (parsed.data.events !== undefined) changes.events = parsed.data.events;
  // `null` clears the secret; omitting the key leaves it alone. Those are
  // different intentions and the API should not collapse them.
  if (parsed.data.secret !== undefined) {
    changes.secretEncrypted = encryptNullable(parsed.data.secret);
  }

  try {
    const [updated] = await withTenant(ctx, (tx) =>
      tx
        .update(integrations)
        .set(changes)
        .where(and(eq(integrations.id, id), eq(integrations.orgId, ctx.orgId)))
        .returning()
    );

    if (!updated) return NextResponse.json({ error: "Unknown integration" }, { status: 404 });
    return NextResponse.json(present(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/integrations_org_name_key/.test(message)) {
      return NextResponse.json({ error: "An integration with that name already exists." }, { status: 409 });
    }
    console.error("Integration update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!canManageIntegrations(ctx.role)) return forbidden();

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Unknown integration" }, { status: 404 });
  }

  try {
    const [removed] = await withTenant(ctx, (tx) =>
      tx
        .delete(integrations)
        .where(and(eq(integrations.id, id), eq(integrations.orgId, ctx.orgId)))
        .returning({ id: integrations.id })
    );

    if (!removed) return NextResponse.json({ error: "Unknown integration" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Integration delete failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
