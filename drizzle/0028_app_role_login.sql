-- ═══════════════════════════════════════════════════════════════
-- 0028 — let the application connect as a role that obeys RLS
-- ═══════════════════════════════════════════════════════════════
--
-- `hrms_app` was created by 0001_row_level_security.sql with the right
-- property — `rolbypassrls = false` — and was then never usable, because it
-- was never granted LOGIN and never given a password. The only role that could
-- actually connect was the database owner, and a database owner has
-- BYPASSRLS.
--
-- The effect was that all ninety-one tenant isolation policies were present,
-- correct, covered by seventy-five tests, and completely inert in the running
-- system. Two organisations shared this database and either could read the
-- other's payroll, salary and statutory identifiers. Proven, not theorised:
-- setting `app.org_id` to organisation B and selecting from `hrms.departments`
-- returned organisation A's rows.
--
-- This migration makes the intended role usable. It deliberately does NOT set
-- a password — a credential committed to a repository is its own incident.
-- The operator runs the ALTER at the bottom with a generated secret and points
-- DATABASE_URL at it.
--
-- Until that happens the application refuses to serve tenant-scoped queries;
-- see `assertConnectionIsolatesTenants` in src/db/client.ts.

-- ── Make the role connectable ────────────────────────────────
ALTER ROLE hrms_app WITH LOGIN;

-- Belt and braces: a future ALTER that grants BYPASSRLS to this role would
-- reopen the hole silently, so state the intent explicitly here too.
ALTER ROLE hrms_app WITH NOBYPASSRLS;

-- ── Grants ───────────────────────────────────────────────────
-- The application reads and writes rows. It does not own tables, and must not:
-- ownership is what confers the RLS exemption in the first place.
GRANT USAGE ON SCHEMA hrms, identity TO hrms_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA hrms, identity
  TO hrms_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA hrms, identity TO hrms_app;

-- Tables created by later migrations must be reachable too, or the next
-- migration silently breaks the application for want of a grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA hrms
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hrms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hrms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA hrms
  GRANT USAGE, SELECT ON SEQUENCES TO hrms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity
  GRANT USAGE, SELECT ON SEQUENCES TO hrms_app;

-- The helper functions every policy calls.
GRANT EXECUTE ON FUNCTION app_current_org() TO hrms_app;
GRANT EXECUTE ON FUNCTION app_is_superuser() TO hrms_app;

-- ── What the operator must still do ──────────────────────────
--
--   1. Generate a password:      openssl rand -base64 32
--   2. Set it:                   ALTER ROLE hrms_app WITH PASSWORD '<secret>';
--   3. Point DATABASE_URL at it, in .env.local and in the deployment's
--      environment variables:
--        postgresql://hrms_app:<secret>@<endpoint>.neon.tech/hrms?sslmode=require
--   4. Confirm:                  npm run db:verify:live
--
-- Step 4 is the one that matters. It connects as whatever DATABASE_URL names,
-- plants a row in one tenant, asks as another, and fails if it is visible.
