-- 097_time_activity.sql
--
-- Automatic GPS activity tracking while a tech is clocked in. The phone polls
-- every 5 minutes, categorises where he is (on a job, driving, at a supply
-- house, at the shop, stationary) and records it as a run of segments.
--
-- WHY NOT `time_entries`
-- `time_entries` already exists (072, 092) and is the payroll clock: one row per
-- clock-in/clock-out. This is a different grain, many segments inside one clock
-- session, so it is its own table. `clock_session_id` points at the
-- time_entries row (day clock or job shift) the segment happened inside.
--
-- This table informs; it does not pay. Paid hours still come from time_entries.
--
-- Policies use is_admin() (profiles.role), not profiles.tier: tier is pay band
-- and touches no policy (see CLAUDE.md).

begin;

create table if not exists public.time_activity (
  id               uuid primary key default gen_random_uuid(),
  tech_id          uuid not null references auth.users(id),
  owner_id         uuid references auth.users(id),
  clock_session_id uuid references public.time_entries(id) on delete set null,
  start_time       timestamptz not null,
  end_time         timestamptz,
  last_seen_at     timestamptz not null default now(),
  category         text not null check (category in
                     ('on_job','in_transit','parts_run','shop','stationary','off_clock')),
  invoice_id       text references public.invoices(id) on delete set null,
  location_lat     double precision,
  location_lng     double precision,
  notes            text,
  created_at       timestamptz not null default now()
);

create index if not exists time_activity_tech_start_idx
  on public.time_activity (tech_id, start_time desc);
-- At most one open segment per tech.
create unique index if not exists time_activity_one_open_per_tech
  on public.time_activity (tech_id) where end_time is null;

alter table public.time_activity enable row level security;

drop policy if exists time_activity_select on public.time_activity;
create policy time_activity_select on public.time_activity
  for select using (tech_id = auth.uid() or owner_id = auth.uid() or public.is_admin());

drop policy if exists time_activity_insert on public.time_activity;
create policy time_activity_insert on public.time_activity
  for insert with check (tech_id = auth.uid() and owner_id is null);

-- A tech closes and refreshes his own open segment. He cannot reassign a row.
drop policy if exists time_activity_update on public.time_activity;
create policy time_activity_update on public.time_activity
  for update using (tech_id = auth.uid() and end_time is null)
  with check (tech_id = auth.uid() and owner_id is null);

drop policy if exists time_activity_admin on public.time_activity;
create policy time_activity_admin on public.time_activity
  for all using (public.is_admin()) with check (public.is_admin());

-- Jake's shop / home base for the "shop" category. Blank until he sets them;
-- a blank value means no shop match, never a match at 0,0.
insert into public.settings (key, value) values
  ('home_base_lat', ''), ('home_base_lng', '')
  on conflict (key) do nothing;

commit;
