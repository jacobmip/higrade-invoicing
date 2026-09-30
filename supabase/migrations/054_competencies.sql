-- 054_competencies.sql
-- Apprentice competency tracking, and the role tier that decides which
-- scorecard a person gets.
--
-- Why a tier separate from profiles.role: `role` drives is_admin(), which
-- every RLS policy in the database depends on. Overloading it with
-- 'apprentice' would quietly change authorization. `tier` is presentation
-- and pay-band only and touches no policy.

-- ── 1. Role tier ────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists tier text not null default 'technician';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_tier_check') then
    alter table public.profiles
      add constraint profiles_tier_check
      check (tier in ('apprentice','technician','admin'));
  end if;
end $$;

comment on column public.profiles.tier is
  'apprentice | technician | admin. Chooses the Reports scorecard: an '
  'apprentice is measured on competency progress, a technician on revenue. '
  'Separate from `role`, which drives is_admin() and all RLS.';

-- Existing accounts: the owner is admin, everyone else is assumed to be a
-- revenue-generating tech until Jake says otherwise. Nobody is silently
-- demoted to apprentice.
update public.profiles set tier = 'admin' where role = 'admin' and tier = 'technician';

-- ── 2. Competency levels ────────────────────────────────────────────────────
-- One row per (tech, skill). skill_key matches a `key` in src/competencies.js.
-- The catalog is deliberately NOT a table: it is code, so it is versioned and
-- reviewable. An orphaned row from a removed skill is harmless.
create table if not exists public.tech_competencies (
  id          uuid primary key default gen_random_uuid(),
  tech_id     uuid not null references auth.users(id) on delete cascade,
  skill_key   text not null,
  level       smallint not null default 0 check (level between 0 and 4),
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  unique (tech_id, skill_key)
);

create index if not exists tech_competencies_tech_idx
  on public.tech_competencies (tech_id);

alter table public.tech_competencies enable row level security;

-- A tech may read their own record. Only an admin may read anyone else's, and
-- only an admin may sign a skill off — self-assessment would make the
-- graduation gate meaningless.
drop policy if exists tech_competencies_select on public.tech_competencies;
create policy tech_competencies_select on public.tech_competencies
  for select using (tech_id = auth.uid() or public.is_admin());

drop policy if exists tech_competencies_write on public.tech_competencies;
create policy tech_competencies_write on public.tech_competencies
  for all using (public.is_admin()) with check (public.is_admin());
