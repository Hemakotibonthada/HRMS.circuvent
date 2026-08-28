import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { lookupMailboxRegistration } from "@/lib/mail-registration-client";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  employeeId: z.string().uuid().optional(),
  candidateId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limitCheck = checkRateLimit(clientIdentifier(request, ctx.userId), 120, 60_000);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const registration = await lookupMailboxRegistration(parsed.data);
  return NextResponse.json({ registration });
}
