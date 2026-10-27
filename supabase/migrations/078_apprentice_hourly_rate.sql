-- 078_apprentice_hourly_rate.sql
--
-- Sets the apprentice's hourly rate to $25/hr (confirmed by Jake 2026-10-26).
--
-- RUN THIS AFTER Jake creates the login in Supabase Auth for
-- kmakaula23@gmail.com. Until that user exists there is no user_id to key
-- tech_pay on, so this RAISES instead of doing nothing: a silent no-op would
-- read as "rate set" when no row was written.
--
-- commission_pct is deliberately left alone (Jake has not decided it). On a
-- re-run only hourly_rate is touched, so a commission set later survives.
--
-- Numbered 078, not 076: 076 and 077 are on disk from another session.

begin;

do $$
declare
  v_tech  uuid;
  v_admin uuid;
begin
  select id into v_tech from auth.users
   where lower(email) = 'kmakaula23@gmail.com';
  if v_tech is null then
    raise exception 'No auth user for kmakaula23@gmail.com yet. Create the login in Supabase Auth first, then re-run.';
  end if;

  select id into v_admin from auth.users
   where lower(email) = 'jacobmip@gmail.com';

  insert into public.tech_pay (tech_id, hourly_rate, updated_by)
  values (v_tech, 25, v_admin)
  on conflict (tech_id) do update
    set hourly_rate = excluded.hourly_rate,
        updated_at  = now(),
        updated_by  = excluded.updated_by;
end $$;

commit;
