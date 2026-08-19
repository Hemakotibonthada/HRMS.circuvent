// ═══════════════════════════════════════════════════════════════
// SAYING WHAT IS WRONG
// ═══════════════════════════════════════════════════════════════
// Every route in this application answered a bad request the same way:
//
//   { error: "Validation failed", issues: [{ field, message }] }
//
// The `issues` were precise. The `error` was not, and `error` is the field
// every client reads — so a person who left a joining date in the past, or
// typed digits into a job title, was told only "Validation failed" and had to
// guess which of eleven fields it meant.
//
// This turns the issues into the message. It is a small change and it is the
// difference between an error a person can act on and one they cannot.
//
// The field names are deliberately *not* prefixed onto the message. Zod paths
// are code identifiers — `joinDate`, `employmentType`, `reportingToId` — and
// pasting them in front of a sentence adds jargon to something somebody has to
// read under pressure. Schemas here supply messages that name their subject in
// ordinary words ("Joining date must be YYYY-MM-DD"), and `issues` still
// carries the machine-readable path for any client that wants to highlight a
// field.

import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export interface FieldIssue {
  field: string;
  message: string;
}

/** Flattens a Zod error into field/message pairs. */
export function toFieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * The message a person reads.
 *
 * One problem per line, de-duplicated: a schema with several refinements on the
 * same field can report the same sentence twice, and saying it twice reads as a
 * bug rather than as emphasis.
 */
export function describeIssues(issues: FieldIssue[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const issue of issues) {
    const message = issue.message.trim();
    if (!message || seen.has(message)) continue;
    seen.add(message);
    lines.push(message);
  }
  return lines.length > 0
    ? lines.join("\n")
    : "The details could not be saved, but no reason was given";
}

/**
 * A 400 that explains itself.
 *
 * `error` carries the readable reasons; `issues` keeps the structured form so a
 * form can still mark the offending inputs.
 */
export function validationFailed(error: ZodError, status = 400): NextResponse {
  const issues = toFieldIssues(error);
  return NextResponse.json({ error: describeIssues(issues), issues }, { status });
}

/** The same shape, for rules checked outside a schema. */
export function issuesFailed(issues: FieldIssue[], status = 400): NextResponse {
  return NextResponse.json({ error: describeIssues(issues), issues }, { status });
}
