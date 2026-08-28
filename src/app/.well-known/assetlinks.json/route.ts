// ═══════════════════════════════════════════════════════════════
// GET /.well-known/assetlinks.json
// ═══════════════════════════════════════════════════════════════
//
// Digital Asset Links. Android's Credential Manager will not let the app use a
// passkey scoped to this domain until the domain says, here, that it trusts the
// app — identified by package name and signing certificate.
//
// Everything else for passkeys was already built: the ceremony, the signature
// checks, the credential table, `PasskeyManager` on the device, and a "Use a
// passkey" button on the sign-in screen. Without this file none of it can
// complete on Android: the platform refuses before a request is ever made, and
// the failure surfaces to somebody as a passkey sheet that opens and shuts
// again with nothing said.
//
// ─── Which certificate ───
//
// For anything distributed through Play App Signing the fingerprint here must
// be the **app signing** certificate Play holds, NOT the upload certificate.
// They are different keys. Play re-signs every artifact after upload, so the
// certificate a phone actually sees is Play's, and a file listing the upload
// certificate verifies against nothing.
//
// Play shows it under Test and release → Setup → App signing, as
// "SHA-256 certificate fingerprint". That value goes in ASSETLINKS_SHA256.
//
// A locally built APK — sideloaded for testing — is signed by the upload key
// instead, so its fingerprint differs again. Both can be listed: the field is
// an array precisely because one app legitimately has several.
//
// ─── Why a route rather than a static file ───
//
// The fingerprint differs per environment, and baking production's into the
// repository means staging fails silently with an error that names nothing. It
// is read from configuration, and when nothing is configured this answers 404
// rather than serving a relation that trusts nobody — an empty assetlinks.json
// is worse than none, because it looks configured.

import { NextResponse } from "next/server";

/** Android package name, overridable so a debug build can be trusted too. */
const DEFAULT_PACKAGE = "com.circuvent.hrms";

/** Uppercase colon-separated hex, exactly as Play and keytool print it. */
function fingerprints(): string[] {
  return (process.env.ASSETLINKS_SHA256 ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
}

export function GET() {
  const certs = fingerprints();

  if (certs.length === 0) {
    // Nothing configured. Saying so plainly beats serving a relation that
    // trusts nobody, which reads as "configured, and the app is not trusted".
    return NextResponse.json(
      { error: "Digital Asset Links are not configured for this deployment" },
      { status: 404 }
    );
  }

  const packageName = process.env.ASSETLINKS_PACKAGE?.trim() || DEFAULT_PACKAGE;

  return NextResponse.json(
    [
      {
        relation: [
          // Passkeys need this one. `handle_all_urls` is deliberately absent:
          // it makes Android open this app for every link to the domain, which
          // is an app-links decision and nothing to do with credentials.
          "delegate_permission/common.get_login_creds",
        ],
        target: {
          namespace: "android_app",
          package_name: packageName,
          sha256_cert_fingerprints: certs,
        },
      },
    ],
    {
      headers: {
        "content-type": "application/json",
        // Google's verifier and the platform both cache this. An hour is long
        // enough to spare the origin and short enough that rotating a signing
        // key does not lock every phone out for a day.
        "cache-control": "public, max-age=3600",
      },
    }
  );
}
