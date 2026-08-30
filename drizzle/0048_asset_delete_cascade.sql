-- Allow CASCADE deletes of asset_events when removing an asset from the register.
-- The append-only trigger still blocks direct UPDATE/DELETE on the audit log.

CREATE OR REPLACE FUNCTION hrms.asset_events_is_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND COALESCE(current_setting('hrms.asset_cascade_delete', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'hrms.asset_events is append-only; % is not permitted', TG_OP;
END
$$;
