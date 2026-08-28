// ═══════════════════════════════════════════════════════════════
// TENANT IDENTITY FOR DOCUMENTS
// ═══════════════════════════════════════════════════════════════
//
// Who the letter says it is from.
//
// Every template in the catalog carries `company_name`, `company_address` and
// `company_contact` as tokens precisely so that one deployment can serve many
// companies. Until now nothing filled them in: `generate()` merged
// `extraValues` and the employee's own fields, so the company identity had to
// be supplied by whoever called the API.
//
// That is the wrong place for it. A caller that omits them gets a 422, which is
// merely annoying; a caller that supplies the wrong ones gets a valid,
// signed contract with another company's name and registration number on it,
// and nothing anywhere will object. The tenant's identity is a property of the
// tenant, so it is read from the tenant.
//
// `extraValues` still wins where it is set, because a company with several
// registered entities issues offers from whichever one is employing — but it
// has to say so explicitly rather than by default.

import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { organizations, users } from "@/db/schema/identity";

export interface OrgIdentity {
  name: string;
  address?: string;
  contact?: string;
  website?: string;
  registration?: string;
  logoUrl?: string;
}

/** Settings blob keys this reads, when the tenant has filled them in. */
interface OrgSettings {
  registrationNumber?: string;
  supportEmail?: string;
  phone?: string;
  letterDefaults?: OrgLetterDefaults;
}

/**
 * The answers every letter needs and no record holds.
 *
 * A joining letter asks who signs it, where to report, at what time and what
 * to bring. None of that is on the employee's row or the organisation's, so
 * `generate()` refused every one of them with a list of ten unresolved tokens
 * — correctly, because a letter that tells somebody to report to a blank
 * address is worse than no letter. But it meant HR retyping the same ten
 * answers for every hire, which nobody does twice: they stop issuing the
 * letter.
 *
 * These are the same for every hire in a company, so they belong to the
 * company. Anything set here is the lowest-precedence source: a specific
 * letter can still override any of it through `extraValues`.
 */
export interface OrgLetterDefaults {
  signatoryName?: string;
  signatoryTitle?: string;
  hrContactName?: string;
  hrContactEmail?: string;
  workLocation?: string;
  officeLocation?: string;
  reportingTime?: string;
  startTime?: string;
  dressCode?: string;
  documentsToBring?: string;
  firstDayPlan?: string;
  dayOnePlan?: string;
  probationMonths?: string;
  probationNoticePeriod?: string;
  policyAcknowledgements?: string;
  buddyName?: string;
}

/** The token name each default answers to, in the templates as written. */
const LETTER_DEFAULT_TOKENS: Record<keyof OrgLetterDefaults, string> = {
  signatoryName: "signatory_name",
  signatoryTitle: "signatory_title",
  hrContactName: "hr_contact_name",
  hrContactEmail: "hr_contact_email",
  workLocation: "work_location",
  officeLocation: "office_location",
  reportingTime: "reporting_time",
  startTime: "start_time",
  dressCode: "dress_code",
  documentsToBring: "documents_to_bring",
  firstDayPlan: "first_day_plan",
  dayOnePlan: "day_one_schedule",
  probationMonths: "probation_months",
  probationNoticePeriod: "probation_notice_period",
  policyAcknowledgements: "policy_acknowledgements",
  buddyName: "buddy_name",
};

export async function loadOrgIdentity(ctx: TenantContext): Promise<OrgIdentity | null> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1);

    if (!row) return null;

    const settings = (row.settings ?? {}) as OrgSettings;

    // Joined with commas rather than newlines: these land in a single-line
    // token inside a letterhead, and a newline there renders as a space in
    // HTML anyway, so building the separator in is the only way it survives.
    const address = [row.address, row.city, row.country].filter(Boolean).join(", ");

    // Falls back to the owner's address, which is real information rather than
    // a placeholder. Without it a newly registered organisation resolves no
    // `company_contact` at all, and since `validateTemplate` treats an empty
    // value as missing, every offer letter it tried to issue failed with a 422
    // naming a token its HR team has never heard of.
    let contact = [settings.supportEmail, settings.phone, row.website]
      .filter(Boolean)
      .join(" · ");

    if (!contact && row.ownerId) {
      const [owner] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, row.ownerId))
        .limit(1);
      if (owner?.email) contact = owner.email;
    }

    return {
      name: row.name,
      address: address || undefined,
      contact: contact || undefined,
      website: row.website ?? undefined,
      registration: settings.registrationNumber,
      logoUrl: row.logoUrl ?? undefined,
    };
  });
}

/**
 * The identity as document tokens.
 *
 * Only non-empty values are returned. A token that is present but blank passes
 * `validateTemplate`, so the letter renders with an empty letterhead line
 * instead of failing — and an offer with a missing registered address is a
 * document somebody has to reissue after it has been signed.
 */
export function identityTokens(identity: OrgIdentity): Record<string, string> {
  const tokens: Record<string, string> = { company_name: identity.name };

  if (identity.address?.trim()) tokens.company_address = identity.address.trim();
  if (identity.contact?.trim()) tokens.company_contact = identity.contact.trim();
  if (identity.registration?.trim()) {
    tokens.company_registration = identity.registration.trim();
  }

  return tokens;
}

/**
 * The organisation's letter defaults, as document tokens.
 *
 * Blank values are dropped rather than returned empty, for the same reason
 * `identityTokens` drops them: `validateTemplate` treats a present-but-empty
 * token as satisfied, so a blank would render a joining letter naming no
 * reporting address and no signatory instead of refusing to issue one.
 */
export function letterDefaultTokens(
  defaults: OrgLetterDefaults | undefined
): Record<string, string> {
  if (!defaults) return {};

  const tokens: Record<string, string> = {};
  for (const [key, token] of Object.entries(LETTER_DEFAULT_TOKENS)) {
    const value = defaults[key as keyof OrgLetterDefaults];
    if (typeof value === "string" && value.trim()) tokens[token] = value.trim();
  }
  return tokens;
}

/** Reads just the letter defaults, for `generate()` and the settings screen. */
export async function loadOrgLetterDefaults(
  ctx: TenantContext
): Promise<OrgLetterDefaults | undefined> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1);

    return ((row?.settings ?? {}) as OrgSettings).letterDefaults;
  });
}
