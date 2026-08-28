// ═══════════════════════════════════════════════════════════════
// GET/POST /api/integrations
// ═══════════════════════════════════════════════════════════════
// Organisation-level configuration, so `settings.manage` throughout — which
// only an administrator holds. An ordinary employee has no business seeing
// where the company sends its notifications, let alone adding a destination.
//
// The endpoint URL is checked before anything is stored. It is the server that
// will make the request, so an unchecked URL here is server-side request
// forgery with an administrator's convenience as the excuse; see
// lib/integrations/endpoint.ts for what that means in practice.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { integrations } from "@/db/schema/integrations";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { canManageIntegrations } from "@/lib/integrations/permissions";
import { checkEndpoint } from "@/lib/integrations/endpoint";
import { encryptNullable } from "@/lib/crypto/field-encryption";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";
import { isMissingTable, notProvisioned } from "@/lib/integrations/provisioning";

const KINDS = ["slack_webhook", "teams_webhook", "generic_webhook"] as const;

const createSchema = z.object({
  kind: z.enum(KINDS),
  displayName: z.string().trim().min(2, "Give it a name you will recognise").max(80),
  endpointUrl: z.string().trim().url("Enter the webhook URL").max(2048),
  /** Optional. Stored encrypted and never read back out over the API. */
  secret: z
    .string()
    .trim()
    .min(8, "A secret shorter than 8 characters is not worth having")
    .max(200)
    .optional(),
  events: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
});

/**
 * What a caller is allowed to see.
 *
 * The secret is absent by construction rather than deleted afterwards: a field
 * that has to be remembered about is one that a later endpoint will forget.
 */
export function present(row: typeof integrations.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.displayName,
    endpointUrl: row.endpointUrl,
    hasSecret: Boolean(row.secretEncrypted),
    events: row.events,
    isEnabled: row.isEnabled,
    lastDeliveryAt: row.lastDeliveryAt,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

function forbidden() {
  return NextResponse.json(
    { error: "Only an administrator can manage integrations." },
    { status: 403 }
  );
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!canManageIntegrations(ctx.role)) return forbidden();

  try {
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select()
        .from(integrations)
        .where(eq(integrations.orgId, ctx.orgId))
        .orderBy(integrations.createdAt)
    );
    return NextResponse.json({ items: rows.map(present) });
  } catch (error) {
    if (isMissingTable(error)) return notProvisioned();
    console.error("Integrations list failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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

  if (!canManageIntegrations(ctx.role)) return forbidden();

  // Each attempt makes the server open a connection to a URL of the caller's
  // choosing, so this is also the limit on using us as a port scanner.
  const limit = checkRateLimit(`integration:${ctx.userId}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment." }, { status: 429 });
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

  const decision = await checkEndpoint(parsed.data.endpointUrl);
  if (!decision.ok) {
    const reason = decision.reason ?? "That endpoint is not allowed.";
    return NextResponse.json(
      { error: reason, issues: [{ path: "endpointUrl", message: reason }] },
      { status: 400 }
    );
  }

  try {
    const [created] = await withTenant(ctx, (tx) =>
      tx
        .insert(integrations)
        .values({
          orgId: ctx.orgId,
          kind: parsed.data.kind,
          displayName: parsed.data.displayName,
          endpointUrl: parsed.data.endpointUrl,
          secretEncrypted: encryptNullable(parsed.data.secret ?? null),
          events: parsed.data.events ?? [],
          createdByUserId: ctx.userId,
        })
        .returning()
    );

    return NextResponse.json(present(created), { status: 201 });
  } catch (error) {
    if (isMissingTable(error)) return notProvisioned();
    const message = error instanceof Error ? error.message : String(error);
    // The unique index is the only constraint a caller can hit by accident.
    if (/integrations_org_name_key/.test(message)) {
      return NextResponse.json(
        { error: "An integration with that name already exists." },
        { status: 409 }
      );
    }
    console.error("Integration create failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
