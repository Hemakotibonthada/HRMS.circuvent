// ═══════════════════════════════════════════════════════════════
// COMPANY MAIL IDENTITY — how a person's address is formed, and changed
// ═══════════════════════════════════════════════════════════════
// A colleague's address is not free text. It encodes whether they are an
// intern, and it has to survive them stopping being one.
//
//   intern     cvi-{handle}@circuvent.com
//   vendor     v-{handle}@circuvent.com
//   permanent  {handle}@circuvent.com
//
// Vendor addresses are issued by Mail.circuvent, not here — a vendor is a
// company that takes our SaaS, not somebody HR employs, so there is no
// employee record behind one and nothing in this app creates them. They are
// named in this module anyway, for two reasons that both matter: nothing here
// may mistake `v-acme@circuvent.com` for a colleague's address, and no
// employee may be issued a handle starting with `v-`, which would tell every
// recipient they are one of our vendors.
//
// The handle is chosen by the person themselves when they create their
// mailbox after accepting an offer — not generated here, and not assigned by
// HR. This module says what a handle may be and what an address becomes; it
// does not decide who gets one. That is `employee-rules.ts` (who is an
// employee at all) and the Mail approval queue (whether this particular
// request is granted).
//
// ── Why conversion is the interesting case ──
// When an intern becomes permanent the `cvi-` prefix has to go, and the rest
// of the address must not: somebody who has been writing from
// `cvi-rahul@circuvent.com` for six months keeps `rahul@circuvent.com`, so
// their correspondents' address books, their sent mail and every document
// quoting them still resolve to a person. That is a *derivation*, and it is
// written down here once rather than being re-derived by string surgery at
// each call site.
//
// ── What this module deliberately does NOT do ──
// It performs no I/O. The mail server has no rename operation at all: the
// Maildir path is derived from the address, so becoming permanent means
// creating the new mailbox, deleting the old one, and only then aliasing the
// old address to the new (the alias endpoint refuses while the old address is
// still a real mailbox). That sequence, its retries and its failure states
// belong to the outbox that carries it, not to a pure naming rule.

/** The domain staff addresses are issued on. */
export const COMPANY_MAIL_DOMAIN = (process.env.COMPANY_MAIL_DOMAIN ?? "circuvent.com").toLowerCase();

/**
 * The prefix an intern's address carries.
 *
 * Lower case, with the separating hyphen included, because every comparison
 * in this module is made against a lower-cased address and forgetting the
 * hyphen would make `cvirahul@` look like an intern address.
 */
export const INTERN_ADDRESS_PREFIX = "cvi-";

/**
 * The prefix a vendor's address carries.
 *
 * Mail.circuvent issues these; this app only needs to recognise them. A
 * vendor is a company taking our SaaS, so there is no employee record behind
 * one — which is exactly why an employee must never be able to choose a
 * handle starting with it.
 */
export const VENDOR_ADDRESS_PREFIX = "v-";

/**
 * Every prefix that means something, longest first.
 *
 * Longest first so a prefix that is a prefix of another cannot shadow it.
 * `cvi-` and `v-` share no leading character today; the ordering is what stops
 * that from becoming a silent bug if a third is ever added.
 */
export const MEANINGFUL_ADDRESS_PREFIXES: readonly string[] = [
  INTERN_ADDRESS_PREFIX,
  VENDOR_ADDRESS_PREFIX,
].sort((a, b) => b.length - a.length);

/**
 * What a handle may be, before any prefix is applied.
 *
 * Deliberately the same shape the mail server itself enforces
 * (`LOCAL_RE` in Mail.circuvent's `api/register` route, and `EMAIL_RE` in
 * `mailadmin/server.js`): start with a letter or digit, then letters, digits,
 * dot, underscore or hyphen. A handle this module accepts and the mail server
 * then rejects would be a request that passes every check HR can see and
 * fails at provisioning time, which is the worst place to find out.
 */
