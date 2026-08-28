// ═══════════════════════════════════════════════════════════════
// INTERN LAST-WORKING-DAY REMINDER SWEEP
// ═══════════════════════════════════════════════════════════════
// Runs from the same daily cron tick as outbox-sweep.ts and tells HR, an
// intern's manager and the intern themselves when an internship's end date
// is within a configured lead time. There is no separate "reminders" cron
// to fall back on if this one misfires — the Vercel Hobby plan permits one
// invocation per path per day (see api/cron/route.ts's header comment) —
// so idempotency cannot be "don't run twice today", it has to be "don't
// send the same milestone twice, ever, no matter how many times this runs".
//
// That guarantee lives in the database, not in this file's control flow:
// each (employee, leadDays) pair is claimed with an `ON CONFLICT DO NOTHING`
// insert into hrms.intern_reminder_log before any mail is sent, and only the
// caller that wins the insert sends anything. A cron invocation that fires
// twice in a day, or is retried after a partial failure, still results in
// each milestone reaching HR, the manager and the intern exactly once.
//
// Mirrors outbox-sweep.ts's shape deliberately: per-organisation, per-item
// try/catch so one tenant's or one intern's failure is recorded and does not
// stop the rest, and every collaborator is injectable so the idempotency
// guarantee is provable without a live database or SMTP server.

import { withTenant, type TenantContext } from "@/db/client";
import { internReminderLog } from "@/db/schema/hrms";
import { loadOrgIdentity } from "@/db/repositories/org-identity";
import { daysUntil, dueLeadDays } from "@/lib/intern-lifecycle";
import {
  loadActiveInternsWithEndDate,
  resolveHrRecipients,
  type HrRecipient,
  type InternCandidate,
} from "@/lib/intern-directory";
import { internshipEndingNoticeEmail, internshipEndingReminderEmail } from "@/lib/intern-mail";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { activeOrganisationIds } from "@/lib/outbox-sweep";

export interface InternReminderOutcome {
  employeeId: string;
  employeeName: string;
  leadDays: number;
  /** True only when this call won the claim and attempted delivery — false means a prior run already handled it. */
  claimed: boolean;
  recipientsNotified: number;
  recipientsTotal: number;
  error?: string;
}

export interface OrgReminderSweepResult {
  orgId: string;
  candidates: number;
  outcomes: InternReminderOutcome[];
}

export interface ReminderSweepResult {
  organisations: number;
  orgs: OrgReminderSweepResult[];
  totals: {
    milestonesClaimed: number;
    milestonesAlreadySent: number;
    recipientsNotified: number;
  };
  /** One entry per tenant that could not be swept at all, naming which. */
  problems: string[];
}

async function claimReminder(
  ctx: TenantContext,
  employeeId: string,
  leadDays: number,
): Promise<boolean> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .insert(internReminderLog)
      .values({ orgId: ctx.orgId, employeeId, leadDays })
      .onConflictDoNothing({
        target: [internReminderLog.employeeId, internReminderLog.leadDays],
      })
      .returning({ id: internReminderLog.id });
    return rows.length > 0;
  });
}

/** Everything the sweep needs from the outside world, swappable for tests. */
export interface ReminderSweepDeps {
  listOrgs(): Promise<string[]>;
  loadCandidates(ctx: TenantContext): Promise<InternCandidate[]>;
  loadHrRecipients(ctx: TenantContext): Promise<HrRecipient[]>;
  loadCompanyName(ctx: TenantContext): Promise<string>;
  claim(ctx: TenantContext, employeeId: string, leadDays: number): Promise<boolean>;
  sendMail(options: { to: string; subject: string; html: string; text?: string }): Promise<boolean>;
  mailConfigured(): boolean;
  /** `YYYY-MM-DD` for "today" — injectable so a test does not depend on the wall clock. */
  today(): string;
}

const defaultDeps: ReminderSweepDeps = {
  listOrgs: activeOrganisationIds,
  loadCandidates: loadActiveInternsWithEndDate,
  loadHrRecipients: resolveHrRecipients,
  loadCompanyName: async (ctx) => (await loadOrgIdentity(ctx))?.name ?? "your employer",
  claim: claimReminder,
  sendMail,
  mailConfigured,
  today: () => new Date().toISOString().slice(0, 10),
};

