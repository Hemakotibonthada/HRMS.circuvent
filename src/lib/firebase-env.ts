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
 * A missing var never falls back to a literal credential — that was the whole
 * point of this module, and it stays true. What it does instead depends on
 * where we are:
 *
 *  - In the browser, and on the server, the name is recorded and an empty
 *    string returned. Empty config cannot connect anywhere, so there is no risk
 *    of silently talking to the production project; the Firebase SDK reports a
 *    clear error the moment anything actually uses it, and `isFirebaseConfigured`
 *    plus `missingFirebaseEnv()` let callers check first.
 *
 * This used to throw on the server. That made the intent loud but also made the
 * application unbuildable: Next evaluates these modules while prerendering, so
 * a single missing var failed the entire production build — including the API
 * routes, which have already moved to Neon and do not touch Firebase at all.
 * Refusing to build is not a safer failure than refusing to connect; it just
 * fails somewhere less useful.
 */
export function requireFirebaseEnv(name: string): string {
  const value = process.env[name];
  if (value && value.trim()) return value;

  if (!MISSING.includes(name)) {
    MISSING.push(name);
    console.error(
      `[firebase] ${name} is missing. Firebase features will not work. ` +
        `Set it in .env.local (local) or the Vercel project environment (deployed).`
    );
  }
  return "";
}

/** True when every Firebase web variable needed to connect is present. */
export function isFirebaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() &&
    !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
  );
}

/** Names of required vars that were missing, for surfacing in a health check. */
export function missingFirebaseEnv(): readonly string[] {
  return MISSING;
}
