-- 072_time_clock.sql
--
-- Clock in and clock out on a job, with the phone's GPS recorded at both ends
-- and the distance to the job site worked out in the database.
--
-- WHY THE DISTANCE IS COMPUTED HERE AND NOT IN THE APP
-- The app runs on the phone of the person being measured. A number the phone
-- calculates and sends is a number the phone can choose. The device
-- coordinates have to come from the phone — nothing else knows where he is —
-- but the job's location, the radius and the arithmetic all live here, so the
-- only thing he supplies is the one thing he has to.
--
-- It is still an honesty aid and not a security control: any phone can be made
-- to report a false position. Jake's call (2026-10-26) was to let an off-site
-- clock event through, flag it, and get a text immediately, rather than block
-- a man out of his own timesheet over a bad GPS fix in a crawlspace. That is
-- what this implements. The raw lat/lng is kept on every entry so a flagged
-- entry can be looked at rather than argued about.

begin;

-- ── 1. Where the job is ────────────────────────────────────────────────────
-- Geocoded from the job address by the app (/api/geocode already exists), and
-- cached here so a clock-in in a dead zone does not need the network.
alter table public.invoices
  add column if not exists job_lat        double precision,
  add column if not exists job_lng        double precision,
  add column if not exists job_geo_at     timestamptz,
  add column if not exists job_geo_source text;

comment on column public.invoices.job_lat is
  'Geocoded job-site latitude, the centre of the clock-in geofence. Set once '
  'from the job address; only an admin may change it after that (migration 072).';

-- A tech may fill these in when they are empty — that is just caching the
-- geocode of an address he can already see — but he may not move a fence that
-- is already set, which would be moving the goalposts on his own timesheet.
create or replace function public.guard_job_geo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;
  if old.job_lat is not null and new.job_lat is distinct from old.job_lat then
    new.job_lat := old.job_lat;
  end if;
  if old.job_lng is not null and new.job_lng is distinct from old.job_lng then
    new.job_lng := old.job_lng;
  end if;
  if new.job_lat is distinct from old.job_lat or new.job_lng is distinct from old.job_lng then
    new.job_geo_at     := now();
    new.job_geo_source := coalesce(new.job_geo_source, 'geocode');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_job_geo on public.invoices;
create trigger trg_guard_job_geo
  before update on public.invoices
  for each row execute function public.guard_job_geo();

-- ── 2. The radius ──────────────────────────────────────────────────────────
-- One setting, not a column, so Jake can widen it without a migration the
-- first time a long driveway or a condo tower produces a false flag.
insert into public.settings (key, value)
  values ('geofence_radius_m', '150')
  on conflict (key) do nothing;

-- ── 3. Distance, in metres ─────────────────────────────────────────────────
-- Haversine. PostGIS is not installed and this does not justify installing it:
-- at these distances the error is centimetres.
create or replace function public.meters_between(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371000 * 2 * asin(sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
           + cos(radians(lat1)) * cos(radians(lat2))
           * power(sin(radians(lng2 - lng1) / 2), 2)
         ))
  end;
$$;

