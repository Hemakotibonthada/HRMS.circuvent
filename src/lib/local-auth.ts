// ═══════════════════════════════════════════════════════════════
// LOCAL CREDENTIALS — Development Only
// Used with `npm run dev:localcreds` for offline development
// ═══════════════════════════════════════════════════════════════

export interface LocalUser {
  uid: string;
  email: string;
  displayName: string;
  role: "admin" | "hr" | "employee";
  department: string;
  designation: string;
  avatar?: string;
  phone?: string;
}

export const LOCAL_CREDENTIALS: { email: string; password: string; user: LocalUser }[] = [
  {
    email: "admin@circuvent.com",
    password: "Hemakoti@003",
    user: {
      uid: "local-admin-001",
      email: "admin@circuvent.com",
      displayName: "Admin",
      role: "admin",
      department: "Administration",
      designation: "System Administrator",
      phone: "+91 98765 00000",
    },
  },
  {
    email: "hr@circuvent.com",
    password: "Hemakoti@003",
    user: {
      uid: "local-hr-001",
      email: "hr@circuvent.com",
      displayName: "Priya Sharma",
      role: "hr",
      department: "Human Resources",
      designation: "HR Director",
      phone: "+91 98765 43211",
    },
  },
  {
    email: "employee@circuvent.com",
    password: "Hemakoti@003",
    user: {
      uid: "local-emp-001",
      email: "employee@circuvent.com",
      displayName: "Arun Kumar",
      role: "employee",
      department: "Engineering",
      designation: "Senior Full Stack Developer",
      phone: "+91 98765 43210",
    },
  },
  {
    email: "hema@circuvent.com",
    password: "Hemakoti@003",
    user: {
      uid: "local-hema-001",
      email: "hema@circuvent.com",
      displayName: "Hema Koti",
      role: "admin",
      department: "Leadership",
      designation: "Director",
      phone: "+91 98765 00001",
    },
  },
];

/**
 * Check if running in local credentials mode
 */
export function isLocalCredentialsMode(): boolean {
  return process.env.NEXT_PUBLIC_USE_LOCAL_CREDS === "true";
}

/**
 * Validate local credentials and return user if valid
 */
export function validateLocalCredentials(email: string, password: string): LocalUser | null {
  const match = LOCAL_CREDENTIALS.find(
    (cred) => cred.email.toLowerCase() === email.toLowerCase() && cred.password === password
  );
  return match ? match.user : null;
}

/**
 * Get locally stored user session
 */
export function getLocalSession(): LocalUser | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem("hrms_local_user");
    if (stored) return JSON.parse(stored);
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
