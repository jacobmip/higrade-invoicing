-- 044_multiple_visits.sql
-- ─── Let one job be scheduled across several visits ─────────────────────────
--
-- A repipe or a water-heater swap with a rough-in and a finish is one invoice
-- and two or three appointments. The schema only allowed one: gcal_date,
-- gcal_event_id, gcal_duration_minutes, all singular.
--
-- `visits` is the source of truth for every visit on a document. Shape:
--   [{ "id": "v_ab12cd", "start": "2026-09-01T09:00", "minutes": 120,
--      "label": "Rough-in", "eventId": "<google event id or null>" }, ...]
--
-- jsonb rather than a child table, matching the call already made for
-- clients.addresses: this is a short ordered list that is always read with its
-- parent and never queried across rows in SQL.
--
-- ── Why the old columns stay ────────────────────────────────────────────────
-- gcal_date is not just an app field. push_invoice_to_calendar() reads it, a
-- trigger fires the calendar webhook off it when the AI receptionist books a
-- lead, create_estimate_from_lead writes it, and migration 038 normalises its
-- format. Removing it would reach straight into Lisa.
--
-- So a trigger keeps the three singular columns mirroring the EARLIEST visit.
-- Every existing reader keeps working and sees the first appointment, which is
-- what they meant by "the" appointment. There is still exactly one source of
-- truth — nothing writes those columns by hand once visits exist; they are
-- derived.
--
-- The mirror only runs when visits is a non-empty array, so the receptionist
-- writing gcal_date directly on a lead (with no visits) is left alone.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

alter table public.invoices
  add column if not exists visits jsonb;

comment on column public.invoices.visits is
  'Ordered list of scheduled visits: [{id,start,minutes,label,eventId}]. Source of truth; gcal_date/gcal_event_id/gcal_duration_minutes mirror the earliest entry via sync_first_visit().';

create or replace function public.sync_first_visit()
returns trigger
language plpgsql
as $$
declare
  v jsonb;
begin
  -- No visits recorded: leave the singular columns exactly as they are. This
  -- is the path the AI receptionist takes, and it must not be disturbed.
  if new.visits is null
     or jsonb_typeof(new.visits) <> 'array'
     or jsonb_array_length(new.visits) = 0 then
    return new;
  end if;

  select e into v
    from jsonb_array_elements(new.visits) e
   where coalesce(btrim(e->>'start'), '') <> ''
   order by e->>'start'
   limit 1;

  if v is null then
    return new;
  end if;

  -- gcal_date is text in 'YYYY-MM-DDTHH:MM' (migration 038). Assigning the
  -- visit's start directly also re-normalises it, which is useful:
  -- save_invoice_with_items casts the field through timestamptz and would
  -- otherwise write it back in Postgres's own format.
  new.gcal_date             := v->>'start';
  new.gcal_event_id         := nullif(btrim(coalesce(v->>'eventId', '')), '');
  new.gcal_duration_minutes := nullif(btrim(coalesce(v->>'minutes', '')), '')::smallint;
  return new;
end;
$$;

drop trigger if exists invoices_sync_first_visit on public.invoices;
create trigger invoices_sync_first_visit
  before insert or update on public.invoices
  for each row
  execute function public.sync_first_visit();

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Every job already scheduled becomes a one-visit job, so nothing looks
-- unscheduled after this runs.
update public.invoices
   set visits = jsonb_build_array(jsonb_build_object(
         'id',      'v_' || substr(md5(id || coalesce(gcal_date, '')), 1, 8),
         'start',   gcal_date,
         'minutes', coalesce(gcal_duration_minutes,
                             (select nullif(value, '')::int from public.settings where key = 'gcal_default_minutes'),
                             90),
         'label',   '',
         'eventId', gcal_event_id
       ))
 where gcal_date is not null
   and btrim(gcal_date) <> ''
   and visits is null;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- every_scheduled_job_has_visits should equal 0.
select
  count(*) filter (where gcal_date is not null and btrim(gcal_date) <> '')      as scheduled_jobs,
  count(*) filter (where visits is not null)                                    as jobs_with_visits,
  count(*) filter (where gcal_date is not null and btrim(gcal_date) <> ''
                     and visits is null)                                        as every_scheduled_job_has_visits,
  coalesce(max(jsonb_array_length(visits)), 0)                                  as most_visits_on_one_job
from public.invoices;
