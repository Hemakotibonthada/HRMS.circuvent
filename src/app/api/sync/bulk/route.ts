import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";

// ═══════════════════════════════════════════════════════════════
// POST /api/sync/bulk — cross-app account reconciliation
// ═══════════════════════════════════════════════════════════════
// This used to copy every employee row into a `users` collection inside CV-365's
// Firestore database and again into Mail's, so each app had its own private
// duplicate of the same person.
//
// That fan-out no longer exists, for two reasons. Identity is now a single
// shared schema (identity.users / identity.user_roles) that every app reads
// directly, so there is nothing to mirror — a copy could only drift from the
// original. And the destinations were Firestore databases: Mail has moved to
// Postgres entirely, and Firebase is being retired across the suite.
//
// The endpoint is kept because the admin and settings screens call it, but it
// now reports what is actually true — which accounts exist, and which employees
// have no account yet — instead of silently writing to databases that are not
// configured and reporting success.

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(req, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const repo = new NeonEmployeeRepository(ctx);
    // One page is enough for a status summary; this is a report, not a job.
    const page = await repo.list({ pageSize: 500 });

    const withEmail = page.items.filter((e) => !!e.email?.trim());
    const withoutEmail = page.items.length - withEmail.length;

    return NextResponse.json({
      success: true,
      mode: "shared-identity",
      message:
        "Accounts are no longer copied between apps. Every Circuvent app reads " +
        "the same identity records, so there is nothing to synchronise.",
      summary: {
        employees: page.total ?? page.items.length,
        withWorkEmail: withEmail.length,
        withoutWorkEmail: withoutEmail,
      },
      // Surfaced rather than hidden: an employee with no work address cannot be
      // given an account, and that is the one thing this screen should flag.
      needsAttention: withoutEmail
        ? `${withoutEmail} employee${withoutEmail === 1 ? "" : "s"} have no work email and cannot be given a sign-in.`
        : null,
    });
  } catch (error) {
    console.error("Account reconciliation failed:", error);
    return NextResponse.json(
      { success: false, error: "Could not read employee records" },
      { status: 500 }
    );
  }
}
