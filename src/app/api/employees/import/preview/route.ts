// ═══════════════════════════════════════════════════════════════
// POST /api/employees/import/preview
// ═══════════════════════════════════════════════════════════════
// Upload a spreadsheet, get back its headers, a suggested column mapping and
// — once the mapping covers every required field — a full dry-run plan of
// what would be created, skipped and rejected. Never writes to the database;
// `commit/route.ts` is the only route that does.

import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { authErrorResponse } from "@/lib/server-auth";
import {
  IMPORT_FIELD_OPTIONS,
  SpreadsheetParseError,
  missingRequiredFields,
  parseSpreadsheet,
  planImport,
  suggestColumnMapping,
} from "@/lib/employee-import";
import { fetchExistingWorkEmails, readMappingOverride, readUploadedSpreadsheet } from "../_lib";

export async function POST(request: NextRequest) {
  let ctx;
  try {
    // Same three roles as the single-add form (`POST /api/employees`) — bulk
    // import is the same action at a larger scale, not a different privilege.
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`import-preview:${clientIdentifier(request, ctx.userId)}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const upload = await readUploadedSpreadsheet(request);
  if ("error" in upload) {
    return NextResponse.json({ error: upload.error }, { status: 400 });
  }

  let parsedFile;
  try {
    parsedFile = parseSpreadsheet(upload.buffer, upload.filename);
  } catch (error) {
    if (error instanceof SpreadsheetParseError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("Employee import preview — parse failure:", error);
    return NextResponse.json({ error: "Could not read that file" }, { status: 422 });
  }

  const override = readMappingOverride(upload.mappingField, parsedFile.headers.length);
  if (override && "error" in override) {
    return NextResponse.json({ error: override.error }, { status: 400 });
  }

  // The very first call (no `mapping` field yet) gets the heuristic's guess;
  // every call after the user has seen and possibly corrected it echoes their
  // choice back through `mapping`, so the preview always reflects what will
  // actually be committed rather than a guess the user never confirmed.
  const mapping = override ?? suggestColumnMapping(parsedFile.headers).mapping;
  const missingRequired = missingRequiredFields(mapping);

  // A plan needs every required field mapped to mean anything — computing it
  // against, say, a mapping with no Work Email column would just reject every
  // row for a reason that has nothing to do with the data itself.
  let plan = null;
  if (missingRequired.length === 0) {
    const existingEmails = await fetchExistingWorkEmails(ctx);
    plan = planImport({ rows: parsedFile.rows, mapping, existingEmails });
  }

  return NextResponse.json({
    headers: parsedFile.headers,
    mapping,
    fieldOptions: IMPORT_FIELD_OPTIONS,
    missingRequired,
    rowCount: parsedFile.rows.length,
    plan,
  });
}
