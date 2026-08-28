-- ═══════════════════════════════════════════════════════════════
-- INTERN LIFECYCLE — a second employee-code sequence, and the columns
-- that let a conversion keep its history
-- ═══════════════════════════════════════════════════════════════
-- Circuvent now hires interns as well as permanent staff, and the two must
-- not share a numbering. `hrms.next_employee_code` used to accept only an
-- organisation and always return CV-NNN; this teaches it a second, wholly
-- independent sequence — CVI-NNN — for interns, without disturbing the
-- CV- sequence ATS and HRMS already depend on.
--
-- ── Why the function is dropped and recreated rather than overloaded ──
-- Adding `next_employee_code(uuid, text)` alongside the existing
-- `next_employee_code(uuid)` looks harmless, but Postgres will not pick
-- between them: a one-argument call becomes ambiguous the moment a second
-- function could satisfy it by defaulting its extra parameter, and every
-- existing call site — in this repository and in ATS — calls it with one
-- argument today. The old single-argument function is dropped first so
-- there is only ever one `next_employee_code` to resolve to, and it
-- defaults its new parameter to 'CV-', so a one-argument call behaves
-- exactly as it did before this migration.
--
-- ── Why the two sequences are independent ──
-- The maximum-in-use lookup now matches only codes that begin with the
-- requested prefix, so issuing CVI-007 does not advance CV-'s counter and
-- issuing CV-007 does not advance CVI-'s — both draw from the same table
-- but count disjoint rows. The advisory lock key folds the prefix in too,
-- so hiring an intern and hiring a permanent employee at the same instant
-- serialise against their own sequence rather than each other's: the two
-- sequences are independent all the way down, not merely in the numbers
-- they happen to produce.
--
-- ── Why the lock and no-reuse properties still hold ──
-- `pg_advisory_xact_lock` is still taken before the read, still scoped to
-- the caller's transaction, so two concurrent hires of the same kind still
-- serialise rather than race for the same number. The scan is still over
-- every row for the organisation, soft-deleted included, so an intern (or
-- permanent hire) who has since left still keeps their number reserved
-- rather than handing it to whoever is hired next.

DROP FUNCTION IF EXISTS hrms.next_employee_code(uuid);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION hrms.next_employee_code(p_org_id uuid, p_prefix text DEFAULT 'CV-')
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_next integer;
BEGIN
  -- Serialised per organisation *and* per prefix: interns and permanent
  -- staff draw from two different sequences, and folding the prefix into
  -- the lock key means allocating one never blocks allocating the other.
  PERFORM pg_advisory_xact_lock(hashtext('hrms.employee_code'), hashtext(p_org_id::text || ':' || p_prefix));

  -- p_prefix is only ever supplied by call sites inside this codebase
  -- ('CV-', 'CVI-'), never by end-user input, so folding it directly into
  -- the pattern below is safe without escaping it as untrusted text.
  SELECT coalesce(max((regexp_match(employee_code, '^' || p_prefix || '([0-9]+)$'))[1]::integer), 0) + 1
    INTO v_next
    FROM hrms.employees
   WHERE org_id = p_org_id;

  -- Three digits to begin with; lpad only pads, so a fourth digit appears
  -- on its own once a sequence passes 999 rather than needing a migration
  -- then.
  RETURN p_prefix || lpad(v_next::text, 3, '0');
END;
$$;
--> statement-breakpoint

COMMENT ON FUNCTION hrms.next_employee_code(uuid, text) IS
  'The next sequential employee code for an organisation, prefixed CV- for '
  'permanent staff or CVI- for interns (default CV-, so existing '
  'one-argument callers are unchanged). Each prefix is its own '
  'independent, gap-free, never-reused sequence over the same table. '
  'Called by both HRMS and ATS so there is one generator rather than four. '
  'Runs as the caller, so it must be invoked inside the tenant context of '
  'the organisation it is asked about.';
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION hrms.next_employee_code(uuid, text) TO hrms_app;
--> statement-breakpoint

-- ── Internship dates and conversion history ──
-- `join_date` already covers "internship start" for every employment type,
-- interns included, so only the expected end date is new. Conversion gets
-- its own two columns rather than reusing `join_date`/`exit_date`: an
-- intern who converts to permanent has not exited, and overwriting their
-- code in place would make every payslip, signed letter and attendance
-- record already issued under the CVI- code unverifiable against the
-- person who holds the CV- code today.
ALTER TABLE "hrms"."employees" ADD COLUMN IF NOT EXISTS "internship_end_date" date;
--> statement-breakpoint
ALTER TABLE "hrms"."employees" ADD COLUMN IF NOT EXISTS "previous_employee_code" text;
--> statement-breakpoint
ALTER TABLE "hrms"."employees" ADD COLUMN IF NOT EXISTS "code_changed_at" timestamp with time zone;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "employees_internship_end_date_idx"
  ON "hrms"."employees" ("org_id", "internship_end_date")
  WHERE "internship_end_date" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint

-- ── Last-working-day reminder idempotency ──
-- The daily cron sweeps every intern nearing their end date and is the
-- only invocation this path gets: the Vercel Hobby plan allows one run of
-- one path per day, so there is no separate "reminders" cron to fall back
-- on and no second chance later today if this run double-sends. A row here
-- is claimed with ON CONFLICT DO NOTHING before any mail goes out, so a
-- cron that fires twice in a day, or is retried after a partial failure,
-- still sends each milestone to HR, the manager and the intern exactly
-- once rather than once per run.
CREATE TABLE IF NOT EXISTS "hrms"."intern_reminder_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "hrms"."employees"("id") ON DELETE CASCADE,
  "lead_days" integer NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "intern_reminder_log_key"
  ON "hrms"."intern_reminder_log" ("employee_id", "lead_days");
--> statement-breakpoint

ALTER TABLE "hrms"."intern_reminder_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."intern_reminder_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."intern_reminder_log";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."intern_reminder_log"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "hrms"."intern_reminder_log" TO hrms_app;
