// ═══════════════════════════════════════════════════════════════
// DOCUMENT PDF STORAGE OUTBOX
// ═══════════════════════════════════════════════════════════════
// A signature is final the instant `documentSignatures.signedAt` is written —
// that happens inside `NeonDocumentsRepository.sign()`, in the same
// transaction as the envelope reaching "completed". Turning that into a
// stored, downloadable PDF is a second step that talks to R2, and R2 can be
// unreachable for reasons that have nothing to do with whether the signature
// is valid. If that second step were just a best-effort call made from
// inside the signing request, a person who signed successfully could still
// be told (or have it silently become true) that their document was never
// archived — which is the one outcome this whole feature exists to prevent.
//
// So this mirrors `paystub-sync-outbox.ts` exactly: a durable row records the
// intent to render-and-upload, an immediate attempt is made once outside the
// signing transaction, and anything left `pending`/`failed` is retried by
// `drainDueDocumentPdfStorage` from the same cron sweep that already drains
// the other two outboxes. A document never gets soft-deleted or reassigned
// the way an employee can be, so there is no "retire" case here — the
// `ON DELETE CASCADE` on `document_id` is all the cleanup a deleted document
// needs, and it removes the outbox row before it could ever be drained again.

import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { documentPdfStorageOutbox, documentSignatures, generatedDocuments } from "@/db/schema/talent";
import { loadOrgIdentity } from "@/db/repositories/org-identity";
import { renderDocumentPdf, type DocumentPdfSignatory } from "@/lib/documents/render-pdf";
import { documentPdfKey, putObject, sha256Hex } from "@/lib/storage/object-store";

type TenantTx = Parameters<Parameters<typeof withTenant>[1]>[0];

export interface DocumentPdfAttemptResult {
  ok: boolean;
  /** The object key just written, present only when `ok`. */
  key?: string;
  error?: string;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // `StorageRequestError`/`StorageConfigError` already carry no credentials —
  // R2's client throws its own errors as `cause`, which this deliberately
  // never reads into a stored string — but a very long message (a stack
  // trace masquerading as a message from some other library) still should
  // not blow out a text column meant for a one-line diagnosis.
  return message.slice(0, 500);
}

/**
 * How long to wait before trying again, doubling each time to a ceiling.
 *
 * Byte-identical to `paystubRetryDelayMinutes` and `retryDelayMinutes` in
 * `onboarding-groups.ts` for the same reason those two are kept in step with
 * each other: three outboxes backing off differently for no functional
 * reason is a bug waiting to be noticed by whoever is on call when only one
 * of them is retrying every minute.
 */
export function documentPdfRetryDelayMinutes(attemptCount: number): number {
  return Math.min(60 * 24, 2 ** Math.min(attemptCount, 10));
}

function retryAt(attemptCount: number): Date {
  return new Date(Date.now() + documentPdfRetryDelayMinutes(attemptCount) * 60_000);
}

/**
 * Records the durable intent to render and store a document's PDF.
 *
 * Called from inside the same transaction that marks the envelope
 * "completed", so the intent can never be lost even if the process is killed
 * before the render-and-upload (which happens afterwards, outside this
 * transaction) ever runs. The unique index on `(org_id, document_id)` makes
 * this safe to call more than once for the same document — a retry, or a
 * concurrent request that also observed completion — by reopening the same
 * row rather than racing two uploads of the same content.
 */
export async function queueDocumentPdfStorage(
  tx: TenantTx,
  orgId: string,
  documentId: string
): Promise<void> {
  await tx
    .insert(documentPdfStorageOutbox)
    .values({
      orgId,
      documentId,
      status: "pending",
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [documentPdfStorageOutbox.orgId, documentPdfStorageOutbox.documentId],
      set: {
        status: "pending",
        nextAttemptAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Marks the outbox row succeeded and points `generatedDocuments.blobUrl` at
 * the object that was just written — in the same transaction, so the two
 * facts ("the PDF is stored" and "here is where") can never disagree.
 *
 * `blobUrl` holds the R2 object *key*, not a public URL: the bucket is
 * private, and a signed document must only ever leave R2 through the
 * authorised staff download route, which checks permissions before calling
 * `getObjectBytes`. Naming the column stays as `blobUrl` (matching the
 * schema already shipped for this feature) rather than renaming it to
 * `blobKey`, since a rename is a migration for no behavioural gain.
 */
async function recordSuccess(ctx: TenantContext, documentId: string, key: string): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx
      .update(generatedDocuments)
      .set({ blobUrl: key })
      .where(eq(generatedDocuments.id, documentId));

    await tx
      .update(documentPdfStorageOutbox)
      .set({
        status: "succeeded",
        attemptCount: sql`${documentPdfStorageOutbox.attemptCount} + 1`,
        lastError: null,
        lastAttemptAt: new Date(),
        nextAttemptAt: null,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(documentPdfStorageOutbox.documentId, documentId));
  });
}

async function recordFailure(
  ctx: TenantContext,
  documentId: string,
  attemptCount: number,
  error: string
): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx
      .update(documentPdfStorageOutbox)
      .set({
        status: "failed",
        attemptCount: sql`${documentPdfStorageOutbox.attemptCount} + 1`,
        lastError: error,
        lastAttemptAt: new Date(),
        nextAttemptAt: retryAt(attemptCount + 1),
        updatedAt: new Date(),
      })
      .where(eq(documentPdfStorageOutbox.documentId, documentId));
  });
}

