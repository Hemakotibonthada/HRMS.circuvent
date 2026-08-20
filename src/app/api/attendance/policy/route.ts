// GET/PUT /api/attendance/policy — whether this organisation photographs its
// staff when they punch, and for how long it keeps the images.
//
// GET is open to any signed-in employee. Somebody being photographed is
// entitled to know that they are, how long the image is kept and who can see
// it, without asking an administrator — and the mobile app needs the same
// answer to know whether to open a camera.
//
// PUT is owner, admin and HR only. This is a decision about other people's
// faces, and it is recorded with the name of whoever took it.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { attendancePolicies } from "@/db/schema/attendance";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  selfieNotice,
} from "@/lib/attendance-selfie";
import { storageConfigured } from "@/lib/storage/object-store";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";

const putSchema = z.object({
  requireSelfieOnPunch: z.boolean(),
  selfieRetentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional(),
});

const CAN_EDIT = new Set(["owner", "admin", "hr"]);

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(clientIdentifier(request, ctx.userId), 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const row = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const rows = await tx
        .select()
        .from(attendancePolicies)
        .where(eq(attendancePolicies.orgId, ctx.orgId))
        .limit(1);
      return rows[0] ?? null;
    });

    // No row is the answer, not a missing answer. An organisation that has
    // never opened this screen is not photographing anybody.
    const policy = {
      requireSelfieOnPunch: row?.requireSelfieOnPunch ?? false,
      selfieRetentionDays: row?.selfieRetentionDays ?? DEFAULT_RETENTION_DAYS,
    };

    return NextResponse.json({
      ...policy,
      canEdit: CAN_EDIT.has(ctx.role),
      // Sent only when it applies, so the app cannot show somebody a notice
      // about photographs that are not being taken.
      notice: policy.requireSelfieOnPunch ? selfieNotice(policy) : null,
    });
  } catch (error) {
    console.error("Attendance policy lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!CAN_EDIT.has(ctx.role)) {
    return NextResponse.json(
      { error: "Only an owner, admin or HR can change this" },
      { status: 403 }
    );
  }

  const limit = checkRateLimit(`policy:${ctx.userId}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await request.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid request";
    return NextResponse.json({ error: message ?? "Invalid request" }, { status: 400 });
  }

  // Refused rather than accepted-and-ignored. Switching this on with nowhere
  // to put the images would photograph every employee and discard the result:
  // the intrusion happens and the evidence it was meant to provide does not
  // exist.
  if (body.requireSelfieOnPunch && !storageConfigured()) {
    return NextResponse.json(
      {
        error:
          "Object storage is not configured, so punch photographs would be taken and " +
          "then discarded. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and " +
          "S3_SECRET_ACCESS_KEY before switching this on.",
      },
      { status: 409 }
    );
  }

  try {
    const saved = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const values = {
        orgId: ctx.orgId,
        requireSelfieOnPunch: body.requireSelfieOnPunch,
        selfieRetentionDays: body.selfieRetentionDays ?? DEFAULT_RETENTION_DAYS,
        updatedByUserId: ctx.userId,
        updatedAt: new Date(),
      };

      const rows = await tx
        .insert(attendancePolicies)
        .values(values)
        .onConflictDoUpdate({ target: attendancePolicies.orgId, set: values })
        .returning();

      return rows[0];
    });

    const policy = {
      requireSelfieOnPunch: saved.requireSelfieOnPunch,
      selfieRetentionDays: saved.selfieRetentionDays,
    };

    return NextResponse.json({
      ...policy,
      canEdit: true,
      notice: policy.requireSelfieOnPunch ? selfieNotice(policy) : null,
    });
  } catch (error) {
    console.error("Attendance policy update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
