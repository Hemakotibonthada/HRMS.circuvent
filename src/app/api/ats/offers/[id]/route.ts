// POST /api/ats/offers/[id] — approve, send, or record a response.
//
// The approver must differ from the author. An offer commits the company to a
// salary; one person drafting and approving it has no check on it at all — the
// same separation payroll, erasure and compensation use.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAtsRepository } from "@/db/repositories/ats.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("send") }),
  z.object({
    action: z.literal("respond"),
    accepted: z.boolean(),
    declineReason: z.string().trim().max(1000).optional(),
  }),
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

  const limit = checkRateLimit(`ats-offer-action:${ctx.userId}`, 30, 60_000);
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

  const repo = new NeonAtsRepository(ctx);

  try {
    if (parsed.data.action === "approve") {
      // Approving an offer is a spending decision, not a recruiting one.
      if (!["owner", "admin"].includes(ctx.role)) {
        return NextResponse.json({ error: "You cannot approve offers" }, { status: 403 });
      }
      return NextResponse.json(await repo.approveOffer(id, ctx.userId));
    }

    if (parsed.data.action === "send") {
      if (!["owner", "admin", "hr"].includes(ctx.role)) {
        return NextResponse.json({ error: "You cannot send offers" }, { status: 403 });
      }
      return NextResponse.json(await repo.sendOffer(id));
    }

    // Recording the candidate's answer. The candidate has no account here, so
    // this is HR entering what they were told; a candidate-facing acceptance
    // goes through the e-signature route, which authenticates by token.
    if (!["owner", "admin", "hr"].includes(ctx.role)) {
      return NextResponse.json({ error: "You cannot record a response" }, { status: 403 });
    }

    return NextResponse.json(
      await repo.respondToOffer(id, parsed.data.accepted, parsed.data.declineReason)
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Offer action failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
