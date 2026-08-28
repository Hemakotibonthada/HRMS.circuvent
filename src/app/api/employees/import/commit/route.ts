// ═══════════════════════════════════════════════════════════════
// POST /api/employees/import/commit
// ═══════════════════════════════════════════════════════════════
// Actually creates the employees. Requires a `mapping` the caller has already
// seen and (if needed) corrected via `/preview` — committing is a distinct,
// explicit step from previewing, never something an upload triggers by
// itself.
//
// Everything the plan depends on — the mapping, the existing-email set — is
// re-derived here from scratch rather than trusted from an earlier preview
// response. A client cannot make this route insert something the server did
// not itself just validate, and re-running the same file is safe by
// construction: the fresh `existingEmails` fetch is what turns a row already
// created by a previous commit into an ordinary skip rather than a duplicate
// or a constraint error.

import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { authErrorResponse } from "@/lib/server-auth";
import {
  SpreadsheetParseError,
  missingRequiredFields,
  parseSpreadsheet,
  planImport,
} from "@/lib/employee-import";
import { commitImport, fetchExistingWorkEmails, readMappingOverride, readUploadedSpreadsheet } from "../_lib";
import { assertSeatsAvailable, refreshSeatCount } from "@/db/repositories/subscription.neon";

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // A tighter budget than `/preview`: previewing is cheap and something a
  // user does repeatedly while fixing a mapping, but a commit writes to the
  // database and should not be something a script can hammer.
  const limit = checkRateLimit(`import-commit:${clientIdentifier(request, ctx.userId)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const upload = await readUploadedSpreadsheet(request);
  if ("error" in upload) {
    return NextResponse.json({ error: upload.error }, { status: 400 });
  }

  // Unlike `/preview`, there is no heuristic fallback here: committing
  // against a guess the user never saw would defeat the entire point of
  // showing them a mapping to correct first.
  //
  // Captured into its own `string` binding rather than read again later as
  // `upload.mappingField` — a property access re-read after the
  // `parseSpreadsheet` call below cannot be relied on to still be narrowed to
  // non-null by this check, whereas a local `const` unambiguously is.
  const mappingField = upload.mappingField;
  if (mappingField === null) {
    return NextResponse.json(
      { error: "A reviewed column mapping is required to commit — run a preview first." },
      { status: 400 }
    );
  }

  let parsedFile;
  try {
    parsedFile = parseSpreadsheet(upload.buffer, upload.filename);
  } catch (error) {
    if (error instanceof SpreadsheetParseError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("Employee import commit — parse failure:", error);
    return NextResponse.json({ error: "Could not read that file" }, { status: 422 });
  }

  const mapping = readMappingOverride(mappingField, parsedFile.headers.length);
  if (mapping === undefined) {
    // Unreachable given the null check above, but keeps the type narrow
    // without an assertion.
    return NextResponse.json({ error: "A column mapping is required." }, { status: 400 });
  }
  if ("error" in mapping) {
    return NextResponse.json({ error: mapping.error }, { status: 400 });
  }

  const missingRequired = missingRequiredFields(mapping);
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: `Map every required field before committing: ${missingRequired.join(", ")}` },
      { status: 400 }
    );
  }

  const existingEmails = await fetchExistingWorkEmails(ctx);
  const plan = planImport({ rows: parsedFile.rows, mapping, existingEmails });

  // Checked once for the whole file, not per row.
  //
  // An importer is the fastest way there is to blow through a seat limit: a
  // spreadsheet of two thousand people would otherwise land in an
  // organisation whose plan covers twenty-five, and the first anybody would
  // know is the invoice. Refusing the whole file is deliberate — importing
  // the first twenty-four rows and stopping leaves a half-populated
  // organisation that somebody then has to reconcile by hand against their
  // own spreadsheet.
  const seats = await assertSeatsAvailable(ctx, plan.toCreate.length);
  if (!seats.allowed) {
    return NextResponse.json(
      { error: seats.reason, seats: { limit: seats.limit, used: seats.used, remaining: seats.remaining } },
      { status: 402 }
    );
  }

  try {
    const created = await commitImport(ctx, plan.toCreate);
    // Keeps the cached count on the subscription row honest. It is never what
    // a limit is checked against — that is always a fresh count — but an
    // invoice run or a support query reads this column directly.
    await refreshSeatCount(ctx).catch(() => undefined);
    return NextResponse.json(
      {
        created,
        createdCount: created.length,
        skipped: plan.toSkip,
        rejected: plan.toReject,
      },
      { status: created.length > 0 ? 201 : 200 }
    );
  } catch (error) {
    // A genuine race — two admins committing overlapping files at the same
    // instant — trips a unique index here instead of being caught earlier by
    // the fresh `existingEmails` read. Same message and status as the
    // single-add route's identical catch (`POST /api/employees`): the fix is
    // the same too, re-run the import, which is safe because of the
    // idempotency guarantee this whole feature exists to provide.
    const message = error instanceof Error ? error.message : "";
    if (message.includes("duplicate key") || message.includes("unique constraint")) {
      return NextResponse.json(
        {
          error:
            "Some rows collided with employees created moments ago. Re-run the import — matching rows will now be skipped, not duplicated.",
        },
        { status: 409 }
      );
    }
    console.error("Employee import commit failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
