// ═══════════════════════════════════════════════════════════════
// /api/organization/letter-defaults
// ═══════════════════════════════════════════════════════════════
//
// The standing answers every letter needs and no record holds: who signs,
// where somebody reports, at what time, what to bring on the first day.
//
// GET  returns what is set, so the settings screen can show it.
// PUT  replaces it.
//
// These were the reason the joining pack could not be issued. `generate()`
// refused a joining letter, an appointment letter and a welcome email with
// ten unresolved tokens each — correctly, since a letter telling somebody to
// report to a blank address is worse than no letter — but the only way to
// supply them was for HR to retype the same ten answers for every hire, which
// nobody does twice. They are the same for every hire in a company, so they
// are stored once against the company.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { organizations } from "@/db/schema/identity";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { loadOrgLetterDefaults, type OrgLetterDefaults } from "@/db/repositories/org-identity";

/**
 * Every field optional and every one trimmed.
 *
 * A company that has not decided its dress code should be able to save the
 * signatory without inventing one, and a value that is only whitespace is
 * stored as absent rather than as a blank that would satisfy the token and
 * print an empty line into a signed letter.
 */
const schema = z.object({
  signatoryName: z.string().trim().max(120).optional(),
  signatoryTitle: z.string().trim().max(120).optional(),
  hrContactName: z.string().trim().max(120).optional(),
  hrContactEmail: z.string().trim().max(200).optional(),
  workLocation: z.string().trim().max(300).optional(),
  officeLocation: z.string().trim().max(300).optional(),
  reportingTime: z.string().trim().max(60).optional(),
  startTime: z.string().trim().max(60).optional(),
  dressCode: z.string().trim().max(300).optional(),
  documentsToBring: z.string().trim().max(2000).optional(),
  firstDayPlan: z.string().trim().max(2000).optional(),
  dayOnePlan: z.string().trim().max(2000).optional(),
  probationMonths: z.string().trim().max(40).optional(),
  probationNoticePeriod: z.string().trim().max(40).optional(),
  policyAcknowledgements: z.string().trim().max(2000).optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const defaults = await loadOrgLetterDefaults(ctx);
  return NextResponse.json({ letterDefaults: defaults ?? {} });
}

export async function PUT(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // The same roles that may generate a document, for the same reason: these
  // values are printed into signed letters.
  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json(
      { error: "Only an administrator or HR can change letter defaults" },
      { status: 403 }
    );
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
      { error: parsed.error.issues[0]?.message ?? "Invalid letter defaults" },
      { status: 400 }
    );
  }

  // Empty strings dropped rather than stored: `letterDefaultTokens` would skip
  // them anyway, and keeping them would make a settings screen show a value
  // that has no effect.
  const letterDefaults: OrgLetterDefaults = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => typeof v === "string" && v.length > 0)
  );

  const saved = await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1);

    // Merged into the existing blob, never replacing it: `settings` also
    // carries the registration number and support contact, and writing this
    // key alone would take a company's CIN off its letterhead.
    const settings = { ...((row?.settings ?? {}) as Record<string, unknown>), letterDefaults };

    await tx
      .update(organizations)
      .set({ settings })
      .where(eq(organizations.id, ctx.orgId));

    return letterDefaults;
  });

  return NextResponse.json({ letterDefaults: saved });
}
