// Which role applies when the identity service and HRMS disagree.
//
// Groups in auth.circuvent.com now grant roles across the suite, and that role
// arrives in the SSO token. HRMS also keeps its own grants in
// `identity.user_roles`. Both are legitimate, so something has to decide.
//
// This does, by rank, and it is deliberately the same rule the identity service
// itself applies when a person's direct grant and their group's grant disagree:
// the stronger wins. Anything else produces a suite where the same person has
// different powers depending on which application they opened, which is the one
// outcome nobody can reason about.

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
 * The stronger of the two, or the local one when the token says nothing.
 *
 * An unknown role from the token is ignored rather than trusted. The identity
 * service and HRMS share a vocabulary today, but a role this app cannot place
 * is one it cannot enforce either — treating it as strong would grant powers
 * with no definition, and treating it as weak would silently demote somebody.
 * Ignoring it leaves the local answer, which is at least a decision this
 * application knows how to apply.
 */
export function strongestRole(
  localRole: string | null | undefined,
  ssoRole: string | null | undefined
): string {
  const local = normalise(localRole) ?? DEFAULT_ROLE;
  const sso = normalise(ssoRole);
  if (!sso) return local;
  return (ROLE_RANK[sso] ?? 0) > (ROLE_RANK[local] ?? 0) ? sso : local;
}

function normalise(role: string | null | undefined): string | null {
  if (typeof role !== "string") return null;
  const r = role.trim().toLowerCase();
  return r && Object.prototype.hasOwnProperty.call(ROLE_RANK, r) ? r : null;
}
