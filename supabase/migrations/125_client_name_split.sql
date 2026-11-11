-- 125_client_name_split.sql
-- ─── Every new client gets first / last name, not just `name` ───────────────
--
-- 109 added first_name / last_name / company_name and backfilled the clients
-- that existed then. Lisa's create_estimate_from_lead() still writes only
-- `name`, so every lead since (Dan, EST1204) showed "Dan" on the document but
-- blank First / Last in the edit form. Jake, 2026-11-11.
--
-- A trigger fills them on insert or name change, only when all three are
-- empty and the name looks like a person: letters, spaces, apostrophes and
-- hyphens, no company words, not a placeholder like "Yelp lead - no name".
-- One word goes to first_name. Older single-word clients (many are
-- businesses: Byblos, Arrancino) are left alone; only clients created since
-- 109 shipped (2026-11-03) are backfilled.

begin;

create or replace function public.tg_split_client_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v text := btrim(regexp_replace(coalesce(NEW.name, ''), '\s+', ' ', 'g'));
begin
  if NEW.first_name is not null or NEW.last_name is not null or NEW.company_name is not null then
    return NEW;
  end if;
  if v = '' or v !~ '^[A-Za-z][A-Za-z''.-]*( [A-Za-z][A-Za-z''.-]*)*$'
     or v ~* '\m(llc|inc|corp|construction|contracting|services|company|co|lead|test|plumbing)\M' then
    return NEW;
  end if;
  NEW.first_name := split_part(v, ' ', 1);
  NEW.last_name  := nullif(substring(v from position(' ' in v) + 1), v);
  return NEW;
end;
$$;

drop trigger if exists split_client_name on public.clients;
create trigger split_client_name before insert or update of name on public.clients
  for each row execute function public.tg_split_client_name();

-- Backfill: clients created since 109, through the same rule.
update public.clients set name = name
 where created_at >= '2026-11-03'
   and first_name is null and last_name is null and company_name is null;

commit;
