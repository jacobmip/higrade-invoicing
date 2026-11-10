-- 120_yelp_progress_alert.sql
-- Jake (2026-11-09): no 8-reply ceiling on Yelp threads. Instead, one Telegram
-- when a thread passes 8 replies with no quote, no phone or address and no
-- booking. This stamps that the alert went out, so it fires once per thread.
-- The hard anti-loop stop in yelp-agent.js is raised to 30.
alter table public.yelp_threads add column if not exists progress_alert_at timestamptz;
notify pgrst, 'reload schema';
