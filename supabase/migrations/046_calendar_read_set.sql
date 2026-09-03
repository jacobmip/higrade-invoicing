-- 046_calendar_read_set.sql
-- ─── Read several calendars, write to one ──────────────────────────────────
--
-- The app was reading and writing 'primary' while the AI receptionist's Apps
-- Script books jobs on the shared Work calendar. Nothing errored, which is what
-- made it invisible: events were created, no failures were raised, but the
-- two-way reconciliation added in "Reconcile visits with Google Calendar in
-- both directions" was comparing two unrelated calendars and so matched
-- nothing. The app never saw a job Lisa booked.
--
-- Split the single calendar_id into a write target and a read set:
--   calendar_id       — where the app CREATES events. Now the Work calendar, so
--                       app-booked jobs land beside Lisa's.
--   read_calendar_ids — every calendar the Calendar tab lists. Keeps personal
--                       events visible alongside work.
--
-- Update and delete are not driven by this alone: /api/gcal tries the write
-- calendar first and falls back across the read set, because events created by
-- the OLD browser flow still live on 'primary' and patching them on Work would
-- 404. That fallback is what stops a reschedule failing on a legacy job.

alter table public.google_credentials
  add column if not exists read_calendar_ids text[] not null default '{primary}';

comment on column public.google_credentials.calendar_id is
  'Write target: the calendar the app creates events on. Must match the calendar the receptionist Apps Script books to, or reconciliation matches nothing.';

comment on column public.google_credentials.read_calendar_ids is
  'Every calendar the app lists events from. Include the write target.';

-- Work calendar, per the Apps Script the receptionist posts to.
update public.google_credentials
set calendar_id       = 'fcqqtdsa77rru3ikdqno2hiims@group.calendar.google.com',
    read_calendar_ids = array['primary', 'fcqqtdsa77rru3ikdqno2hiims@group.calendar.google.com'],
    updated_at        = now()
where id = 'google_calendar';
