// POST /api/governance/requests/[id] — verify, approve or execute a request.
//
// Three separate actions on purpose. Erasure is the only operation in this
// system that destroys data deliberately, so the identity check, the approval
// and the execution are three decisions by potentially three people rather
// than one button.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonGovernanceRepository } from "@/db/repositories/governance.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { withTenant } from "@/db/client";
import { dataSubjectRequests } from "@/db/schema/governance";
import { eq } from "drizzle-orm";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("verify-identity"),
    method: z.string().trim().min(3).max(200),
  }),
  z.object({
    action: z.literal("approve"),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal("execute") }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot action these requests" }, { status: 403 });
  }

  const limit = checkRateLimit(`dsr-action:${ctx.userId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.action === "execute") {
      const result = await new NeonGovernanceRepository(ctx).executeErasure(id, ctx.userId);
      return NextResponse.json(result);
    }

    if (parsed.data.action === "approve" && !["owner", "admin"].includes(ctx.role)) {
      // Approving an irreversible deletion is a step above handling the
      // paperwork for it.
      return NextResponse.json({ error: "You cannot approve an erasure" }, { status: 403 });
    }

    const updated = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const [existing] = await tx
        .select()
        .from(dataSubjectRequests)
        .where(eq(dataSubjectRequests.id, id))
        .for("update")
        .limit(1);

      if (!existing) throw new NotFoundError("Request", id);

      if (parsed.data.action === "verify-identity") {
        const [row] = await tx
          .update(dataSubjectRequests)
          .set({
            identityVerifiedAt: new Date(),
            identityVerifiedById: ctx.userId,
            status: "in_progress",
            notes: parsed.data.method,
            updatedAt: new Date(),
          })
          .where(eq(dataSubjectRequests.id, id))
          .returning({ id: dataSubjectRequests.id, status: dataSubjectRequests.status });
        return row;
      }

      if (!existing.identityVerifiedAt) {
        // Approving before the requester is who they say they are is how
        // someone else's data gets destroyed.
        throw new RepositoryError(
          "Verify the requester's identity before approving",
          409
        );
      }

      const [row] = await tx
        .update(dataSubjectRequests)
        .set({
          approvedById: ctx.userId,
          approvedAt: new Date(),
          status: "awaiting_approval",
          updatedAt: new Date(),
        })
        .where(eq(dataSubjectRequests.id, id))
        .returning({ id: dataSubjectRequests.id, status: dataSubjectRequests.status });
      return row;
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Request action failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
