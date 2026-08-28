-- ═══════════════════════════════════════════════════════════════
-- EMPLOYEE CODES — one generator, in the one place both apps share
-- ═══════════════════════════════════════════════════════════════
-- There were four generators producing three formats:
--
--   ATS  api/sync/route.ts        EMP-<base36 of Date.now()>   EMP-MSZ64CHT
--   ATS  onboarding/handoff.ts    EMP-<base36 of Date.now()>   EMP-MSYX0KHX
--   HRMS employee.neon.ts         CIR-<count + 1>              CIR-0001
--   HRMS auth/register/route.ts   the literal string           EMP-0001
--
-- Every one of them is wrong in its own way. The timestamp codes are unreadable
-- and unorderable — nobody can say whether MSYX0KHX joined before MSZ64CHT. The
-- count-based one reuses a number the moment anybody is deleted, so two people
-- end up sharing a code. The literal one guarantees it: three rows in this
-- database are all called EMP-0001.
--
-- A code is an identifier a person quotes on the phone, writes on a form and
-- finds on their payslip. It has to be short, sequential and never reused.
--
-- ── Why this lives in the database ──
-- ATS and HRMS are separate repositories that share one database, and both
-- create employees. Any generator written in TypeScript has to be written twice
-- and will drift — which is exactly how there came to be four. A function here
-- is the only version there can be.
--
-- ── Concurrency ──
-- Two people hired in the same second must not take the same number. The
-- advisory lock serialises the read-and-increment per organisation and is
-- released at commit, so it is held for microseconds and never leaks.
--
-- ── Soft-deleted rows are counted ──
-- `max` over every row, including `deleted_at IS NOT NULL`. Somebody who has
-- left keeps their number: reusing it would attach a former employee's payslips,
-- letters and audit trail to whoever came next.

CREATE OR REPLACE FUNCTION hrms.next_employee_code(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_next integer;
BEGIN
  -- Serialised per organisation, for the duration of the caller's transaction.
  PERFORM pg_advisory_xact_lock(hashtext('hrms.employee_code'), hashtext(p_org_id::text));

  SELECT coalesce(max((regexp_match(employee_code, '^CV-([0-9]+)$'))[1]::integer), 0) + 1
    INTO v_next
    FROM hrms.employees
   WHERE org_id = p_org_id;

  -- Three digits to begin with, growing on its own past CV-999 — lpad only pads,
  -- it never truncates, so CV-1000 follows CV-999 without anything to change.
  RETURN 'CV-' || lpad(v_next::text, 3, '0');
END;
$$;

COMMENT ON FUNCTION hrms.next_employee_code(uuid) IS
  'The next sequential employee code for an organisation, as CV-001. Called by '
  'both HRMS and ATS so there is one generator rather than four. Runs as the '
  'caller, so it must be invoked inside the tenant context of the organisation '
  'it is asked about.';

GRANT EXECUTE ON FUNCTION hrms.next_employee_code(uuid) TO hrms_app;
