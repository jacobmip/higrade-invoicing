-- 117_yelp_thread_form.sql
-- ─── Keep the Yelp quote form on the thread (v1.64.0) ──────────────────────
--
-- The quote form (job, survey answers, timing, area) used to reach Lisa only
-- on the first reply. Dan M. said "regulator, 90 to 100 psi" on the form and
-- was asked a week later what his pressure was. The form now lives on the
-- thread, refreshed whenever a Zap sends it, and every reply sees it.
--
--   form   plain-text summary of the quote request, null until known
--
-- No RLS change: the table stays service-role only (migration 115).

begin;

alter table public.yelp_threads
  add column if not exists form text;

commit;
