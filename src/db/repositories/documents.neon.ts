// ═══════════════════════════════════════════════════════════════
// DOCUMENTS REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Template rendering, envelope dispatch and signature collection. The rules
// live in src/lib/document-rules.ts so they test without a database.
//
// The signing path is the unusual one here: a candidate signing an offer has
// no account and no session. They are authenticated solely by a single-use
// token in the emailed link, which is why that token is stored hashed and
// compared in constant time.

import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { departments, employees } from "@/db/schema/hrms";
import { applyCompanyLogo, resolveCompanyLogoUrl } from "@/lib/document-templates/branding";
import { identityTokens, letterDefaultTokens, loadOrgIdentity, loadOrgLetterDefaults } from "./org-identity";
import {
  documentSignatures,
  documentTemplates,
  generatedDocuments,
} from "@/db/schema/talent";
import {
  buildSlots,
  canSign,
  createAccessToken,
  envelopeStatus,
  extractTokens,
  hashContent,
  hashToken,
  render,
  timingSafeEqualHex,
  validateTemplate,
  verifyIntegrity,
  type EnvelopeStatus,
  type SignatureSlot,
  type TemplateDefinition,
  type TokenValues,
} from "@/lib/document-rules";
import {
  queueAndAttemptDocumentPdfStorage,
  queueDocumentPdfStorage,
} from "@/lib/document-pdf-outbox";
import { NotFoundError, RepositoryError } from "./types";

export interface TemplateRecord {
  id: string;
  name: string;
  category: string;
  body: string;
  tokens: string[];
  requiresSignature: boolean;
  signatoryRoles: string[];
  version: number;
  isActive: boolean;
}

export interface DocumentRecord {
  id: string;
  title: string;
  category: string;
  status: EnvelopeStatus;
  employeeId?: string;
  candidateId?: string;
  renderedBody?: string;
  contentHash?: string;
  /** R2 object key for the archived PDF, once `document-pdf-outbox.ts` has stored it — not a public URL. */
  blobUrl?: string;
  sentAt?: string;
  completedAt?: string;
  expiresAt?: string;
  signatures: {
    id: string;
    role: string;
    email: string;
    name?: string;
    sequence: number;
    viewedAt?: string;
    signedAt?: string;
    declinedAt?: string;
    declineReason?: string;
  }[];
}

/**
 * The outcome of a signing action, and who took it.
 *
 * `sign` and `decline` used to return the document alone, which meant the
 * route had to work out afterwards which of the signatories had just acted —
 * and there is no reliable way to do that from the record. Comparing
 * `signedAt` timestamps picks the wrong slot when two people sign in the same
 * second, and a decline sets no timestamp the route can see at all.
 *
 * The repository already resolved the token to exactly one slot in order to do
 * the work. Returning it costs nothing and removes the guess.
 */
export interface SignedResult {
  document: DocumentRecord;
  signatory: { email: string; role: string; name?: string };
}

export interface GenerateRequest {
  templateId: string;
  employeeId?: string;
  candidateId?: string;
  title?: string;
  /** Values for tokens the employee record cannot supply, e.g. an offer figure. */
  extraValues?: TokenValues;
  recipients?: Record<string, { email: string; name?: string }>;
  /** Days until the signing request lapses. */
  expiresInDays?: number;
}

function toDefinition(row: typeof documentTemplates.$inferSelect): TemplateDefinition {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    body: row.body,
    requiredTokens: (row.requiredTokens as string[]) ?? [],
    requiresSignature: row.requiresSignature,
    signatoryRoles: (row.signatoryRoles as string[]) ?? [],
    version: row.version,
  };
}

function toSlots(rows: (typeof documentSignatures.$inferSelect)[]): SignatureSlot[] {
  return rows.map((r) => ({
    signatoryEmail: r.signatoryEmail,
    signatoryRole: r.signatoryRole,
    sequence: r.sequence,
    viewedAt: r.viewedAt?.toISOString(),
    signedAt: r.signedAt?.toISOString(),
    declinedAt: r.declinedAt?.toISOString(),
  }));
}

