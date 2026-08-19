// ═══════════════════════════════════════════════════════════════
// POST /api/integrations/[id]/test
// ═══════════════════════════════════════════════════════════════
// Sends one real message to the configured endpoint and records what came
// back. This is the difference between the panel this replaces and an honest
// one: "connected" now means a request was made and answered, at a time that
// is written down, rather than a word typed into a fixture.
//
// The result is stored whether it succeeded or failed. A failure that is only
// shown in a toast is a failure nobody sees again.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { integrations } from "@/db/schema/integrations";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { canManageIntegrations } from "@/lib/integrations/permissions";
import { deliver } from "@/lib/integrations/deliver";
import { decryptNullable } from "@/lib/crypto/field-encryption";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!canManageIntegrations(ctx.role)) {
    return NextResponse.json(
      { error: "Only an administrator can manage integrations." },
      { status: 403 }
    );
  }

  // Without this, "send a test" is an outbound request generator.
  const limit = checkRateLimit(`integration-test:${ctx.userId}`, 6, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many tests. Please wait a moment." }, { status: 429 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Unknown integration" }, { status: 404 });
  }

  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select()
      .from(integrations)
      .where(and(eq(integrations.id, id), eq(integrations.orgId, ctx.orgId)))
      .limit(1)
  );

  if (!row) return NextResponse.json({ error: "Unknown integration" }, { status: 404 });

  const result = await deliver(
    row.endpointUrl,
    {
      event: "integration.test",
      sentAt: new Date().toISOString(),
      data: {
        message: "This is a test message from Circuvent HRMS.",
        integration: row.displayName,
      },
    },
    decryptNullable(row.secretEncrypted)
  );

  await withTenant(ctx, (tx) =>
    tx
      .update(integrations)
      .set({
        lastDeliveryAt: new Date(),
        lastStatus: result.ok ? "ok" : "failed",
        // Cleared on success, so a fixed problem stops being reported as current.
        lastError: result.ok ? null : (result.error ?? "Delivery failed").slice(0, 500),
        updatedAt: new Date(),
      })
      .where(and(eq(integrations.id, id), eq(integrations.orgId, ctx.orgId)))
  );

  // 200 either way: the test ran. Whether the endpoint liked it is the body's
  // business, and a 502 here would read as "our API is broken".
  return NextResponse.json({
    ok: result.ok,
    status: result.status ?? null,
    error: result.ok ? null : result.error ?? "Delivery failed",
  });
}
