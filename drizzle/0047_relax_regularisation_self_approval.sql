-- Relax self-approval constraint to permit organization administrators and owners
-- to approve their own attendance regularisation requests when administering the company.
ALTER TABLE "hrms"."attendance_regularisations"
  DROP CONSTRAINT IF EXISTS "attendance_regularisations_no_self_approval";