export class NeonDocumentsRepository {
  constructor(private readonly ctx: TenantContext) {}

  /**
   * Resolves which organization a signing link belongs to.
   *
   * A candidate has no session and therefore no tenant context, but every
   * other query in this file must still run under RLS. This is the one
   * deliberate exception: a single lookup that returns nothing but an org id,
   * so the caller can build a proper tenant context and do the real work
   * inside it.
   *
   * Kept as narrow as it is on purpose. Running the whole signing flow as a
   * superuser would mean a bug in the token comparison could read across every
   * tenant rather than failing to find a row.
   */
  static async resolveSigningOrg(documentId: string): Promise<string | null> {
    const rows = await withTenant({ orgId: "", superuser: true }, async (tx) =>
      tx
        .select({ orgId: generatedDocuments.orgId })
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, documentId))
        .limit(1)
    );

    return rows[0]?.orgId ?? null;
  }

  async listTemplates(): Promise<TemplateRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.isActive, true))
        .orderBy(asc(documentTemplates.category), asc(documentTemplates.name));

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        body: r.body,
        // Derived from the body rather than trusting the stored list, which
        // goes stale the moment someone edits the template.
        tokens: extractTokens(r.body),
        requiresSignature: r.requiresSignature,
        signatoryRoles: (r.signatoryRoles as string[]) ?? [],
        version: r.version,
        isActive: r.isActive,
      }));
    });
  }

  /**
   * Creates or revises a template.
   *
   * Editing bumps the version rather than overwriting, because a generated
   * document records the version it used and must remain reproducible.
   */
  async saveTemplate(input: {
    id?: string;
    name: string;
    category: string;
    body: string;
    requiresSignature?: boolean;
    signatoryRoles?: string[];
  }): Promise<TemplateRecord> {
    const tokens = extractTokens(input.body);

    return withTenant(this.ctx, async (tx) => {
      if (input.id) {
        const [existing] = await tx
          .select()
          .from(documentTemplates)
          .where(eq(documentTemplates.id, input.id))
          .for("update")
          .limit(1);

        if (!existing) throw new NotFoundError("Template", input.id);

        const [updated] = await tx
          .update(documentTemplates)
          .set({
            name: input.name,
            category: input.category,
            body: input.body,
            requiredTokens: tokens,
            requiresSignature: input.requiresSignature ?? existing.requiresSignature,
            signatoryRoles: input.signatoryRoles ?? (existing.signatoryRoles as string[]),
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(documentTemplates.id, input.id))
          .returning();

        return {
          id: updated.id,
          name: updated.name,
          category: updated.category,
          body: updated.body,
          tokens,
          requiresSignature: updated.requiresSignature,
          signatoryRoles: (updated.signatoryRoles as string[]) ?? [],
          version: updated.version,
          isActive: updated.isActive,
        };
      }

      const [created] = await tx
        .insert(documentTemplates)
        .values({
          orgId: this.ctx.orgId,
          name: input.name,
          category: input.category,
          body: input.body,
          requiredTokens: tokens,
          requiresSignature: input.requiresSignature ?? false,
          signatoryRoles: input.signatoryRoles ?? [],
        })
        .returning();

      return {
        id: created.id,
        name: created.name,
        category: created.category,
        body: created.body,
        tokens,
        requiresSignature: created.requiresSignature,
        signatoryRoles: (created.signatoryRoles as string[]) ?? [],
        version: created.version,
        isActive: created.isActive,
      };
    });
  }

  /**
   * Renders a document from a template.
   *
   * The rendered body and its hash are frozen here. A document that re-renders
   * on read would change when the employee's record changes, and a signature
   * on it would attest to text that no longer exists.
   */
  async generate(request: GenerateRequest, generatedById: string): Promise<DocumentRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [templateRow] = await tx
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.id, request.templateId))
        .limit(1);

      if (!templateRow) throw new NotFoundError("Template", request.templateId);
      if (!templateRow.isActive) {
        throw new RepositoryError("This template has been retired", 409);
      }

      const template = toDefinition(templateRow);

      // Tenant identity first, so `extraValues` can still override it for a
      // company that issues from more than one registered entity — but a
      // caller that says nothing gets its own name rather than a 422 or, worse,
      // whatever name the caller happened to send.
      const identity = await loadOrgIdentity(this.ctx);

      let values: TokenValues = {
        // No document in the catalog can be issued undated, and unlike
        // identity or employee data there is no record this could be read
        // from — "today" is the only honest default. It sat unresolved here
        // (employeeTokens() below computes the same date but under the key
        // "today", not "issue_date", so it never satisfied this token), which
        // 422'd every template that has {{issue_date}}, including the offer
        // letter, before a single value was ever supplied. `extraValues` can
        // still override it for a letter deliberately dated to when the
        // offer was decided rather than when it was rendered.
        issue_date: new Date().toISOString().slice(0, 10),
        ...(identity ? identityTokens(identity) : {}),
        ...request.extraValues,
      };
      if (request.employeeId) {
        values = { ...(await this.employeeTokens(tx, request.employeeId)), ...values };
      }

      // The organisation's standing answers, underneath everything else.
      //
      // Who signs a joining letter, where somebody reports and at what time
      // are the same for every hire in a company but appear on no record, so
      // every one of these letters used to fail with a list of unresolved
      // tokens. Lowest precedence deliberately: a specific letter overrides
      // any of them through `extraValues`, and an employee's own fields are
      // more specific still.
      values = { ...letterDefaultTokens(await loadOrgLetterDefaults(this.ctx)), ...values };

      // The document's own id, decided here rather than by the insert.
      //
      // `document_reference` is a token: it has to exist before the body is
      // rendered, and the body has to be final before its hash is taken. A
      // reference derived from a counter would either need a sequence nobody
      // has written or a count taken inside this transaction, which two
      // concurrent issues would read identically and both use. Deriving it
      // from the row's own identifier is unique by construction and needs no
      // coordination — and quoting the year keeps it readable to whoever has
      // to find the letter again.
      const documentId = randomUUID();
      values.document_reference =
        values.document_reference ??
        `HR/${new Date().getUTCFullYear()}/${documentId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

      // A company registration number is required on a contract issued by a
      // company that has one, and does not exist for a partnership, a sole
      // proprietorship or a foreign entity. Requiring it unconditionally
      // blocked every letter a newly registered tenant tried to issue, with
      // a 422 naming a token; fabricating one would put a false statutory
      // identifier on a signed contract, which is the specific harm the
      // template catalog was written to avoid.
      //
      // So it renders as blank when the organisation has not set one. The
      // letterhead loses a line; nothing untrue is printed.
      const optionalTokens = ["company_registration"];
      const validation = validateTemplate(template, values, { optional: optionalTokens });
      if (!validation.valid) {
        throw new RepositoryError(
          `${validation.reason}: ${validation.missing.join(", ")}`,
          422
        );
      }

      const { body: renderedText, missing: unresolvedOptional } = render(template.body, values);
      // render() leaves `{{token}}` in place for anything it can't resolve —
      // right for a preview (see previewTemplate() in
      // lib/document-templates/validation.ts), wrong here: validateTemplate()
      // above has already guaranteed every *required* token resolved, so
      // anything still in `unresolvedOptional` is one of `optionalTokens`
      // that this tenant has never set. Left alone, that is raw template
      // syntax baked into a signed contract — exactly the "nothing untrue is
      // printed" comment above promised would not happen, but the promise
      // was never kept: render() has no notion of "optional" and always
      // leaves the placeholder text, it never blanks it. Stripping those
      // specific placeholders here is what actually keeps that promise.
      const blankedText = unresolvedOptional.reduce(
        (text, token) => text.split(`{{${token}}}`).join(""),
        renderedText
      );
      // Resolved here, once, rather than substituted as a `{{token}}` — see
      // `letter-kit.mjs`'s header comment for why a raw token can't do this
      // safely (render() has no conditionals, so a tenant with no logo would
      // get a literal broken `<img>` baked into a signed contract). The
      // marker `letterhead()`/`emailOpen()` leave behind is an HTML comment,
      // invisible to `extractTokens()`, so it never shows up as a missing
      // token either. Resolving before the hash is taken, not on every read,
      // means a signature attests to the masthead the signatory actually saw.
      const body = applyCompanyLogo(blankedText, resolveCompanyLogoUrl(identity?.logoUrl));
      const contentHash = await hashContent(body);

      const expiresAt = request.expiresInDays
        ? new Date(Date.now() + request.expiresInDays * 86_400_000)
        : undefined;

      const [document] = await tx
        .insert(generatedDocuments)
        .values({
          id: documentId,
          orgId: this.ctx.orgId,
          templateId: template.id,
          templateVersion: template.version,
          employeeId: request.employeeId,
          candidateId: request.candidateId,
          title: request.title ?? template.name,
          category: template.category,
          renderedBody: body,
          contentHash,
          generatedById,
          expiresAt,
        })
        .returning();

      if (template.requiresSignature) {
        const slots = buildSlots(template.signatoryRoles, request.recipients ?? {});
        await tx.insert(documentSignatures).values(
          slots.map((s) => ({
            orgId: this.ctx.orgId,
            documentId: document.id,
            signatoryEmail: s.signatoryEmail,
            signatoryName: s.signatoryName,
            signatoryRole: s.signatoryRole,
            sequence: s.sequence,
          }))
        );
      }

      return (await this.getIn(tx, document.id))!;
    });
  }

  /**
   * Sends a document for signature, issuing one single-use link per signatory.
   *
   * Returns the plaintext tokens exactly once, for the caller to put in the
   * emails. They are stored hashed, so a leaked database does not hand over
   * working signing links for every outstanding contract.
   */
  async send(
    documentId: string
  ): Promise<{ document: DocumentRecord; links: { email: string; role: string; token: string }[] }> {
    return withTenant(this.ctx, async (tx) => {
      const [document] = await tx
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, documentId))
        .for("update")
        .limit(1);

      if (!document) throw new NotFoundError("Document", documentId);
      if (document.status !== "draft") {
        throw new RepositoryError(`This document is already ${document.status}`, 409);
      }

      const slots = await tx
        .select()
        .from(documentSignatures)
        .where(eq(documentSignatures.documentId, documentId))
        .orderBy(asc(documentSignatures.sequence));

      if (slots.length === 0) {
        throw new RepositoryError("This document has no signatories", 400);
      }

      const links: { email: string; role: string; token: string }[] = [];

      for (const slot of slots) {
        const { token, hash } = await createAccessToken();
        await tx
          .update(documentSignatures)
          .set({ accessTokenHash: hash })
          .where(eq(documentSignatures.id, slot.id));

        links.push({ email: slot.signatoryEmail, role: slot.signatoryRole, token });
      }

      await tx
        .update(generatedDocuments)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(generatedDocuments.id, documentId));

      return { document: (await this.getIn(tx, documentId))!, links };
    });
  }

  /**
   * Resolves a signing link to the document behind it.
   *
   * The only authentication a candidate has. The token is compared against the
   * stored hash in constant time, and the document body is returned with its
   * hash so the signature can attest to exactly these bytes.
   */
  async openForSigning(
    documentId: string,
    token: string
  ): Promise<{
    document: DocumentRecord;
    signatory: { id: string; email: string; role: string; name?: string };
    canSignNow: boolean;
    reason?: string;
  }> {
    const presented = await hashToken(token);

    return withTenant(this.ctx, async (tx) => {
      const slots = await tx
        .select()
        .from(documentSignatures)
        .where(eq(documentSignatures.documentId, documentId))
        .orderBy(asc(documentSignatures.sequence));

      const slot = slots.find(
        (s) => s.accessTokenHash && timingSafeEqualHex(s.accessTokenHash, presented)
      );

      // Deliberately the same error whether the document or the token is
      // wrong: distinguishing them confirms a document id to someone holding
      // an invalid token.
      if (!slot) throw new NotFoundError("Signing request", documentId);

      const [document] = await tx
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, documentId))
        .limit(1);

      if (!document) throw new NotFoundError("Signing request", documentId);

      if (!slot.viewedAt) {
        await tx
          .update(documentSignatures)
          .set({ viewedAt: new Date() })
          .where(eq(documentSignatures.id, slot.id));
      }

      const verdict = canSign(toSlots(slots), slot.signatoryEmail, {
        sentAt: document.sentAt?.toISOString(),
        expiresAt: document.expiresAt?.toISOString(),
        voidedReason: document.voidedReason ?? undefined,
        now: new Date().toISOString(),
      });

      return {
        document: (await this.getIn(tx, documentId))!,
        signatory: {
          id: slot.id,
          email: slot.signatoryEmail,
          role: slot.signatoryRole,
          name: slot.signatoryName ?? undefined,
        },
        canSignNow: verdict.allowed,
        reason: verdict.allowed ? undefined : verdict.reason,
      };
    });
  }

  /**
   * Records a signature.
   *
   * Integrity is re-verified against the stored body immediately before the
   * mark is recorded. A signature on a document that changed after it was sent
   * is worth nothing, and this is the last point at which that can be caught.
   */
  async sign(
    documentId: string,
    token: string,
    evidence: { signatureImageUrl?: string; ipAddress?: string; userAgent?: string }
  ): Promise<SignedResult> {
    const presented = await hashToken(token);

    const result = await withTenant(this.ctx, async (tx) => {
      const [document] = await tx
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, documentId))
        .for("update")
        .limit(1);

      if (!document) throw new NotFoundError("Signing request", documentId);

      const slots = await tx
        .select()
        .from(documentSignatures)
        .where(eq(documentSignatures.documentId, documentId))
        .orderBy(asc(documentSignatures.sequence));

      const slot = slots.find(
        (s) => s.accessTokenHash && timingSafeEqualHex(s.accessTokenHash, presented)
      );
      if (!slot) throw new NotFoundError("Signing request", documentId);

      const verdict = canSign(toSlots(slots), slot.signatoryEmail, {
        sentAt: document.sentAt?.toISOString(),
        expiresAt: document.expiresAt?.toISOString(),
        voidedReason: document.voidedReason ?? undefined,
        now: new Date().toISOString(),
      });

      if (!verdict.allowed) throw new RepositoryError(verdict.reason, 409);

      const { intact, currentHash } = await verifyIntegrity(
        document.renderedBody ?? "",
        document.contentHash ?? ""
      );

      if (!intact) {
        throw new RepositoryError(
          "This document has changed since it was sent and can no longer be signed",
          409
        );
      }

      await tx
        .update(documentSignatures)
        .set({
          signedAt: new Date(),
          signedContentHash: currentHash,
          signatureImageUrl: evidence.signatureImageUrl,
          ipAddress: evidence.ipAddress,
          userAgent: evidence.userAgent,
          // Burned on use: a signing link that still works after signing is a
          // link that can be replayed.
          accessTokenHash: null,
        })
        .where(eq(documentSignatures.id, slot.id));

      const after = await tx
        .select()
        .from(documentSignatures)
        .where(eq(documentSignatures.documentId, documentId));

      const status = envelopeStatus(toSlots(after), {
        sentAt: document.sentAt?.toISOString(),
        expiresAt: document.expiresAt?.toISOString(),
        voidedReason: document.voidedReason ?? undefined,
        now: new Date().toISOString(),
      });

      await tx
        .update(generatedDocuments)
        .set({
          status,
          completedAt: status === "completed" ? new Date() : null,
        })
        .where(eq(generatedDocuments.id, documentId));

      if (status === "completed") {
        // Recorded in the same transaction as completion itself: the render
        // and upload happen afterwards (outside this transaction, since they
        // talk to R2 and can take real time), but the intent to do so can
        // never be lost even if nothing ever runs that second step.
        await queueDocumentPdfStorage(tx, this.ctx.orgId, documentId);
      }

      return {
        document: (await this.getIn(tx, documentId))!,
        signatory: {
          email: slot.signatoryEmail,
          role: slot.signatoryRole,
          name: slot.signatoryName ?? undefined,
        },
      };
    });

    if (result.document.status === "completed") {
      // Best-effort immediate attempt, outside the transaction that just
      // committed. A failure here is not this signature's problem: the
      // outbox row queued above already guarantees `drainDueDocumentPdfStorage`
      // will pick it up from the next cron sweep, so this can never turn a
      // slow or unreachable R2 into a failed sign.
      void queueAndAttemptDocumentPdfStorage(this.ctx, documentId).catch((error: unknown) => {
        console.warn("[document-pdf] Could not run the immediate PDF storage attempt.", {
          orgId: this.ctx.orgId,
          documentId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }

    return result;
  }

  async decline(
    documentId: string,
    token: string,
    reason: string
  ): Promise<SignedResult> {
    const presented = await hashToken(token);

    return withTenant(this.ctx, async (tx) => {
      const slots = await tx
        .select()
        .from(documentSignatures)
        .where(eq(documentSignatures.documentId, documentId));

      const slot = slots.find(
        (s) => s.accessTokenHash && timingSafeEqualHex(s.accessTokenHash, presented)
      );
      if (!slot) throw new NotFoundError("Signing request", documentId);
      if (slot.signedAt) {
        throw new RepositoryError("You have already signed this document", 409);
      }

      await tx
        .update(documentSignatures)
        .set({ declinedAt: new Date(), declineReason: reason, accessTokenHash: null })
        .where(eq(documentSignatures.id, slot.id));

      await tx
        .update(generatedDocuments)
        .set({ status: "declined" })
        .where(eq(generatedDocuments.id, documentId));

      return {
        document: (await this.getIn(tx, documentId))!,
        signatory: {
          email: slot.signatoryEmail,
          role: slot.signatoryRole,
          name: slot.signatoryName ?? undefined,
        },
      };
    });
  }

  /**
   * Voids a document.
   *
   * Never deletes. An offer that was withdrawn is part of the record, and a
   * disappeared document is indistinguishable from one that never existed.
   */
  async voidDocument(documentId: string, reason: string): Promise<DocumentRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [document] = await tx
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, documentId))
        .for("update")
        .limit(1);

      if (!document) throw new NotFoundError("Document", documentId);
      if (document.status === "voided") {
        throw new RepositoryError("This document is already voided", 409);
      }

      await tx
        .update(generatedDocuments)
        .set({ status: "voided", voidedReason: reason })
        .where(eq(generatedDocuments.id, documentId));

      // Outstanding links are invalidated, or a voided offer stays signable.
      await tx
        .update(documentSignatures)
        .set({ accessTokenHash: null })
        .where(eq(documentSignatures.documentId, documentId));

      return (await this.getIn(tx, documentId))!;
    });
  }

  /**
   * Every document the tenant has generated, newest first.
   *
   * `listFor` answers "what does this employee have", which is the wrong shape
   * for the letters screen: most documents are offers to candidates who have no
   * employee record yet, so a per-employee query cannot see them at all. That
   * is why the screen previously showed a client-side list that vanished on
   * reload — there was no query that would have returned the right rows.
   *
   * Bounded, because a tenant that has been issuing offers for two years has
   * tens of thousands and this feeds a page.
   */
  async list(options: { status?: string; limit?: number } = {}): Promise<DocumentRecord[]> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

    return withTenant(this.ctx, async (tx) => {
      const rows = await (options.status
        ? tx
            .select()
            .from(generatedDocuments)
            .where(eq(generatedDocuments.status, options.status as "draft"))
            .orderBy(desc(generatedDocuments.createdAt))
            .limit(limit)
        : tx
            .select()
            .from(generatedDocuments)
            .orderBy(desc(generatedDocuments.createdAt))
            .limit(limit));

      const out: DocumentRecord[] = [];
      for (const row of rows) {
        const doc = await this.getIn(tx, row.id);
        if (doc) out.push(doc);
      }
      return out;
    });
  }

  /**
   * Issues a fresh signing link for whoever still has to sign.
   *
   * A reminder needs a working link and the original cannot be recovered:
   * tokens are stored as hashes precisely so that a leaked database does not
   * hand over every outstanding contract. So a reminder mints a new one, and
   * the previous link stops working.
   *
   * That trade is deliberate and is stated in the reminder itself. The
   * alternative — storing tokens in a form that can be re-read — would make
   * every offer in the table a usable credential, which is a far worse
   * property than a candidate having to use the most recent email.
   *
   * Only slots that have neither signed nor declined are re-issued. Reviving a
   * link for someone who already signed would let a signature be replaced.
   */
  async reissueSigningTokens(
    documentId: string
  ): Promise<{ document: DocumentRecord; links: { email: string; role: string; token: string }[] }> {
    return withTenant(this.ctx, async (tx) => {
      const [document] = await tx
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, documentId))
        .for("update")
        .limit(1);

      if (!document) throw new NotFoundError("Document", documentId);
      if (!["sent", "viewed", "partially_signed"].includes(document.status)) {
        throw new RepositoryError(`This document is ${document.status}`, 409);
      }

      const slots = await tx
        .select()
        .from(documentSignatures)
        .where(eq(documentSignatures.documentId, documentId))
        .orderBy(asc(documentSignatures.sequence));

      const links: { email: string; role: string; token: string }[] = [];

      for (const slot of slots) {
        if (slot.signedAt || slot.declinedAt) continue;

        const { token, hash } = await createAccessToken();
        await tx
          .update(documentSignatures)
          .set({ accessTokenHash: hash })
          .where(eq(documentSignatures.id, slot.id));

        links.push({ email: slot.signatoryEmail, role: slot.signatoryRole, token });
      }

      return { document: (await this.getIn(tx, documentId))!, links };
    });
  }

  async listFor(employeeId: string): Promise<DocumentRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.employeeId, employeeId))
        .orderBy(desc(generatedDocuments.createdAt));

      const out: DocumentRecord[] = [];
      for (const row of rows) {
        const doc = await this.getIn(tx, row.id);
        if (doc) out.push(doc);
      }
      return out;
    });
  }

  async get(documentId: string): Promise<DocumentRecord | null> {
    return withTenant(this.ctx, (tx) => this.getIn(tx, documentId));
  }

  // ─── Internals ─────────────────────────────────────────────

  private async getIn(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    documentId: string
  ): Promise<DocumentRecord | null> {
    const [row] = await tx
      .select()
      .from(generatedDocuments)
      .where(eq(generatedDocuments.id, documentId))
      .limit(1);

    if (!row) return null;

    const slots = await tx
      .select()
      .from(documentSignatures)
      .where(eq(documentSignatures.documentId, documentId))
      .orderBy(asc(documentSignatures.sequence));

    return {
      id: row.id,
      title: row.title,
      category: row.category,
      // Derived, not read from the column: a stored status maintained by hand
      // drifts out of step with the rows it summarises.
      status: envelopeStatus(toSlots(slots), {
        sentAt: row.sentAt?.toISOString(),
        expiresAt: row.expiresAt?.toISOString(),
        voidedReason: row.voidedReason ?? undefined,
        now: new Date().toISOString(),
      }),
      employeeId: row.employeeId ?? undefined,
      candidateId: row.candidateId ?? undefined,
      renderedBody: row.renderedBody ?? undefined,
      contentHash: row.contentHash ?? undefined,
      blobUrl: row.blobUrl ?? undefined,
      sentAt: row.sentAt?.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
      signatures: slots.map((s) => ({
        id: s.id,
        role: s.signatoryRole,
        email: s.signatoryEmail,
        name: s.signatoryName ?? undefined,
        sequence: s.sequence,
        viewedAt: s.viewedAt?.toISOString(),
        signedAt: s.signedAt?.toISOString(),
        declinedAt: s.declinedAt?.toISOString(),
        declineReason: s.declineReason ?? undefined,
      })),
    };
  }

  /**
   * Token values an employee record can supply.
   *
   * These are the names the templates actually use. They used to be emitted
   * under a dotted namespace — `employee.fullName`, `employee.code`,
   * `employee.joinDate` — while every template in the catalog asks for
   * `full_name`, `employee_code` and `join_date`. Nothing joined the two, so
   * this method supplied values no template could read, and `generate()` then
   * refused with "16 tokens could not be resolved" naming facts HRMS was
   * holding in the very row it had just loaded. The offer letter only worked
   * because ATS passes every value in `extraValues`; the letters that follow
   * an offer have no such caller, so a joining letter could not be issued at
   * all.
   *
   * Dates and money are formatted the way a letter reads them rather than the
   * way a database stores them: "1 September 2026", not "2026-09-01", and
   * major units, because a raw bigint of minor units in a contract reads as a
   * hundredfold pay rise.
   *
   * Only facts the employment record actually holds are returned. Anything
   * else a template needs — who signs it, where to report, what to bring on
   * the first day — stays unresolved on purpose, so `generate()` refuses
   * rather than issuing a letter with a blank where an answer belongs.
   */
  private async employeeTokens(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    employeeId: string
  ): Promise<TokenValues> {
    const [row] = await tx
      .select({
        e: employees,
        departmentName: departments.name,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.id, employeeId))
      .limit(1);

    if (!row) throw new NotFoundError("Employee", employeeId);

    // The reporting line, by name, when there is one.
    //
    // A separate lookup rather than a self-join on the select above: Drizzle
    // needs an alias for the second reference to `employees`, and a manager
    // who has left or was never set must leave the token unresolved rather
    // than resolve to an empty string — a joining letter telling somebody to
    // report to nobody is one HR has to reissue.
    let reportingManager: string | undefined;
    if (row.e.reportingToId) {
      const [manager] = await tx
        .select({ firstName: employees.firstName, lastName: employees.lastName })
        .from(employees)
        .where(eq(employees.id, row.e.reportingToId))
        .limit(1);
      const name = manager ? `${manager.firstName} ${manager.lastName}`.trim() : "";
      reportingManager = name || undefined;
    }

    const fullName = `${row.e.firstName} ${row.e.lastName}`.trim();
    const joinDate = formatLetterDate(row.e.joinDate);

    return {
      full_name: fullName,
      first_name: row.e.firstName,
      last_name: row.e.lastName,
      employee_code: row.e.employeeCode,
      candidate_email: row.e.personalEmail || row.e.workEmail,
      employee_email: row.e.personalEmail || row.e.workEmail,
      personal_email: row.e.personalEmail ?? undefined,
      work_email: row.e.workEmail,
      position_title: row.e.designation ?? undefined,
      designation: row.e.designation ?? undefined,
      department: row.departmentName ?? undefined,
      reporting_manager: reportingManager,
      join_date: joinDate,
      // The same day under the name the welcome email uses for it.
      start_date: joinDate,
      employment_type: formatEmploymentType(row.e.employmentType),
      notice_period:
        row.e.noticePeriodDays != null ? `${row.e.noticePeriodDays} days` : undefined,
      annual_ctc: row.e.ctcMinor ? formatMoney(row.e.ctcMinor, row.e.currency) : undefined,
      org_currency: row.e.currency,
      today: new Date().toISOString().slice(0, 10),
    };
  }
}

function formatMoney(minor: bigint, currency: string): string {
  const major = Number(minor) / 100;
  return `${currency} ${major.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

/**
 * A date as a letter writes it: "1 September 2026".
 *
 * `issue_date` is the one date `generate()` sets itself and it uses ISO, but
 * that is a default of last resort for a value with no record behind it. A
 * joining date read off the employment record is prose in a letter somebody
 * signs, and "2026-09-01" in the middle of a sentence reads as a serial
 * number. Returns undefined rather than "Invalid Date" for an absent or
 * unparseable value, so the token stays unresolved and `generate()` refuses
 * instead of issuing a letter that names a date nobody can read.
 */
function formatLetterDate(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * `full_time` is a column value, not something to print in a contract.
 *
 * Anything this does not recognise is passed through with its underscores
 * turned into spaces rather than dropped: an unfamiliar engagement type is
 * still better named imperfectly than left blank on an appointment letter.
 */
function formatEmploymentType(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const known: Record<string, string> = {
    full_time: "Full-time, permanent",
    part_time: "Part-time",
    contract: "Fixed-term contract",
    intern: "Internship",
    apprentice: "Apprenticeship",
    consultant: "Consultant",
  };
  return known[value] ?? value.replace(/_/g, " ");
}

