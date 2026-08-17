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

import { asc, desc, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { departments, employees } from "@/db/schema/hrms";
import { identityTokens, loadOrgIdentity } from "./org-identity";
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
        ...(identity ? identityTokens(identity) : {}),
        ...request.extraValues,
      };
      if (request.employeeId) {
        values = { ...(await this.employeeTokens(tx, request.employeeId)), ...values };
      }

      const validation = validateTemplate(template, values, {
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
        optional: ["company_registration"],
      });
      if (!validation.valid) {
        throw new RepositoryError(
          `${validation.reason}: ${validation.missing.join(", ")}`,
          422
        );
      }

      const { body } = render(template.body, values);
      const contentHash = await hashContent(body);

      const expiresAt = request.expiresInDays
        ? new Date(Date.now() + request.expiresInDays * 86_400_000)
        : undefined;

      const [document] = await tx
        .insert(generatedDocuments)
        .values({
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

    return withTenant(this.ctx, async (tx) => {
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

  /** Token values an employee record can supply. */
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

    return {
      "employee.firstName": row.e.firstName,
      "employee.lastName": row.e.lastName,
      "employee.fullName": `${row.e.firstName} ${row.e.lastName}`,
      "employee.code": row.e.employeeCode,
      "employee.email": row.e.workEmail,
      "employee.designation": row.e.designation,
      "employee.department": row.departmentName ?? undefined,
      "employee.joinDate": row.e.joinDate,
      "employee.employmentType": row.e.employmentType,
      "employee.noticePeriodDays": row.e.noticePeriodDays ?? undefined,
      // Money as a formatted major-unit string; a raw bigint of minor units in
      // a contract would read as a hundredfold pay rise.
      "employee.ctc": row.e.ctcMinor
        ? formatMoney(row.e.ctcMinor, row.e.currency)
        : undefined,
      "org.currency": row.e.currency,
      "today": new Date().toISOString().slice(0, 10),
    };
  }
}

function formatMoney(minor: bigint, currency: string): string {
  const major = Number(minor) / 100;
  return `${currency} ${major.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

