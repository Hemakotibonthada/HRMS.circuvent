// GET/PUT/PATCH/DELETE /api/scim/v2/Users/[id] — one provisioned user.
//
// DELETE deactivates rather than deleting. A removed row takes the employment
// record, the payslip history and the audit trail with it, and a directory
// removing a user means "this person has left", not "erase every trace that
// they worked here". Actual erasure goes through /api/governance, which knows
// about retention obligations.

import { NextResponse, type NextRequest } from "next/server";
import {
  NeonScimRepository,
  authenticateScim,
} from "@/db/repositories/scim.neon";
import { ScimError, errorResponse } from "@/lib/scim";
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

async function withRepo(
  request: NextRequest,
  handler: (repo: NeonScimRepository) => Promise<NextResponse>
): Promise<NextResponse> {
  const auth = await authenticateScim(request.headers.get("authorization"));
  if (!auth) return unauthorised();

  const limit = checkRateLimit(`scim:${auth.orgId}`, 600, 60_000);
  if (!limit.allowed) {
    return scimJson(errorResponse(new ScimError("Too many requests", 429)), 429);
  }

  return handler(
    new NeonScimRepository({ orgId: auth.orgId }, auth.tokenId, baseUrlFor(request))
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  return withRepo(request, async (repo) => {
    try {
      const user = await repo.get(id);
      await repo.log({ operation: "get", userId: id, statusCode: 200 });
      return scimJson(user);
    } catch (error) {
      return handleError(repo, "get", id, undefined, error);
    }
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  return withRepo(request, async (repo) => {
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
      const user = await repo.replace(id, payload as never);
      await repo.log({ operation: "replace", userId: id, payload, statusCode: 200 });
      return scimJson(user);
    } catch (error) {
      return handleError(repo, "replace", id, payload, error);
    }
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  return withRepo(request, async (repo) => {
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
      const user = await repo.patch(id, payload as never);
      await repo.log({ operation: "patch", userId: id, payload, statusCode: 200 });
      return scimJson(user);
    } catch (error) {
      return handleError(repo, "patch", id, payload, error);
    }
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  return withRepo(request, async (repo) => {
    try {
      await repo.deactivate(id);
      await repo.log({ operation: "delete", userId: id, statusCode: 204 });
      // 204 with no body, per RFC 7644 §3.6.
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      return handleError(repo, "delete", id, undefined, error);
    }
  });
}

async function handleError(
  repo: NeonScimRepository,
  operation: string,
  userId: string,
  payload: unknown,
  error: unknown
): Promise<NextResponse> {
  if (error instanceof ScimError) {
    await repo.log({
      operation,
      userId,
      payload,
      statusCode: error.status,
      errorDetail: error.message,
    });
    return scimJson(errorResponse(error), error.status);
  }

  console.error(`SCIM ${operation} failed:`, error);
  await repo.log({
    operation,
    userId,
    payload,
    statusCode: 500,
    errorDetail: String(error),
  });
  return scimJson(errorResponse(new ScimError("Internal server error", 500)), 500);
}
