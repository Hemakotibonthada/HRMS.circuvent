// ═══════════════════════════════════════════════════════════════
// /api/billing/settings
// ═══════════════════════════════════════════════════════════════
//
// Reading and writing the deployment's Razorpay configuration.
//
// The keys used to live only in `process.env`, which meant billing could be
// switched on only by somebody with the Vercel dashboard and a deploy — and
// environment variables bind when a deployment is created, so rotating a
// compromised key meant editing a dashboard and waiting for a build, during
// which payments either used the stale key or failed outright.
//
// ── What is never returned ──
//
// The secrets. GET reports whether each one is present and nothing more. A
// settings screen that renders a merchant key back to the browser turns any
// future XSS into a stolen merchant account, and "the admin already knows it"
// is not a reason — the browser is not the admin.
//
// PUT treats a blank secret as "leave it alone" for the same reason: the form
// cannot show the current value, so an empty field has to mean unchanged
// rather than cleared.
//
// Every handler is restricted to owner and admin. These are the credentials
// that take money in the company's name; reading which mode a deployment is in
// is harmless, but changing the merchant key is not, and they are one screen.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import {
  loadRazorpaySettings,
  razorpayConfigStatus,
  saveRazorpaySettings,
  clearRazorpaySettings,
} from "@/db/repositories/platform-settings";
import { verifyCredentials } from "@/lib/billing/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "admin"] as const;

const schema = z.object({
  keyId: z.string().trim().min(1, "A Key ID is required"),
  keySecret: z.string().trim().optional(),
  webhookSecret: z.string().trim().optional(),
  mode: z.enum(["test", "live"]),
  enabled: z.boolean(),
  /** When true, the credentials are checked against Razorpay before saving. */
  verify: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireApiContext(request, [...ALLOWED]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  return NextResponse.json({ razorpay: await razorpayConfigStatus() });
}

export async function PUT(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, [...ALLOWED]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
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
      { error: parsed.error.issues[0]?.message ?? "Check the values and try again" },
      { status: 400 }
    );
  }

  const input = parsed.data;

  /*
   * A live key with the mode set to test — or the reverse — is worth refusing
   * rather than storing. Razorpay's key id carries the distinction, so the two
   * can be checked against each other, and the mistakes this catches are
   * charging real cards from a staging deployment, and taking test payments
   * that will never settle.
   */
  if (input.keyId.startsWith("rzp_live_") && input.mode === "test") {
    return NextResponse.json(
      { error: "That is a live key but the mode is set to test. Set the mode to live, or use a test key." },
      { status: 400 }
    );
  }
  if (input.keyId.startsWith("rzp_test_") && input.mode === "live") {
    return NextResponse.json(
      { error: "That is a test key but the mode is set to live. Test keys do not take real payments." },
      { status: 400 }
    );
  }

  /*
   * Checked against Razorpay before being stored, when a secret was supplied.
   * Saving a typo and reporting success means the first anybody hears of it is
   * a customer who cannot pay.
   */
  if (input.verify && input.keySecret) {
    const result = await verifyCredentials({ keyId: input.keyId, keySecret: input.keySecret });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
  }

  try {
    await saveRazorpaySettings({
      keyId: input.keyId,
      keySecret: input.keySecret,
      webhookSecret: input.webhookSecret,
      mode: input.mode,
      enabled: input.enabled,
      updatedBy: ctx.userId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the settings" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, razorpay: await razorpayConfigStatus() });
}

/** Checks the stored credentials against Razorpay without changing anything. */
export async function POST(request: NextRequest) {
  try {
    await requireApiContext(request, [...ALLOWED]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const settings = await loadRazorpaySettings();
  if (!settings) {
    return NextResponse.json({ ok: false, error: "Nothing is configured yet." }, { status: 400 });
  }

  const result = await verifyCredentials(settings);
  return NextResponse.json(
    result.ok ? { ok: true, mode: settings.mode } : { ok: false, error: result.error },
    { status: result.ok ? 200 : 400 }
  );
}

/**
 * Removes the stored credentials.
 *
 * Needed for the case the rest of this route cannot serve: keys that have been
 * compromised and have no replacement to hand. Overwriting them with a new
 * pair requires having a new pair; this stops the deployment charging anybody
 * in the meantime.
 */
export async function DELETE(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, [...ALLOWED]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  await clearRazorpaySettings(ctx.userId);
  return NextResponse.json({ ok: true, razorpay: await razorpayConfigStatus() });
}