/** Everything needed to render one document's PDF, already resolved — no `ctx`, no DB. */
export interface DocumentPdfSource {
  documentId: string;
  orgId: string;
  title: string;
  companyName: string;
  renderedBody: string;
  signatories: DocumentPdfSignatory[];
}

/**
 * Renders and uploads a document's PDF from already-loaded data, recording
 * exactly one outcome through the injected `save` callbacks.
 *
 * Deliberately takes no `ctx` and calls no `withTenant`: everything it needs
 * is already in `source`, and the only side effects it can have are the ones
 * `deps.render`/`deps.upload`/`deps.hash` and `save.success`/`save.failure`
 * choose to have. That is what makes "a signature that fails to upload",
 * "storage is not configured" and "the key never contains a person's typed
 * title" testable in isolation, without a Postgres connection — exactly the
 * split `deliverPaystubEmployeeSync` makes for the same reason.
 */
export async function deliverDocumentPdfStorage(
  source: DocumentPdfSource,
  save: {
    success(key: string): Promise<void>;
    failure(error: string): Promise<void>;
  },
  deps: {
    render?: typeof renderDocumentPdf;
    upload?: typeof putObject;
    hash?: typeof sha256Hex;
  } = {}
): Promise<DocumentPdfAttemptResult> {
  const render = deps.render ?? renderDocumentPdf;
  const upload = deps.upload ?? putObject;
  const hash = deps.hash ?? sha256Hex;

  try {
    const pdfBytes = await render({
      title: source.title,
      companyName: source.companyName,
      bodyHtmlOrText: source.renderedBody,
      signingReference: source.documentId,
      signatories: source.signatories,
    });

    const digest = await hash(pdfBytes);
    // Built from the hash of the PDF's own bytes plus server-assigned ids —
    // never from `source.title`, which is the one field here a person chose
    // the wording of. See `documentPdfKey`'s own comment for why that matters.
    const key = documentPdfKey({ orgId: source.orgId, documentId: source.documentId, sha256Hex: digest });

    // Nothing is recorded as stored until this resolves. If it throws (R2
    // unreachable, or `StorageConfigError` when unconfigured), the catch
    // below records a failure and `save.success` is never called.
    await upload(key, pdfBytes, "application/pdf");

    await save.success(key);
    return { ok: true, key };
  } catch (error) {
    const message = safeErrorMessage(error);
    await save.failure(message);
    return { ok: false, error: message };
  }
}

/** The pieces `attemptDocumentPdfStorage` needs, gathered from a tenant-scoped read. */
interface LoadedAttempt {
  source: DocumentPdfSource;
  attemptCount: number;
}

