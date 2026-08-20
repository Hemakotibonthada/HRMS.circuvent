// ═══════════════════════════════════════════════════════════════
// POST /api/attendance/clock
// ═══════════════════════════════════════════════════════════════
// Clock in and out. The employee is always the caller — punching for a
// colleague ("buddy punching") is the classic attendance fraud, so the id
// comes from the token and the body cannot override it.
//
// Geofence validation happens in the repository, on the server. A mobile
// client asserting it is at the office is claiming something it has every
// reason to misreport.

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { NeonAttendanceRepository } from "@/db/repositories/attendance.neon";
import { withTenant } from "@/db/client";
import { attendancePolicies, attendancePunchPhotos } from "@/db/schema/attendance";
import {
  MAX_SELFIE_BYTES,
  checkSelfie,
  selfieObjectKey,
  type AttendancePolicy,
  type SelfieCheck,
} from "@/lib/attendance-selfie";
import { deleteObject, putObject, sha256Hex } from "@/lib/storage/object-store";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { NoEmployeeRecordError, requireCurrentEmployeeId } from "@/lib/current-employee";

const schema = z.object({
  action: z.enum(["in", "out"]),
  method: z.enum(["biometric", "web", "mobile", "manual", "geo_fence"]).default("web"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // The device's own assessment of its fix. Accepted rather than ignored
  // because the geofence logic treats accuracy as a radius of uncertainty —
  // without it, a reading accurate to half a kilometre is indistinguishable
  // from one accurate to five metres, and both get a yes-or-no answer they
  // do not deserve.
  accuracyMetres: z.number().min(0).max(100_000).optional(),
  capturedAt: z.number().int().min(0).optional(),
  isMocked: z.boolean().optional(),
  photoUrl: z.string().url().max(2048).optional(),
  /**
   * A punch photograph, base64 encoded.
   *
   * Only accepted when the organisation has switched selfie punch on, and
   * refused outright when it has not — storing a face nobody asked for is the
   * same harm as storing one under a policy that was never enabled.
   *
   * Base64 rather than multipart because the rest of this endpoint is JSON and
   * a punch has to work from a queued offline request, which is stored as
   * JSON. The 33% inflation on a ~150 KB image is affordable; two encodings
   * of the same request are not.
   */
  selfie: z
    .object({
      base64: z.string().min(1).max(4 * 1024 * 1024),
      contentType: z.string().min(1).max(100),
      /** When the shutter fired, which is not when this request arrived. */
      takenAt: z.number().int().min(0).optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Tight, because a punch is a once-or-twice-daily action. A flood is either
  // a stuck client or someone probing the geofence boundary.
  const limit = checkRateLimit(`clock:${ctx.userId}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const {
    action,
    method,
    latitude,
    longitude,
    accuracyMetres,
    capturedAt,
    isMocked,
    photoUrl,
    selfie,
  } = parsed.data;

  // The photograph is validated and stored *before* the punch is recorded. A
  // punch that the policy required a photograph for must never exist without
  // one, and the only way to guarantee that is to fail before writing it
  // rather than after.
  let storedSelfie: { key: string; takenAt: Date } | null = null;
  try {
    const policy = await loadAttendancePolicy(ctx);
    const decoded = selfie ? decodeSelfie(selfie) : null;

    if (decoded === "invalid_encoding") {
      return NextResponse.json({ error: "That photograph could not be read" }, { status: 400 });
    }

    const verdict = checkSelfie(policy, decoded);
    if (!verdict.ok) {
      return NextResponse.json({ error: selfieRejectionMessage(verdict) }, { status: 400 });
    }

    if (decoded && verdict.extension) {
      const digest = await sha256Hex(decoded.bytes);
      const key = selfieObjectKey({
        orgId: ctx.orgId,
        captureId: randomUUID(),
        direction: action,
        sha256Hex: digest,
        extension: verdict.extension,
      });

      await putObject(key, decoded.bytes, decoded.contentType);
      storedSelfie = {
        key,
        takenAt: selfie?.takenAt ? new Date(selfie.takenAt) : new Date(),
      };
    }
  } catch (error) {
    // Storage refused, so the photograph does not exist. Recording the punch
    // anyway would leave a required photograph permanently missing, with
    // nothing to show that it was ever attempted.
    console.error("Punch photograph could not be stored:", error);
    return NextResponse.json(
      {
        error:
          "Your photograph could not be saved, so the punch was not recorded. " +
          "Please try again.",
      },
      { status: 502 }
    );
  }

  try {
    const repo = new NeonAttendanceRepository(ctx);
    const employeeId = await requireCurrentEmployeeId(ctx);
    const record =
      action === "in"
        ? await repo.clockIn({
            employeeId,
            method,
            latitude,
            longitude,
            accuracyMetres,
            capturedAt,
            isMocked,
            photoUrl,
            ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
          })
        : await repo.clockOut({ employeeId, method, latitude, longitude });

    if (storedSelfie) {
      await attachSelfie(ctx, record.id, action, storedSelfie);
    }

    return NextResponse.json(record, { status: action === "in" ? 201 : 200 });
  } catch (error) {
    // The photograph was stored before the punch, so that a punch requiring one
    // can never exist without it. The cost of that ordering is this: when the
    // punch is refused — outside the geofence, no employee record, already
    // clocked in — the image is already in the bucket with nothing pointing at
    // it. Retention walks attendance records, so it would never find it, and a
    // face nobody can see and nothing will delete is the worst outcome here.
    if (storedSelfie) {
      await deleteObject(storedSelfie.key).catch((cleanupError) => {
        // Logged loudly rather than swallowed: this is the one path that can
        // leave an image behind, and somebody has to be able to find it.
        console.error(
          `Orphaned punch photograph ${storedSelfie?.key} could not be removed:`,
          cleanupError
        );
      });
    }

    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Clock action failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** GET /api/attendance/clock — today's record, for the punch button's state. */
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const employeeId = await requireCurrentEmployeeId(ctx);
    const { record, fence } = await new NeonAttendanceRepository(ctx).todayWithFence(employeeId);
    // 200 with null rather than 404: "not clocked in yet" is the expected
    // state at the start of a day, not an error.
    //
    // The fence goes with it so the app can warn someone standing in the
    // wrong place before they tap, rather than after. Handing the client the
    // boundary does not weaken anything — the punch is validated server-side
    // regardless, and a client determined to lie does not need to be told
    // where the office is to do it.
    return NextResponse.json({ record, fence });
  } catch (error) {
    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Attendance lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── Punch photographs ───────────────────────────────────────

type ApiContext = Awaited<ReturnType<typeof requireApiContext>>;

/**
 * The organisation's policy, or null when it has never set one.
 *
 * Null is a real answer meaning "not required", not a missing one. Every
 * caller treats it that way, so an organisation that has never opened the
 * setting is not photographing anybody.
 */
async function loadAttendancePolicy(ctx: ApiContext): Promise<AttendancePolicy | null> {
  return withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
    const rows = await tx
      .select({
        requireSelfieOnPunch: attendancePolicies.requireSelfieOnPunch,
        selfieRetentionDays: attendancePolicies.selfieRetentionDays,
      })
      .from(attendancePolicies)
      .where(eq(attendancePolicies.orgId, ctx.orgId))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Decodes the base64 body.
 *
 * The length is checked before decoding as well as after: a client can claim
 * a small image and send four megabytes of base64, and refusing at the string
 * length avoids allocating the buffer to find that out.
 */
function decodeSelfie(input: {
  base64: string;
  contentType: string;
}): { bytes: Uint8Array; contentType: string } | "invalid_encoding" | null {
  // 4/3 expansion, plus padding and any data-URL prefix a client adds.
  if (input.base64.length > MAX_SELFIE_BYTES * 2) return "invalid_encoding";

  const payload = input.base64.includes(",")
    ? input.base64.slice(input.base64.indexOf(",") + 1)
    : input.base64;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, "base64");
  } catch {
    return "invalid_encoding";
  }
  if (buffer.byteLength === 0) return "invalid_encoding";

  return { bytes: new Uint8Array(buffer), contentType: input.contentType };
}

/** Turns a refusal into something worth reading on a phone. */
function selfieRejectionMessage(verdict: Extract<SelfieCheck, { ok: false }>): string {
  switch (verdict.reason) {
    case "missing":
      return "Your employer requires a photograph with each punch. Take one and try again.";
    case "not_required":
      return "This organisation does not collect punch photographs, so none was stored.";
    case "too_large":
      return `That photograph is too large. The limit is ${Math.round(verdict.limit / 1024)} KB.`;
    case "unsupported_type":
      return `That image format is not accepted. Use ${verdict.accepted.join(" or ")}.`;
    case "not_an_image":
      return "That file is not an image.";
  }
}

/**
 * Records a stored photograph against the punch it belongs to.
 *
 * Scoped by org as well as record id. The id came from a repository call in
 * this same request so it is already this tenant's, but a write that does not
 * say so is one refactor away from being a cross-tenant insert.
 *
 * Upsert on (record, direction): a retry that stored a second image would
 * otherwise leave two rows and one orphaned object. The key of the image being
 * replaced is returned so the caller can delete it rather than abandon it.
 */
async function attachSelfie(
  ctx: ApiContext,
  recordId: string,
  direction: "in" | "out",
  stored: { key: string; takenAt: Date }
): Promise<{ replaced: string | null }> {
  return withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
    const existing = await tx
      .select({ objectKey: attendancePunchPhotos.objectKey })
      .from(attendancePunchPhotos)
      .where(
        and(
          eq(attendancePunchPhotos.attendanceRecordId, recordId),
          eq(attendancePunchPhotos.direction, direction),
          eq(attendancePunchPhotos.orgId, ctx.orgId)
        )
      )
      .limit(1);

    await tx
      .insert(attendancePunchPhotos)
      .values({
        orgId: ctx.orgId,
        attendanceRecordId: recordId,
        direction,
        objectKey: stored.key,
        takenAt: stored.takenAt,
      })
      .onConflictDoUpdate({
        target: [
          attendancePunchPhotos.attendanceRecordId,
          attendancePunchPhotos.direction,
        ],
        set: { objectKey: stored.key, takenAt: stored.takenAt },
      });

    const previous = existing[0]?.objectKey ?? null;
    return { replaced: previous && previous !== stored.key ? previous : null };
  });
}
