-- ═══════════════════════════════════════════════════════════════
-- DOCUMENT PDF STORAGE OUTBOX
-- ═══════════════════════════════════════════════════════════════
-- A signature is recorded, and final, the moment `document_signatures.signed_at`
-- is set inside the same transaction that moves the envelope to `completed`.
-- Turning that into an archived, downloadable PDF is a second step that talks
-- to an object store, and an object store can be unreachable for reasons that
-- have nothing to do with whether the signature is valid. This table is the
-- same shape and the same idea as `paystub_employee_sync_outbox` and
-- `directory_group_join_outbox`: the durable intent to render and upload,
-- plus the retry state a scheduled sweep re-drives after an outage, so a
-- storage failure is a retryable row rather than a signature nobody can ever
-- retrieve.

CREATE TABLE IF NOT EXISTS "hrms"."document_pdf_storage_outbox" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"          uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "document_id"     uuid NOT NULL REFERENCES "hrms"."generated_documents"("id") ON DELETE CASCADE,
  "status"          text NOT NULL DEFAULT 'pending',
  "attempt_count"   integer NOT NULL DEFAULT 0,
  "last_error"      text,
  "next_attempt_at" timestamptz,
  "last_attempt_at" timestamptz,
  "uploaded_at"     timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

-- One outbox row per document: a retry, or a second signatory completing the
-- envelope, reopens the same row rather than racing two uploads of the same
-- content.
CREATE UNIQUE INDEX IF NOT EXISTS "document_pdf_storage_outbox_document_key"
  ON "hrms"."document_pdf_storage_outbox" ("org_id", "document_id");

CREATE INDEX IF NOT EXISTS "document_pdf_storage_outbox_retry_idx"
  ON "hrms"."document_pdf_storage_outbox" ("status", "next_attempt_at");

ALTER TABLE "hrms"."document_pdf_storage_outbox"
  DROP CONSTRAINT IF EXISTS "document_pdf_storage_outbox_status_valid";
ALTER TABLE "hrms"."document_pdf_storage_outbox"
  ADD CONSTRAINT "document_pdf_storage_outbox_status_valid"
    CHECK ("status" IN ('pending', 'processing', 'succeeded', 'failed'));

SELECT apply_tenant_rls();
