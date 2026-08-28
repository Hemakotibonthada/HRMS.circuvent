// ═══════════════════════════════════════════════════════════════
// INTERN REMINDER SWEEP — idempotency
// ═══════════════════════════════════════════════════════════════
// The one guarantee that matters here cannot be "the cron only runs once a
// day" — the Vercel Hobby plan already enforces that, and intern-reminders.ts
// exists precisely because that enforcement is not enough on its own (see
// its header comment: a retried invocation, or a redeploy that re-triggers
// the same day's tick, still has to result in each milestone reaching HR,
// the manager and the intern exactly once). Every collaborator
// sweepInternRemindersForOrg needs is injectable for exactly this reason: it
// lets a test run the sweep twice against the same in-memory "already sent"
// state and prove the second run sends nothing, without a real database, a
// real mailer or a real day boundary.

import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/db/client";
import { sweepInternRemindersForOrg, type ReminderSweepDeps } from "@/lib/intern-reminders";
import type { HrRecipient, InternCandidate } from "@/lib/intern-directory";

const ctx: TenantContext = { orgId: "org-1" };

const intern: InternCandidate = {
  id: "intern-1",
  fullName: "Priya Nair",
  workEmail: "priya@example.com",
  employeeCode: "CVI-004",
  // Exactly 14 days from the fixed "today" below, so only the 14-day
  // milestone is due — dueLeadDays treats "at or inside" a lead time as due,
  // so picking the lead exactly avoids the 3-day milestone also firing and
  // complicating the assertions below.
  internshipEndDate: "2025-01-15",
  managerName: "Manager Person",
  managerEmail: "manager@example.com",
};

const hrRecipients: HrRecipient[] = [{ email: "hr@example.com", name: "HR Person", role: "hr" }];

/**
 * Stands in for `hrms.intern_reminder_log`'s `ON CONFLICT (employeeId,
 * leadDays) DO NOTHING` — a Set that only ever grows, and a claim call that
 * returns true the first time a key is added and false ever after, mirrors
 * exactly what the unique index guarantees in production: each
 * (employee, leadDays) pair can be claimed by at most one caller, no matter
 * how many times or how close together claim() is called for it.
 */
function makeClaimStore(): { claim: ReminderSweepDeps["claim"]; claimedKeys: Set<string> } {
  const claimedKeys = new Set<string>();
  return {
    claimedKeys,
    claim: async (_ctx, employeeId, leadDays) => {
      const key = `${employeeId}:${leadDays}`;
      if (claimedKeys.has(key)) return false;
      claimedKeys.add(key);
      return true;
    },
  };
}

function makeDeps(overrides: Partial<ReminderSweepDeps> = {}): Partial<ReminderSweepDeps> {
  return {
    loadCandidates: async () => [intern],
    loadHrRecipients: async () => hrRecipients,
    loadCompanyName: async () => "Circuvent",
    mailConfigured: () => true,
    today: () => "2025-01-01",
    ...overrides,
  };
}

describe("sweepInternRemindersForOrg idempotency", () => {
  it("sends the first time a milestone becomes due", async () => {
    const sent: string[] = [];
    const { claim } = makeClaimStore();
    const result = await sweepInternRemindersForOrg(
      ctx,
      makeDeps({
        claim,
        sendMail: async (options) => {
          sent.push(options.to);
          return true;
        },
      }),
    );

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].claimed).toBe(true);
    // The intern, HR, and the manager — every recipient dueLeadDays says this
    // milestone is for.
    expect(sent.sort()).toEqual(
      ["hr@example.com", "manager@example.com", "priya@example.com"].sort(),
    );
  });

  it("does not re-send a milestone the sweep already claimed, even on the same day", async () => {
    const sent: string[] = [];
    const { claim } = makeClaimStore();
    const deps = makeDeps({
      claim,
      sendMail: async (options) => {
        sent.push(options.to);
        return true;
      },
    });

    // First run: the cron's normal daily tick.
    await sweepInternRemindersForOrg(ctx, deps);
    expect(sent).toHaveLength(3);

    // Second run against the *same* claim store: a retried invocation, a
    // redeploy that re-triggers today's tick, or the job simply being run
    // again by hand. Nothing new should go out.
    const second = await sweepInternRemindersForOrg(ctx, deps);

    expect(second.outcomes).toHaveLength(1);
    expect(second.outcomes[0].claimed).toBe(false);
    expect(second.outcomes[0].recipientsNotified).toBe(0);
    // The real proof: sendMail was not invoked again. A test that only
    // checked `claimed` could still pass with a bug that mails first and
    // claims second — this checks the side effect actually did not happen.
    expect(sent).toHaveLength(3);
  });

  it("does not mail anyone when no milestone is due yet", async () => {
    const sent: string[] = [];
    const { claim } = makeClaimStore();
    const result = await sweepInternRemindersForOrg(
      ctx,
      makeDeps({
        claim,
        // 40 days out clears both the 14- and 3-day defaults.
        loadCandidates: async () => [{ ...intern, internshipEndDate: "2025-02-10" }],
        sendMail: async (options) => {
          sent.push(options.to);
          return true;
        },
      }),
    );

    expect(result.outcomes).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});
