-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY AND INTEGRITY FOR CUSTOM FIELD TABLES
-- ═══════════════════════════════════════════════════════════════
-- The sweep from 0003. Every migration that adds an org-scoped table must call
-- it, or that table returns every tenant's rows to every caller.

SELECT apply_tenant_rls();

-- ─── Retire the jsonb placeholders these tables replace ──────
--
-- Two homes for the same concept is how a field ends up written to one place
-- and read from the other. Neither column was ever read; both are dropped so
-- there is exactly one answer to "where do custom fields live".

ALTER TABLE hrms.employees DROP COLUMN IF EXISTS custom_fields;
ALTER TABLE identity.organizations DROP COLUMN IF EXISTS custom_fields;

-- ─── Definition integrity ────────────────────────────────────

-- A key is a stable machine identifier. Allowing spaces or capitals makes
-- `shirt size` and `Shirt Size` distinct fields that look identical in a form.
ALTER TABLE hrms.custom_field_definitions
  DROP CONSTRAINT IF EXISTS custom_field_definitions_key_format;
ALTER TABLE hrms.custom_field_definitions
  ADD CONSTRAINT custom_field_definitions_key_format
    CHECK (key ~ '^[a-z][a-z0-9_]{0,48}$');

-- A choice field with no options cannot be filled in at all.
ALTER TABLE hrms.custom_field_definitions
  DROP CONSTRAINT IF EXISTS custom_field_definitions_choices_have_options;
ALTER TABLE hrms.custom_field_definitions
  ADD CONSTRAINT custom_field_definitions_choices_have_options
    CHECK (
      data_type NOT IN ('select', 'multiselect')
      OR jsonb_array_length(options) > 0
    );

ALTER TABLE hrms.custom_field_definitions
  DROP CONSTRAINT IF EXISTS custom_field_definitions_options_is_array;
ALTER TABLE hrms.custom_field_definitions
  ADD CONSTRAINT custom_field_definitions_options_is_array
    CHECK (jsonb_typeof(options) = 'array');

-- A tenant-authored pattern runs against every submitted value. The length cap
-- is the database's half of the defence; compilePattern is the other half.
ALTER TABLE hrms.custom_field_definitions
  DROP CONSTRAINT IF EXISTS custom_field_definitions_pattern_length;
ALTER TABLE hrms.custom_field_definitions
  ADD CONSTRAINT custom_field_definitions_pattern_length
    CHECK (
      validation->>'pattern' IS NULL
      OR length(validation->>'pattern') <= 200
    );

-- ─── Value integrity ─────────────────────────────────────────

-- Uniqueness has to be a real index, not an application check: two concurrent
-- requests both pass a SELECT and both insert. But a partial index predicate
-- cannot contain a subquery, so it cannot read the definition's is_unique
-- flag directly.
--
-- The flag is therefore denormalised onto the value row and maintained by the
-- database itself — triggers, not application code, so it cannot drift.

ALTER TABLE hrms.custom_field_values
  ADD COLUMN IF NOT EXISTS is_unique boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION hrms.custom_field_value_stamp_unique()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT d.is_unique INTO NEW.is_unique
  FROM hrms.custom_field_definitions d
  WHERE d.id = NEW.definition_id;

  NEW.is_unique := COALESCE(NEW.is_unique, false);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS custom_field_values_stamp_unique ON hrms.custom_field_values;
CREATE TRIGGER custom_field_values_stamp_unique
  BEFORE INSERT OR UPDATE ON hrms.custom_field_values
  FOR EACH ROW EXECUTE FUNCTION hrms.custom_field_value_stamp_unique();

-- Toggling the flag on a definition has to reach the rows already stored, or
-- turning uniqueness on would leave every existing value unenforced.
CREATE OR REPLACE FUNCTION hrms.custom_field_definition_propagate_unique()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_unique IS DISTINCT FROM OLD.is_unique THEN
    UPDATE hrms.custom_field_values
    SET is_unique = NEW.is_unique
    WHERE definition_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS custom_field_definitions_propagate_unique ON hrms.custom_field_definitions;
CREATE TRIGGER custom_field_definitions_propagate_unique
  AFTER UPDATE ON hrms.custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION hrms.custom_field_definition_propagate_unique();

-- Only over rows that actually hold a value: three employees with no passport
-- number are not duplicates of each other.
DROP INDEX IF EXISTS hrms.custom_field_values_unique_per_definition;
CREATE UNIQUE INDEX custom_field_values_unique_per_definition
  ON hrms.custom_field_values (definition_id, value_text)
  WHERE is_unique AND value_text IS NOT NULL;

-- A value must carry its indexable text whenever it carries a value, or the
-- uniqueness index above silently stops covering it.
ALTER TABLE hrms.custom_field_values
  DROP CONSTRAINT IF EXISTS custom_field_values_text_matches_value;
ALTER TABLE hrms.custom_field_values
  ADD CONSTRAINT custom_field_values_text_matches_value
    CHECK ((value IS NULL) = (value_text IS NULL));
