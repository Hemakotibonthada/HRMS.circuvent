// ═══════════════════════════════════════════════════════════════
// BULK EMPLOYEE IMPORT — the database-touching half
// ═══════════════════════════════════════════════════════════════
// `src/lib/employee-import.ts` is deliberately pure so header matching, row
// validation and date parsing can be unit-tested without Neon. Everything
// that needs `withTenant`, the `employees` table or a Next.js request lives
// here instead, shared by the three routes under this directory.

import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { departments, employees, locations } from "@/db/schema/hrms";
import { defaultTeamId } from "@/lib/default-team";
import { employeeCodePrefixFor } from "@/lib/employee-code";
import { IMPORT_FIELD_OPTIONS, type CanonicalRow, type ImportField } from "@/lib/employee-import";

/**
 * Bound on the upload itself, checked before a single byte reaches
 * `parseSpreadsheet`. Generous for `MAX_IMPORT_ROWS` (2000) rows of plain
 * text — a file anywhere near this limit is almost certainly the wrong
 * attachment, not a large-but-legitimate roster.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface UploadError {
  error: string;
}

export interface UploadedSpreadsheet {
  buffer: Buffer;
  filename: string;
  /** The raw `mapping` form field, if the caller sent one — parsed by `readMappingOverride`. */
  mappingField: string | null;
}

/**
 * Reads the uploaded file out of a `multipart/form-data` body.
 *
 * `request.formData()` throws on a body that is not multipart at all — the
 * wrong `Content-Type`, or no body — which is indistinguishable from "the
 * file field is missing" as far as the caller needs to know, so both are
 * answered with the same plain-language 400 rather than an unhandled
 * exception reaching the route's outer catch.
 */
export async function readUploadedSpreadsheet(
  request: NextRequest
): Promise<UploadedSpreadsheet | UploadError> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: 'Send the file as multipart/form-data with a "file" field.' };
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return { error: 'No file was uploaded — attach it under the "file" field.' };
  }
  if (file.size === 0) {
    return { error: "The file is empty." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const limitMb = MAX_UPLOAD_BYTES / (1024 * 1024);
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      error: `The file is ${fileMb}MB; the limit is ${limitMb}MB. Split it and import in batches.`,
    };
  }
  // Checked on the name the browser reports, same as `parseSpreadsheet` — a
  // second, redundant check here would let the two disagree about what "an
  // accepted file" means.
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return { error: "Only .xlsx and .csv files are accepted." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mappingField = form.get("mapping");

  return {
    buffer,
    filename: file.name,
    mappingField: typeof mappingField === "string" ? mappingField : null,
  };
}

const IMPORT_FIELD_VALUES: ReadonlySet<string> = new Set(
  IMPORT_FIELD_OPTIONS.map((option) => option.value)
);

/**
 * Parses and validates the optional `mapping` form field: the user's
 * corrected column mapping, sent back as JSON once they have seen the
 * headers and fixed whatever `suggestColumnMapping` guessed wrong.
 *
 * Returns `undefined` when the field was not sent at all, which is what the
 * very first preview call — before the user has seen the headers, let alone
 * corrected anything — relies on to fall back to the auto-suggested mapping.
 */
export function readMappingOverride(
  raw: string | null,
  headerCount: number
): (ImportField | null)[] | undefined | UploadError {
  if (raw === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: '"mapping" must be JSON — an array of field names or null, one per column.' };
  }

  if (!Array.isArray(parsed) || parsed.length !== headerCount) {
    return { error: `"mapping" must have exactly ${headerCount} entries, one per column in the file.` };
  }
  for (const entry of parsed) {
    if (entry !== null && !IMPORT_FIELD_VALUES.has(entry as string)) {
      return { error: `"${String(entry)}" is not a field this importer understands.` };
    }
  }

  return parsed as (ImportField | null)[];
}

/**
 * Every work email already in this organisation, lower-cased, including
 * soft-deleted employees.
 *
 * `employees_org_work_email_key` (see `db/schema/hrms.ts`) is a plain unique
 * index with no `deleted_at IS NULL` qualifier — a departed employee's
 * address is not available again just because they left. A row this query
 * left out would let the same address "create" a second time in the dry
 * run, only for the commit's insert to fail against a constraint the caller
 * was never told about.
 */
export async function fetchExistingWorkEmails(ctx: TenantContext): Promise<Set<string>> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select({ workEmail: employees.workEmail }).from(employees);
    return new Set(rows.map((r) => r.workEmail.toLowerCase()));
  });
}

export interface CommittedEmployee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  workEmail: string;
}

