-- ═══════════════════════════════════════════════════════════════
-- INDEXES FOR LIST QUERIES
-- ═══════════════════════════════════════════════════════════════
-- Every list endpoint in this application has the same shape:
--
--   WHERE org_id = current_setting('app.org_id')  -- added by RLS
--   [AND status = $1]
--   ORDER BY <a date column> DESC
--   LIMIT 50
--
-- The existing indexes cover the filter but not the sort. `(org_id, status)`
-- lets Postgres find a tenant's rows, and then it sorts all of them to return
-- fifty. That is fine on a demo database and it is a sequential scan plus a
-- sort on the largest customer — which is exactly the tenant you least want to
-- be slow.
--
-- A composite starting with `org_id` is the right shape here precisely because
-- RLS puts `org_id = …` on every single query: the leading column is always
-- an equality match, so the rest of the index is ordered within a tenant and
-- the sort disappears.
--
-- These were chosen from `scripts/audit-indexes.ts`, which cross-references
-- what the repositories actually filter and order by against what is indexed.
-- Only columns a repository really sorts on are here. An index is not free —
-- it costs write throughput on every insert and update — so the low-cardinality
-- booleans the audit also flagged (`is_active`, `is_mandatory`, `is_primary`)
-- are deliberately left out: Postgres will pick a sequential scan over them
-- anyway, and a partial index would be the right tool if they ever matter.

-- ─── Recruitment ─────────────────────────────────────────────
-- `applications` had (org_id, stage) but the pipeline lists sort by when
-- someone applied, which is the column a recruiter reads down.
CREATE INDEX IF NOT EXISTS "applications_org_applied_idx"
  ON "hrms"."applications" ("org_id", "applied_at" DESC);

CREATE INDEX IF NOT EXISTS "applications_org_updated_idx"
  ON "hrms"."applications" ("org_id", "updated_at" DESC);

-- Job postings are listed newest-first on the careers page and the ATS.
CREATE INDEX IF NOT EXISTS "job_postings_org_created_idx"
  ON "hrms"."job_postings" ("org_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "offers_org_created_idx"
  ON "hrms"."offers" ("org_id", "created_at" DESC);

-- ─── Expenses ────────────────────────────────────────────────
-- Two different reads: "my recent claims" sorts by creation, and the finance
-- export filters a date range on when the money was actually spent.
CREATE INDEX IF NOT EXISTS "expense_claims_org_created_idx"
  ON "hrms"."expense_claims" ("org_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "expense_claims_org_date_idx"
  ON "hrms"."expense_claims" ("org_id", "expense_date");

-- ─── Scheduling ──────────────────────────────────────────────
-- `roster_assignments` had (org_id, shift_date), but the repository filters on
-- `starts_at` — the timestamp, not the date — in four separate queries. A
-- date index cannot serve a range over a timestamp column.
CREATE INDEX IF NOT EXISTS "roster_assignments_org_starts_idx"
  ON "hrms"."roster_assignments" ("org_id", "starts_at");

-- ─── Talent ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "benefit_claims_org_created_idx"
  ON "hrms"."benefit_claims" ("org_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "course_enrolments_org_created_idx"
  ON "hrms"."course_enrolments" ("org_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "generated_documents_org_created_idx"
  ON "hrms"."generated_documents" ("org_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "performance_goals_org_created_idx"
  ON "hrms"."performance_goals" ("org_id", "created_at" DESC);

-- ─── Interviews ──────────────────────────────────────────────
-- (org_id, scheduled_at) already exists, but the common read is "upcoming
-- interviews that are still scheduled" — status first so the index is ordered
-- by time within a status.
CREATE INDEX IF NOT EXISTS "interviews_org_status_scheduled_idx"
  ON "hrms"."interviews" ("org_id", "status", "scheduled_at");
