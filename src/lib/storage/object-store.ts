// ═══════════════════════════════════════════════════════════════
// OBJECT STORAGE (Cloudflare R2, S3-compatible)
// ═══════════════════════════════════════════════════════════════
// Where a signed document's rendered PDF actually lives. R2 was chosen over
// storing bytes in Postgres because a few hundred signed PDFs at a few
// hundred KB each would bloat `generated_documents` and its backups for no
// reason the database needs; R2 is billed for egress at zero, so there is no
// cost trade-off either.
//
// This module deliberately does NOT follow `mailer.ts`'s "unconfigured means
// return false and log" convention. An email that silently fails to send is
// merely annoying — the recipient asks again. A signed document that silently
// fails to store is a legal record that no longer exists anywhere, and the
// signatory has no way to know that and no reason to sign again. So every
// function here throws when storage is not configured or a request fails;
// there is no return value that could be mistaken for success.

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";

/**
 * Thrown when R2 credentials are missing, instead of quietly no-op'ing.
 *
 * A caller that catches this and moves on is choosing to lose the document;
 * that choice must be explicit, not something that falls out of an `if`
 * silently doing nothing.
 */
export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

/** Thrown when R2 itself rejects or fails a request that was correctly formed. */
export class StorageRequestError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "StorageRequestError";
  }
}

interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Reads config from `process.env` on every call rather than at module load.
 *
 * Importing this module (transitively, e.g. from a route that also imports
 * something storage-adjacent) must never throw just because a test runner or
 * a build step has not populated `.env.local` — only actually *using* the
 * store should be able to fail on missing configuration.
 */
function readConfig(): StorageConfig | null {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  // R2 has no notion of AWS regions; "auto" is Cloudflare's documented value
  // and what the SDK needs to see to sign requests without complaint.
  const region = process.env.S3_REGION?.trim() || "auto";

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

function requireConfig(): StorageConfig {
  const config = readConfig();
  if (!config) {
    throw new StorageConfigError(
      "Object storage is not configured; refusing to report success for a document that was never stored. " +
        "Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY."
    );
  }
  return config;
}

/** Lets a caller check configuration up front (e.g. a health check) without triggering a throw. */
export function storageConfigured(): boolean {
  return readConfig() !== null;
}

let cachedClient: S3Client | null = null;
let cachedClientKey: string | null = null;

/**
 * One client per distinct configuration, not one per call.
 *
 * Keyed on the values that shape the client (not just "is it configured"), so
 * that tests which swap `process.env` between cases — or a real credential
 * rotation — get a client built against the values in effect now, rather than
 * a stale one built the first time this module happened to run.
 */
function clientFor(config: StorageConfig): S3Client {
  const key = `${config.endpoint}|${config.region}|${config.accessKeyId}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;

  cachedClient = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // R2's endpoint is account-scoped, not bucket-scoped, so the bucket must
    // go in the path (`endpoint/bucket/key`). Without this the SDK defaults
    // to virtual-hosted addressing (`bucket.endpoint/key`), which R2 does not
    // serve for a plain account endpoint and every request would 404.
    forcePathStyle: true,
  });
  cachedClientKey = key;
  return cachedClient;
}

export interface ObjectStore {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getObjectBytes(key: string): Promise<Uint8Array>;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const config = requireConfig();
  const client = clientFor(config);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  } catch (error) {
    throw new StorageRequestError(`Could not upload "${key}" to object storage.`, error);
  }
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const config = requireConfig();
  const client = clientFor(config);
  let body: GetObjectCommandOutput["Body"];
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    body = result.Body;
  } catch (error) {
    throw new StorageRequestError(`Could not download "${key}" from object storage.`, error);
  }
  if (!body) {
    throw new StorageRequestError(`Object storage returned no content for "${key}".`);
  }
  // Buffers the whole object in memory. Fine for a document-sized PDF (tens
  // to low hundreds of KB) and far simpler than piping a Node stream through
  // an API route response, which is the only reason to avoid it here.
  return body.transformToByteArray();
}

export const r2ObjectStore: ObjectStore = { putObject, getObjectBytes };

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Builds the storage key for a signed document's PDF.
 *
 * Deliberately takes no filename, title, or anything else a person typed.
 * `orgId` and `documentId` are server-assigned identifiers already trusted
 * throughout this codebase (never taken raw off a request body), and the
 * final segment is the SHA-256 of the PDF's own bytes — so the only way to
 * predict a key is to already possess the exact file it names. A title like
 * `../../../etc/passwd` or one containing a path separator or null byte
 * cannot influence this key, because no title is ever read by this function.
 */
export function documentPdfKey(params: { orgId: string; documentId: string; sha256Hex: string }): string {
  if (!SHA256_HEX_PATTERN.test(params.sha256Hex)) {
    throw new Error(`documentPdfKey requires a 64-character lowercase hex SHA-256; got "${params.sha256Hex}".`);
  }
  return `documents/${params.orgId}/${params.documentId}/${params.sha256Hex}.pdf`;
}

/** SHA-256 of arbitrary bytes, hex-encoded the same way `document-rules.ts` hashes document content. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `.slice()` copies into a freshly allocated, exactly-sized ArrayBuffer.
  // `bytes` may be a `Uint8Array` whose declared buffer type is the broader
  // `ArrayBufferLike` (any view a caller such as pdf-lib's `.save()` hands
  // back), which `SubtleCrypto.digest` does not accept; the copy is cheap
  // next to hashing a whole PDF and needs no unsafe cast to satisfy it.
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
