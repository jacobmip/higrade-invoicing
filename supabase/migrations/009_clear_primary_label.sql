-- 009_clear_primary_label.sql
-- Clear the auto-assigned "Primary" nickname from any address that was
-- backfilled by migration 008. The convention is now: a single address
-- with no nickname is implicitly the primary, so we don't need a
-- placeholder label cluttering the UI.
--
-- Idempotent: clients that already have empty/different labels are
-- untouched.

UPDATE clients
SET addresses = (
  SELECT jsonb_agg(
    CASE
      WHEN addr->>'label' = 'Primary'
        THEN jsonb_set(addr, '{label}', '""'::jsonb)
      ELSE addr
    END
  )
  FROM jsonb_array_elements(addresses) AS addr
)
WHERE jsonb_typeof(addresses) = 'array'
  AND jsonb_array_length(addresses) > 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(addresses) AS a
    WHERE a->>'label' = 'Primary'
  );
