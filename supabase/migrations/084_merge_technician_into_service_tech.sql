-- 084_merge_technician_into_service_tech.sql
-- 'technician' and 'service_tech' meant the same tier. Collapse to 'service_tech'.
--
-- 1. Drop the CHECK first (it still allows 'technician', so order is harmless,
--    but the new one must not exist while old rows could violate it).
-- 2. Move existing rows.
-- 3. Re-add the CHECK without 'technician'.
-- 4. Column default 'technician' (from 054) becomes 'service_tech'. New logins
--    are filed 'pending' by handle_new_user() (083); the default only matters
--    to a writer that inserts a profile without a tier.
-- Touches no policy.

begin;

alter table public.profiles drop constraint if exists profiles_tier_check;

update public.profiles set tier = 'service_tech' where tier = 'technician';

alter table public.profiles
  add constraint profiles_tier_check
  check (tier in ('pending','apprentice','service_tech','journeyman','admin'));

alter table public.profiles alter column tier set default 'service_tech';

comment on column public.profiles.tier is
  'pending | apprentice | service_tech | journeyman | admin. '
  'Chooses the Reports scorecard and, from /welcome onward, whether the person '
  'is still waiting for Jake to assign them (pending). Separate from `role`, '
  'which drives is_admin() and all RLS.';

commit;
