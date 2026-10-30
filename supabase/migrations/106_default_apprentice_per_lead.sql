-- 106_default_apprentice_per_lead.sql
-- ─── A default apprentice for each lead, not just the owner ─────────────────
--
-- 094/098 stamp settings.default_apprentice_id onto a new document only when its
-- owner is an admin. That was Jake's whole team. Once Kaulana graduates to Service
-- Tech, he and Jake share one apprentice, and Kaulana's own new jobs need the
-- apprentice too.
--
-- Each lead now has a setting of his own:
--   default_apprentice_id:<lead's user uuid>   -> that lead's default apprentice
-- and the owner's original key keeps working exactly as before:
--   default_apprentice_id                      -> fallback, admins only
--
-- Rules, in order, when a new invoices row has no apprentice_id:
--   1. the owner's own key, if it holds a uuid that is a real profile and is not
--      the owner himself;
--   2. else, if the owner is an admin, the original key (unchanged 098 behaviour);
--   3. else nothing.
-- An empty value means "no default". INSERT only, as before: editing a job's
-- apprentice afterwards (v1.41.9) is never undone.
--
-- Settings are readable by every signed-in user except the deny-list in
-- is_privileged_setting() (070), and these keys are not on it, so a tech's own
-- INSERT can read his key. Writes stay admin-only: Jake sets everyone's default
-- in Settings > Default Apprentice.
--
-- Patched against the live definition: the DO block refuses to run unless the
-- function still contains 098's two load-bearing lines, so an unseen edit made
-- since then is not silently replaced.

begin;

do $guard$
declare d text;
begin
  select pg_get_functiondef('public.default_assigned_tech()'::regprocedure) into d;
  if d is null then
    raise exception '106: default_assigned_tech() not found - nothing changed';
  end if;
  if d like '%default_apprentice_id:%' then
    raise exception '106: already applied (per-lead key present) - nothing changed';
  end if;
  if position('where key = ''default_apprentice_id''' in d) = 0
     or position('public.is_admin_uid(new.owner_id)' in d) = 0
     or position('from public.profiles where id = v_app::uuid' in d) = 0 then
    raise exception '106: live default_assigned_tech() does not match 098 - nothing changed';
  end if;
end $guard$;

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

  if new.apprentice_id is null and new.owner_id is not null then
    -- 1. The owner's own default (migration 106).
    select nullif(btrim(value), '') into v_app
      from public.settings where key = 'default_apprentice_id:' || new.owner_id::text;

    -- 2. Admins fall back to the original single default (094/098).
    if v_app is null and public.is_admin_uid(new.owner_id) then
      select nullif(btrim(value), '') into v_app
        from public.settings where key = 'default_apprentice_id';
    end if;

    -- profiles, never auth.users: this runs as the caller (098).
    if v_app ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and v_app::uuid <> new.owner_id
       and exists (select 1 from public.profiles where id = v_app::uuid) then
      new.apprentice_id := v_app::uuid;
    end if;
  end if;
  return new;
end;
$$;

commit;
