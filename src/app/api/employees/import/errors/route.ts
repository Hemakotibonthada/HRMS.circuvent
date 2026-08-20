// ═══════════════════════════════════════════════════════════════
// POST /api/employees/import/errors
// ═══════════════════════════════════════════════════════════════
// Turns the skip/reject buckets already returned by `/preview` or `/commit`
// into a downloadable CSV, so HR can fix the file and re-upload without
// re-typing every problem row by hand.
//
// Takes JSON, not a file: the caller already has `toReject`/`toSkip` in the
// response it just received, and re-uploading the spreadsheet a third time
// just to ask the same question again would be a pointless round trip.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { authErrorResponse } from "@/lib/server-auth";
import { buildErrorReportCsv } from "@/lib/employee-import";

// Loose on purpose: this body is just an echo of a `RejectedRow`/`SkippedRow`
// array the server itself produced moments earlier. `raw` is typed
// `Partial<Record<ImportField, string>>` in the pure library, but the only
// field `buildErrorReportCsv` ever reads back out of it is `workEmail` —
// requiring the full field set here would make this route reject a payload
// for missing keys it never uses.
const rowSchema = z.object({
  rowNumber: z.number(),
  reasons: z.array(z.string()).default([]),
  workEmail: z.string().optional(),
  raw: z.object({ workEmail: z.string().optional() }).partial().passthrough().optional().default({}),
});

const bodySchema = z.object({
  toReject: z.array(rowSchema).max(2000).default([]),
  toSkip: z.array(rowSchema).max(2000).default([]),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`import-errors:${clientIdentifier(request, ctx.userId)}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

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

  const csv = buildErrorReportCsv({
    toReject: parsed.data.toReject.map((r) => ({ ...r, raw: r.raw ?? {} })),
    toSkip: parsed.data.toSkip.map((r) => ({ ...r, workEmail: r.workEmail ?? "" })),
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="employee-import-errors.csv"',
    },
  });
}
