import { mailboxInviteEmail } from "@/lib/document-mail";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { issueOnboardingToken, mailboxClaimUrl } from "@/lib/onboarding/token";

export interface MailboxInviteOutcome {
  status: "done" | "blocked" | "failed";
  detail?: string;
}

export function isInternEmploymentType(value: string | null | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "intern";
}

/**
 * Sends the joiner a signed link to claim their company mailbox.
 * Idempotent per employee via a stable subject line — callers should not spam.
 */
export async function sendMailboxInvite(args: {
  employeeId: string;
  candidateId: string | null;
  employmentType: string | null;
  personalEmail: string | null;
  candidateName: string;
  jobTitle?: string | null;
  startDate?: string | null;
  employeeCode?: string | null;
  department?: string | null;
}): Promise<MailboxInviteOutcome> {
  const to = (args.personalEmail ?? "").trim();
  if (!to) {
    return { status: "blocked", detail: "No personal email address to send the invitation to." };
  }

  const issued = issueOnboardingToken({
    employeeId: args.employeeId,
    candidateId: args.candidateId ?? null,
    employmentType: args.employmentType ?? null,
    displayName: args.candidateName,
    employeeCode: args.employeeCode ?? null,
    designation: args.jobTitle ?? null,
    department: args.department ?? null,
  });

  if (!issued) {
    return {
      status: "blocked",
      detail:
        "ONBOARDING_TOKEN_SECRET is not set. Set the same value in HRMS, ATS and Mail so the claim link can be verified.",
    };
  }

  const branded = mailboxInviteEmail({
    candidateName: args.candidateName,
    jobTitle: args.jobTitle ?? null,
    startDate: args.startDate ?? null,
    claimUrl: mailboxClaimUrl(issued.token),
    isIntern: isInternEmploymentType(args.employmentType),
  });

  if (!mailConfigured()) {
    return { status: "blocked", detail: "SMTP is not configured, so the invitation could not be sent." };
  }

  const sent = await sendMail({
    to,
    subject: branded.subject,
    html: branded.html,
    text: branded.text,
  });

  if (!sent) {
    return { status: "failed", detail: `The invitation to ${to} could not be delivered.` };
  }

  return { status: "done", detail: `Invitation sent to ${to}; awaiting mailbox claim and HR approval.` };
}
