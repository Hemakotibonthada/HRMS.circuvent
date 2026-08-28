// ═══════════════════════════════════════════════════════════════
// GET /api/downloads/windows — the desktop installer
// ═══════════════════════════════════════════════════════════════
//
// Streams the installer out of private object storage rather than linking to
// it. The bucket also holds signed letters and payslips; making it public so
// one file could be linked directly would put every employee's payslip one
// guessed key away, and no amount of saved egress is worth that.
//
// Streamed, not buffered. ~100MB per concurrent download held in memory is how
// a release day takes the web server down.
//
// Deliberately unauthenticated. Somebody setting up a new laptop has no way to
// sign in until the app is on it, and gating the installer behind the thing it
// installs is a circle. The bytes are a public product download; the data
// behind them is not.

import { NextResponse } from "next/server";
import {
  getObjectBytes,
  getObjectStream,
  storageConfigured,
} from "@/lib/storage/object-store";

export const runtime = "nodejs";
// Never cached at the edge: the manifest decides which build is current, and a
// cached response would keep serving the previous one after a release.
export const dynamic = "force-dynamic";

const MANIFEST_KEY = "downloads/windows/latest.json";

export interface DesktopManifest {
  product: string;
  version: string;
  key: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  codeSigned: boolean;
  publishedAt: string;
  minimumWindows: string;
  notes?: string;
}

/** The published build, or null when nothing has been published yet. */
export async function readManifest(): Promise<DesktopManifest | null> {
  if (!storageConfigured()) return null;
  try {
    const bytes = await getObjectBytes(MANIFEST_KEY);
    return JSON.parse(new TextDecoder().decode(bytes)) as DesktopManifest;
  } catch {
    // A missing manifest means nothing has been published, which is a state
    // the download page renders rather than an error worth a 500.
    return null;
  }
}

export async function GET() {
  const manifest = await readManifest();

  if (!manifest) {
    return NextResponse.json(
      { error: "No Windows build has been published yet." },
      { status: 404 }
    );
  }

  try {
    const object = await getObjectStream(manifest.key);

    return new NextResponse(object.body, {
      headers: {
        "content-type": "application/x-msi",
        // Both quoted forms, so a filename with a space survives every browser.
        "content-disposition": `attachment; filename="${manifest.fileName}"`,
        ...(object.contentLength
          ? { "content-length": String(object.contentLength) }
          : {}),
        // Published so a download can be verified against the page. The
        // installer is not code-signed, so this is the only way somebody can
        // tell a genuine copy from a substituted one.
        "x-content-sha256": manifest.sha256,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("Desktop download failed:", error);
    return NextResponse.json(
      { error: "The installer could not be read from storage." },
      { status: 502 }
    );
  }
}
