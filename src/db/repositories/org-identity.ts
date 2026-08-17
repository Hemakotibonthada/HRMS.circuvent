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
}

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
