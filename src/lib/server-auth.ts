// ═══════════════════════════════════════════════════════════════
// SERVER AUTH — Firebase Admin token verification for API routes
// ═══════════════════════════════════════════════════════════════
// API routes previously performed no authentication at all, so anyone could
// call them directly. They also used the client Firebase SDK server-side with
// hardcoded config fallbacks. This module provides the Admin SDK (which
// bypasses security rules by design) plus request verification helpers.
//
// Credentials resolve from FIREBASE_SERVICE_ACCOUNT_KEY (raw JSON or base64),
// otherwise from Application Default Credentials, which work automatically on
// Firebase App Hosting / Cloud Run.

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const ADMIN_APP_NAME = "circuvent-server";

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

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "circuvent";

  const serviceAccount = loadServiceAccount();

  return initializeApp(
    {
      credential: serviceAccount
        ? cert(serviceAccount as Parameters<typeof cert>[0])
        : applicationDefault(),
      projectId,
    },
    ADMIN_APP_NAME
  );
}

const dbCache = new Map<string, Firestore>();

/**
 * Admin Firestore handle for a named database.
 * Bypasses security rules — never expose directly to clients.
 */
export function adminDb(databaseId?: string): Firestore {
  const key = databaseId ?? "(default)";
  const cached = dbCache.get(key);
  if (cached) return cached;

  const db = databaseId
    ? getFirestore(getAdminApp(), databaseId)
    : getFirestore(getAdminApp());
  db.settings({ ignoreUndefinedProperties: true });
  dbCache.set(key, db);
  return db;
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 401
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
}

/** Cryptographically verify the caller's Firebase ID token. */
export async function verifyRequest(req: Request): Promise<DecodedIdToken> {
  const token = extractBearerToken(req);
  if (!token) throw new AuthError("Missing bearer token");

  try {
    return await adminAuth().verifyIdToken(token, true);
  } catch {
    throw new AuthError("Invalid or expired token");
  }
}

async function hasRole(decoded: DecodedIdToken, roles: string[]): Promise<boolean> {
  if (decoded.admin === true) return true;
  if (typeof decoded.role === "string" && roles.includes(decoded.role)) return true;

  const snap = await adminDb().collection("users").doc(decoded.uid).get();
  const role = snap.exists ? (snap.get("role") as string | undefined) : undefined;
  return !!role && roles.includes(role);
}

/** Verify the caller holds one of the given roles. */
export async function requireRole(
  req: Request,
  roles: string[]
): Promise<DecodedIdToken> {
  const decoded = await verifyRequest(req);
  if (!(await hasRole(decoded, roles))) {
    throw new AuthError("Insufficient permissions", 403);
  }
  return decoded;
}

/**
 * Shared-secret gate for machine-to-machine callers (cross-app sync jobs that
 * have no Firebase user). Fails closed when the secret is unset.
 */
export function requireServiceToken(req: Request): void {
  const expected = process.env.CROSS_APP_SYNC_TOKEN;
  if (!expected) {
    throw new AuthError("CROSS_APP_SYNC_TOKEN is not configured", 403);
  }
  const provided =
    req.headers.get("x-service-token") || extractBearerToken(req) || "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) throw new AuthError("Invalid service token", 403);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
  if (!timingSafeEqual(a, b)) throw new AuthError("Invalid service token", 403);
}

/** Accepts either a signed-in Firebase user or a valid service token. */
export async function requireUserOrService(req: Request): Promise<void> {
  try {
    requireServiceToken(req);
    return;
  } catch {
    await verifyRequest(req);
  }
}

/** Map an AuthError (or anything else) to a JSON error response body. */
export function authErrorResponse(e: unknown): { body: { error: string }; status: number } {
  const err = e as { status?: number; message?: string };
  return {
    body: { error: err.message ?? "Unauthorized" },
    status: err.status ?? 401,
  };
}
