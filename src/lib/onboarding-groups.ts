// ═══════════════════════════════════════════════════════════════
// ONBOARDING GROUPS — the standard access a new hire gets
// ═══════════════════════════════════════════════════════════════
//
// Access granted person by person is access nobody audits and nobody revokes.
// A group is granted once at the identity provider — everyone in
// all@<domain> holds the standard employee role across the suite — and
// membership becomes the only thing onboarding has to get right.
//
// Groups themselves live in auth.circuvent.com, not here; `directory-sdk.ts`
// explains why in its own header. This module owns only the decision of
// *which* groups a new hire joins and *whether* they should, so that decision
// can be tested without a database and without the identity provider.

/** Domain used when nothing else is configured, matching the suite's own. */
const FALLBACK_DOMAIN = "circuvent.com";

export interface OnboardingGroup {
  /** Local part of the group address. */
  localPart: string;
  name: string;
  description: string;
  /** Every new hire joins this one automatically. */
  autoJoin: boolean;
}

/**
 * The groups an organisation is expected to have.
 *
 * Only one auto-joins, deliberately. A new hire belongs in "All Employees"
 * because being employed is the entire criterion; every other list here is one
 * somebody has to be *put* on, and a product that guesses produces a company
 * where the finance list contains the whole company.
 */
export const STANDARD_GROUPS: readonly OnboardingGroup[] = [
  {
    localPart: "all",
    name: "All Employees",
    description:
      "Every current employee. Grants the standard access an ordinary member of staff needs, and is the address that reaches the whole company.",
    autoJoin: true,
  },
  {
    localPart: "people",
    name: "People Team",
    description: "HR and recruitment.",
    autoJoin: false,
  },
  {
    localPart: "managers",
    name: "Managers",
    description: "Anyone with direct reports.",
    autoJoin: false,
  },
];

/**
 * The mail domain to build group addresses on.
 *
 * Taken from an address the organisation already uses — the new hire's own
 * work address, or the owner's — rather than from a marketing website URL,
 * which is regularly a different domain from the mailboxes. A group address on
 * the wrong domain is a distribution list that silently reaches nobody.
 */
export function resolveGroupDomain(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const domain = candidate?.split("@")[1]?.trim().toLowerCase();
    if (domain && domain.includes(".") && !domain.endsWith(".") && !domain.startsWith(".")) {
      return domain;
    }
  }
  return process.env.DIRECTORY_GROUP_DOMAIN?.trim().toLowerCase() || FALLBACK_DOMAIN;
}

export function groupAddress(localPart: string, domain: string): string {
  return `${localPart.trim().toLowerCase()}@${domain.trim().toLowerCase().replace(/^@/, "")}`;
}

/** The addresses a new hire is added to. */
export function autoJoinAddresses(domain: string): string[] {
  return STANDARD_GROUPS.filter((group) => group.autoJoin).map((group) =>
    groupAddress(group.localPart, domain)
  );
}

export interface AutoJoinCandidate {
  email: string;
  status?: string | null;
}

/** Statuses meaning a person is arriving or already here, rather than a record being back-filled. */
const JOINING_STATUSES = new Set(["active", "onboarding", "probation", "notice"]);

/**
 * Whether a newly created employee should be auto-joined.
 *
 * A hire recorded with a future joining date still joins: the group is what
 * grants the account they need on day one, and provisioning access the morning
 * somebody starts is how a first day is spent waiting. Someone created already
 * resigned or terminated does not — that is history being entered, not a
 * person arriving, and adding them would put a leaver on the all-staff list.
 */
export function shouldAutoJoin(candidate: AutoJoinCandidate): boolean {
  const email = candidate.email?.trim().toLowerCase() ?? "";
  const [local, domain, ...rest] = email.split("@");
  if (!local || !domain || rest.length > 0 || !domain.includes(".")) return false;

  const status = (candidate.status ?? "active").trim().toLowerCase();
  return JOINING_STATUSES.has(status);
}

/**
 * How long to wait before retrying a failed join.
 *
 * Doubling — the same curve `paystub-sync-outbox.ts` uses, deliberately, so
 * two queues solving the same problem do not back off differently.
 *
 * Two ceilings, and it is worth being exact about which one binds: the
 * exponent is capped at 10 first, so the effective maximum is 1024 minutes —
 * a little over seventeen hours — and the outer `60 * 24` never actually
 * applies. Left in place because it is the guarantee the caller wants
 * (nothing waits longer than a day) and it costs nothing to keep true.
 */
export function retryDelayMinutes(attemptCount: number): number {
  return Math.min(60 * 24, 2 ** Math.min(attemptCount, 10));
}
