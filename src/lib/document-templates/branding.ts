// ═══════════════════════════════════════════════════════════════
// BRANDING — resolving a document's logo, once, at generation time
// ═══════════════════════════════════════════════════════════════
//
// The splice/extract mechanics (`applyCompanyLogo`, `extractCompanyLogoUrl`,
// `isAbsoluteHttpUrl`) live in `letter-kit.mjs`, not here, because
// `scripts/seed-letter-templates.mjs` needs them too and can only import
// plain JavaScript (see that file's header for why). This module adds the
// one piece that is genuinely TypeScript's: deciding *which* URL a given
// document should carry, which is a policy question, not a string-splicing
// one, and only ever runs from Node server code that already has real `env`
// typing.
//
// `resolveCompanyLogoUrl()` is called exactly once per document, in
// `generate()` in `src/db/repositories/documents.neon.ts`, immediately after
// `render()` and before the result is hashed and frozen into
// `renderedBody`. That is deliberate: a document's signature attests to the
// text (and now the image) it was shown at signing time, so the logo has to
// be resolved and baked in at generation, the same moment every other token
// is, rather than recomputed each time the document is displayed — a
// document whose masthead could change after being signed is not one whose
// hash means anything.

import {
  applyCompanyLogo,
  extractCompanyLogoUrl,
  isAbsoluteHttpUrl,
} from "./letter-kit.mjs";

export { applyCompanyLogo, extractCompanyLogoUrl, isAbsoluteHttpUrl };

/**
 * The deployment-wide fallback logo, for an organisation that has not
 * configured its own. Same two environment variables and the same shape as
 * `logoUrl()` in `referral-invite-email.ts` and `intern-mail.ts` — so a
 * generated document and a lifecycle email show the same mark for a tenant
 * that has not branded itself — duplicated rather than imported, matching
 * `intern-mail.ts`'s own header comment on why every one of these stays
 * self-contained instead of sharing a "components" module.
 */
export function defaultLogoUrl(): string {
  const configured = process.env.MAIL_LOGO_URL?.trim();
  if (configured) return configured;
  const careers = process.env.NEXT_PUBLIC_CAREERS_URL?.trim() || "https://career.circuvent.com";
  return `${careers.replace(/\/$/, "")}/logo-mark-128.png`;
}

/**
 * The logo URL a generated document should carry.
 *
 * The organisation's own logo wins whenever it is a genuine, absolute
 * `http(s)` URL. Anything else it might contain — unset, blank, a relative
 * path left over from a form that stored an upload path rather than a public
 * URL, or (before this change existed) a stray `cid:` value imported from
 * the old email-only scheme — falls through to the deployment default rather
 * than producing a broken image, because `isAbsoluteHttpUrl` is exactly the
 * same guard `applyCompanyLogo` itself uses to decide whether to emit an
 * `<img>` at all.
 *
 * This always resolves to *some* URL: Circuvent's own mark is the documented
 * fallback for a tenant that has not branded its own instance yet (the
 * founder confirmed `https://career.circuvent.com/logo-mark-128.png` is
 * live). That is a deliberate product choice, not an accident of this
 * function — the safety property that actually matters, that no tenant ever
 * gets a placeholder or a broken image, is enforced independently by
 * `applyCompanyLogo` itself, which is what falls back to rendering no `<img>`
 * at all whenever it is ever handed nothing usable.
 */
export function resolveCompanyLogoUrl(orgLogoUrl?: string | null): string {
  if (isAbsoluteHttpUrl(orgLogoUrl)) return orgLogoUrl;
  return defaultLogoUrl();
}
