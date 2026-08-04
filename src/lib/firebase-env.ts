// ═══════════════════════════════════════════════════════════════
// FIREBASE ENVIRONMENT VALIDATION
// ═══════════════════════════════════════════════════════════════
// src/lib/firebase.ts and src/lib/cross-app-sync.ts previously fell back to
// literal project credentials when an env var was missing:
//
//   apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCh3BR…"
//
// Those literals shipped in the client bundle and sat in git history. Worse,
// the fallback hid misconfiguration: a deployment with no env vars silently
// connected to the production Firebase project instead of failing.
//
// Missing configuration is now an error. Firebase is being retired in favour of
// Neon (see docs/PLATFORM-ARCHITECTURE.md), so this module exists to keep the
// remaining Firebase code safe until that migration completes.

const MISSING: string[] = [];

/**
 * Reads a required Firebase env var.
 *
 * On the server a missing var throws immediately. In the browser it collects
 * the name and returns an empty string instead — throwing during module
 * evaluation would blank the page before any error boundary can mount, and the
 * Firebase SDK reports a clearer error itself once it is handed empty config.
 */
export function requireFirebaseEnv(name: string): string {
  const value = process.env[name];
  if (value && value.trim()) return value;

  if (typeof window === "undefined") {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill in the Firebase web config. ` +
        `Hardcoded credential fallbacks were removed deliberately — see src/lib/firebase-env.ts.`
    );
  }

  if (!MISSING.includes(name)) {
    MISSING.push(name);
    console.error(
      `[firebase] ${name} is missing. Firebase features will not work. ` +
        `Set it in .env.local (local) or the Vercel project environment (deployed).`
    );
  }
  return "";
}

/** Names of required vars that were missing, for surfacing in a health check. */
export function missingFirebaseEnv(): readonly string[] {
  return MISSING;
}
