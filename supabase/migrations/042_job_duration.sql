-- 042_job_duration.sql
-- ─── Store how long a scheduled job actually is ─────────────────────────────
--
-- ScheduleJobModal asks for a duration, uses it to compute the end time of the
-- Google Calendar event, and then throws it away. `invoices` has gcal_date and
-- gcal_event_id and nowhere to put a length.
--
-- That was coherent while Google Calendar was the store of record: the app
-- remembered when a job started and kept a pointer to the event, and Google
-- held its shape. It falls apart whenever the sync is not there — a job booked
-- while signed out, or during the hour-long token gap fixed in v1.5.0 — and it
-- became visible in v1.6.0, which draws jobs as blocks and so has to know how
-- long they are. Those fell back to a flat two hours.
--
-- Deliberately NOT added to save_invoice_with_items. That function has been
-- redefined by seven migrations and may carry edits made straight in the SQL
-- editor, so rewriting it to add one column risks silently reverting one of
-- them. The column is written the same way internal_notes is (migration 024):
-- on its own, after the main save. A side effect worth knowing is that a full
-- save cannot clobber it, because the RPC never names the column.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

alter table public.invoices
  add column if not exists gcal_duration_minutes smallint;

comment on column public.invoices.gcal_duration_minutes is
  'Length of the scheduled job in minutes. NULL means never recorded (rows from before this migration, or booked by the AI receptionist); readers fall back to settings.gcal_default_minutes.';

-- One default, shared by both paths. The AI receptionist already reads
-- gcal_default_minutes here; the app now reads the same key instead of
-- carrying its own hardcoded two hours, so a lead-booked job and a manually
-- booked one no longer disagree about how long an unrecorded job runs.
insert into public.settings (key, value)
values ('gcal_default_minutes', '90')
on conflict (key) do nothing;

-- ── Verify ───────────────────────────────────────────────────────────────────
select
  (select value from public.settings where key = 'gcal_default_minutes') as default_minutes,
  count(*) filter (where gcal_date is not null)                          as scheduled_jobs,
  count(*) filter (where gcal_date is not null
                     and gcal_duration_minutes is null)                  as still_using_default
from public.invoices;