/**
 * Inserts every row in `rows` inside one transaction.
 *
 * A partial import is worse than none: HR would see, say, 40 of 50 rows
 * land without being told which 10 did not, and re-running the same file —
 * the whole point of the idempotency guarantee — would now report the 40
 * that already landed as ordinary "already exists" collisions, burying
 * whatever actually went wrong the first time.
 *
 * Deliberately does not call `NeonEmployeeRepository.create()` in a loop.
 * That method opens its own `withTenant` transaction on every call, which
 * would make this N separate transactions instead of one, and it also
 * queues a leave-balance provisioning, a directory-group join, a payslip
 * sync and (for interns) lifecycle documents for every row. None of that is
 * right for a historical bulk import:
 *
 *   - `provisionFor` (`lib/leave-provisioning.ts`) provisions leave for the
 *     join *year*, and no year-rollover job exists anywhere in this
 *     codebase. A person hired three years ago would be given a leave
 *     balance for a year that ended long ago and can never be topped up —
 *     worse than no balance row, which at least fails loudly the first time
 *     someone tries to apply for leave, rather than silently existing and
 *     being wrong.
 *   - The mailbox/group/payslip/joining-letter side effects all assume a
 *     hire that is happening *now*. Backdating them for somebody who has
 *     already worked there for years would queue a welcome mailbox change
 *     and dispatch a joining letter for an event long past.
 *
 * Both are pre-existing product gaps this feature does not attempt to
 * solve; see the report back to the user for the full list of what a bulk
 * import deliberately leaves undone that a single "Add Employee" does.
 */
export async function commitImport(
  ctx: TenantContext,
  rows: readonly CanonicalRow[]
): Promise<CommittedEmployee[]> {
  if (rows.length === 0) return [];

  return withTenant(ctx, async (tx) => {
    // Resolved once per commit, not once per row:
    const deptRows = await tx.select({ id: departments.id, name: departments.name }).from(departments);
    const deptByName = new Map(deptRows.map((d) => [d.name.trim().toLowerCase(), d.id]));

    const locRows = await tx.select({ id: locations.id, name: locations.name, code: locations.code }).from(locations);
    const locByName = new Map<string, string>();
    for (const l of locRows) {
      locByName.set(l.name.trim().toLowerCase(), l.id);
      locByName.set(l.code.trim().toLowerCase(), l.id);
    }

    const empRows = await tx
      .select({ id: employees.id, workEmail: employees.workEmail, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees);
    const empByEmailOrName = new Map<string, string>();
    for (const e of empRows) {
      empByEmailOrName.set(e.workEmail.trim().toLowerCase(), e.id);
      empByEmailOrName.set(`${e.firstName} ${e.lastName}`.trim().toLowerCase(), e.id);
    }

    const created: CommittedEmployee[] = [];
    for (const row of rows) {
      const prefix = employeeCodePrefixFor(row.employmentType);
      const codeResult = await tx.execute(
        sql`SELECT hrms.next_employee_code(${ctx.orgId}::uuid, ${prefix}) AS code`
      );
      const code = (codeResult.rows[0] as { code?: string } | undefined)?.code;
      if (!code) {
        throw new Error(
          "hrms.next_employee_code returned nothing; migration 0030 may not be applied"
        );
      }

      const departmentId =
        (row.department && deptByName.get(row.department.trim().toLowerCase())) ||
        (await defaultTeamId(tx, ctx.orgId));

      const locationId =
        (row.location && locByName.get(row.location.trim().toLowerCase())) || null;

      const reportingToId =
        (row.reportingManager && empByEmailOrName.get(row.reportingManager.trim().toLowerCase())) || null;

      let ctcMinor: bigint | null = null;
      if (row.annualCtc) {
        const cleanCtc = Number(row.annualCtc.replace(/[^0-9.]/g, ""));
        if (!isNaN(cleanCtc) && cleanCtc > 0) {
          ctcMinor = BigInt(Math.round(cleanCtc * 100));
        }
      }

      const bankDetails =
        row.bankName || row.accountNumber || row.ifsc
          ? {
              bankName: row.bankName || "",
              accountHolderName: row.accountHolderName || `${row.firstName} ${row.lastName}`.trim(),
              accountNumber: row.accountNumber || "",
              ifsc: row.ifsc || "",
              accountType: (row.accountType || "savings") as "savings" | "current",
            }
          : null;

      const emergencyContact =
        row.emergencyContactName || row.emergencyContactPhone
          ? {
              name: row.emergencyContactName || "",
              relationship: row.emergencyContactRelationship || "",
              phone: row.emergencyContactPhone || "",
            }
          : null;

      const [inserted] = await tx
        .insert(employees)
        .values({
          orgId: ctx.orgId,
          employeeCode: code,
          firstName: row.firstName,
          lastName: row.lastName,
          workEmail: row.workEmail,
          personalEmail: row.personalEmail || null,
          phone: row.phone || null,
          gender: row.gender || null,
          dateOfBirth: row.dateOfBirth || null,
          bloodGroup: row.bloodGroup || null,
          departmentId,
          locationId,
          reportingToId,
          designation: row.designation,
          employmentType: (row.employmentType ?? "full_time") as never,
          status: "active" as never,
          joinDate: row.joinDate,
          ctcMinor,
          bankDetails: bankDetails as never,
          emergencyContact: emergencyContact as never,
          panNumber: row.panNumber || null,
          aadhaarNumber: row.aadhaarNumber || null,
          uanNumber: row.uanNumber || null,
          addressLine1: row.address || null,
          city: row.city || null,
          state: row.state || null,
          postalCode: row.postalCode || null,
        })
        .returning({
          id: employees.id,
          employeeCode: employees.employeeCode,
          firstName: employees.firstName,
          lastName: employees.lastName,
          workEmail: employees.workEmail,
        });

      created.push(inserted);
    }

    return created;
  });
}
