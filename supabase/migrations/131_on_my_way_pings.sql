-- 131_on_my_way_pings.sql
--
-- GPS proof of dispatch. Jake wants to know where a tech actually was the
-- moment he pressed "On My Way" for a job -- not continuous tracking (that's
-- time_activity, migration 097), just a one-shot stamp per button press.
--
-- Written under the tech's own session, same pattern as time_activity: no
-- new API route, no service role, no Node-function-budget cost. Only the
-- tech himself and an admin (Jake) can ever read a row -- not other techs.

begin;

create table if not exists public.on_my_way_pings (
  id          uuid primary key default gen_random_uuid(),
  tech_id     uuid not null references auth.users(id),
  invoice_id  text references public.invoices(id) on delete set null,
  lat         double precision not null,
  lng         double precision not null,
  created_at  timestamptz not null default now()
);

create index if not exists on_my_way_pings_created_idx
  on public.on_my_way_pings (created_at desc);
create index if not exists on_my_way_pings_tech_idx
  on public.on_my_way_pings (tech_id, created_at desc);

alter table public.on_my_way_pings enable row level security;

drop policy if exists on_my_way_pings_select on public.on_my_way_pings;
create policy on_my_way_pings_select on public.on_my_way_pings
  for select using (tech_id = auth.uid() or public.is_admin());

drop policy if exists on_my_way_pings_insert on public.on_my_way_pings;
create policy on_my_way_pings_insert on public.on_my_way_pings
  for insert with check (tech_id = auth.uid());

drop policy if exists on_my_way_pings_admin on public.on_my_way_pings;
create policy on_my_way_pings_admin on public.on_my_way_pings
  for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';

commit;