async function processCandidate(
  candidate: InternCandidate,
  ctx: TenantContext,
  hrRecipients: HrRecipient[],
  companyName: string,
  deps: ReminderSweepDeps,
): Promise<InternReminderOutcome[]> {
  const daysRemaining = daysUntil(candidate.internshipEndDate, deps.today());
  const due = dueLeadDays(daysRemaining);
  const outcomes: InternReminderOutcome[] = [];

  for (const leadDays of due) {
    try {
      const claimed = await deps.claim(ctx, candidate.id, leadDays);
      if (!claimed) {
        // Someone else — an earlier run today, or this same milestone
        // reached on a previous day the sweep ran — already sent this one.
        // Recorded so the totals show it was seen, not dropped silently.
        outcomes.push({
          employeeId: candidate.id,
          employeeName: candidate.fullName,
          leadDays,
          claimed: false,
          recipientsNotified: 0,
          recipientsTotal: 0,
        });
        continue;
      }

      const recipients: { email: string; name: string; isIntern: boolean }[] = [
        { email: candidate.workEmail, name: candidate.fullName, isIntern: true },
        ...hrRecipients.map((hr) => ({ email: hr.email, name: hr.name, isIntern: false })),
      ];
      if (candidate.managerEmail) {
        recipients.push({
          email: candidate.managerEmail,
          name: candidate.managerName ?? "Manager",
          isIntern: false,
        });
      }

      let notified = 0;
      if (deps.mailConfigured()) {
        for (const recipient of recipients) {
          const body = recipient.isIntern
            ? internshipEndingReminderEmail({
                companyName,
                internName: candidate.fullName,
                endDate: candidate.internshipEndDate,
                daysRemaining,
              })
            : internshipEndingNoticeEmail({
                companyName,
                recipientName: recipient.name,
                internName: candidate.fullName,
                internEmail: candidate.workEmail,
                endDate: candidate.internshipEndDate,
                daysRemaining,
                managerName: candidate.managerName,
              });
          const ok = await deps.sendMail({
            to: recipient.email,
            subject: body.subject,
            html: body.html,
            text: body.text,
          });
          if (ok) notified += 1;
        }
      }

      outcomes.push({
        employeeId: candidate.id,
        employeeName: candidate.fullName,
        leadDays,
        claimed: true,
        recipientsNotified: notified,
        recipientsTotal: recipients.length,
      });
    } catch (error) {
      // Caught per milestone: one candidate's bad data (or a transient
      // failure resolving HR recipients) must not stop the reminder for
      // every other intern whose end date is also approaching this run.
      outcomes.push({
        employeeId: candidate.id,
        employeeName: candidate.fullName,
        leadDays,
        claimed: false,
        recipientsNotified: 0,
        recipientsTotal: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcomes;
}

/** Sweeps one organisation's interns. Exported so a single-tenant caller (e.g. a test, or a manual re-run) does not need the multi-org wrapper. */
export async function sweepInternRemindersForOrg(
  ctx: TenantContext,
  deps: Partial<ReminderSweepDeps> = {},
): Promise<OrgReminderSweepResult> {
  const merged: ReminderSweepDeps = { ...defaultDeps, ...deps };
  const candidates = await merged.loadCandidates(ctx);
  const hrRecipients = await merged.loadHrRecipients(ctx);
  const companyName = await merged.loadCompanyName(ctx);

  const outcomes: InternReminderOutcome[] = [];
  for (const candidate of candidates) {
    const results = await processCandidate(candidate, ctx, hrRecipients, companyName, merged);
    outcomes.push(...results);
  }

  return { orgId: ctx.orgId, candidates: candidates.length, outcomes };
}

/**
 * Sweeps every tenant's interns for due reminder milestones.
 *
 * One tenant's failure is recorded in `problems` and the rest still run —
 * the same trade-off `sweepOutboxes` makes, for the same reason: a tenant
 * whose HR-recipient lookup breaks must not cost every other tenant's
 * intern their last-working-day reminder for the day.
 */
export async function sweepInternReminders(
  deps: Partial<ReminderSweepDeps> = {},
): Promise<ReminderSweepResult> {
  const merged: ReminderSweepDeps = { ...defaultDeps, ...deps };

  const result: ReminderSweepResult = {
    organisations: 0,
    orgs: [],
    totals: { milestonesClaimed: 0, milestonesAlreadySent: 0, recipientsNotified: 0 },
    problems: [],
  };

  let orgIds: string[];
  try {
    orgIds = await merged.listOrgs();
  } catch (error) {
    result.problems.push(
      `Could not list organisations: ${error instanceof Error ? error.message : String(error)}`,
    );
    return result;
  }

  result.organisations = orgIds.length;

  for (const orgId of orgIds) {
    try {
      const orgResult = await sweepInternRemindersForOrg({ orgId }, merged);
      result.orgs.push(orgResult);
      for (const outcome of orgResult.outcomes) {
        if (outcome.claimed) {
          result.totals.milestonesClaimed += 1;
          result.totals.recipientsNotified += outcome.recipientsNotified;
        } else if (!outcome.error) {
          result.totals.milestonesAlreadySent += 1;
        }
      }
    } catch (error) {
      result.problems.push(`${orgId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