-- ── 4. The timesheet ───────────────────────────────────────────────────────
-- One row per visit to a job by one person. invoice_id is nullable on purpose:
-- shop time, a supply-house run and drive time are real paid hours with no
-- job attached, and a timesheet that cannot record them is a timesheet Jake
-- has to correct by hand every week.
create table if not exists public.time_entries (
  id                uuid primary key default gen_random_uuid(),
  tech_id           uuid not null references auth.users(id) on delete restrict,
  invoice_id        text references public.invoices(id) on delete set null,
  kind              text not null default 'job'
                      check (kind in ('job','shop','supply','drive','other')),

  clock_in_at       timestamptz not null default now(),
  clock_in_lat      double precision,
  clock_in_lng      double precision,
  clock_in_accuracy double precision,
  clock_in_m        double precision,
  clock_in_on_site  boolean,

  clock_out_at      timestamptz,
  clock_out_lat     double precision,
  clock_out_lng     double precision,
  clock_out_accuracy double precision,
  clock_out_m       double precision,
  clock_out_on_site boolean,

  -- Written by the database, never by the client, so "how long did he work"
  -- is not a number the phone gets to supply either.
  minutes           integer,

  note              text,
  -- Jake's review. An entry he has blessed stops showing up as needing a look.
  reviewed_at       timestamptz,
  reviewed_by       uuid references auth.users(id),
  edited_by_admin   boolean not null default false,

  alert_status      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.time_entries is
  'One clock-in/clock-out per person per visit. minutes, the distances and the '
  'on-site flags are all computed by trigger, never accepted from the client.';

-- One person cannot be on the clock twice at once. A partial unique index on
-- the open entry is what makes "clock in" idempotent-ish and stops a
-- double-tap producing two open shifts.
create unique index if not exists time_entries_one_open_per_tech
  on public.time_entries (tech_id)
  where clock_out_at is null;

create index if not exists time_entries_tech_day_idx
  on public.time_entries (tech_id, clock_in_at desc);
create index if not exists time_entries_invoice_idx
  on public.time_entries (invoice_id)
  where invoice_id is not null;
create index if not exists time_entries_needs_review_idx
  on public.time_entries (clock_in_at desc)
  where reviewed_at is null;

-- ── 5. The maths, and the refusal to take the client's word for it ─────────
create or replace function public.tg_time_entry_compute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_radius double precision;
  v_lat    double precision;
  v_lng    double precision;
begin
  v_radius := coalesce(
    nullif((select value from public.settings where key = 'geofence_radius_m'), '')::double precision,
    150);

  if new.invoice_id is not null then
    select job_lat, job_lng into v_lat, v_lng
      from public.invoices where id = new.invoice_id;
  end if;

  -- Always recomputed from the coordinates. Whatever the client sent in these
  -- columns is discarded.
  new.clock_in_m := public.meters_between(v_lat, v_lng, new.clock_in_lat, new.clock_in_lng);
  new.clock_in_on_site := case
    when new.clock_in_m is null then null          -- unknown, not "off site"
    else new.clock_in_m <= v_radius end;

  new.clock_out_m := public.meters_between(v_lat, v_lng, new.clock_out_lat, new.clock_out_lng);
  new.clock_out_on_site := case
    when new.clock_out_m is null then null
    else new.clock_out_m <= v_radius end;

  if new.clock_out_at is not null then
    if new.clock_out_at < new.clock_in_at then
      raise exception 'INVALID_INPUT: clock-out is before clock-in';
    end if;
    new.minutes := ceil(extract(epoch from (new.clock_out_at - new.clock_in_at)) / 60.0);
  else
    new.minutes := null;
  end if;

  if tg_op = 'UPDATE' then
    -- An entry a tech cannot edit after the fact is the whole point of a
    -- clock. He may close an open shift; he may not reopen a closed one,
    -- move its start, or move it to a different job or person.
    if not public.is_admin() then
      if old.clock_out_at is not null then
        raise exception 'FORBIDDEN: that shift is already closed. Ask Jake to fix it.';
      end if;
      new.tech_id     := old.tech_id;
      new.invoice_id  := old.invoice_id;
      new.clock_in_at := old.clock_in_at;
      new.clock_in_lat := old.clock_in_lat;
      new.clock_in_lng := old.clock_in_lng;
      new.reviewed_at := old.reviewed_at;
      new.reviewed_by := old.reviewed_by;
      new.edited_by_admin := old.edited_by_admin;
    elsif new.clock_in_at  is distinct from old.clock_in_at
       or new.clock_out_at is distinct from old.clock_out_at
       or new.minutes      is distinct from old.minutes then
      new.edited_by_admin := true;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_time_entry_compute on public.time_entries;
create trigger trg_time_entry_compute
  before insert or update on public.time_entries
  for each row execute function public.tg_time_entry_compute();

-- ── 6. Row security ────────────────────────────────────────────────────────
alter table public.time_entries enable row level security;

-- A tech sees and keeps his own timesheet. He does not see anyone else's
-- hours, which is also what keeps pay private between Jake and each employee.
drop policy if exists time_entries_select on public.time_entries;
create policy time_entries_select on public.time_entries
  for select to authenticated
  using (tech_id = auth.uid() or public.is_admin());

drop policy if exists time_entries_insert on public.time_entries;
create policy time_entries_insert on public.time_entries
  for insert to authenticated
  with check (tech_id = auth.uid() or public.is_admin());

drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries
  for update to authenticated
  using      (tech_id = auth.uid() or public.is_admin())
  with check (tech_id = auth.uid() or public.is_admin());

-- Deleting hours is the owner's alone. A tech who can delete a shift can
-- delete the evidence of a short day.
drop policy if exists time_entries_delete on public.time_entries;
create policy time_entries_delete on public.time_entries
  for delete to authenticated
  using (public.is_admin());

commit;
