-- 094_default_apprentice.sql
--
-- Default Apprentice. A document created by an admin gets invoices.apprentice_id
-- filled from settings.default_apprentice_id, silently, in the same trigger that
-- defaults assigned_tech_id (058). A trigger and not app code, so the receptionist
-- RPCs and every other writer are covered too.
--
-- apprentice_id is display only: it grants no access (RLS is untouched) and
-- save_invoice_with_items never names it, so a full save cannot clobber it.
-- The setting is ordinary config (readable by default, see 070); the admin sets it
-- in Settings. A blank or non-uuid value is ignored rather than failing the insert.

begin;

alter table public.invoices
  add column if not exists apprentice_id uuid references auth.users(id) on delete set null;

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
       and exists (select 1 from auth.users where id = v_app::uuid) then
      new.apprentice_id := v_app::uuid;
    end if;
  end if;
  return new;
end;
$$;

-- Kaulana Makaula is the current default apprentice.
insert into public.settings (key, value)
values ('default_apprentice_id', '0152abad-6cc0-49f6-846a-042bf528ae30')
on conflict (key) do nothing;

commit;
