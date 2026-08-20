// Which role applies when the identity service and HRMS disagree.
//
// Groups in auth.circuvent.com grant roles across the suite, and that role
// arrives in the SSO token. HRMS also keeps its own grants in
// `identity.user_roles`. Both are written down, so something has to decide.
//
// ── Why the directory wins, rather than whichever is stronger ──
// This used to return the *stronger* of the two, reasoning that a group of
// ordinary employees should not silently demote an HRMS administrator. The
// reasoning was sound; the consequence was that a role could be granted from
// auth.circuvent.com but never taken away by it. Removing somebody's admin
// there left `identity.user_roles` untouched, the stronger local row kept
// winning, and the person stayed an administrator through every sign-out,
// every fresh sign-in, and every incognito window — while the identity service
// displayed the reduced role the whole time. It cost a founder an afternoon
// proving the directory was not lying.
//
// Revocation that does not revoke is worse than no revocation, because it
// looks like it worked. `signInWithSso`'s own documentation already says the
// directory "is the system of record for who works here, not HRMS", and the
// identity service refuses to issue a token for an application at all unless
// the person holds a grant for it — so a token that arrives here has already
// passed that gate, and its role claim is that gate's answer.
//
// A local grant still applies when the provider asserts nothing: password
// sign-in has no directory assertion to defer to, and neither does a token
// minted before the role claim existed.

/** HRMS's own vocabulary, weakest first. `owner` exists only here. */
export const ROLE_RANK: Record<string, number> = {
  employee: 10,
  manager: 20,
  hr: 30,
  admin: 40,
  owner: 50,
};

export const DEFAULT_ROLE = "employee";

/**
 * The role to sign into the session with, given what HRMS holds locally and
 * what the identity service asserts.
 *
 * The asserted role wins whenever it is one this application can place —
 * including when it is *weaker* than the local grant, which is the whole
 * point: that is what makes removing access in auth.circuvent.com actually
 * remove it.
 *
 * An unknown role from the token is ignored rather than trusted. A role this
 * app cannot place is one it cannot enforce either — treating it as valid
 * would hand out powers with no definition here — so the local answer is used
 * instead, which is at least a decision this application knows how to apply.
 */
export function effectiveRole(
  localRole: string | null | undefined,
  ssoRole: string | null | undefined
): string {
  const local = normalise(localRole) ?? DEFAULT_ROLE;
  const sso = normalise(ssoRole);
  return sso ?? local;
}

function normalise(role: string | null | undefined): string | null {
  if (typeof role !== "string") return null;
  const r = role.trim().toLowerCase();
  return r && Object.prototype.hasOwnProperty.call(ROLE_RANK, r) ? r : null;
}
