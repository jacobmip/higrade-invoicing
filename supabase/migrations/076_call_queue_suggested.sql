-- 076_call_queue_suggested.sql
-- ─── Outbound calls: the queue may now SUGGEST, never dial ─────────────────
--
-- 068 promised that nothing writes to call_queue on its own. That promise was
-- there for one reason: a person must decide that a customer gets rung. The
-- reason is not that a person types the row; it is that a person releases it.
--
-- So the promise is kept in its true form, and 068's header is corrected in the
-- same commit so it stops claiming the weaker thing:
--
--   * the abandoned-call net (capture_abandoned_call, 077) may write a row with
--     status = 'suggested'. The runner never selects 'suggested'.
--   * a row only becomes dialable when a person moves it suggested -> queued
--     (scripts/outbound_call.py release ID). Releasing is the consent step.
--
-- Nothing else changes: kill switch, calling hours, dry run and the attempt
-- cap all still apply on top of release.

alter table public.call_queue drop constraint if exists call_queue_status_ck;
alter table public.call_queue add constraint call_queue_status_ck
  check (status in ('suggested','queued','calling','done','failed','cancelled'));

select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname = 'call_queue_status_ck';
