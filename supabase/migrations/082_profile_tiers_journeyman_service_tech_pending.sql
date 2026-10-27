-- 082_profile_tiers_journeyman_service_tech_pending.sql
-- Widens profiles.tier from ('apprentice','technician','admin') to also allow
-- 'service_tech', 'journeyman' and 'pending'.
--
-- `tier` is a text column with a CHECK constraint, not a Postgres enum, so this
-- is a constraint swap. It is additive: every existing row still satisfies it.
--
--   pending      invited, has set a password on /welcome, not yet assigned by Jake.
--                The app shows the "Pending setup" screen until this changes.
--   service_tech reserved spelling for "solo jobs + own financials". The app's
--                existing equivalent is 'technician' (labelled "Service Tech" in
--                Settings). Both are valid; see CLAUDE.md "Employee tiers" for
--                the plan to collapse them.
--   journeyman   nearly full access minus admin settings (permissions not built).
--
-- Touches no policy. `role` still drives is_admin() and all RLS.

begin;

alter table public.profiles drop constraint if exists profiles_tier_check;

alter table public.profiles
  add constraint profiles_tier_check
  check (tier in ('apprentice','technician','service_tech','journeyman','admin','pending'));

comment on column public.profiles.tier is
  'pending | apprentice | technician | service_tech | journeyman | admin. '
  'Chooses the Reports scorecard and, from /welcome onward, whether the person '
  'is still waiting for Jake to assign them (pending). Separate from `role`, '
  'which drives is_admin() and all RLS.';

commit;
