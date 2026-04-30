-- 004_converted_to_id.sql
-- Track when an estimate/invoice has been converted to its counterpart.
-- The source document (e.g. an estimate that became an invoice) gets stamped
-- with the new doc's ID. We use this to count an estimate as "closed" in
-- the Estimates list (Closed = approved OR converted).

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS converted_to_id text;

CREATE INDEX IF NOT EXISTS invoices_converted_to_id_idx
  ON invoices(converted_to_id)
  WHERE converted_to_id IS NOT NULL;