const HANDLE_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * The longest a local part may be.
 *
 * 64 octets is the RFC 5321 limit; the mail server's own regex allows a
 * leading character plus 62 more, so 63 is the effective ceiling and the one
 * worth agreeing with.
 */
const MAX_LOCAL_PART = 63;

/**
 * Local parts nobody may take as a personal address.
 *
 * The union of what the Mail registration route reserves and the role
 * addresses `employee-rules.ts` refuses to treat as a colleague. Held here as
 * well because this module is what a person's *requested* handle is checked
 * against, and "the other two files would have caught it" is not a property
 * that survives either of them being edited.
 */
const RESERVED_HANDLES = new Set([
  "postmaster",
  "abuse",
  "admin",
  "administrator",
  "root",
  "security",
  "noreply",
  "no-reply",
  "mailer-daemon",
  "hostmaster",
  "webmaster",
  "support",
  "help",
  "info",
  "contact",
  "sales",
  "billing",
  "accounts",
  "hr",
  "careers",
  "jobs",
  "legal",
  "privacy",
  "marketing",
  "it",
  "team",
  "all",
  "everyone",
  "payroll",
  "finance",
  "dmarc",
  "tls-reports",
]);

export type MailIdentityKind = "intern" | "permanent";

/** Why a requested handle was refused, in words meant for the person who typed it. */
export class MailHandleError extends Error {
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = "MailHandleError";
  }
}

/**
 * Which kind of address an employment type gets.
 *
 * Only `intern` carries the prefix. A contractor, consultant or freelancer is
 * not an intern and is not treated as one — they are here on their own terms,
 * and marking them out in their address would be both wrong and visible to
 * everybody they ever write to.
 */
export function mailIdentityKindFor(employmentType: string | null | undefined): MailIdentityKind {
  return String(employmentType ?? "").trim().toLowerCase() === "intern" ? "intern" : "permanent";
}

/**
 * Checks a handle a person has chosen, returning it normalised.
 *
 * Throws rather than returning null: every caller here has to tell the person
 * *why* their choice was refused, and a boolean cannot.
 */
export function normaliseHandle(raw: string, kind: MailIdentityKind = "permanent"): string {
  const handle = String(raw ?? "").trim().toLowerCase();

  if (handle.length === 0) {
    throw new MailHandleError("Choose the name you want before the @ sign.");
  }
  if (!HANDLE_RE.test(handle)) {
    throw new MailHandleError(
      "Use only letters, numbers, dots, underscores and hyphens, starting with a letter or number."
    );
  }
  if (handle.startsWith(INTERN_ADDRESS_PREFIX)) {
    // Otherwise an intern typing "cvi-rahul" would be issued
    // "cvi-cvi-rahul@", and — worse — converting them later would strip one
    // prefix and leave the other.
    throw new MailHandleError(
      `Do not include "${INTERN_ADDRESS_PREFIX}" yourself — it is added automatically while you are an intern, and removed when you are made permanent.`
    );
  }
  if (handle.startsWith(VENDOR_ADDRESS_PREFIX)) {
    // Nobody employed here may take a vendor's shape. `v-acme@circuvent.com`
    // tells every recipient that the sender is one of our vendors, and an
    // employee who could choose that handle would be issued an address that
    // vouches for them as one.
    throw new MailHandleError(
      `A name cannot start with "${VENDOR_ADDRESS_PREFIX}": that prefix is reserved for vendors and is added automatically for them.`
    );
  }
  if (RESERVED_HANDLES.has(handle)) {
    throw new MailHandleError("That name is reserved for a shared or system mailbox. Please choose another.");
  }

  // Measured against the address this handle will actually produce, so an
  // intern is told now rather than after the prefix pushes them over.
  const localPartLength = kind === "intern" ? INTERN_ADDRESS_PREFIX.length + handle.length : handle.length;
  if (localPartLength > MAX_LOCAL_PART) {
    throw new MailHandleError(
      `That name is too long — the part before the @ can be at most ${MAX_LOCAL_PART} characters${
        kind === "intern" ? `, and "${INTERN_ADDRESS_PREFIX}" counts towards it` : ""
      }.`
    );
  }

  return handle;
}

