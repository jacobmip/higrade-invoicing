-- 083_invite_onboarding_pending.sql
-- Employee onboarding via the /welcome page. Requires 082 (the 'pending' tier).
--
-- 1. handle_new_user() now files every new login as tier 'pending'. Before this
--    a new profile took the column default 'technician', i.e. an invited person
--    silently became a Service Tech with no one deciding it. Jake's own row and
--    the two existing accounts are untouched (insert-only trigger).
--
-- 2. complete_my_onboarding(name) lets a pending person put his own name on his
--    profile. profiles has no self-update policy (profiles_admin_modify is the
--    only write path), so without a narrow SECURITY DEFINER function the name
--    typed on /welcome could not reach the roster. It touches display_name and
--    nothing else, only on the caller's own row, and only while still pending.
--
-- Phone is NOT stored on profiles on purpose: profiles_read is `using (true)`,
-- so a phone column there would be readable by every login. /welcome keeps it
-- in auth user_metadata (visible to Jake in the Auth dashboard).

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into profiles (id, display_name, role, tier)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'plumber',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end; $function$;

create or replace function public.complete_my_onboarding(p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  update profiles
     set display_name = coalesce(nullif(btrim(p_name), ''), display_name)
   where id = auth.uid()
     and tier = 'pending';
end; $function$;

revoke all on function public.complete_my_onboarding(text) from public, anon;
grant execute on function public.complete_my_onboarding(text) to authenticated;

commit;
