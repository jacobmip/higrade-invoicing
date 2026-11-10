-- 118_yelp_followup_tracking.sql
-- ─── Yelp follow-up tracking on yelp_threads (v1.68.0) ──────────────────────
--
-- Three nullable columns so the Mac mini cron (scripts/yelp_followup.py) can
-- track where each Yelp lead is in the follow-up sequence without re-scanning
-- the messages array every run.
--
--   second_message_sent_at   when the 2-minute bump was posted to Yelp
--   call_queued_at           when the 7-minute outbound call was queued
--   service_summary          one-line summary of the job, stored on first reply
--                            so the call script has context without re-parsing
--                            the messages array
--
-- No RLS change. The table is already service-role-only (no policies, RLS on).

begin;

alter table public.yelp_threads
  add column if not exists second_message_sent_at timestamptz,
  add column if not exists call_queued_at         timestamptz,
  add column if not exists service_summary        text;

comment on column public.yelp_threads.second_message_sent_at is
  'When the 2-minute bump message was sent (v1.68.0). Null = not yet sent.';
comment on column public.yelp_threads.call_queued_at is
  'When the 7-minute outbound call was queued in call_queue (v1.68.0). Null = not queued.';
comment on column public.yelp_threads.service_summary is
  'One-line job summary stored on first reply for use by the call script (v1.68.0).';

commit;