/** The address a chosen handle produces for someone of this kind. */
export function addressFor(handle: string, kind: MailIdentityKind): string {
  const normalised = normaliseHandle(handle, kind);
  const local = kind === "intern" ? `${INTERN_ADDRESS_PREFIX}${normalised}` : normalised;
  return `${local}@${COMPANY_MAIL_DOMAIN}`;
}

/** True when this address carries the intern prefix. */
export function isInternAddress(email: string): boolean {
  return localPartOf(email).startsWith(INTERN_ADDRESS_PREFIX);
}

/**
 * True when this address belongs to a vendor rather than a colleague.
 *
 * Used wherever this app would otherwise treat any `@circuvent.com` address
 * as staff — a vendor is a customer company, not somebody on the payroll or
 * in the directory.
 */
export function isVendorAddress(email: string): boolean {
  return localPartOf(email).startsWith(VENDOR_ADDRESS_PREFIX);
}

/** True when the address belongs to somebody employed here, of any kind. */
export function isStaffAddress(email: string): boolean {
  if (domainOf(email) !== COMPANY_MAIL_DOMAIN) return false;
  return !isVendorAddress(email);
}

/** The part before the @, lower-cased. Empty when there isn't one. */
export function localPartOf(email: string): string {
  const at = String(email ?? "").trim().toLowerCase().lastIndexOf("@");
  return at <= 0 ? "" : String(email).trim().toLowerCase().slice(0, at);
}

/** The part after the @, lower-cased. */
export function domainOf(email: string): string {
  const value = String(email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  return at < 0 ? "" : value.slice(at + 1);
}

/**
 * The address an intern keeps once they are made permanent.
 *
 * Returns null when there is nothing to do — a permanent address, or an
 * address on somebody else's domain — so a caller can treat "no change
 * needed" as an ordinary outcome rather than an error. Converting somebody
 * who was hired permanently in the first place is a normal thing to attempt,
 * because the conversion path does not know in advance how they were hired.
 */
export function permanentAddressFor(currentEmail: string): string | null {
  const local = localPartOf(currentEmail);
  const domain = domainOf(currentEmail);

  if (local.length === 0 || domain !== COMPANY_MAIL_DOMAIN) return null;
  if (!local.startsWith(INTERN_ADDRESS_PREFIX)) return null;

  const handle = local.slice(INTERN_ADDRESS_PREFIX.length);

  // A mailbox literally called "cvi-" has no handle underneath it. Refusing
  // is right: there is no address to move them to, and inventing one would
  // silently give somebody a mailbox nobody chose.
  if (handle.length === 0) return null;

  return `${handle}@${COMPANY_MAIL_DOMAIN}`;
}

/**
 * The full plan for making an intern permanent, or null when no mail change
 * is needed.
 *
 * Returned as data rather than performed, because the mail server has no
 * rename: this has to become a create, a delete and an alias in that order,
 * each of which can fail independently and has to be retried without
 * repeating the ones that already succeeded.
 */
export interface MailConversion {
  /** The address they have been writing from. */
  from: string;
  /** The address they keep. */
  to: string;
  /**
   * Whether the old address should continue to deliver to the new mailbox.
   *
   * Always true here, and stated explicitly rather than assumed: mail sent to
   * an intern's old address after they convert is ordinary correspondence
   * from people who have not heard, not a mistake to bounce.
   */
  aliasOldAddress: boolean;
}

export function planMailConversion(currentEmail: string): MailConversion | null {
  const to = permanentAddressFor(currentEmail);
  if (!to) return null;
  return { from: String(currentEmail).trim().toLowerCase(), to, aliasOldAddress: true };
}
