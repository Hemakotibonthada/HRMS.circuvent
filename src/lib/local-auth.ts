// ═══════════════════════════════════════════════════════════════
// LOCAL CREDENTIALS — Development Only
// Used with `npm run dev:localcreds` for offline development
// ═══════════════════════════════════════════════════════════════
// The shared password is NOT stored in this file. It is read from
// NEXT_PUBLIC_LOCAL_DEV_PASSWORD, and local-credentials mode refuses to
// authenticate anyone when that variable is unset. Previously a real personal
// password was committed here in plaintext for four accounts, which meant it
// also shipped inside the compiled client bundle.
//
// To use: set NEXT_PUBLIC_USE_LOCAL_CREDS=true and
// NEXT_PUBLIC_LOCAL_DEV_PASSWORD=<something> in .env.local (git-ignored).

export interface LocalUser {
  uid: string;
  email: string;
  displayName: string;
  role: "admin" | "hr" | "employee";
  department: string;
  designation: string;
  organizationId: string;
  avatar?: string;
  phone?: string;
}

/** Synthetic organization used to scope local dev data. */
export const LOCAL_ORG_ID = "local-dev-org";

export const LOCAL_USERS: LocalUser[] = [
  {
    uid: "local-admin-001",
    email: "admin@circuvent.com",
    displayName: "Admin",
    role: "admin",
    department: "Administration",
    designation: "System Administrator",
    organizationId: LOCAL_ORG_ID,
    phone: "+91 98765 00000",
  },
  {
    uid: "local-hr-001",
    email: "hr@circuvent.com",
    displayName: "Priya Sharma",
    role: "hr",
    department: "Human Resources",
    designation: "HR Director",
    organizationId: LOCAL_ORG_ID,
    phone: "+91 98765 43211",
  },
  {
    uid: "local-emp-001",
    email: "employee@circuvent.com",
    displayName: "Arun Kumar",
    role: "employee",
    department: "Engineering",
    designation: "Senior Full Stack Developer",
    organizationId: LOCAL_ORG_ID,
    phone: "+91 98765 43210",
  },
  {
    uid: "local-lead-001",
    email: "lead@circuvent.com",
    displayName: "Team Lead",
    role: "admin",
    department: "Leadership",
    designation: "Director",
    organizationId: LOCAL_ORG_ID,
    phone: "+91 98765 00001",
  },
];

/**
 * Check if running in local credentials mode
 */
export function isLocalCredentialsMode(): boolean {
  return process.env.NEXT_PUBLIC_USE_LOCAL_CREDS === "true";
}

function getLocalDevPassword(): string | null {
  const password = process.env.NEXT_PUBLIC_LOCAL_DEV_PASSWORD;
  return password && password.length > 0 ? password : null;
}

/**
 * Validate local credentials and return user if valid.
 * Fails closed when no dev password is configured.
 */
export function validateLocalCredentials(
  email: string,
  password: string
): LocalUser | null {
  if (!isLocalCredentialsMode()) return null;

  const expected = getLocalDevPassword();
  if (!expected) {
    console.error(
      "Local credentials mode is on but NEXT_PUBLIC_LOCAL_DEV_PASSWORD is not set — refusing to sign in."
    );
    return null;
  }
  if (password !== expected) return null;

  return (
    LOCAL_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase()) ??
    null
  );
}

/**
 * Get locally stored user session
 */
export function getLocalSession(): LocalUser | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem("hrms_local_user");
    if (stored) return JSON.parse(stored) as LocalUser;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Save local user session
 */
export function setLocalSession(user: LocalUser): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("hrms_local_user", JSON.stringify(user));
}

/**
 * Clear local user session
 */
export function clearLocalSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("hrms_local_user");
}
