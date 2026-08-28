-- ═══════════════════════════════════════════════════════════════
-- 0046 — recurring Razorpay subscriptions
-- ═══════════════════════════════════════════════════════════════
-- Billing so far takes a one-off order for the month just counted. That is a
-- deliberate choice and it stays: seat pricing changes as a company hires, and
-- charging for a period already measured is exact and easy to defend on an
-- invoice. Its cost is that somebody has to come back and pay every month.
--
-- Recurring is offered alongside it, using Razorpay's Subscriptions API. A
-- plan is priced per employee per month and the subscription carries a
-- `quantity`, so Razorpay charges amount × seats each cycle and a headcount
-- change is a quantity update rather than a cancel-and-recreate. That answers
-- the objection the one-off design was written against.
--
-- ── Why new columns rather than the two that are already there ──
-- `external_subscription_id` and `external_customer_id` exist and look like
-- exactly the right homes. They are not: the webhook stores the last *payment*
-- id in `external_subscription_id` and uses it as the idempotency key that
-- stops one payment extending a period twice, and puts the *order* id in
-- `external_customer_id`. Both are misnamed for what they hold, and
-- repurposing either would break replay protection on the busiest path in
-- billing to save creating a column.

ALTER TABLE identity.subscriptions
  -- The Razorpay subscription this tenant authorised, when they chose
  -- recurring. Null for everyone on the one-off flow, which is not a defect.
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id text,
  -- The plan it was created against. Kept so a seat change can be checked
  -- against the price actually authorised rather than today's catalogue.
  ADD COLUMN IF NOT EXISTS razorpay_plan_id text,
  -- Seats Razorpay is currently billing for. Compared against live headcount
  -- to decide whether a quantity update is owed; without it the only way to
  -- know is to ask Razorpay on every sweep.
  ADD COLUMN IF NOT EXISTS billed_quantity integer;

CREATE INDEX IF NOT EXISTS subscriptions_razorpay_subscription_idx
  ON identity.subscriptions (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

COMMENT ON COLUMN identity.subscriptions.razorpay_subscription_id IS
  'Razorpay Subscriptions API id for tenants on recurring billing. Distinct from external_subscription_id, which holds the last payment id and is the webhook idempotency key.';
