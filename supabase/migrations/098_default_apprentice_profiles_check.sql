-- 098_default_apprentice_profiles_check.sql
--
-- 094 checked the default apprentice with `select 1 from auth.users`. The trigger is
-- SECURITY INVOKER, and `authenticated` has no privilege on auth.users, so every
-- admin-owned INSERT into invoices (estimate -> invoice conversion, new documents)
-- failed with "permission denied for table users" whenever the setting was a uuid.
-- profiles.id is a FK to auth.users and profiles_read is using (true), so the
-- profiles row answers the same question without touching auth.

begin;

create or replace function public.default_assigned_tech()
returns trigger
language plpgsql
as $$
declare
  v_app text;
begin
  if new.assigned_tech_id is null then
    new.assigned_tech_id := coalesce(new.owner_id, auth.uid());
  end if;

  if new.apprentice_id is null
     and new.owner_id is not null
     and public.is_admin_uid(new.owner_id) then
    select value into v_app from public.settings where key = 'default_apprentice_id';
    if v_app ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and exists (select 1 from public.profiles where id = v_app::uuid) then
      new.apprentice_id := v_app::uuid;
    end if;
  end if;
  return new;
end;
$$;

commit;
