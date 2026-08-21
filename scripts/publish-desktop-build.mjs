#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Publishes the Windows desktop build to object storage
// ═══════════════════════════════════════════════════════════════
//
// Uploads the installer and a manifest describing it. The download page and
// the download route both read the manifest rather than guessing a filename,
// so publishing a new build is one upload and the site follows.
//
// ─── On the bucket ───
//
// The same bucket holds signed letters and payslips, and it is private: the
// app reads objects server-side and there is no public URL anywhere in
// `object-store.ts`. That stays true here. Making the bucket public so an
// installer could be linked directly would put every employee's payslip one
// guessed key away, which is not a trade worth 100MB of egress.
//
// ─── On the checksum ───
//
// Published because the installer is not code-signed. Windows will warn about
// an unknown publisher, and a checksum is the only way somebody can tell a
// genuine download from a corrupted or substituted one. It is computed here
// from the exact bytes uploaded, not from a file that was built separately.
//
//   node scripts/publish-desktop-build.mjs [--dry-run]

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");

// .env.local, the same file the app reads. Loaded by hand because this runs
// outside Next.
for (const file of [".env.local", ".env"]) {
  const at = path.join(root, file);
  if (!existsSync(at)) continue;
  for (const line of readFileSync(at, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const KEY_PREFIX = "downloads/windows";

/**
 * Which installer to publish.
 *
 * These used to be hardcoded to 1.0.0, which meant running this script after
 * building a new version silently re-uploaded the *previous* installer and
 * pointed the download page back at it. It looked like it worked — it printed
 * a size, a checksum and "Done" — while shipping the wrong build.
 *
 * So the version is now required, and the file must exist. Guessing either of
 * them is how the original bug happened.
 */
function readArg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 ? process.argv[at + 1] : undefined;
}

const VERSION = readArg("version");
if (!VERSION || !/^\d+\.\d+\.\d+$/.test(VERSION)) {
  console.error(
    "Usage: node scripts/publish-desktop-build.mjs --version <x.y.z> [--file <path>] [--dry-run]\n" +
      "The version is required so that a stale installer cannot be published by default."
  );
  process.exit(1);
}

const MSI = readArg("file")
  ? path.resolve(root, readArg("file"))
  : path.join(root, "android", "release-artifacts", `CircuventHR-Windows-${VERSION}.msi`);

if (!existsSync(MSI)) {
  console.error(`No installer at ${MSI}. Build it first, or pass --file.`);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. Object storage is not configured.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  if (!existsSync(MSI)) {
    console.error(`No installer at ${MSI}`);
    console.error("Build it first: gradlew :desktop:packageReleaseMsi");
    process.exit(1);
  }

  const bytes = await readFile(MSI);
  const info = await stat(MSI);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const key = `${KEY_PREFIX}/CircuventHR-Windows-${VERSION}.msi`;
  const manifest = {
    product: "Circuvent HR for Windows",
    version: VERSION,
    key,
    fileName: `CircuventHR-Windows-${VERSION}.msi`,
    sizeBytes: info.size,
    sha256,
    // Whether the bytes carry an Authenticode signature. Stated rather than
    // implied: the download page tells people what Windows will say, and that
    // sentence has to be true.
    codeSigned: false,
    publishedAt: new Date().toISOString(),
    minimumWindows: "Windows 10 (64-bit)",
    notes: "Includes its own Java runtime. Nothing else needs installing.",
  };

  console.log(`installer  ${path.basename(MSI)}`);
  console.log(`size       ${(info.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`sha256     ${sha256}`);
  console.log(`key        ${key}`);

  if (dryRun) {
    console.log("\n--dry-run: nothing uploaded.");
    return;
  }

  const endpoint = requireEnv("S3_ENDPOINT");
  const bucket = requireEnv("S3_BUCKET");
  const client = new S3Client({
    region: process.env.S3_REGION?.trim() || "auto",
    endpoint,
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: "application/x-msi",
      // Not a browser-cacheable public asset — it is streamed through a route
      // that sets its own headers.
      CacheControl: "no-store",
    })
  );
  console.log(`\nuploaded   ${key}`);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${KEY_PREFIX}/latest.json`,
      Body: Buffer.from(JSON.stringify(manifest, null, 2)),
      ContentType: "application/json",
      CacheControl: "no-store",
    })
  );
  console.log(`uploaded   ${KEY_PREFIX}/latest.json`);
  console.log("\nDone. /download will pick this up on its next request.");
}

main().catch((error) => {
  console.error("Publish failed:", error?.message ?? error);
  process.exit(1);
});
