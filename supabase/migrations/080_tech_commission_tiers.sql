-- 080_tech_commission_tiers.sql
--
-- Tiered weekly commission. Each row says: once a tech's weekly commissionable
-- sales reach threshold_cents, the rate is rate_pct. The tier with the highest
-- threshold at or below the week's total applies. tech_pay.commission_pct (075)
-- stays as the flat fallback for a tech with no tier rows.
--
-- This migration is the data model only. Nothing in the app or the pay report
-- reads it yet, and "weekly" is a property of whoever computes the total, not
-- of this table.
--
-- Same privacy shape as tech_pay: a tech reads his own tiers, only an admin
-- writes. Not on profiles, whose read policy is using (true).

begin;

create table if not exists public.tech_commission_tiers (
  id              uuid primary key default gen_random_uuid(),
  tech_id         uuid not null references public.profiles(id) on delete cascade,
  threshold_cents integer not null check (threshold_cents >= 0),
  rate_pct        numeric not null check (rate_pct between 0 and 100),
  created_at      timestamptz not null default now(),
  unique (tech_id, threshold_cents)
);

comment on table public.tech_commission_tiers is
  'Weekly commission tiers per tech: at or above threshold_cents of weekly '
  'sales the rate is rate_pct; highest qualifying threshold wins. '
  'tech_pay.commission_pct is the flat fallback (migration 080).';

alter table public.tech_commission_tiers enable row level security;

drop policy if exists tech_commission_tiers_select on public.tech_commission_tiers;
create policy tech_commission_tiers_select on public.tech_commission_tiers
  for select to authenticated
  using (tech_id = auth.uid() or public.is_admin());

drop policy if exists tech_commission_tiers_write on public.tech_commission_tiers;
create policy tech_commission_tiers_write on public.tech_commission_tiers
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Apprentice: kmakaula23@gmail.com
insert into public.tech_commission_tiers (tech_id, threshold_cents, rate_pct)
select '0152abad-6cc0-49f6-846a-042bf528ae30'::uuid, t.threshold_cents, t.rate_pct
  from (values (0, 15::numeric), (150000, 18::numeric), (300000, 20::numeric)) as t(threshold_cents, rate_pct)
 where exists (select 1 from public.profiles where id = '0152abad-6cc0-49f6-846a-042bf528ae30')
on conflict (tech_id, threshold_cents) do nothing;

commit;
