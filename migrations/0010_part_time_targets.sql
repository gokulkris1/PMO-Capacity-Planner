-- 0010 part-time targets (QA-022; PO rule, docs/product/ACCEPTANCE_REPORT.md §7): a v1.1 person whose capacity is
-- below 100 % and who never had a target gets that capacity as their target. Without it, supply counted 0.8 FTE
-- (min(capacity, target)) while the utilisation denominator counted 1.0 (the default target of 100), so Reports and
-- the QBR pack showed two different figures for the same people.
--
-- Additive: the target goes in a new 2.0 column, `resources.target_util`; the v1.1 columns (total_capacity,
-- craft_profile) are not touched, so the parity check stays "0 rows lost" and a rollback reads what it read before.
-- 2.0 writes keep target_util and craft_profile.targetUtil equal (dual write); reads prefer craft_profile.targetUtil.
-- Only rows whose target is still unset (no numeric craft_profile.targetUtil > 0, target_util NULL) are filled.
-- Idempotent: a second run matches nothing.
ALTER TABLE resources ADD COLUMN IF NOT EXISTS target_util NUMERIC;

UPDATE resources
SET target_util = total_capacity, version = version + 1, updated_at = now()
WHERE target_util IS NULL
  AND total_capacity > 0 AND total_capacity < 100
  AND NOT (
    coalesce(jsonb_typeof(craft_profile -> 'targetUtil'), '') = 'number'
    AND (craft_profile ->> 'targetUtil')::numeric > 0
  );
