// ═══════════════════════════════════════════════════════════════
// FIRESTORE SOURCE — migration only
// ═══════════════════════════════════════════════════════════════
// The only Firebase left in this repository, and it is not part of the
// application: it exists so the one-off Firestore → Neon copy in
// migrate-to-neon.ts can still be run against a legacy project if there is data
// left to rescue.
//
// It deliberately lives under scripts/ rather than src/. Nothing the app ships
// imports it, so no deployment needs Firebase credentials to authenticate a
// user or read a record — which was the situation that left the API unable to
// authenticate anybody at all.
//
// Once the legacy project is decommissioned, delete this file, the
// migrate-to-neon script, and the firebase-admin devDependency.

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const ADMIN_APP_NAME = "circuvent-migration";

function loadServiceAccount(): Record<string, unknown> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw || !raw.trim()) return null;

  const text = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is set but is not valid JSON or base64-encoded JSON"
    );
  }
}

function getAdminApp(): App {
  const existing = getApps().find((a) => a.name === ADMIN_APP_NAME);
  if (existing) return existing;

  const serviceAccount = loadServiceAccount();
  return initializeApp(
    {
      credential: serviceAccount
        ? cert(serviceAccount as Parameters<typeof cert>[0])
        : applicationDefault(),
    },
    ADMIN_APP_NAME
  );
}

const cache = new Map<string, Firestore>();

/** Read-side Firestore handle for the legacy project. */
export function adminDb(databaseId?: string): Firestore {
  const key = databaseId ?? "(default)";
  const hit = cache.get(key);
  if (hit) return hit;

  const db = databaseId
    ? getFirestore(getAdminApp(), databaseId)
    : getFirestore(getAdminApp());
  cache.set(key, db);
  return db;
}
