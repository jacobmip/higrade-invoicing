-- 091: tag invoice_versions snapshots with the event that caused them and who did it.
-- Additive only: four nullable columns, no policy or trigger touched. Old rows stay null.
begin;

alter table public.invoice_versions
  add column if not exists event_type text,
  add column if not exists triggered_by uuid,
  add column if not exists triggered_by_name text,
  add column if not exists triggered_by_tier text;

commit;
