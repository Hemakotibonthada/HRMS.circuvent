// GET/POST /api/scim/v2/Users — SCIM 2.0 user provisioning.
//
// Authenticated by a bearer token issued to the identity provider, not by a
// session. Every request is logged whether it succeeded or not: the question
// after an incident is always "when did the directory tell us to disable this
// account, and what did we do about it?", and neither side's logs alone
// answer it.

import { NextResponse, type NextRequest } from "next/server";
import {
  NeonScimRepository,
  authenticateScim,
} from "@/db/repositories/scim.neon";
import { ScimError, errorResponse, listResponse } from "@/lib/scim";
import { checkRateLimit } from "@/lib/api-context";

const SCIM_CONTENT_TYPE = "application/scim+json";

function scimJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Content-Type": SCIM_CONTENT_TYPE },
  });
}

function unauthorised() {
  return scimJson(errorResponse(new ScimError("Invalid or missing bearer token", 401)), 401);
}

function baseUrlFor(request: NextRequest): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin}/api/scim/v2`;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateScim(request.headers.get("authorization"));
  if (!auth) return unauthorised();

  const limit = checkRateLimit(`scim:${auth.orgId}`, 600, 60_000);
  if (!limit.allowed) {
    return scimJson(errorResponse(new ScimError("Too many requests", 429)), 429);
  }

  const { searchParams } = new URL(request.url);
  const repo = new NeonScimRepository(
    { orgId: auth.orgId },
    auth.tokenId,
    baseUrlFor(request)
  );

  // 1-based, per RFC 7644. Treating it as 0-based silently skips the first
  // user of every page.
  const startIndex = Math.max(1, Number(searchParams.get("startIndex") ?? "1") || 1);
  const count = Math.min(200, Math.max(1, Number(searchParams.get("count") ?? "100") || 100));

  try {
    const { resources, total } = await repo.list(
      searchParams.get("filter"),
      startIndex,
      count
    );

    await repo.log({ operation: "list", statusCode: 200 });
    return scimJson(listResponse(resources, startIndex, count, total));
  } catch (error) {
    if (error instanceof ScimError) {
      await repo.log({
        operation: "list",
        statusCode: error.status,
        errorDetail: error.message,
      });
      return scimJson(errorResponse(error), error.status);
    }
    console.error("SCIM list failed:", error);
    await repo.log({ operation: "list", statusCode: 500, errorDetail: String(error) });
    return scimJson(errorResponse(new ScimError("Internal server error", 500)), 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateScim(request.headers.get("authorization"));
  if (!auth) return unauthorised();

  const limit = checkRateLimit(`scim:${auth.orgId}`, 600, 60_000);
  if (!limit.allowed) {
    return scimJson(errorResponse(new ScimError("Too many requests", 429)), 429);
  }

  const repo = new NeonScimRepository(
    { orgId: auth.orgId },
    auth.tokenId,
    baseUrlFor(request)
  );

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return scimJson(
      errorResponse(new ScimError("Request body is not valid JSON", 400, "invalidSyntax")),
      400
    );
  }

  try {
    const created = await repo.create(payload as never);

    await repo.log({
      operation: "create",
      externalId: created.externalId,
      userId: created.id,
      payload,
      statusCode: 201,
    });

    return scimJson(created, 201);
  } catch (error) {
    if (error instanceof ScimError) {
      // Logged including the payload, so a provider's malformed create can be
      // reproduced rather than guessed at from a support ticket.
      await repo.log({
        operation: "create",
        payload,
        statusCode: error.status,
        errorDetail: error.message,
      });
      return scimJson(errorResponse(error), error.status);
    }
    console.error("SCIM create failed:", error);
    await repo.log({
      operation: "create",
      payload,
      statusCode: 500,
      errorDetail: String(error),
    });
    return scimJson(errorResponse(new ScimError("Internal server error", 500)), 500);
  }
}
