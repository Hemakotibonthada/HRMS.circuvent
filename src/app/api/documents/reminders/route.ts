// POST /api/documents/reminders — chase offers that are about to lapse.
//
// Meant to be called once a day by a scheduler. Accepts either a signed-in
// administrator or the shared service token, so it can be driven by a cron job
// that acts for no particular user.
//
// Two properties this endpoint has to have, because it sends mail to people
// outside the company on a timer:
//
//   - **The decision does not depend on the hour it runs.** `shouldRemind`
//     fires only at fixed distances from expiry — seven days, three days, one
//     day — counted in whole IST days. A run at 09:00 and a run at 23:00 make
//     the same decision, which is what stops a late run skipping a day. It
//     follows that running it twice in one day sends twice, so schedule it
//     once.
//
//   - **It never chases somebody who has already signed.** The candidate slot
//     is checked before anything is minted or sent.
//
// A reminder mints a fresh signing token and the previous link stops working,
// because tokens are stored hashed and the original cannot be recovered. The
// email says so.

import { NextResponse, type NextRequest } from "next/server";
import { NeonDocumentsRepository } from "@/db/repositories/documents.neon";
import { RepositoryError } from "@/db/repositories/types";
import { requireApiContext } from "@/lib/api-context";
import { requireServiceToken } from "@/lib/server-auth";
import { dispatchDocumentEvent } from "@/lib/document-dispatch";
import { CANDIDATE_ROLE, shouldRemind } from "@/lib/document-notify";

interface Chased {
  documentId: string;
  title: string;
  daysLeft?: number;
  sent: number;
  failed: number;
}

export async function POST(request: NextRequest) {
  // A cron caller has no user; an administrator running it by hand does.
  let orgId: string | null = null;
  try {
    requireServiceToken(request);
    orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) {
      return NextResponse.json(
        { error: "A service caller must name the organisation with ?orgId=" },
        { status: 400 }
      );
    }
  } catch {
    try {
      const ctx = await requireApiContext(request);
      if (!["owner", "admin", "hr"].includes(ctx.role)) {
        return NextResponse.json({ error: "You cannot send reminders" }, { status: 403 });
      }
      orgId = ctx.orgId;
    } catch {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
  }

  const ctx = { orgId };
  const repo = new NeonDocumentsRepository(ctx);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const now = new Date();

  try {
    // Only the statuses that can still be signed are worth reading.
    const outstanding = [
      ...(await repo.list({ status: "sent", limit: 500 })),
      ...(await repo.list({ status: "viewed", limit: 500 })),
    ];

    const chased: Chased[] = [];
    const skipped: { documentId: string; reason: string }[] = [];

    for (const document of outstanding) {
      const decision = shouldRemind(document, now);
      if (!decision.send) {
        skipped.push({ documentId: document.id, reason: decision.reason });
        continue;
      }

      let sent = 0;
      let failed = 0;

      try {
        const { document: refreshed, links } = await repo.reissueSigningTokens(document.id);

        // One reminder per outstanding candidate, carrying their own link and
        // nobody else's. A signing link is a working credential for exactly
        // one person's contract.
        for (const link of links) {
          const isCandidate = refreshed.signatures.some(
            (s) => s.email === link.email && s.role === CANDIDATE_ROLE
          );
          if (!isCandidate) continue;

          const outcomes = await dispatchDocumentEvent(ctx, refreshed, "reminder", {
            signUrl: `${base}/sign/${refreshed.id}?token=${link.token}`,
          });

          sent += outcomes.filter((o) => o.sent).length;
          failed += outcomes.filter((o) => !o.sent).length;
        }
      } catch (error) {
        // One bad document must not stop the run. A job that aborts halfway
        // leaves the rest un-chased and says nothing about which.
        console.error(`[reminders] ${document.id} could not be chased:`, error);
        failed += 1;
      }

      chased.push({
        documentId: document.id,
        title: document.title,
        daysLeft: decision.daysLeft,
        sent,
        failed,
      });
    }

    return NextResponse.json({
      considered: outstanding.length,
      chased,
      // Returned so a scheduler's logs say why nothing went out. A successful
      // run that did nothing otherwise looks identical to a broken one.
      skipped: skipped.slice(0, 50),
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Reminder run failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
