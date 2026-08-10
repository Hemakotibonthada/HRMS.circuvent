-- ═══════════════════════════════════════════════════════════════
-- DOCUMENT STORE
-- ═══════════════════════════════════════════════════════════════
-- The dashboard reached Firestore directly from the browser through
-- src/lib/firestore-service.ts, across 84 pages. Roughly half of the
-- collections it used have no relational table and never will: kudos, wellness,
-- badges, celebrations, visitors, grievances and the rest are small, free-form
-- records whose shape belongs to the page that writes them.
--
-- Rather than invent 20-odd narrow tables, or leave those pages on Firebase,
-- they get one schemaless table with the same access pattern. Purpose-built
-- tables keep their own routes: this exists for the long tail, not to replace
-- employees, leave or payroll.
--
-- Tenant isolation is enforced here by row-level security, exactly as for every
-- other table. The Firestore version depended on each query remembering to
-- filter by organizationId, which is precisely the mistake RLS exists to make
-- impossible.
--
-- Numbered 0023, not 0012. It was written as 0012, which was already taken by
-- 0012_compensation, and it was never added to drizzle/meta/_journal.json —
-- so `drizzle-kit migrate` would have skipped it entirely while the directory
-- listing made it look applied. The journal-completeness check in
-- scripts/verify-migrations.ts is what caught it.

CREATE TABLE IF NOT EXISTS hrms.doc_store (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  collection  text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- The dominant query is "one collection for this tenant, newest first".
CREATE INDEX IF NOT EXISTS doc_store_org_collection_idx
  ON hrms.doc_store (org_id, collection, created_at DESC)
  WHERE deleted_at IS NULL;

-- Supports filtering on arbitrary document fields without a per-field index.
CREATE INDEX IF NOT EXISTS doc_store_data_gin_idx
  ON hrms.doc_store USING gin (data jsonb_path_ops);

-- Isolation via the shared helper, exactly like every other org-scoped table.
--
-- This originally hand-rolled its own policy named `doc_store_tenant_isolation`
-- with the same predicate. Identical behaviour, different name — which meant
-- the "every org-scoped table has a tenant_isolation policy" check could not
-- see it, and any future change to how isolation works would have had to be
-- remembered in two places. One home for one concept.
SELECT apply_tenant_rls();

-- updated_at is set by the writing statement, matching the other tables in this
-- schema; there is no shared trigger function to hang one off.

-- ── Guardrails ───────────────────────────────────────────────
-- A schemaless table with no constraints becomes a dumping ground: every page
-- invents its own collection name, nobody can enumerate what is in there, and
-- the first person to write a report discovers "kudos", "Kudos" and
-- "kudos_v2" all mean the same thing. These are cheap and prevent that.

ALTER TABLE hrms.doc_store
  DROP CONSTRAINT IF EXISTS doc_store_collection_shape_check;

-- Lower-case, alphanumeric and underscores. Enforcing the shape at write time
-- is the only way to stop case and punctuation drift, because nothing else
-- ever looks at these names.
ALTER TABLE hrms.doc_store
  ADD CONSTRAINT doc_store_collection_shape_check
  CHECK (collection ~ '^[a-z][a-z0-9_]{1,63}$');

ALTER TABLE hrms.doc_store
  DROP CONSTRAINT IF EXISTS doc_store_data_shape_check;

-- An object, not an array or a bare scalar. Every reader does data->>'field';
-- a top-level array makes that silently return null rather than fail.
ALTER TABLE hrms.doc_store
  ADD CONSTRAINT doc_store_data_shape_check
  CHECK (jsonb_typeof(data) = 'object');