async function loadSource(
  ctx: TenantContext,
  documentId: string,
  loadIdentity: typeof loadOrgIdentity
): Promise<LoadedAttempt | null> {
  const row = await withTenant(ctx, async (tx) => {
    const [document] = await tx
      .select()
      .from(generatedDocuments)
      .where(eq(generatedDocuments.id, documentId))
      .limit(1);
    if (!document) return null;

    const slots = await tx
      .select()
      .from(documentSignatures)
      .where(eq(documentSignatures.documentId, documentId))
      .orderBy(asc(documentSignatures.sequence));

    const [outboxRow] = await tx
      .select({ attemptCount: documentPdfStorageOutbox.attemptCount })
      .from(documentPdfStorageOutbox)
      .where(eq(documentPdfStorageOutbox.documentId, documentId))
      .limit(1);

    return { document, slots, attemptCount: outboxRow?.attemptCount ?? 0 };
  });

  if (!row) return null;

  // A tenant whose org row cannot be loaded is not something the FK on
  // `generatedDocuments.orgId` (`ON DELETE CASCADE`) should ever allow to
  // happen — but "should not happen" is exactly the case this whole module
  // exists to not paper over. Treated the same as "document not found":
  // no outbox row exists to record a failure against yet if this is the
  // very first attempt, so there is nothing to update, only an honest
  // result to return.
  const identity = await loadIdentity(ctx);
  if (!identity) return null;

  // Only slots that actually signed become signatories: `DocumentPdfSignatory`
  // requires a `signedAt`, and a declined or still-open slot has none —
  // reproducing exactly what `envelopeStatus` already means by "completed".
  const signatories: DocumentPdfSignatory[] = row.slots
    .filter((s): s is typeof s & { signedAt: Date } => s.signedAt !== null)
    .map((s) => ({
      name: s.signatoryName?.trim() || s.signatoryEmail,
      role: s.signatoryRole,
      signedAt: s.signedAt,
      signatureImageDataUrl: s.signatureImageUrl ?? undefined,
    }));

  return {
    source: {
      documentId,
      orgId: ctx.orgId,
      title: row.document.title,
      companyName: identity.name,
      renderedBody: row.document.renderedBody ?? "",
      signatories,
    },
    attemptCount: row.attemptCount,
  };
}

/**
 * Loads a document's current state, then renders and uploads its PDF,
 * recording exactly one outcome either way.
 *
 * Does not check whether an attempt is "due" — that is `drainDueDocumentPdfStorage`'s
 * job when sweeping a batch. This can be, and is, called directly for the
 * first attempt right after signing, exactly like `attemptPaystubEmployeeSync`.
 */
export async function attemptDocumentPdfStorage(
  ctx: TenantContext,
  documentId: string,
  deps: {
    render?: typeof renderDocumentPdf;
    upload?: typeof putObject;
    hash?: typeof sha256Hex;
    loadIdentity?: typeof loadOrgIdentity;
  } = {}
): Promise<DocumentPdfAttemptResult> {
  const loadIdentity = deps.loadIdentity ?? loadOrgIdentity;

  const loaded = await loadSource(ctx, documentId, loadIdentity);
  if (!loaded) {
    return { ok: false, error: `Document ${documentId} was not found for PDF storage.` };
  }

  return deliverDocumentPdfStorage(
    loaded.source,
    {
      success: (key) => recordSuccess(ctx, documentId, key),
      failure: (error) => recordFailure(ctx, documentId, loaded.attemptCount, error),
    },
    deps
  );
}

/**
 * Fire-and-forget wrapper for the first attempt, called right after the
 * signing transaction commits.
 *
 * Never throws: a slow or unreachable R2 must not turn into a 500 for the
 * person who just signed, since the intent already survived in the outbox
 * row written inside that same transaction. `drainDueDocumentPdfStorage`
 * picks up whatever this attempt does not finish.
 */
export async function queueAndAttemptDocumentPdfStorage(
  ctx: TenantContext,
  documentId: string
): Promise<void> {
  const result = await attemptDocumentPdfStorage(ctx, documentId);
  if (!result.ok) {
    console.warn("[document-pdf] PDF storage attempt failed; intent remains in the outbox.", {
      orgId: ctx.orgId,
      documentId,
    });
  }
}

export interface DocumentPdfDrainResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Retries every PDF storage attempt that is due, for one tenant.
 *
 * Due means a retry was actually scheduled and that time has passed. A null
 * `next_attempt_at` is deliberately *not* due: that is how a succeeded row
 * says it wants nothing further, so a completed upload is never re-attempted
 * by the sweep just because it is still sitting in the table.
 */
export async function drainDueDocumentPdfStorage(
  ctx: TenantContext,
  limit = 50
): Promise<DocumentPdfDrainResult> {
  const now = new Date();

  const due = await withTenant(ctx, async (tx) =>
    tx
      .select({ documentId: documentPdfStorageOutbox.documentId })
      .from(documentPdfStorageOutbox)
      .where(
        and(
          eq(documentPdfStorageOutbox.orgId, ctx.orgId),
          inArray(documentPdfStorageOutbox.status, ["pending", "failed"]),
          isNotNull(documentPdfStorageOutbox.nextAttemptAt),
          lte(documentPdfStorageOutbox.nextAttemptAt, now)
        )
      )
      .limit(limit)
  );

  const result: DocumentPdfDrainResult = { attempted: 0, succeeded: 0, failed: 0 };

  for (const row of due) {
    result.attempted++;
    const attempt = await attemptDocumentPdfStorage(ctx, row.documentId);
    if (attempt.ok) result.succeeded++;
    else result.failed++;
  }

  return result;
}
